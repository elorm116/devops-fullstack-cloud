const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const Post = require('./models/Post');
const auth = require('./middleware/auth');
const client = require('prom-client');
const { getVaultClient } = require('./services/vault');

const app = express();

// ─── Security middleware ─────────────────────────────────────────────────────
app.use(helmet());
app.use(express.json({ limit: '16kb' }));

// CORS — restrict to known origins in production
const ALLOWED_ORIGINS = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',')
  : ['http://localhost:3000'];
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));

// Rate limiting — 100 requests per 15 min per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

// Stricter limiter for auth endpoints (20 per 15 min)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many auth attempts, please try again later.' },
});

// ─── Config ──────────────────────────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/blog';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is required');
  process.exit(1);
}

mongoose
  .connect(MONGO_URI, {
    serverSelectionTimeoutMS: 30000, // wait up to 30 s for MongoDB to become ready
  })
  .then(() => console.log('DB Connected'))
  .catch((err) => {
    console.error('DB connection error:', err.message);
    process.exit(1);
  });

// ─── Prometheus Metrics ──────────────────────────────────────────────────────
client.collectDefaultMetrics();

const httpRequestDurationMicroseconds = new client.Histogram({
  name: 'http_request_duration_ms',
  help: 'Duration of HTTP requests in ms',
  labelNames: ['method', 'route', 'code'],
  buckets: [50, 100, 200, 300, 400, 500, 750, 1000, 2000],
});

app.use((req, res, next) => {
  const end = httpRequestDurationMicroseconds.startTimer();
  res.on('finish', () => {
    const route = req.route ? req.route.path : 'unknown_route';
    end({ route, code: res.statusCode, method: req.method });
  });
  next();
});

// ─── Validation Schemas ──────────────────────────────────────────────────────
const registerSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required(),
  password: Joi.string().min(8).max(128).required(),
  email: Joi.string().email().allow('', null).optional(),
  fullName: Joi.string().max(100).allow('', null).optional(),
});

const loginSchema = Joi.object({
  username: Joi.string().required(),
  password: Joi.string().required(),
});

const postSchema = Joi.object({
  title: Joi.string().trim().min(1).max(200).required(),
  content: Joi.string().trim().min(1).max(10000).required(),
});

// ─── Health / Metrics ────────────────────────────────────────────────────────
app.get('/metrics', async (_req, res) => {
  try {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
  } catch (e) {
    res.status(500).end(e.message);
  }
});

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

app.get('/health/vault', async (_req, res) => {
  try {
    const vault = getVaultClient();
    const status = await vault.healthCheck();
    const code = status.ok ? 200 : 503;
    res.status(code).json(status);
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── AUTH ────────────────────────────────────────────────────────────────────
app.post('/api/register', authLimiter, async (req, res) => {
  try {
    const { error, value } = registerSchema.validate(req.body);
    if (error) return res.status(400).json({ message: error.details[0].message });

    const { username, password, email, fullName } = value;
    const existing = await User.findOne({ username });
    if (existing) {
      return res.status(409).json({ message: 'Username already taken' });
    }
    const hashedPassword = await bcrypt.hash(password, 12);
    const user = new User({ username, password: hashedPassword, email, fullName });
    await user.save();
    res.status(201).json({ message: 'User registered' });
  } catch (e) {
    console.error('Register error:', e.message);
    res.status(500).json({ message: 'Registration failed' });
  }
});

app.post('/api/login', authLimiter, async (req, res) => {
  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) return res.status(400).json({ message: error.details[0].message });

    const { username, password } = value;
    const user = await User.findOne({ username });
    if (user && (await bcrypt.compare(password, user.password))) {
      const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
      res.json({ token, username: user.username });
    } else {
      res.status(401).json({ message: 'Invalid credentials' });
    }
  } catch (e) {
    console.error('Login error:', e.message);
    res.status(500).json({ message: 'Login failed' });
  }
});

app.get('/api/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userData.userId).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (e) {
    console.error('Get user error:', e.message);
    res.status(500).json({ message: 'Could not fetch user' });
  }
});

// ─── BLOG POSTS ──────────────────────────────────────────────────────────────
app.get('/api/posts', async (_req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 });
    res.json(posts);
  } catch (e) {
    console.error('Get posts error:', e.message);
    res.status(500).json({ message: 'Could not fetch posts' });
  }
});

app.post('/api/posts', auth, async (req, res) => {
  try {
    const { error, value } = postSchema.validate(req.body);
    if (error) return res.status(400).json({ message: error.details[0].message });

    const { title, content } = value;
    const user = await User.findById(req.userData.userId);
    const post = new Post({
      title,
      content,
      author: user?.username || 'Anonymous',
      userId: req.userData.userId,
    });
    await post.save();
    res.status(201).json(post);
  } catch (e) {
    console.error('Create post error:', e.message);
    res.status(500).json({ message: 'Could not create post' });
  }
});

app.delete('/api/posts/:id', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    // Only the author can delete their own post
    if (post.userId && post.userId.toString() !== req.userData.userId) {
      return res.status(403).json({ message: 'Not authorized to delete this post' });
    }

    await post.deleteOne();
    res.json({ message: 'Post deleted' });
  } catch (e) {
    console.error('Delete post error:', e.message);
    res.status(500).json({ message: 'Could not delete post' });
  }
});

// ─── Start Server ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, async () => {
  console.log(`Server running on ${PORT}`);

  // Verify Vault connectivity on startup (non-blocking)
  try {
    const vault = getVaultClient();
    const status = await vault.healthCheck();
    if (status.ok) {
      console.log(`[Vault] Connected — version ${status.version}, sealed=${status.sealed}`);
    } else {
      console.warn(`[Vault] Unreachable on startup: ${status.error}`);
    }
  } catch (err) {
    console.warn(`[Vault] Not configured or unreachable: ${err.message}`);
  }
});

// ─── Graceful Shutdown ───────────────────────────────────────────────────────
function gracefulShutdown(signal) {
  console.log(`\n${signal} received — shutting down gracefully...`);
  server.close(async () => {
    try {
      await mongoose.connection.close();
      console.log('MongoDB connection closed.');
    } catch (err) {
      console.error('Error closing MongoDB connection:', err.message);
    }
    process.exit(0);
  });

  // Force exit after 10 seconds if graceful shutdown fails
  setTimeout(() => {
    console.error('Forced shutdown — timeout exceeded');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
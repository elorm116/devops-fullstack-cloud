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
const { verifyGoogleToken } = require('./services/oauth');

const app = express();

// ─── Security middleware ─────────────────────────────────────────────────────
app.set('trust proxy', 1); // Trust first proxy for correct IP logging (if behind a proxy)
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

// ─── Internal-only middleware ────────────────────────────────────────────────
const internalOnly = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
    return next();
  }
  return res.status(403).json({ message: 'Forbidden' });
};

// ─── Config ──────────────────────────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/blog';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is required');
  process.exit(1);
}

mongoose
  .connect(MONGO_URI, {
    serverSelectionTimeoutMS: 30000,
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

// Internal only — Prometheus scrapes this, should never be public
app.get('/metrics', internalOnly, async (_req, res) => {
  try {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
  } catch (e) {
    res.status(500).end(e.message);
  }
});

// Public — used by Docker healthcheck
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

// Internal only — leaks infrastructure info
app.get('/health/vault', internalOnly, async (_req, res) => {
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
    const user = new User({
      username,
      password: hashedPassword,
      email,
      fullName,
      authProvider: 'local',
    });
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

    // Prevent Google SSO users from logging in with a password
    if (user && user.authProvider === 'google') {
      return res.status(400).json({
        message: 'This account uses Google Sign-In. Please use the Google button to log in.',
      });
    }

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

// ─── GOOGLE SSO ──────────────────────────────────────────────────────────────
app.post('/api/auth/google', authLimiter, async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({ message: 'Google ID token is required' });
    }

    // Verify the token with Google
    const googleUser = await verifyGoogleToken(idToken);
    const { googleId, email, name, picture } = googleUser;

    // Check if user already exists by Google ID
    let user = await User.findOne({ googleId });

    if (!user) {
      // Check if a local account already has this email
      const emailConflict = await User.findOne({ email });
      if (emailConflict) {
        return res.status(409).json({
          message: 'An account with this email already exists. Please log in with your username and password.',
        });
      }

      // Auto-create account — generate a unique username from their Google name
      let baseUsername = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'user';
      let username = baseUsername;
      let suffix = 1;
      while (await User.findOne({ username })) {
        username = `${baseUsername}${suffix++}`;
      }

      user = new User({
        username,
        password: null,
        email,
        fullName: name,
        googleId,
        picture,
        authProvider: 'google',
      });
      await user.save();
      console.log(`[SSO] Auto-created Google account for ${email} as @${username}`);
    }

    // Issue your app's JWT — same as regular login from here on
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username: user.username });
  } catch (e) {
    console.error('Google SSO error:', e.message);
    if (
      e.message.includes('Invalid Google token') ||
      e.message.includes('expired') ||
      e.message.includes('audience')
    ) {
      return res.status(401).json({ message: 'Google authentication failed. Please try again.' });
    }
    res.status(500).json({ message: 'Google sign-in failed' });
  }
});

app.get('/api/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userData.userId).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Return only the fields the frontend needs
    res.json({
      username: user.username,
      email: user.email || null,
      fullName: user.fullName || null,
      picture: user.picture || null,
      authProvider: user.authProvider,
    });
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

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// ─── Global Error Handler ────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ message: 'Internal server error' });
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
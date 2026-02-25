const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const Post = require('./models/Post');
const auth = require('./middleware/auth');

const app = express();
app.use(express.json());
app.use(cors());

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/blog';
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key';

mongoose
  .connect(MONGO_URI)
  .then(() => console.log('DB Connected'))
  .catch((err) => {
    console.error('DB connection error:', err.message);
    process.exit(1);
  });

// --- HEALTH CHECK (used by Docker Compose healthcheck) ---
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

// --- AUTH ---
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }
    const existing = await User.findOne({ username });
    if (existing) {
      return res.status(409).json({ message: 'Username already taken' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashedPassword });
    await user.save();
    res.status(201).json({ message: 'User registered' });
  } catch (e) {
    console.error('Register error:', e.message);
    res.status(500).json({ message: 'Registration failed' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
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

// --- BLOG POSTS ---
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
    const { title, content } = req.body;
    if (!title || !content) {
      return res.status(400).json({ message: 'Title and content are required' });
    }
    const user = await User.findById(req.userData.userId);
    const post = new Post({ title, content, author: user?.username || 'Anonymous' });
    await post.save();
    res.status(201).json(post);
  } catch (e) {
    console.error('Create post error:', e.message);
    res.status(500).json({ message: 'Could not create post' });
  }
});

app.delete('/api/posts/:id', auth, async (req, res) => {
  try {
    const post = await Post.findByIdAndDelete(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });
    res.json({ message: 'Post deleted' });
  } catch (e) {
    console.error('Delete post error:', e.message);
    res.status(500).json({ message: 'Could not delete post' });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
import { useEffect, useState } from 'react';
import { useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';
import LoginForm from './components/LoginForm';
import PostList from './components/PostList';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || '/api';

function App() {
  const { user, token } = useAuth();
  const [posts, setPosts] = useState([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);

  const fetchPosts = async () => {
    try {
      const res = await fetch(`${API_URL}/posts`);
      const data = await res.json();
      setPosts(data);
    } catch (err) {
      console.error('Failed to fetch posts:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchProfile = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setProfile(data);
      }
    } catch (err) {
      console.error('Failed to fetch profile:', err);
    }
  };

  useEffect(() => {
    fetchPosts();
  }, []);

  useEffect(() => {
    if (user) {
      fetchProfile();
    } else {
      setProfile(null);
    }
  }, [user, token]);

  const handlePost = async (e) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;

    try {
      const res = await fetch(`${API_URL}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title, content }),
      });

      if (res.ok) {
        setTitle('');
        setContent('');
        fetchPosts();
      }
    } catch (err) {
      console.error('Failed to create post:', err);
    }
  };

  return (
    <div className="app">
      <Navbar />

      <main className="container">
        {!user ? (
          <LoginForm />
        ) : (
          <>
            {profile && (
              <section className="profile-section" style={{ marginBottom: '2rem', padding: '1rem', backgroundColor: '#f9f9f9', borderRadius: '8px' }}>
                <h3>Your Profile (Decrypted from Vault)</h3>
                <p><strong>Username:</strong> {profile.username}</p>
                <p><strong>Full Name:</strong> {profile.fullName || 'N/A'}</p>
                <p><strong>Email:</strong> {profile.email || 'N/A'}</p>
              </section>
            )}
            <section className="create-post">
              <h2>Write a New Post</h2>
              <form onSubmit={handlePost}>
                <input
                  type="text"
                  placeholder="Post title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
                <textarea
                  placeholder="What's on your mind?"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={5}
                  required
                />
                <button className="btn btn-primary" type="submit">
                  Publish
                </button>
              </form>
            </section>
          </>
        )}

        <section className="posts-section">
          <h2>Recent Posts</h2>
          {loading ? <p>Loading...</p> : <PostList posts={posts} />}
        </section>
      </main>

      <footer className="footer">
        <p>&copy; {new Date().getFullYear()} Mali's Blog. All rights reserved.</p>
      </footer>
    </div>
  );
}

export default App;

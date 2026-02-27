import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

const API_URL = process.env.REACT_APP_API_URL || '/api';
const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;

export default function LoginForm() {
  const [isLogin, setIsLogin] = useState(true);
  const [form, setForm] = useState({ username: '', password: '', email: '', fullName: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoaded, setGoogleLoaded] = useState(false);
  const { login } = useAuth();

  // ─── Load Google Identity Services script ──────────────────────────────────
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    if (document.getElementById('google-gsi-script')) {
      setGoogleLoaded(true);
      return;
    }
    const script = document.createElement('script');
    script.id = 'google-gsi-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => setGoogleLoaded(true);
    document.body.appendChild(script);
  }, []);

  // ─── Handle Google credential response ────────────────────────────────────
  const handleGoogleResponse = useCallback(async (response) => {
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: response.credential }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || 'Google sign-in failed');
        return;
      }
      login(data.username, data.token);
    } catch {
      setError('Google sign-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [login]);

  // ─── Render Google Sign-In button ─────────────────────────────────────────
  useEffect(() => {
    if (!googleLoaded || !GOOGLE_CLIENT_ID || !window.google) return;
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleResponse,
    });
    window.google.accounts.id.renderButton(
      document.getElementById('google-signin-button'),
      { theme: 'outline', size: 'large', width: 320, text: 'signin_with', shape: 'rectangular' }
    );
  }, [googleLoaded, handleGoogleResponse]);

  // ─── Handle traditional login / register ──────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = isLogin ? '/login' : '/register';
      const payload = isLogin
        ? { username: form.username, password: form.password }
        : form;

      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.ok && isLogin) {
        login(data.username, data.token);
      } else if (res.ok && !isLogin) {
        setIsLogin(true);
        setForm({ username: '', password: '', email: '', fullName: '' });
        setError('');
        alert('Registered! Now please login.');
      } else {
        setError(data.message || 'Something went wrong');
      }
    } catch {
      setError('Could not connect to server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <h2>{isLogin ? 'Login' : 'Sign Up'}</h2>

      {error && <p className="error-msg">{error}</p>}

      {/* Google Sign-In — only shown if client ID is configured */}
      {GOOGLE_CLIENT_ID && (
        <>
          <div id="google-signin-button" style={{ marginBottom: '1rem' }} />
          <div className="auth-divider">
            <span>or</span>
          </div>
        </>
      )}

      <form onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Username"
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
          required
        />
        {!isLogin && (
          <>
            <input
              type="email"
              placeholder="Email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
            <input
              type="text"
              placeholder="Full Name"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              required
            />
          </>
        )}
        <input
          type="password"
          placeholder="Password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          required
        />
        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? 'Please wait...' : isLogin ? 'Login' : 'Create Account'}
        </button>
      </form>

      <p className="auth-toggle" onClick={() => { setIsLogin(!isLogin); setError(''); }}>
        {isLogin ? "Need an account? Sign Up" : "Have an account? Login"}
      </p>
    </div>
  );
}

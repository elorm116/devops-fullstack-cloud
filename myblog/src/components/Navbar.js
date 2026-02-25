import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { user, logout } = useAuth();

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <a href="/" className="navbar-brand">Mali's Blog</a>
        <div className="navbar-right">
          {user ? (
            <>
              <span className="navbar-user">Hi, {user}</span>
              <button className="btn btn-outline" onClick={logout}>Logout</button>
            </>
          ) : null}
        </div>
      </div>
    </nav>
  );
}

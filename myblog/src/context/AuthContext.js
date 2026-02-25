import { createContext, useState, useContext } from 'react';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(localStorage.getItem('username'));
  const [token, setToken] = useState(localStorage.getItem('token'));

  const login = (username, userToken) => {
    localStorage.setItem('token', userToken);
    localStorage.setItem('username', username);
    setToken(userToken);
    setUser(username);
  };

  const logout = () => {
    localStorage.clear();
    setUser(null);
    setToken(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

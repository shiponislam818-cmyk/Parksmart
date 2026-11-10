import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('');

  const clear = useCallback((msg) => {
    setToken(null);
    setUser(null);
    if (msg) setNotice(msg);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler((msg) => clear(msg || 'Your session has ended. Please log in again.'));
    if (!getToken()) { setReady(true); return; }
    api('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => clear())
      .finally(() => setReady(true));
  }, [clear]);

  const login = useCallback(async (identifier, password) => {
    const d = await api('/auth/login', { method: 'POST', body: { identifier, password } });
    setToken(d.token);
    setUser(d.user);
    setNotice('');
    return d.user;
  }, []);

  const register = useCallback(async (form) => {
    const d = await api('/auth/register', { method: 'POST', body: form });
    setToken(d.token);
    setUser(d.user);
    return d.user;
  }, []);

  // FR-AUTH-08: logout discards the token on the client
  const logout = useCallback(async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* token may already be invalid */ }
    clear('You have been logged out.');
  }, [clear]);

  const value = useMemo(() => ({ user, ready, login, register, logout, notice, setNotice }), [user, ready, login, register, logout, notice]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

export function homeFor(role) {
  if (role === 'admin') return '/admin';
  if (role === 'operator') return '/gate';
  return '/driver';
}

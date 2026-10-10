/**
 * Central authentication store (single source of truth for the session).
 * Role/department here is for UI rendering only — the backend re-authorises
 * every request and never trusts values sent by the client.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi, tokenStore, setUnauthorizedHandler } from '../services/api';

const AuthContext = createContext(null);

const HOME_BY_ROLE = {
  student: '/student/dashboard',
  faculty: '/faculty/dashboard',
  hod: '/hod/dashboard',
  admin: '/admin/dashboard',
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => tokenStore.get());
  const [initialising, setInitialising] = useState(true);

  const logout = useCallback(() => {
    tokenStore.clear();
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      tokenStore.clear();
      setToken(null);
      setUser(null);
    });
  }, []);

  // Restore the session on reload by re-validating the token with the backend.
  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      if (!tokenStore.get()) {
        setInitialising(false);
        return;
      }
      try {
        const profile = await authApi.me();
        if (!cancelled) {
          setUser(profile.data);
          setToken(tokenStore.get());
        }
      } catch {
        if (!cancelled) logout();
      } finally {
        if (!cancelled) setInitialising(false);
      }
    };
    restore();
    return () => {
      cancelled = true;
    };
  }, [logout]);

  const login = useCallback(async (email, password) => {
    const result = await authApi.login(email, password);
    tokenStore.set(result.token);
    setToken(result.token);
    setUser(result.user);
    return result.user;
  }, []);

  const refresh = useCallback(async () => {
    const profile = await authApi.me();
    setUser(profile.data);
    return profile.data;
  }, []);

  const value = useMemo(
    () => ({
      user,
      token,
      initialising,
      login,
      logout,
      refresh,
      isAuthenticated: Boolean(token && user),
      role: user?.role || null,
      departmentId: user?.departmentId || null,
      departmentName: user?.department?.departmentName || user?.departmentName || '',
      isAdmin: user?.role === 'admin',
      homePath: HOME_BY_ROLE[user?.role] || '/login',
      can: (...roles) => (user ? roles.includes(user.role) : false),
    }),
    [user, token, initialising, login, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
};

export { HOME_BY_ROLE };
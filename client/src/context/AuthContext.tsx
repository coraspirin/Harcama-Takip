import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, setSessionExpiredHandler } from '../services/api.ts';
import { authService } from '../services/auth.ts';
import type { User } from '../types/index.ts';

/**
 * loading        - acilis kontrolu suruyor
 * setup-required - uygulama hic kurulmamis, ilk super admin olusturulmali
 * anonymous      - kurulum tamam, oturum yok
 * authenticated  - oturum acik
 */
export type AuthStatus = 'loading' | 'setup-required' | 'anonymous' | 'authenticated';

type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  activeSessions: number;
  login: (username: string, password: string) => Promise<User>;
  completeSetup: (input: {
    username: string;
    email?: string;
    password: string;
  }) => Promise<User>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<number>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [activeSessions, setActiveSessions] = useState(0);

  const loadSession = useCallback(async () => {
    try {
      const { setupCompleted } = await authService.setupStatus();
      if (!setupCompleted) {
        setUser(null);
        setStatus('setup-required');
        return;
      }
    } catch {
      // Sunucuya ulasilamadiysa anonim kabul edip giris ekranini gosteririz.
      setStatus('anonymous');
      return;
    }

    try {
      const me = await authService.me();
      setUser(me.user);
      setActiveSessions(me.activeSessions);
      setStatus('authenticated');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PASSWORD_CHANGE_REQUIRED') {
        // Bu duruma normalde dusmeyiz (/auth/me kilitten muaftir) ama guvenli taraf
        setStatus('authenticated');
        return;
      }
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  // Yenileme de basarisiz olduysa oturumu dusur
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setUser(null);
      setActiveSessions(0);
      setStatus('anonymous');
    });
    return () => setSessionExpiredHandler(null);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const { user: logged } = await authService.login({ username, password });
    setUser(logged);
    setStatus('authenticated');
    return logged;
  }, []);

  const completeSetup = useCallback(
    async (input: { username: string; email?: string; password: string }) => {
      const { user: created } = await authService.completeSetup(input);
      setUser(created);
      setStatus('authenticated');
      return created;
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } finally {
      setUser(null);
      setActiveSessions(0);
      setStatus('anonymous');
    }
  }, []);

  const logoutAll = useCallback(async () => {
    const { revokedSessions } = await authService.logoutAll();
    setUser(null);
    setActiveSessions(0);
    setStatus('anonymous');
    return revokedSessions;
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const { user: updated } = await authService.changePassword({ currentPassword, newPassword });
    setUser(updated);
    setStatus('authenticated');
  }, []);

  const refreshUser = useCallback(async () => {
    const me = await authService.me();
    setUser(me.user);
    setActiveSessions(me.activeSessions);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      activeSessions,
      login,
      completeSetup,
      logout,
      logoutAll,
      changePassword,
      refreshUser,
    }),
    [status, user, activeSessions, login, completeSetup, logout, logoutAll, changePassword, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth yalnizca AuthProvider icinde kullanilabilir');
  return ctx;
}

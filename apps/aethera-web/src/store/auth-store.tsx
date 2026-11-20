import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
  createdAt: string;
  updatedAt: string;
}

export interface AuthSession {
  id: string;
  deviceLabel: string;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  isCurrent?: boolean;
}

export interface AuthAuditLog {
  id: number;
  eventType: string;
  ipAddress: string;
  detail: string;
  createdAt: string;
}

export interface LinkedComputer {
  id: string;
  stableHostId: string;
  name: string;
  baseUrl: string;
  tokenFingerprint: string;
  hasCredential: boolean;
  isActive: boolean;
  autoConnect: boolean;
  lastStatus: 'unknown' | 'online' | 'offline' | 'revoked' | 'error';
  lastConnectedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
}

export type AuthStatus = 'loading' | 'setup_required' | 'unauthenticated' | 'authenticated';

interface AuthMeResponse {
  authenticated: boolean;
  setupRequired: boolean;
  setupTokenRequired: boolean;
  user: AuthUser | null;
  sessionId: string | null;
  csrfToken: string | null;
  computers: LinkedComputer[];
}

interface AuthContextValue {
  authState: AuthStatus;
  user: AuthUser | null;
  sessionId: string | null;
  setupTokenRequired: boolean;
  computers: LinkedComputer[];
  sessions: AuthSession[];
  auditLogs: AuthAuditLog[];
  authFetch: (url: string, init?: RequestInit) => Promise<Response>;
  authJson: <T>(url: string, init?: RequestInit) => Promise<T>;
  hydrateAuth: () => Promise<void>;
  setupAdmin: (input: {
    name: string;
    email: string;
    password: string;
    setupToken?: string;
  }) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: (includeCurrent: boolean) => Promise<number>;
  refreshAccountData: () => Promise<void>;
  revokeSession: (targetSessionId: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<string>;
  confirmPasswordReset: (code: string, newPassword: string) => Promise<void>;
  createComputer: (input: {
    name: string;
    baseUrl: string;
    bearerToken: string;
    autoConnect?: boolean;
    setActive?: boolean;
  }) => Promise<{ computer: LinkedComputer; probe: { ok: boolean; offline: boolean; error: string | null } }>;
  updateComputer: (
    computerId: string,
    patch: { name?: string; baseUrl?: string; autoConnect?: boolean; isActive?: boolean },
  ) => Promise<LinkedComputer>;
  rotateComputerCredential: (
    computerId: string,
    bearerToken: string,
    baseUrl?: string,
  ) => Promise<LinkedComputer>;
  revokeComputerCredential: (computerId: string) => Promise<LinkedComputer>;
  testComputer: (
    computerId: string,
  ) => Promise<{ ok: boolean; offline: boolean; error: string | null; computer: LinkedComputer }>;
  deleteComputer: (computerId: string) => Promise<void>;
  syncComputersFromProxy: (nextComputers: LinkedComputer[]) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [setupTokenRequired, setSetupTokenRequired] = useState(false);
  const [computers, setComputers] = useState<LinkedComputer[]>([]);
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuthAuditLog[]>([]);

  // Synchronizer CSRF token is stored STRICTLY in memory — never written to localStorage/sessionStorage
  const csrfTokenRef = useRef<string>('');

  const clearClientSessionState = useCallback((setupRequired = false) => {
    csrfTokenRef.current = '';
    setUser(null);
    setSessionId(null);
    setComputers([]);
    setSessions([]);
    setAuditLogs([]);
    setAuthState(setupRequired ? 'setup_required' : 'unauthenticated');
  }, []);

  const authFetch = useCallback(
    async (url: string, init?: RequestInit): Promise<Response> => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const headers = new Headers(init?.headers ?? {});
      if (init?.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && csrfTokenRef.current) {
        headers.set('X-CSRF-Token', csrfTokenRef.current);
      }

      const res = await fetch(url, {
        ...init,
        credentials: 'include',
        headers,
      });

      if (res.status === 401 && !url.startsWith('/api/auth/login') && !url.startsWith('/api/auth/setup-admin')) {
        clearClientSessionState(false);
      }
      return res;
    },
    [clearClientSessionState],
  );

  const authJson = useCallback(
    async <T,>(url: string, init?: RequestInit): Promise<T> => {
      const res = await authFetch(url, init);
      const data = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `Erro HTTP ${res.status}`);
      }
      return data;
    },
    [authFetch],
  );

  const hydrateAuth = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      const data = (await res.json()) as AuthMeResponse;
      setSetupTokenRequired(Boolean(data.setupTokenRequired));
      if (data.authenticated && data.user && data.csrfToken) {
        csrfTokenRef.current = data.csrfToken;
        setUser(data.user);
        setSessionId(data.sessionId);
        setComputers(data.computers ?? []);
        setAuthState('authenticated');
      } else {
        clearClientSessionState(Boolean(data.setupRequired));
      }
    } catch {
      clearClientSessionState(false);
    }
  }, [clearClientSessionState]);

  useEffect(() => {
    void hydrateAuth();
  }, [hydrateAuth]);

  const setupAdmin = useCallback(
    async (input: { name: string; email: string; password: string; setupToken?: string }) => {
      const res = await fetch('/api/auth/setup-admin', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = (await res.json().catch(() => ({}))) as {
        authenticated?: boolean;
        user?: AuthUser;
        sessionId?: string;
        csrfToken?: string;
        computers?: LinkedComputer[];
        error?: string;
      };
      if (!res.ok || !data.authenticated || !data.user || !data.csrfToken) {
        throw new Error(data.error || 'Falha ao configurar administrador inicial.');
      }
      csrfTokenRef.current = data.csrfToken;
      setUser(data.user);
      setSessionId(data.sessionId ?? null);
      setComputers(data.computers ?? []);
      setAuthState('authenticated');
    },
    [],
  );

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      authenticated?: boolean;
      user?: AuthUser;
      sessionId?: string;
      csrfToken?: string;
      computers?: LinkedComputer[];
      error?: string;
    };
    if (!res.ok || !data.authenticated || !data.user || !data.csrfToken) {
      throw new Error(data.error || 'E-mail ou senha inválidos.');
    }
    csrfTokenRef.current = data.csrfToken;
    setUser(data.user);
    setSessionId(data.sessionId ?? null);
    setComputers(data.computers ?? []);
    setAuthState('authenticated');
  }, []);

  const logout = useCallback(async () => {
    try {
      await authFetch('/api/auth/logout', { method: 'POST' });
    } finally {
      clearClientSessionState(false);
    }
  }, [authFetch, clearClientSessionState]);

  const logoutAll = useCallback(
    async (includeCurrent: boolean): Promise<number> => {
      const res = await authJson<{ ok: boolean; revokedCount: number }>('/api/auth/logout-all', {
        method: 'POST',
        body: JSON.stringify({ includeCurrent }),
      });
      if (includeCurrent) {
        clearClientSessionState(false);
      } else {
        const s = await authJson<{ sessions: AuthSession[]; auditLogs: AuthAuditLog[] }>('/api/auth/sessions');
        setSessions(s.sessions);
        setAuditLogs(s.auditLogs);
      }
      return res.revokedCount;
    },
    [authJson, clearClientSessionState],
  );

  const refreshAccountData = useCallback(async () => {
    const [sessData, compData] = await Promise.all([
      authJson<{ sessions: AuthSession[]; auditLogs: AuthAuditLog[] }>('/api/auth/sessions'),
      authJson<{ computers: LinkedComputer[] }>('/api/computers'),
    ]);
    setSessions(sessData.sessions);
    setAuditLogs(sessData.auditLogs);
    setComputers(compData.computers);
  }, [authJson]);

  const revokeSession = useCallback(
    async (targetSessionId: string) => {
      const res = await authJson<{ ok: boolean; revokedCurrent: boolean }>(
        `/api/auth/sessions/${encodeURIComponent(targetSessionId)}`,
        { method: 'DELETE' },
      );
      if (res.revokedCurrent) {
        clearClientSessionState(false);
        return;
      }
      setSessions((prev) => prev.filter((s) => s.id !== targetSessionId));
    },
    [authJson, clearClientSessionState],
  );

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      await authJson<{ ok: boolean }>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      await refreshAccountData();
    },
    [authJson, refreshAccountData],
  );

  const requestPasswordReset = useCallback(async (email: string): Promise<string> => {
    const res = await fetch('/api/auth/password-reset/request', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    if (!res.ok) {
      throw new Error(data.error || 'Falha ao solicitar recuperação de senha.');
    }
    return (
      data.message ||
      'Se o e-mail estiver cadastrado, um código seguro de recuperação foi emitido pelo servidor.'
    );
  }, []);

  const confirmPasswordReset = useCallback(async (code: string, newPassword: string) => {
    const res = await fetch('/api/auth/password-reset/confirm', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, newPassword }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Código inválido ou expirado.');
    }
  }, []);

  const createComputer = useCallback(
    async (input: {
      name: string;
      baseUrl: string;
      bearerToken: string;
      autoConnect?: boolean;
      setActive?: boolean;
    }) => {
      const res = await authJson<{
        computer: LinkedComputer;
        probe: { ok: boolean; offline: boolean; error: string | null };
      }>('/api/computers', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      const list = await authJson<{ computers: LinkedComputer[] }>('/api/computers');
      setComputers(list.computers);
      return res;
    },
    [authJson],
  );

  const updateComputer = useCallback(
    async (
      computerId: string,
      patch: { name?: string; baseUrl?: string; autoConnect?: boolean; isActive?: boolean },
    ) => {
      const res = await authJson<{ computer: LinkedComputer }>(
        `/api/computers/${encodeURIComponent(computerId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(patch),
        },
      );
      const list = await authJson<{ computers: LinkedComputer[] }>('/api/computers');
      setComputers(list.computers);
      return res.computer;
    },
    [authJson],
  );

  const rotateComputerCredential = useCallback(
    async (computerId: string, bearerToken: string, baseUrl?: string) => {
      const res = await authJson<{ computer: LinkedComputer }>(
        `/api/computers/${encodeURIComponent(computerId)}/rotate`,
        {
          method: 'POST',
          body: JSON.stringify({ bearerToken, ...(baseUrl ? { baseUrl } : {}) }),
        },
      );
      const list = await authJson<{ computers: LinkedComputer[] }>('/api/computers');
      setComputers(list.computers);
      return res.computer;
    },
    [authJson],
  );

  const revokeComputerCredential = useCallback(
    async (computerId: string) => {
      const res = await authJson<{ computer: LinkedComputer }>(
        `/api/computers/${encodeURIComponent(computerId)}/revoke`,
        { method: 'POST' },
      );
      const list = await authJson<{ computers: LinkedComputer[] }>('/api/computers');
      setComputers(list.computers);
      return res.computer;
    },
    [authJson],
  );

  const testComputer = useCallback(
    async (computerId: string) => {
      const res = await authJson<{
        ok: boolean;
        offline: boolean;
        error: string | null;
        computer: LinkedComputer;
      }>(`/api/computers/${encodeURIComponent(computerId)}/test`, { method: 'POST' });
      setComputers((prev) => prev.map((c) => (c.id === res.computer.id ? res.computer : c)));
      return res;
    },
    [authJson],
  );

  const deleteComputer = useCallback(
    async (computerId: string) => {
      await authJson<{ ok: boolean }>(`/api/computers/${encodeURIComponent(computerId)}`, {
        method: 'DELETE',
      });
      setComputers((prev) => prev.filter((c) => c.id !== computerId));
    },
    [authJson],
  );

  const syncComputersFromProxy = useCallback((nextComputers: LinkedComputer[]) => {
    setComputers(nextComputers);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      authState,
      user,
      sessionId,
      setupTokenRequired,
      computers,
      sessions,
      auditLogs,
      authFetch,
      authJson,
      hydrateAuth,
      setupAdmin,
      login,
      logout,
      logoutAll,
      refreshAccountData,
      revokeSession,
      changePassword,
      requestPasswordReset,
      confirmPasswordReset,
      createComputer,
      updateComputer,
      rotateComputerCredential,
      revokeComputerCredential,
      testComputer,
      deleteComputer,
      syncComputersFromProxy,
    }),
    [
      auditLogs,
      authFetch,
      authJson,
      authState,
      changePassword,
      computers,
      confirmPasswordReset,
      createComputer,
      deleteComputer,
      hydrateAuth,
      login,
      logout,
      logoutAll,
      refreshAccountData,
      requestPasswordReset,
      revokeComputerCredential,
      revokeSession,
      rotateComputerCredential,
      sessionId,
      sessions,
      setupAdmin,
      setupTokenRequired,
      syncComputersFromProxy,
      testComputer,
      updateComputer,
      user,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}

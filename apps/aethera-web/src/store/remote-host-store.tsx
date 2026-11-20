import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ArtifactTicketResponse,
  CreateRemoteJobRequest,
  RemoteAgentsResponse,
  RemoteHealthResponse,
  RemoteHostStatusResponse,
  RemoteJobDetailResponse,
  RemoteJobEvent,
  RemoteJobRecord,
  RemoteJobsListResponse,
  RemoteProjectsResponse,
} from '../../../aethera-remote-host/src/contracts/v1';

export type RemoteConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

interface RemoteHostContextValue {
  connectionState: RemoteConnectionState;
  baseUrl: string;
  hasTokenInMemory: boolean;
  error: string | null;
  lastSyncedAt: string | null;
  sseConnected: boolean;
  health: RemoteHealthResponse | null;
  hostStatus: RemoteHostStatusResponse | null;
  agentsInfo: RemoteAgentsResponse | null;
  projectsInfo: RemoteProjectsResponse | null;
  jobs: RemoteJobRecord[];
  selectedJobId: string | null;
  selectedJobEvents: RemoteJobEvent[];
  setBaseUrlDraft: (url: string) => void;
  connect: (url: string, bearerToken: string) => Promise<boolean>;
  disconnect: () => void;
  refreshAll: () => Promise<void>;
  selectJob: (jobId: string | null) => void;
  submitJob: (req: CreateRemoteJobRequest) => Promise<RemoteJobRecord>;
  cancelJob: (jobId: string) => Promise<RemoteJobRecord>;
  approveJob: (jobId: string, approved: boolean, note?: string) => Promise<RemoteJobRecord>;
  mintArtifactTicket: (artifactId: string) => Promise<{
    streamUrl: string;
    downloadUrl: string;
    expiresAt: string;
  }>;
}

const RemoteHostContext = createContext<RemoteHostContextValue | null>(null);

const URL_SESSION_KEY = 'aethera_remote_host_url_session_v1';

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

function readSessionUrl(): string {
  try {
    // Only the non-sensitive endpoint URL is kept in sessionStorage; tokens NEVER touch localStorage or sessionStorage.
    return window.sessionStorage.getItem(URL_SESSION_KEY) ?? 'http://127.0.0.1:4848';
  } catch {
    return 'http://127.0.0.1:4848';
  }
}

export function RemoteHostProvider({ children }: { children: React.ReactNode }) {
  const [baseUrl, setBaseUrl] = useState<string>(() => readSessionUrl());
  // Security requirement: Bearer token is held STRICTLY in React ref/memory — NEVER written to localStorage!
  const tokenRef = useRef<string>('');
  const [hasTokenInMemory, setHasTokenInMemory] = useState(false);

  const [connectionState, setConnectionState] = useState<RemoteConnectionState>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);

  const [health, setHealth] = useState<RemoteHealthResponse | null>(null);
  const [hostStatus, setHostStatus] = useState<RemoteHostStatusResponse | null>(null);
  const [agentsInfo, setAgentsInfo] = useState<RemoteAgentsResponse | null>(null);
  const [projectsInfo, setProjectsInfo] = useState<RemoteProjectsResponse | null>(null);
  const [jobs, setJobs] = useState<RemoteJobRecord[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedJobEvents, setSelectedJobEvents] = useState<RemoteJobEvent[]>([]);

  const lastEventSeqRef = useRef<number>(0);

  const setBaseUrlDraft = useCallback((url: string) => {
    setBaseUrl(url);
    try {
      window.sessionStorage.setItem(URL_SESSION_KEY, url);
    } catch {
      // ignore storage errors
    }
  }, []);

  const remoteFetch = useCallback(
    async <T,>(endpoint: string, init?: RequestInit, overrideUrl?: string, overrideToken?: string): Promise<T> => {
      const targetBase = normalizeBaseUrl(overrideUrl ?? baseUrl);
      const token = overrideToken ?? tokenRef.current;
      if (!targetBase) throw new Error('Informe a URL do Remote Host (ex.: https://seu-tunel.ngrok-free.app).');
      if (!token) throw new Error('Token Bearer ausente em memória. Reconecte ao Remote Host.');

      const res = await fetch(`${targetBase}${endpoint}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': '1',
          ...(init?.headers ?? {}),
        },
      });
      const data = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `Erro HTTP ${res.status} no Remote Host.`);
      }
      return data;
    },
    [baseUrl],
  );

  const refreshAll = useCallback(
    async (overrideUrl?: string, overrideToken?: string) => {
      const targetBase = normalizeBaseUrl(overrideUrl ?? baseUrl);
      const token = overrideToken ?? tokenRef.current;
      if (!targetBase || !token) return;

      const healthRes = await fetch(`${targetBase}/api/health`, {
        headers: { 'ngrok-skip-browser-warning': '1' },
      });
      if (!healthRes.ok) {
        throw new Error(`Remote Host indisponível (HTTP ${healthRes.status}).`);
      }
      const healthData = (await healthRes.json()) as RemoteHealthResponse;

      const [statusData, agentsData, projectsData, jobsData] = await Promise.all([
        remoteFetch<RemoteHostStatusResponse>('/api/host/status', undefined, targetBase, token),
        remoteFetch<RemoteAgentsResponse>('/api/agents', undefined, targetBase, token),
        remoteFetch<RemoteProjectsResponse>('/api/projects', undefined, targetBase, token),
        remoteFetch<RemoteJobsListResponse>('/api/jobs', undefined, targetBase, token),
      ]);

      setHealth(healthData);
      setHostStatus(statusData);
      setAgentsInfo(agentsData);
      setProjectsInfo(projectsData);
      setJobs(jobsData.jobs);
      setSelectedJobId((curr) => curr ?? jobsData.jobs[0]?.id ?? null);
      setLastSyncedAt(new Date().toISOString());
      setError(null);
      setConnectionState('connected');
    },
    [baseUrl, remoteFetch],
  );

  const connect = useCallback(
    async (url: string, bearerToken: string): Promise<boolean> => {
      const cleanUrl = normalizeBaseUrl(url);
      const cleanToken = bearerToken.trim();
      if (!cleanUrl || !cleanToken) {
        setError('Informe a URL do host e o token Bearer gerado no PC Windows.');
        setConnectionState('error');
        return false;
      }
      setBaseUrlDraft(cleanUrl);
      tokenRef.current = cleanToken;
      setHasTokenInMemory(true);
      setConnectionState('connecting');
      setError(null);

      try {
        await refreshAll(cleanUrl, cleanToken);
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setConnectionState('error');
        return false;
      }
    },
    [refreshAll, setBaseUrlDraft],
  );

  const disconnect = useCallback(() => {
    tokenRef.current = '';
    setHasTokenInMemory(false);
    setConnectionState('disconnected');
    setSseConnected(false);
    setHealth(null);
    setHostStatus(null);
    setAgentsInfo(null);
    setProjectsInfo(null);
    setJobs([]);
    setSelectedJobId(null);
    setSelectedJobEvents([]);
    setError(null);
  }, []);

  // Periodic host status & jobs refresh while connected
  useEffect(() => {
    if (connectionState !== 'connected' && connectionState !== 'reconnecting') return;
    const timer = window.setInterval(() => {
      void refreshAll().catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setConnectionState('reconnecting');
      });
    }, 8_000);
    return () => window.clearInterval(timer);
  }, [connectionState, refreshAll]);

  // Authenticated fetch-SSE stream for selected job with automatic Last-Event-ID reconnect (no Bearer token in URL!)
  useEffect(() => {
    if ((connectionState !== 'connected' && connectionState !== 'reconnecting') || !selectedJobId || !tokenRef.current) {
      setSseConnected(false);
      return;
    }

    let cancelled = false;
    let activeController: AbortController | null = null;
    lastEventSeqRef.current = 0;

    // Load initial snapshot for selected job
    void remoteFetch<RemoteJobDetailResponse>(`/api/jobs/${encodeURIComponent(selectedJobId)}`)
      .then((detail) => {
        if (cancelled) return;
        setSelectedJobEvents(detail.recentEvents);
        const maxSeq = detail.recentEvents.reduce((m, e) => Math.max(m, e.seq), 0);
        lastEventSeqRef.current = maxSeq;
        setJobs((prev) => prev.map((j) => (j.id === detail.job.id ? detail.job : j)));
      })
      .catch(() => {
        // handled by stream reconnect
      });

    const connectStream = async (attempt: number) => {
      if (cancelled || !tokenRef.current) return;
      activeController = new AbortController();
      const targetBase = normalizeBaseUrl(baseUrl);

      try {
        const res = await fetch(`${targetBase}/api/jobs/${encodeURIComponent(selectedJobId)}/events`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${tokenRef.current}`,
            Accept: 'text/event-stream',
            'ngrok-skip-browser-warning': '1',
            ...(lastEventSeqRef.current > 0 ? { 'Last-Event-ID': String(lastEventSeqRef.current) } : {}),
          },
          signal: activeController.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(`SSE HTTP ${res.status}`);
        }

        setSseConnected(true);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let splitIdx = buffer.indexOf('\n\n');
          while (splitIdx !== -1) {
            const rawBlock = buffer.slice(0, splitIdx);
            buffer = buffer.slice(splitIdx + 2);
            splitIdx = buffer.indexOf('\n\n');

            const dataLine = rawBlock
              .split(/\r?\n/)
              .find((l) => l.startsWith('data: '));
            if (!dataLine) continue;

            try {
              const parsed = JSON.parse(dataLine.slice(6)) as Partial<RemoteJobEvent>;
              if (typeof parsed.seq === 'number' && parsed.jobId) {
                const ev = parsed as RemoteJobEvent;
                lastEventSeqRef.current = Math.max(lastEventSeqRef.current, ev.seq);
                setSelectedJobEvents((prev) => (prev.some((x) => x.seq === ev.seq) ? prev : [...prev, ev].slice(-250)));

                if (ev.type === 'progress' && ev.progressPct !== null) {
                  setJobs((prev) =>
                    prev.map((j) =>
                      j.id === ev.jobId ? { ...j, progressPct: ev.progressPct, currentStage: ev.stage } : j,
                    ),
                  );
                } else if (ev.type === 'job_status' || ev.type === 'stage_update' || ev.type === 'artifact_ready' || ev.type === 'approval_resolved') {
                  void remoteFetch<RemoteJobDetailResponse>(`/api/jobs/${encodeURIComponent(ev.jobId)}`)
                    .then((detail) => {
                      if (!cancelled) {
                        setJobs((prev) => prev.map((j) => (j.id === detail.job.id ? detail.job : j)));
                      }
                    })
                    .catch(() => undefined);
                }
              }
            } catch {
              // ignore heartbeat or non-JSON comment
            }
          }
        }
      } catch {
        setSseConnected(false);
      }

      if (!cancelled && tokenRef.current) {
        const delayMs = Math.min(10_000, 1200 * Math.pow(1.5, Math.min(attempt, 5)));
        setTimeout(() => {
          void connectStream(attempt + 1);
        }, delayMs);
      }
    };

    void connectStream(0);

    return () => {
      cancelled = true;
      setSseConnected(false);
      activeController?.abort();
    };
  }, [baseUrl, connectionState, remoteFetch, selectedJobId]);

  const submitJob = useCallback(
    async (req: CreateRemoteJobRequest): Promise<RemoteJobRecord> => {
      const res = await remoteFetch<{ job: RemoteJobRecord }>('/api/jobs', {
        method: 'POST',
        body: JSON.stringify(req),
      });
      setJobs((prev) => [res.job, ...prev.filter((j) => j.id !== res.job.id)]);
      setSelectedJobId(res.job.id);
      setSelectedJobEvents([]);
      return res.job;
    },
    [remoteFetch],
  );

  const cancelJob = useCallback(
    async (jobId: string): Promise<RemoteJobRecord> => {
      const res = await remoteFetch<{ job: RemoteJobRecord }>(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: 'POST',
      });
      setJobs((prev) => prev.map((j) => (j.id === res.job.id ? res.job : j)));
      return res.job;
    },
    [remoteFetch],
  );

  const approveJob = useCallback(
    async (jobId: string, approved: boolean, note?: string): Promise<RemoteJobRecord> => {
      const res = await remoteFetch<{ job: RemoteJobRecord }>(`/api/jobs/${encodeURIComponent(jobId)}/approve`, {
        method: 'POST',
        body: JSON.stringify({ approved, note }),
      });
      setJobs((prev) => prev.map((j) => (j.id === res.job.id ? res.job : j)));
      return res.job;
    },
    [remoteFetch],
  );

  const mintArtifactTicket = useCallback(
    async (artifactId: string) => {
      const ticket = await remoteFetch<ArtifactTicketResponse>(
        `/api/artifacts/${encodeURIComponent(artifactId)}/ticket`,
        { method: 'POST' },
      );
      const targetBase = normalizeBaseUrl(baseUrl);
      return {
        streamUrl: `${targetBase}${ticket.streamPath}`,
        downloadUrl: `${targetBase}${ticket.downloadPath}`,
        expiresAt: ticket.expiresAt,
      };
    },
    [baseUrl, remoteFetch],
  );

  const value = useMemo<RemoteHostContextValue>(
    () => ({
      connectionState,
      baseUrl,
      hasTokenInMemory,
      error,
      lastSyncedAt,
      sseConnected,
      health,
      hostStatus,
      agentsInfo,
      projectsInfo,
      jobs,
      selectedJobId,
      selectedJobEvents,
      setBaseUrlDraft,
      connect,
      disconnect,
      refreshAll: async () => {
        await refreshAll();
      },
      selectJob: setSelectedJobId,
      submitJob,
      cancelJob,
      approveJob,
      mintArtifactTicket,
    }),
    [
      agentsInfo,
      approveJob,
      baseUrl,
      cancelJob,
      connect,
      connectionState,
      disconnect,
      error,
      hasTokenInMemory,
      health,
      hostStatus,
      jobs,
      lastSyncedAt,
      mintArtifactTicket,
      projectsInfo,
      refreshAll,
      selectedJobEvents,
      selectedJobId,
      setBaseUrlDraft,
      sseConnected,
      submitJob,
    ],
  );

  return <RemoteHostContext.Provider value={value}>{children}</RemoteHostContext.Provider>;
}

export function useRemoteHost(): RemoteHostContextValue {
  const ctx = useContext(RemoteHostContext);
  if (!ctx) throw new Error('useRemoteHost deve ser usado dentro de RemoteHostProvider');
  return ctx;
}

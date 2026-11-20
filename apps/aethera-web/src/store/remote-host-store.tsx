import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CreateRemoteJobRequest,
  ProjectSyncBadgeState,
  RemoteAgentsResponse,
  RemoteHealthResponse,
  RemoteHostStatusResponse,
  RemoteJobDetailResponse,
  RemoteJobEvent,
  RemoteJobRecord,
  RemoteProjectsResponse,
  ResolveSyncConflictRequest,
  SyncChangeEvent,
  SyncConflictPayload,
  SyncSnapshotResponse,
  SyncedProjectData,
  SyncedProjectRecord,
  UpsertSyncedProjectRequest,
} from '../../../aethera-remote-host/src/contracts/v1';
import { useAuth, type LinkedComputer } from './auth-store';

export type RemoteConnectionState =
  | 'unconfigured'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'offline'
  | 'error';

export interface PendingSyncMutation {
  idempotencyKey: string;
  projectId?: string;
  expectedVersion: number | null;
  data: SyncedProjectData;
  queuedAt: string;
}

export interface UpsertSyncedProjectResult {
  ok: boolean;
  queued?: boolean;
  project?: SyncedProjectRecord;
  conflict?: SyncConflictPayload;
  error?: string;
}

export interface ProjectSyncBadgeInfo {
  state: ProjectSyncBadgeState;
  version?: number;
  updatedBy?: SyncedProjectRecord['updatedBy'];
  hasRender?: boolean;
}

interface RemoteProxyStatusPayload {
  configured: boolean;
  connected: boolean;
  offline: boolean;
  authFailed?: boolean;
  computer: LinkedComputer | null;
  computers: LinkedComputer[];
  error?: string | null;
  health?: RemoteHealthResponse;
  hostStatus?: RemoteHostStatusResponse;
  agentsInfo?: RemoteAgentsResponse | null;
  projectsInfo?: RemoteProjectsResponse | null;
  jobs?: RemoteJobRecord[];
  syncSnapshot?: SyncSnapshotResponse | null;
}

interface RemoteHostContextValue {
  connectionState: RemoteConnectionState;
  activeComputer: LinkedComputer | null;
  computers: LinkedComputer[];
  error: string | null;
  lastSyncedAt: string | null;
  nextRetryAt: string | null;
  sseConnected: boolean;
  syncSseConnected: boolean;
  health: RemoteHealthResponse | null;
  hostStatus: RemoteHostStatusResponse | null;
  agentsInfo: RemoteAgentsResponse | null;
  projectsInfo: RemoteProjectsResponse | null;
  jobs: RemoteJobRecord[];
  selectedJobId: string | null;
  selectedJobEvents: RemoteJobEvent[];
  // Bidirectional Sync State
  syncedProjects: SyncedProjectRecord[];
  syncSeq: number;
  desktopBridgeStatus: SyncSnapshotResponse['desktopBridgeStatus'] | null;
  syncEvents: SyncChangeEvent[];
  pendingSyncQueue: PendingSyncMutation[];
  syncConflicts: Record<string, SyncConflictPayload>;
  reconnectNow: (computerId?: string) => Promise<boolean>;
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
  // Bidirectional Sync Actions
  upsertSyncedProject: (req: Omit<UpsertSyncedProjectRequest, 'actor'>) => Promise<UpsertSyncedProjectResult>;
  resolveSyncConflict: (
    projectId: string,
    strategy: ResolveSyncConflictRequest['strategy'],
    clientData?: SyncedProjectData,
  ) => Promise<{ ok: boolean; project?: SyncedProjectRecord; error?: string }>;
  triggerDesktopIngest: () => Promise<{ ingested: number }>;
  mintSyncedMediaTicket: (mediaRefId: string) => Promise<{
    streamUrl: string;
    downloadUrl: string;
    expiresAt: string;
  }>;
  getProjectSyncBadge: (projectId: string) => ProjectSyncBadgeInfo;
}

const RemoteHostContext = createContext<RemoteHostContextValue | null>(null);

function makeIdempotencyKey(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${rand}`;
}

export function RemoteHostProvider({ children }: { children: React.ReactNode }) {
  const { authState, computers, authFetch, authJson, syncComputersFromProxy } = useAuth();

  const [connectionState, setConnectionState] = useState<RemoteConnectionState>('unconfigured');
  const [activeComputer, setActiveComputer] = useState<LinkedComputer | null>(null);
  const [manuallyDisconnected, setManuallyDisconnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [nextRetryAt, setNextRetryAt] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [syncSseConnected, setSyncSseConnected] = useState(false);

  const [health, setHealth] = useState<RemoteHealthResponse | null>(null);
  const [hostStatus, setHostStatus] = useState<RemoteHostStatusResponse | null>(null);
  const [agentsInfo, setAgentsInfo] = useState<RemoteAgentsResponse | null>(null);
  const [projectsInfo, setProjectsInfo] = useState<RemoteProjectsResponse | null>(null);
  const [jobs, setJobs] = useState<RemoteJobRecord[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedJobEvents, setSelectedJobEvents] = useState<RemoteJobEvent[]>([]);

  // Bidirectional sync state
  const [syncedProjects, setSyncedProjects] = useState<SyncedProjectRecord[]>([]);
  const [syncSeq, setSyncSeq] = useState<number>(0);
  const [desktopBridgeStatus, setDesktopBridgeStatus] =
    useState<SyncSnapshotResponse['desktopBridgeStatus'] | null>(null);
  const [syncEvents, setSyncEvents] = useState<SyncChangeEvent[]>([]);
  const [pendingSyncQueue, setPendingSyncQueue] = useState<PendingSyncMutation[]>([]);
  const [syncConflicts, setSyncConflicts] = useState<Record<string, SyncConflictPayload>>({});

  const lastEventSeqRef = useRef<number>(0);
  const lastSyncSeqRef = useRef<number>(0);
  const backoffAttemptRef = useRef<number>(0);
  const retryTimerRef = useRef<number | null>(null);
  const activeComputerIdRef = useRef<string | null>(null);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setNextRetryAt(null);
  }, []);

  const computerQuerySuffix = useCallback((computerId?: string) => {
    const id = computerId ?? activeComputerIdRef.current;
    return id ? `?computerId=${encodeURIComponent(id)}` : '';
  }, []);

  const refreshSyncSnapshot = useCallback(async () => {
    if (authState !== 'authenticated') return;
    try {
      const snapshot = await authJson<SyncSnapshotResponse>(
        `/api/remote-proxy/sync/snapshot${computerQuerySuffix()}`,
      );
      setSyncedProjects(snapshot.projects);
      setSyncSeq(snapshot.currentSeq);
      lastSyncSeqRef.current = Math.max(lastSyncSeqRef.current, snapshot.currentSeq);
      setDesktopBridgeStatus(snapshot.desktopBridgeStatus);
    } catch {
      // keep existing state when host is temporarily offline
    }
  }, [authJson, authState, computerQuerySuffix]);

  const probeAndHydrate = useCallback(
    async (computerId?: string, silent = false): Promise<boolean> => {
      if (authState !== 'authenticated') return false;
      clearRetryTimer();
      if (!silent) {
        setConnectionState((prev) => (prev === 'connected' ? 'connected' : 'connecting'));
      }

      try {
        const query = computerId ? `?computerId=${encodeURIComponent(computerId)}` : '';
        const payload = await authJson<RemoteProxyStatusPayload>(`/api/remote-proxy/status${query}`);
        if (payload.computers) {
          syncComputersFromProxy(payload.computers);
        }
        setActiveComputer(payload.computer ?? null);
        activeComputerIdRef.current = payload.computer?.id ?? null;

        if (!payload.configured) {
          setConnectionState('unconfigured');
          setError(null);
          setHealth(null);
          setHostStatus(null);
          setAgentsInfo(null);
          setProjectsInfo(null);
          setJobs([]);
          setSyncedProjects([]);
          return false;
        }

        if (payload.connected && payload.health && payload.hostStatus) {
          backoffAttemptRef.current = 0;
          setHealth(payload.health);
          setHostStatus(payload.hostStatus);
          setAgentsInfo(payload.agentsInfo ?? null);
          setProjectsInfo(payload.projectsInfo ?? null);
          const nextJobs = payload.jobs ?? [];
          setJobs(nextJobs);
          setSelectedJobId((curr) => curr ?? nextJobs[0]?.id ?? null);

          if (payload.syncSnapshot) {
            setSyncedProjects(payload.syncSnapshot.projects);
            setSyncSeq(payload.syncSnapshot.currentSeq);
            lastSyncSeqRef.current = Math.max(lastSyncSeqRef.current, payload.syncSnapshot.currentSeq);
            setDesktopBridgeStatus(payload.syncSnapshot.desktopBridgeStatus);
          }

          setLastSyncedAt(new Date().toISOString());
          setError(null);
          setConnectionState('connected');
          return true;
        }

        if (payload.authFailed) {
          setConnectionState('error');
          setError(payload.error ?? 'Token do Remote Host recusado pelo PC Windows.');
          return false;
        }

        // PC is offline or tunnel unavailable -> non-blocking offline indicator + automatic backoff
        setConnectionState(payload.offline ? 'offline' : 'error');
        setError(payload.error ?? 'PC Windows offline. Reconexão automática em segundo plano...');
        return false;
      } catch (err) {
        setConnectionState('offline');
        setError(err instanceof Error ? err.message : 'Falha temporária ao contatar backend do Aethera Web.');
        return false;
      }
    },
    [authJson, authState, clearRetryTimer, syncComputersFromProxy],
  );

  // Automatic connection on login, page reload, or active computer change
  const activeCandidateId = useMemo(() => {
    const active = computers.find((c) => c.isActive && c.hasCredential && c.autoConnect);
    return active?.id ?? null;
  }, [computers]);

  useEffect(() => {
    if (authState !== 'authenticated') {
      clearRetryTimer();
      setConnectionState('disconnected');
      setActiveComputer(null);
      activeComputerIdRef.current = null;
      return;
    }

    if (manuallyDisconnected) {
      clearRetryTimer();
      setConnectionState('disconnected');
      return;
    }

    if (computers.length === 0) {
      clearRetryTimer();
      setConnectionState('unconfigured');
      setActiveComputer(null);
      activeComputerIdRef.current = null;
      setError(null);
      return;
    }

    const active = computers.find((c) => c.isActive) ?? computers[0];
    setActiveComputer(active ?? null);
    activeComputerIdRef.current = active?.id ?? null;

    if (!active || !active.hasCredential) {
      clearRetryTimer();
      setConnectionState('disconnected');
      setError(
        active?.lastStatus === 'revoked'
          ? 'Credencial revogada. Rotacione o token em Configurações > Meus Computadores para reconectar.'
          : null,
      );
      return;
    }

    if (!active.autoConnect) {
      clearRetryTimer();
      setConnectionState('disconnected');
      return;
    }

    void probeAndHydrate(active.id, false);
  }, [activeCandidateId, authState, clearRetryTimer, computers, manuallyDisconnected, probeAndHydrate]);

  // Non-blocking exponential backoff reconnect while PC is offline (5s -> 10s -> 20s -> 30s)
  useEffect(() => {
    if (authState !== 'authenticated' || manuallyDisconnected) return;
    if (connectionState !== 'offline' && connectionState !== 'reconnecting') return;
    if (!activeComputer?.hasCredential || !activeComputer.autoConnect) return;

    const attempt = backoffAttemptRef.current;
    const delayMs = Math.min(30_000, 5_000 * Math.pow(2, Math.min(attempt, 3)));
    setNextRetryAt(new Date(Date.now() + delayMs).toISOString());

    retryTimerRef.current = window.setTimeout(() => {
      backoffAttemptRef.current = Math.min(attempt + 1, 5);
      setConnectionState('reconnecting');
      void probeAndHydrate(activeComputer.id, true);
    }, delayMs);

    return () => {
      clearRetryTimer();
    };
  }, [activeComputer, authState, clearRetryTimer, connectionState, manuallyDisconnected, probeAndHydrate]);

  // Periodic lightweight refresh while connected
  useEffect(() => {
    if (authState !== 'authenticated' || connectionState !== 'connected' || manuallyDisconnected) return;
    const timer = window.setInterval(() => {
      void probeAndHydrate(activeComputerIdRef.current ?? undefined, true);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [authState, connectionState, manuallyDisconnected, probeAndHydrate]);

  const reconnectNow = useCallback(
    async (computerId?: string): Promise<boolean> => {
      setManuallyDisconnected(false);
      backoffAttemptRef.current = 0;
      return probeAndHydrate(computerId ?? activeComputerIdRef.current ?? undefined, false);
    },
    [probeAndHydrate],
  );

  const disconnect = useCallback(() => {
    clearRetryTimer();
    setManuallyDisconnected(true);
    setConnectionState('disconnected');
    setSseConnected(false);
    setSyncSseConnected(false);
    setError(null);
  }, [clearRetryTimer]);

  // Authenticated same-origin proxy SSE stream for Bidirectional Project Sync
  useEffect(() => {
    if (authState !== 'authenticated' || connectionState !== 'connected' || !activeComputer?.id) {
      setSyncSseConnected(false);
      return;
    }

    let cancelled = false;
    let activeController: AbortController | null = null;
    const targetId = activeComputer.id;

    const connectSyncStream = async (attempt: number) => {
      if (cancelled) return;
      activeController = new AbortController();

      try {
        const res = await authFetch(
          `/api/remote-proxy/sync/events?computerId=${encodeURIComponent(targetId)}`,
          {
            method: 'GET',
            headers: {
              Accept: 'text/event-stream',
              ...(lastSyncSeqRef.current > 0 ? { 'Last-Event-ID': String(lastSyncSeqRef.current) } : {}),
            },
            signal: activeController.signal,
          },
        );

        if (!res.ok || !res.body) {
          throw new Error(`Sync SSE HTTP ${res.status}`);
        }

        setSyncSseConnected(true);
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

            const dataLine = rawBlock.split(/\r?\n/).find((l) => l.startsWith('data: '));
            if (!dataLine) continue;

            try {
              const parsed = JSON.parse(dataLine.slice(6)) as Partial<SyncChangeEvent>;
              if (typeof parsed.seq === 'number' && parsed.projectId && parsed.eventType) {
                const ev = parsed as SyncChangeEvent;
                lastSyncSeqRef.current = Math.max(lastSyncSeqRef.current, ev.seq);
                setSyncSeq((prev) => Math.max(prev, ev.seq));
                setSyncEvents((prev) => (prev.some((x) => x.seq === ev.seq) ? prev : [...prev, ev].slice(-200)));

                if (ev.project) {
                  const updatedProject = ev.project;
                  setSyncedProjects((prev) => {
                    const others = prev.filter((p) => p.id !== updatedProject.id);
                    return [updatedProject, ...others].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
                  });
                } else {
                  void refreshSyncSnapshot();
                }
              }
            } catch {
              // ignore heartbeats
            }
          }
        }
      } catch {
        setSyncSseConnected(false);
      }

      if (!cancelled) {
        const delayMs = Math.min(12_000, 1500 * Math.pow(1.5, Math.min(attempt, 5)));
        window.setTimeout(() => {
          void connectSyncStream(attempt + 1);
        }, delayMs);
      }
    };

    void connectSyncStream(0);

    return () => {
      cancelled = true;
      setSyncSseConnected(false);
      activeController?.abort();
    };
  }, [activeComputer?.id, authFetch, authState, connectionState, refreshSyncSnapshot]);

  // Authenticated same-origin proxy SSE stream for selected Remote Host job
  useEffect(() => {
    if (
      authState !== 'authenticated' ||
      connectionState !== 'connected' ||
      !selectedJobId ||
      !activeComputer?.id
    ) {
      setSseConnected(false);
      return;
    }

    let cancelled = false;
    let activeController: AbortController | null = null;
    const targetId = activeComputer.id;
    lastEventSeqRef.current = 0;

    void authJson<RemoteJobDetailResponse>(
      `/api/remote-proxy/jobs/${encodeURIComponent(selectedJobId)}?computerId=${encodeURIComponent(targetId)}`,
    )
      .then((detail) => {
        if (cancelled) return;
        setSelectedJobEvents(detail.recentEvents);
        const maxSeq = detail.recentEvents.reduce((m, e) => Math.max(m, e.seq), 0);
        lastEventSeqRef.current = maxSeq;
        setJobs((prev) => prev.map((j) => (j.id === detail.job.id ? detail.job : j)));
      })
      .catch(() => undefined);

    const connectStream = async (attempt: number) => {
      if (cancelled) return;
      activeController = new AbortController();

      try {
        const res = await authFetch(
          `/api/remote-proxy/jobs/${encodeURIComponent(selectedJobId)}/events?computerId=${encodeURIComponent(targetId)}`,
          {
            method: 'GET',
            headers: {
              Accept: 'text/event-stream',
              ...(lastEventSeqRef.current > 0 ? { 'Last-Event-ID': String(lastEventSeqRef.current) } : {}),
            },
            signal: activeController.signal,
          },
        );

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

            const dataLine = rawBlock.split(/\r?\n/).find((l) => l.startsWith('data: '));
            if (!dataLine) continue;

            try {
              const parsed = JSON.parse(dataLine.slice(6)) as Partial<RemoteJobEvent>;
              if (typeof parsed.seq === 'number' && parsed.jobId) {
                const ev = parsed as RemoteJobEvent;
                lastEventSeqRef.current = Math.max(lastEventSeqRef.current, ev.seq);
                setSelectedJobEvents((prev) =>
                  prev.some((x) => x.seq === ev.seq) ? prev : [...prev, ev].slice(-250),
                );

                if (ev.type === 'progress' && ev.progressPct !== null) {
                  setJobs((prev) =>
                    prev.map((j) =>
                      j.id === ev.jobId ? { ...j, progressPct: ev.progressPct, currentStage: ev.stage } : j,
                    ),
                  );
                } else if (
                  ev.type === 'job_status' ||
                  ev.type === 'stage_update' ||
                  ev.type === 'artifact_ready' ||
                  ev.type === 'approval_resolved'
                ) {
                  void authJson<RemoteJobDetailResponse>(
                    `/api/remote-proxy/jobs/${encodeURIComponent(ev.jobId)}?computerId=${encodeURIComponent(targetId)}`,
                  )
                    .then((detail) => {
                      if (!cancelled) {
                        setJobs((prev) => prev.map((j) => (j.id === detail.job.id ? detail.job : j)));
                      }
                    })
                    .catch(() => undefined);
                }
              }
            } catch {
              // ignore heartbeats
            }
          }
        }
      } catch {
        setSseConnected(false);
      }

      if (!cancelled) {
        const delayMs = Math.min(10_000, 1200 * Math.pow(1.5, Math.min(attempt, 5)));
        window.setTimeout(() => {
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
  }, [activeComputer?.id, authFetch, authJson, authState, connectionState, selectedJobId]);

  const upsertSyncedProject = useCallback(
    async (req: Omit<UpsertSyncedProjectRequest, 'actor'>): Promise<UpsertSyncedProjectResult> => {
      const idempotencyKey = req.idempotencyKey ?? makeIdempotencyKey('sync-web');

      if (connectionState !== 'connected') {
        const queuedItem: PendingSyncMutation = {
          idempotencyKey,
          projectId: req.id,
          expectedVersion: req.expectedVersion ?? null,
          data: req.data,
          queuedAt: new Date().toISOString(),
        };
        setPendingSyncQueue((prev) => [
          ...prev.filter((item) => !req.id || item.projectId !== req.id),
          queuedItem,
        ]);
        return { ok: true, queued: true };
      }

      const payload: UpsertSyncedProjectRequest = {
        ...req,
        actor: 'web',
        idempotencyKey,
      };
      const endpoint = req.id
        ? `/api/remote-proxy/sync/projects/${encodeURIComponent(req.id)}${computerQuerySuffix()}`
        : `/api/remote-proxy/sync/projects${computerQuerySuffix()}`;
      const method = req.id ? 'PUT' : 'POST';

      try {
        const res = await authFetch(endpoint, {
          method,
          headers: { 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify(payload),
        });
        const body = (await res.json().catch(() => ({}))) as {
          project?: SyncedProjectRecord;
          error?: string;
          code?: string;
        } & Partial<SyncConflictPayload>;

        if (res.status === 409 && body.code === 'SYNC_VERSION_CONFLICT' && body.projectId && body.serverProject) {
          const conflict = body as SyncConflictPayload;
          setSyncConflicts((prev) => ({ ...prev, [conflict.projectId]: conflict }));
          setSyncedProjects((prev) => {
            const others = prev.filter((p) => p.id !== conflict.serverProject.id);
            return [conflict.serverProject, ...others].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          });
          return { ok: false, conflict, error: conflict.error };
        }

        if (!res.ok || !body.project) {
          return { ok: false, error: body.error || `Falha na sincronização (HTTP ${res.status}).` };
        }

        const saved = body.project;
        setSyncedProjects((prev) => {
          const others = prev.filter((p) => p.id !== saved.id);
          return [saved, ...others].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        });
        setSyncConflicts((prev) => {
          if (!prev[saved.id]) return prev;
          const copy = { ...prev };
          delete copy[saved.id];
          return copy;
        });
        setPendingSyncQueue((prev) => prev.filter((item) => item.projectId !== saved.id));
        return { ok: true, project: saved };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    [authFetch, computerQuerySuffix, connectionState],
  );

  // Auto-flush queued mutations once PC reconnects
  useEffect(() => {
    if (connectionState !== 'connected' || pendingSyncQueue.length === 0) return;
    let active = true;
    const queueCopy = [...pendingSyncQueue];
    void (async () => {
      for (const item of queueCopy) {
        if (!active) break;
        const result = await upsertSyncedProject({
          id: item.projectId,
          expectedVersion: item.expectedVersion,
          idempotencyKey: item.idempotencyKey,
          data: item.data,
        });
        if (result.ok || result.conflict) {
          setPendingSyncQueue((prev) => prev.filter((x) => x.idempotencyKey !== item.idempotencyKey));
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [connectionState, pendingSyncQueue, upsertSyncedProject]);

  const resolveSyncConflict = useCallback(
    async (
      projectId: string,
      strategy: ResolveSyncConflictRequest['strategy'],
      clientData?: SyncedProjectData,
    ): Promise<{ ok: boolean; project?: SyncedProjectRecord; error?: string }> => {
      const idempotencyKey = makeIdempotencyKey('sync-resolve');
      try {
        const res = await authJson<{ project: SyncedProjectRecord; forkedProject?: SyncedProjectRecord }>(
          `/api/remote-proxy/sync/projects/${encodeURIComponent(projectId)}/resolve-conflict${computerQuerySuffix()}`,
          {
            method: 'POST',
            headers: { 'Idempotency-Key': idempotencyKey },
            body: JSON.stringify({
              strategy,
              actor: 'web',
              idempotencyKey,
              ...(clientData ? { clientData } : {}),
            } satisfies ResolveSyncConflictRequest),
          },
        );
        setSyncedProjects((prev) => {
          const added = [res.project, ...(res.forkedProject ? [res.forkedProject] : [])];
          const addedIds = new Set(added.map((p) => p.id));
          const others = prev.filter((p) => !addedIds.has(p.id));
          return [...added, ...others].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        });
        setSyncConflicts((prev) => {
          const copy = { ...prev };
          delete copy[projectId];
          return copy;
        });
        return { ok: true, project: res.forkedProject ?? res.project };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    [authJson, computerQuerySuffix],
  );

  const triggerDesktopIngest = useCallback(async (): Promise<{ ingested: number }> => {
    const res = await authJson<{ ingestedCount?: number }>(
      `/api/remote-proxy/sync/desktop-ingest${computerQuerySuffix()}`,
      { method: 'POST' },
    );
    await refreshSyncSnapshot();
    return { ingested: res.ingestedCount ?? 0 };
  }, [authJson, computerQuerySuffix, refreshSyncSnapshot]);

  // Same-origin cookie-authenticated proxy media URLs — Remote Host token & URL are NEVER exposed to browser
  const mintSyncedMediaTicket = useCallback(
    async (mediaRefId: string) => {
      const q = computerQuerySuffix();
      return {
        streamUrl: `/api/remote-proxy/sync/media/${encodeURIComponent(mediaRefId)}/stream${q}`,
        downloadUrl: `/api/remote-proxy/sync/media/${encodeURIComponent(mediaRefId)}/download${q}`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
    },
    [computerQuerySuffix],
  );

  const getProjectSyncBadge = useCallback(
    (projectId: string): ProjectSyncBadgeInfo => {
      if (syncConflicts[projectId]) {
        return {
          state: 'conflict',
          version: syncConflicts[projectId].serverVersion,
          updatedBy: syncConflicts[projectId].serverProject.updatedBy,
        };
      }
      if (pendingSyncQueue.some((item) => item.projectId === projectId)) {
        const existing = syncedProjects.find((p) => p.id === projectId);
        return {
          state: 'pending',
          version: existing?.version,
          updatedBy: existing?.updatedBy,
        };
      }
      const synced = syncedProjects.find((p) => p.id === projectId);
      if (synced) {
        return {
          state: 'synced',
          version: synced.version,
          updatedBy: synced.updatedBy,
          hasRender: Boolean(synced.data.latestRenderMediaRefId),
        };
      }
      return { state: 'local_only' };
    },
    [pendingSyncQueue, syncConflicts, syncedProjects],
  );

  const submitJob = useCallback(
    async (req: CreateRemoteJobRequest): Promise<RemoteJobRecord> => {
      const res = await authJson<{ job: RemoteJobRecord }>(
        `/api/remote-proxy/jobs${computerQuerySuffix()}`,
        {
          method: 'POST',
          body: JSON.stringify(req),
        },
      );
      setJobs((prev) => [res.job, ...prev.filter((j) => j.id !== res.job.id)]);
      setSelectedJobId(res.job.id);
      setSelectedJobEvents([]);
      return res.job;
    },
    [authJson, computerQuerySuffix],
  );

  const cancelJob = useCallback(
    async (jobId: string): Promise<RemoteJobRecord> => {
      const res = await authJson<{ job: RemoteJobRecord }>(
        `/api/remote-proxy/jobs/${encodeURIComponent(jobId)}/cancel${computerQuerySuffix()}`,
        { method: 'POST' },
      );
      setJobs((prev) => prev.map((j) => (j.id === res.job.id ? res.job : j)));
      return res.job;
    },
    [authJson, computerQuerySuffix],
  );

  const approveJob = useCallback(
    async (jobId: string, approved: boolean, note?: string): Promise<RemoteJobRecord> => {
      const res = await authJson<{ job: RemoteJobRecord }>(
        `/api/remote-proxy/jobs/${encodeURIComponent(jobId)}/approve${computerQuerySuffix()}`,
        {
          method: 'POST',
          body: JSON.stringify({ approved, note }),
        },
      );
      setJobs((prev) => prev.map((j) => (j.id === res.job.id ? res.job : j)));
      return res.job;
    },
    [authJson, computerQuerySuffix],
  );

  const mintArtifactTicket = useCallback(
    async (artifactId: string) => {
      const q = computerQuerySuffix();
      return {
        streamUrl: `/api/remote-proxy/artifacts/${encodeURIComponent(artifactId)}/stream${q}`,
        downloadUrl: `/api/remote-proxy/artifacts/${encodeURIComponent(artifactId)}/download${q}`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
    },
    [computerQuerySuffix],
  );

  const value = useMemo<RemoteHostContextValue>(
    () => ({
      connectionState,
      activeComputer,
      computers,
      error,
      lastSyncedAt,
      nextRetryAt,
      sseConnected,
      syncSseConnected,
      health,
      hostStatus,
      agentsInfo,
      projectsInfo,
      jobs,
      selectedJobId,
      selectedJobEvents,
      syncedProjects,
      syncSeq,
      desktopBridgeStatus,
      syncEvents,
      pendingSyncQueue,
      syncConflicts,
      reconnectNow,
      disconnect,
      refreshAll: async () => {
        await probeAndHydrate(activeComputerIdRef.current ?? undefined, false);
      },
      selectJob: setSelectedJobId,
      submitJob,
      cancelJob,
      approveJob,
      mintArtifactTicket,
      upsertSyncedProject,
      resolveSyncConflict,
      triggerDesktopIngest,
      mintSyncedMediaTicket,
      getProjectSyncBadge,
    }),
    [
      activeComputer,
      agentsInfo,
      approveJob,
      cancelJob,
      computers,
      connectionState,
      desktopBridgeStatus,
      disconnect,
      error,
      getProjectSyncBadge,
      health,
      hostStatus,
      jobs,
      lastSyncedAt,
      mintArtifactTicket,
      mintSyncedMediaTicket,
      nextRetryAt,
      pendingSyncQueue,
      probeAndHydrate,
      projectsInfo,
      reconnectNow,
      resolveSyncConflict,
      selectedJobEvents,
      selectedJobId,
      sseConnected,
      submitJob,
      syncConflicts,
      syncEvents,
      syncSeq,
      syncSseConnected,
      syncedProjects,
      triggerDesktopIngest,
      upsertSyncedProject,
    ],
  );

  return <RemoteHostContext.Provider value={value}>{children}</RemoteHostContext.Provider>;
}

export function useRemoteHost(): RemoteHostContextValue {
  const ctx = useContext(RemoteHostContext);
  if (!ctx) throw new Error('useRemoteHost deve ser usado dentro de RemoteHostProvider');
  return ctx;
}

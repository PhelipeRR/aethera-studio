import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from 'node:fs';
import { join } from 'node:path';

export interface DesktopSyncSidecar {
  projectId: string;
  version: number;
  contentHash: string;
  origin: 'web' | 'desktop' | 'remote_host';
  updatedBy: 'web' | 'desktop' | 'remote_host';
  updatedAt: string;
  latestJobId: string | null;
  latestRenderMediaRefId: string | null;
}

export interface ExternalSyncChangeEvent {
  projectId: string;
  kind: 'project' | 'render';
  fileName: string;
  detectedAt: string;
}

function safeProjectFileStem(projectId: string): string {
  return projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * Coordinates safe, atomic bidirectional projection between Aethera Desktop
 * (`cinema-projects/<id>.json` + `.render.json`) and Aethera Remote Host's
 * Single Write Authority without sharing concurrent writes to Electron's SQLite DB.
 */
export class CinemaProjectSyncBridge {
  private readonly projectsDir: string;
  private readonly loadedMtimes = new Map<string, number>();
  private readonly loadedRenderMtimes = new Map<string, number>();
  private readonly recentSelfWriteHashes = new Map<string, { hash: string; expiresAt: number }>();
  private watcher: FSWatcher | null = null;
  private debounceTimers = new Map<string, NodeJS.Timeout>();

  constructor(projectsDir: string) {
    this.projectsDir = projectsDir;
  }

  getProjectFilePath(projectId: string): string {
    return join(this.projectsDir, `${safeProjectFileStem(projectId)}.json`);
  }

  getRenderFilePath(projectId: string): string {
    return join(this.projectsDir, `${safeProjectFileStem(projectId)}.render.json`);
  }

  getSyncSidecarPath(projectId: string): string {
    return join(this.projectsDir, `${safeProjectFileStem(projectId)}.sync.json`);
  }

  writeProjectAtomic(projectId: string, payload: unknown): void {
    mkdirSync(this.projectsDir, { recursive: true });
    const targetPath = this.getProjectFilePath(projectId);
    const json = JSON.stringify(payload, null, 2);
    const hash = sha256Hex(json);
    this.recentSelfWriteHashes.set(targetPath, { hash, expiresAt: Date.now() + 2_500 });

    const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmpPath, json, 'utf8');
    renameSync(tmpPath, targetPath);

    try {
      const st = statSync(targetPath);
      this.loadedMtimes.set(projectId, st.mtimeMs);
    } catch {
      // Ignore stat race
    }
  }

  writeRenderAtomic(projectId: string, payload: unknown): void {
    mkdirSync(this.projectsDir, { recursive: true });
    const targetPath = this.getRenderFilePath(projectId);
    const json = JSON.stringify(payload, null, 2);
    const hash = sha256Hex(json);
    this.recentSelfWriteHashes.set(targetPath, { hash, expiresAt: Date.now() + 2_500 });

    const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmpPath, json, 'utf8');
    renameSync(tmpPath, targetPath);

    try {
      const st = statSync(targetPath);
      this.loadedRenderMtimes.set(projectId, st.mtimeMs);
    } catch {
      // Ignore stat race
    }
  }

  recordProjectLoaded(projectId: string, filePath?: string): void {
    const target = filePath ?? this.getProjectFilePath(projectId);
    try {
      if (existsSync(target)) {
        this.loadedMtimes.set(projectId, statSync(target).mtimeMs);
      }
    } catch {
      // Ignore stat failure
    }
  }

  recordRenderLoaded(projectId: string, filePath?: string): void {
    const target = filePath ?? this.getRenderFilePath(projectId);
    try {
      if (existsSync(target)) {
        this.loadedRenderMtimes.set(projectId, statSync(target).mtimeMs);
      }
    } catch {
      // Ignore stat failure
    }
  }

  /**
   * Returns true if the on-disk project JSON was modified externally (e.g. via
   * Aethera Web -> Remote Host projection) after the in-memory copy was cached.
   */
  isProjectCacheStale(projectId: string, filePath?: string): boolean {
    const target = filePath ?? this.getProjectFilePath(projectId);
    if (!existsSync(target)) return false;
    try {
      const diskMtime = statSync(target).mtimeMs;
      const knownMtime = this.loadedMtimes.get(projectId);
      if (knownMtime === undefined) return true;
      return diskMtime > knownMtime + 1;
    } catch {
      return false;
    }
  }

  isRenderCacheStale(projectId: string, filePath?: string): boolean {
    const target = filePath ?? this.getRenderFilePath(projectId);
    if (!existsSync(target)) return false;
    try {
      const diskMtime = statSync(target).mtimeMs;
      const knownMtime = this.loadedRenderMtimes.get(projectId);
      if (knownMtime === undefined) return true;
      return diskMtime > knownMtime + 1;
    } catch {
      return false;
    }
  }

  readSyncSidecar(projectId: string): DesktopSyncSidecar | null {
    const sidecarPath = this.getSyncSidecarPath(projectId);
    if (!existsSync(sidecarPath)) return null;
    try {
      return JSON.parse(readFileSync(sidecarPath, 'utf8')) as DesktopSyncSidecar;
    } catch {
      return null;
    }
  }

  startWatching(onExternalChange: (event: ExternalSyncChangeEvent) => void): void {
    if (this.watcher) return;
    mkdirSync(this.projectsDir, { recursive: true });
    try {
      this.watcher = watch(this.projectsDir, (_eventType, rawFileName) => {
        if (!rawFileName) return;
        const fileName = String(rawFileName);
        if (!fileName.endsWith('.json') || fileName.endsWith('.sync.json') || fileName.endsWith('.tmp')) {
          return;
        }
        const existingTimer = this.debounceTimers.get(fileName);
        if (existingTimer) clearTimeout(existingTimer);
        const timer = setTimeout(() => {
          this.debounceTimers.delete(fileName);
          this.handleWatchedFile(fileName, onExternalChange);
        }, 250);
        this.debounceTimers.set(fileName, timer);
      });
    } catch {
      this.watcher = null;
    }
  }

  private handleWatchedFile(
    fileName: string,
    onExternalChange: (event: ExternalSyncChangeEvent) => void,
  ): void {
    const fullPath = join(this.projectsDir, fileName);
    if (!existsSync(fullPath)) return;

    try {
      const raw = readFileSync(fullPath, 'utf8');
      const currentHash = sha256Hex(raw);
      const recent = this.recentSelfWriteHashes.get(fullPath);
      if (recent && recent.expiresAt > Date.now() && recent.hash === currentHash) {
        return;
      }

      const isRender = fileName.endsWith('.render.json');
      let projectId = isRender
        ? fileName.slice(0, -'.render.json'.length)
        : fileName.slice(0, -'.json'.length);

      if (!isRender) {
        try {
          const parsed = JSON.parse(raw) as { timeline?: { projectId?: string } };
          if (parsed?.timeline?.projectId) {
            projectId = parsed.timeline.projectId;
          }
        } catch {
          return; // Skip incomplete/malformed JSON
        }
      }

      onExternalChange({
        projectId,
        kind: isRender ? 'render' : 'project',
        fileName,
        detectedAt: new Date().toISOString(),
      });
    } catch {
      // Ignore transient fs lock on Windows
    }
  }

  close(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        // Ignore close errors
      }
      this.watcher = null;
    }
  }
}

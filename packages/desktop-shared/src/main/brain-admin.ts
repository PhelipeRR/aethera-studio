import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inArray, sql } from 'drizzle-orm';
import { applyRetention, BrainError, exportBrain, importBrain, LearningService, readBrainSettings, toMarkdownFiles, writeBrainSettings, BrainService, type CandidateEdits } from '@neuralbridge/brain';
import { backupDatabase, backupFileName, isBackupFileName, listBackups, pruneBackups, restoreDatabase, tasks, type DatabaseHandle } from '@neuralbridge/database';
import { FINAL_TASK_STATUSES, TASK_STATUSES, type BackupInfo, type BrainSettings, type ImportResult, type LearningCandidate, type LearningStatus, type RetentionResult } from '@neuralbridge/shared';

const HOUR = 3_600_000;
/** Imports larger than this are refused before reading: a brain export of 100k memories is far smaller. */
const IMPORT_LIMIT_BYTES = 200 * 1024 * 1024;

export interface BrainAdminOptions {
  handle: DatabaseHandle | null;
  /** Where database backups live (one folder, files named by backupFileName). */
  backupsDir: string;
  migrationsFolder: string;
  /** After memories were added or replaced outside the normal store path (embeddings, open screens). */
  onMemoriesChanged?: () => void;
  log?: (message: string) => void;
  clock?: () => Date;
}

function domain<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof BrainError) throw new Error(`${error.code}: ${error.message}`, { cause: error });
    throw error;
  }
}

/** Brain Settings, learning queue, backups, retention, export and import. */
export function createBrainAdmin(options: BrainAdminOptions) {
  const { handle, backupsDir } = options;
  const log = options.log ?? ((message: string) => console.error(message));
  const now = () => options.clock?.() ?? new Date();
  const learning = handle ? new LearningService(handle, new BrainService(handle), { onStored: () => options.onMemoriesChanged?.() }) : null;

  function need(): DatabaseHandle {
    if (!handle) throw new Error('unavailable: O banco de dados está indisponível.');
    return handle;
  }

  function needLearning(): LearningService {
    need();
    return learning as LearningService;
  }

  function backup(kind: BackupInfo['kind']): BackupInfo {
    const file = join(backupsDir, backupFileName(kind, now()));
    backupDatabase(need(), file);
    const created = listBackups(backupsDir).find((entry) => entry.file === file);
    if (!created) throw new Error('O backup não foi encontrado depois de criado.');
    return created;
  }

  return {
    settings(): BrainSettings {
      return readBrainSettings(need());
    },

    saveSettings(value: BrainSettings): BrainSettings {
      return writeBrainSettings(need(), value);
    },

    learning(status?: LearningStatus): LearningCandidate[] {
      return needLearning().list(status);
    },

    propose(proposals: unknown[], context: Parameters<LearningService['propose']>[1]) {
      return learning ? learning.propose(proposals, context) : [];
    },

    approve(id: string, edits: CandidateEdits): { memoryId: string } {
      return domain(() => needLearning().approve(id, edits));
    },

    reject(id: string): void {
      domain(() => needLearning().reject(id));
    },

    backups(): BackupInfo[] {
      return listBackups(backupsDir);
    },

    createBackup(): BackupInfo {
      return backup('manual');
    },

    /**
     * Replaces the brain with a backup from the backups folder (by name only: the renderer never chooses
     * a path). A safety backup of the current state is taken first; refused while tasks are running.
     */
    async restore(name: string): Promise<{ safetyBackup: BackupInfo }> {
      const db = need();
      if (!isBackupFileName(name)) throw new Error('invalid: Nome de backup inválido.');
      const source = listBackups(backupsDir).find((entry) => entry.name === name);
      if (!source) throw new Error('not_found: Backup não encontrado.');
      const active = db.db
        .select({ n: sql<number>`count(*)` })
        .from(tasks)
        .where(inArray(tasks.status, TASK_STATUSES.filter((status) => !FINAL_TASK_STATUSES.includes(status))))
        .get()?.n;
      if (active) throw new Error('conflict: Há tarefas em andamento. Espere terminarem ou cancele-as antes de restaurar.');
      const safetyBackup = backup('before-restore');
      await restoreDatabase(db, source.file, { migrationsFolder: options.migrationsFolder });
      log(`[backup] restored ${source.name}; previous state saved as ${safetyBackup.name}`);
      options.onMemoriesChanged?.();
      return { safetyBackup };
    },

    applyRetention(): RetentionResult {
      return applyRetention(need(), readBrainSettings(need()).retention, now());
    },

    /**
     * What runs on a timer: an automatic backup when the newest one is older than the interval, pruning of
     * old automatic backups, and the retention policy. Failures are logged, never thrown at the timer.
     */
    runScheduled(): { backedUp: boolean; retention: RetentionResult | null } {
      if (!handle) return { backedUp: false, retention: null };
      const settings = readBrainSettings(handle);
      let backedUp = false;
      try {
        const latest = listBackups(backupsDir).find((entry) => entry.kind === 'auto');
        if (settings.backup.intervalHours > 0 && (!latest || now().getTime() - Date.parse(latest.createdAt) >= settings.backup.intervalHours * HOUR)) {
          backup('auto');
          backedUp = true;
        }
        pruneBackups(backupsDir, settings.backup.keep);
      } catch (error) {
        log(`[backup] automatic backup failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      let retention: RetentionResult | null = null;
      try {
        retention = applyRetention(handle, settings.retention, now());
      } catch (error) {
        log(`[retention] failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      return { backedUp, retention };
    },

    exportJson(file: string): { count: number } {
      const dump = exportBrain(need());
      writeFileSync(file, JSON.stringify(dump, null, 2), 'utf8');
      return { count: dump.memories.length };
    },

    /** Writes into a new folder inside `parent`, so nothing the user already has is overwritten. */
    exportMarkdown(parent: string): { count: number; folder: string } {
      const files = toMarkdownFiles(exportBrain(need()));
      const folder = join(parent, `Singularity-memorias-${now().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`);
      mkdirSync(folder, { recursive: false });
      for (const file of files) {
        const target = join(folder, ...file.path.split('/'));
        mkdirSync(join(target, '..'), { recursive: true });
        writeFileSync(target, file.content, { encoding: 'utf8', flag: 'wx' });
      }
      return { count: files.length, folder };
    },

    importJson(file: string): ImportResult {
      if (statSync(file).size > IMPORT_LIMIT_BYTES) throw new Error('invalid: Arquivo grande demais para uma exportação do Singularity.');
      let data: unknown;
      try {
        data = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        throw new Error('invalid: O arquivo não é um JSON válido.');
      }
      let result: ImportResult;
      try {
        result = importBrain(need(), data);
      } catch (error) {
        throw new Error(`invalid: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
      if (result.imported) options.onMemoriesChanged?.();
      return result;
    },
  };
}

export type BrainAdmin = ReturnType<typeof createBrainAdmin>;

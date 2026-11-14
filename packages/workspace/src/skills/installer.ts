import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, mkdir, open, readFile, readdir, rename, rm, writeFile, lstat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { SkillAgent } from './contracts.js';
import { createTrustCenter, type TrustSource } from './trust-center.js';
import { validateRemoteSkillSource } from '../skills.js';
import { promisify } from 'node:util';

export type SkillTransactionState = 'prepared' | 'awaiting_approval' | 'staging' | 'validated' | 'committing' | 'completed' | 'rolling_back' | 'rolled_back' | 'failed' | 'cancelled' | 'recovery_required';
export type SkillInstallOperation = 'install' | 'update' | 'rollback';

export interface SkillInstallAuthorization { operationId: string; origin: string; destination: string; scope: 'global' | 'project'; agent: SkillAgent | null; fingerprint: string; operation: SkillInstallOperation; summary: string; versionRef: string | null; }
export interface SkillInstallRequest { skillId: string; source: string; destination: string; allowedDestinationRoot: string; stagingRoot: string; journalRoot: string; scope: 'global' | 'project'; agent?: SkillAgent; versionRef?: string | null; sourceDescriptor?: TrustSource; expectedDestinationFingerprint?: string | null; }
export interface SkillTransaction { id: string; skillId: string; source: string; destination: string; scope: 'global' | 'project'; agent: SkillAgent | null; operation: 'install' | 'update'; state: SkillTransactionState; fingerprint: string; stagingPath: string; backupPath: string | null; expectedDestinationFingerprint?: string | null; authorization: SkillInstallAuthorization | null; createdAt: string; updatedAt: string; error: string | null; }
export interface PreparedSkillInstall { transaction: SkillTransaction; preview: Awaited<ReturnType<ReturnType<typeof createTrustCenter>['preview']>>; authorization: SkillInstallAuthorization; }
export interface TransactionalSkillInstaller { prepare(request: SkillInstallRequest): Promise<PreparedSkillInstall>; commit(operationId: string, authorization: SkillInstallAuthorization): Promise<SkillTransaction>; cancel(operationId: string): Promise<SkillTransaction>; rollback(operationId: string, authorization: SkillInstallAuthorization): Promise<SkillTransaction>; recover(): Promise<SkillTransaction[]>; history(): Promise<SkillTransaction[]>; readJournal(operationId: string): Promise<SkillTransaction>; }
const execFileAsync = promisify(execFile);

function now(): string { return new Date().toISOString(); }
function safeChild(root: string, candidate: string): boolean { const rel = relative(resolve(root), resolve(candidate)); return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)); }
async function exists(path: string): Promise<boolean> { return lstat(path).then(() => true).catch(() => false); }
async function atomicJson(path: string, value: unknown): Promise<void> { await mkdir(dirname(path), { recursive: true }); const temp = `${path}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(value, null, 2), 'utf8'); await rename(temp, path); }
function journalPath(root: string, id: string): string { return resolve(root, `${id}.json`); }
async function lockDestination(destination: string): Promise<{ release: () => Promise<void> }> { const lock = `${resolve(destination)}.neuralbridge.lock`; await mkdir(dirname(lock), { recursive: true }); const handle = await open(lock, 'wx'); return { release: async () => { await handle.close(); await rm(lock, { force: true }); } }; }

export function createTransactionalSkillInstaller(options: { journalRoot?: string } = {}): TransactionalSkillInstaller {
  const trust = createTrustCenter();
  const configuredJournalRoot = options.journalRoot;
  return {
    async prepare(request) {
      if (!configuredJournalRoot || configuredJournalRoot !== resolve(request.journalRoot)) throw new Error('journal_root_required: configure o mesmo diretório persistente no instalador e na operação');
      const destination = resolve(request.destination);
      const allowedRoot = resolve(request.allowedDestinationRoot);
      const remote = /^https:\/\//iu.test(request.source);
      const source = remote ? request.source : resolve(request.source);
      if (!safeChild(allowedRoot, destination) || destination === allowedRoot) throw new Error('invalid_skill_destination: destino fora da raiz autorizada');
      const id = randomUUID();
      const stagingPath = resolve(request.stagingRoot, id);
      await mkdir(request.stagingRoot, { recursive: true });
      if (remote) {
        const descriptor = request.sourceDescriptor;
        if (!descriptor || descriptor.kind !== 'remote') throw new Error('invalid_skill_source: origem remota sem descriptor');
        validateRemoteSkillSource(request.source, descriptor.allowlistedHosts ?? []);
        const caFile = descriptor.caFile;
        const gitArgs = ['-c', 'protocol.file.allow=never', ...(caFile ? ['-c', 'http.sslBackend=openssl', '-c', `http.sslCAInfo=${caFile}`, '-c', 'http.sslVerify=true'] : []), 'clone', '--no-recurse-submodules', '--no-tags', request.source, stagingPath];
        await execFileAsync('git', gitArgs, { timeout: 60_000, windowsHide: true });
      } else {
        if (!(await exists(source)) || !(await lstat(source)).isDirectory()) throw new Error('invalid_skill_source: origem local indisponível');
        await cp(source, stagingPath, { recursive: true, errorOnExist: true, force: false });
      }
      const descriptor = request.sourceDescriptor ?? { kind: 'local' as const, value: source, scope: request.scope };
      const preview = await trust.preview({ skillId: request.skillId, root: stagingPath, source: descriptor, destination });
      if (preview.blockedBy.length) { await rm(stagingPath, { recursive: true, force: true }); throw new Error(`trust_blocked: ${preview.blockedBy.join(',')}`); }
      const transaction: SkillTransaction = { id, skillId: request.skillId, source, destination, scope: request.scope, agent: request.agent ?? null, operation: await exists(destination) ? 'update' : 'install', state: 'awaiting_approval', fingerprint: preview.assessmentFingerprint, stagingPath, backupPath: null, ...(request.expectedDestinationFingerprint !== undefined ? { expectedDestinationFingerprint: request.expectedDestinationFingerprint } : {}), authorization: null, createdAt: now(), updatedAt: now(), error: null };
      const authorization: SkillInstallAuthorization = { operationId: id, origin: source, destination, scope: request.scope, agent: request.agent ?? null, fingerprint: preview.assessmentFingerprint, operation: transaction.operation, summary: `${transaction.operation}:${request.skillId}`, versionRef: request.versionRef ?? null };
      transaction.authorization = authorization;
      await atomicJson(journalPath(request.journalRoot, id), transaction);
      return { transaction, preview, authorization };
    },
    async commit(operationId, authorization) {
      const journal = await this.readJournal(operationId);
      if (journal.state !== 'awaiting_approval' || journal.authorization === null) throw new Error('invalid_transaction_state: operação não aguarda autorização');
      if (journal.authorization.operationId !== authorization.operationId || journal.authorization.origin !== authorization.origin || journal.authorization.destination !== authorization.destination || journal.authorization.scope !== authorization.scope || journal.authorization.agent !== authorization.agent || journal.authorization.fingerprint !== authorization.fingerprint || journal.authorization.operation !== authorization.operation) throw new Error('authorization_mismatch: autorização não corresponde à transação');
      const lock = await lockDestination(journal.destination).catch(() => { throw new Error('destination_busy: destino já possui uma operação em andamento'); });
      try {
        journal.state = 'staging'; journal.updatedAt = now();
        if (journal.expectedDestinationFingerprint !== undefined) {
          const destinationCurrent = await exists(journal.destination) ? await trust.assess({ skillId: journal.skillId, root: journal.destination, source: { kind: 'local', value: journal.destination, scope: journal.scope } }) : null;
          if (destinationCurrent?.decision.blockedBy.length || (destinationCurrent?.contentFingerprint ?? null) !== journal.expectedDestinationFingerprint) throw new Error('destination_changed: destino publicado mudou ou deixou de ser confiável após a prévia');
        }
        const current = await trust.assess({ skillId: journal.skillId, root: journal.stagingPath, source: { kind: 'local', value: journal.source, scope: journal.scope } });
        const sourceCurrent = /^https:\/\//iu.test(journal.source) ? null : await trust.assess({ skillId: journal.skillId, root: journal.source, source: { kind: 'local', value: journal.source, scope: journal.scope } });
        if (current.contentFingerprint !== journal.fingerprint || (sourceCurrent !== null && sourceCurrent.contentFingerprint !== journal.fingerprint) || current.decision.blockedBy.length || (sourceCurrent?.decision.blockedBy.length ?? 0)) throw new Error('fingerprint_changed: conteúdo preparado ou origem não corresponde à avaliação aprovada');
        journal.state = 'validated'; journal.updatedAt = now();
        const journalFile = journalPath(configuredJournalRoot ?? dirname(journal.stagingPath), operationId); await atomicJson(journalFile, journal);
        journal.state = 'committing'; journal.updatedAt = now(); await atomicJson(journalFile, journal);
        if (await exists(journal.destination)) { journal.backupPath = `${journal.destination}.neuralbridge-backup-${journal.id}`; await rename(journal.destination, journal.backupPath); await atomicJson(journalFile, journal); }
        await rename(journal.stagingPath, journal.destination);
        const installed = await trust.assess({ skillId: journal.skillId, root: journal.destination, source: { kind: 'local', value: journal.source, scope: journal.scope } });
        if (installed.contentFingerprint !== journal.fingerprint || installed.decision.blockedBy.length) throw new Error('post_commit_validation_failed: destino não corresponde ao conteúdo validado');
        journal.state = 'completed'; journal.updatedAt = now(); journal.authorization = null; await atomicJson(journalFile, journal);
        return journal;
      } catch (error) {
        const file = journalPath(configuredJournalRoot ?? dirname(journal.stagingPath), operationId);
        if (journal.backupPath && !(await exists(journal.destination)) && await exists(journal.backupPath)) { await rename(journal.backupPath, journal.destination); journal.state = 'rolled_back'; } else journal.state = 'recovery_required';
        journal.error = error instanceof Error ? error.message : String(error); journal.updatedAt = now(); journal.authorization = null; await atomicJson(file, journal); throw error;
      } finally { await lock.release(); }
    },
    async cancel(operationId) { const journal = await this.readJournal(operationId); if (journal.state !== 'awaiting_approval' && journal.state !== 'prepared') throw new Error('cancel_not_available: operação já iniciou commit'); await rm(journal.stagingPath, { recursive: true, force: true }); journal.state = 'cancelled'; journal.authorization = null; journal.updatedAt = now(); await atomicJson(journalPath(configuredJournalRoot ?? dirname(journal.stagingPath), operationId), journal); return journal; },
    async rollback(operationId, authorization) { const journal = await this.readJournal(operationId); if (journal.state !== 'completed' || !journal.backupPath || !(await exists(journal.backupPath))) throw new Error('rollback_unavailable: backup íntegro não encontrado'); if (authorization.operationId !== operationId || authorization.operation !== 'rollback' || authorization.destination !== journal.destination || authorization.fingerprint !== journal.fingerprint) throw new Error('authorization_mismatch: autorização de rollback inválida'); const lock = await lockDestination(journal.destination); try { journal.state = 'rolling_back'; journal.updatedAt = now(); const file = journalPath(configuredJournalRoot ?? dirname(journal.stagingPath), operationId); await atomicJson(file, journal); const displaced = `${journal.destination}.neuralbridge-rollback-${journal.id}`; await rename(journal.destination, displaced); await rename(journal.backupPath, journal.destination); await rm(displaced, { recursive: true, force: true }); journal.state = 'rolled_back'; journal.authorization = null; journal.updatedAt = now(); await atomicJson(file, journal); return journal; } finally { await lock.release(); } },
    async recover() { if (!configuredJournalRoot) return []; const entries = await readdir(configuredJournalRoot, { withFileTypes: true }).catch(() => []); const recovered: SkillTransaction[] = []; for (const entry of entries) { if (!entry.isFile() || !entry.name.endsWith('.json')) continue; const file = resolve(configuredJournalRoot, entry.name); const journal = JSON.parse(await readFile(file, 'utf8')) as SkillTransaction; if (['committing', 'rolling_back', 'staging', 'validated'].includes(journal.state)) { journal.state = 'recovery_required'; journal.updatedAt = now(); journal.error = 'recovery_required: operação interrompida antes da confirmação segura'; journal.authorization = null; await atomicJson(file, journal); recovered.push(journal); } } return recovered; },
    async history() { if (!configuredJournalRoot) return []; const entries = await readdir(configuredJournalRoot, { withFileTypes: true }).catch(() => []); const result: SkillTransaction[] = []; for (const entry of entries) { if (!entry.isFile() || !entry.name.endsWith('.json')) continue; result.push(JSON.parse(await readFile(resolve(configuredJournalRoot, entry.name), 'utf8')) as SkillTransaction); } return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); },
    async readJournal(operationId) { if (!configuredJournalRoot) throw new Error('journal_root_required: configure o diretório persistente do journal'); return JSON.parse(await readFile(journalPath(configuredJournalRoot, operationId), 'utf8')) as SkillTransaction; },
  };
}


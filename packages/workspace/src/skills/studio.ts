import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { createSkillRecommendationEngine, type RecommendationContext } from './recommendation.js';
import type { DiscoveredSkill } from './discovery.js';
import { createTransactionalSkillInstaller } from './installer.js';
import { createTrustCenter } from './trust-center.js';
import { parseSkillManifest } from '../skills.js';
import type { SkillDraft, SkillDraftFile, SkillDraftSummary, SkillEditorState, SkillExportResult, SkillImportPreview, SkillMetadata, SkillRecommendationSimulation, SkillValidationResult, SkillVersion } from './contracts.js';

const FRONTMATTER = /^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/u;
const SIDECAR = 'neuralbridge.skill.json';
const VERSION_META = 'neuralbridge.version.json';
const MAX_FILE_BYTES = 512_000;
const MAX_TOTAL_BYTES = 5_000_000;
const MAX_FILES = 200;
const MAX_DEPTH = 8;
const TEXT_EXTENSIONS = new Set(['.bat', '.cmd', '.com', '.json', '.js', '.mjs', '.md', '.ps1', '.sh', '.txt', '.vbs', '.yaml', '.yml']);
const DRAFT_DEFAULTS: Omit<SkillMetadata, 'name' | 'description'> = { objective: '', triggers: [], agents: ['claude', 'codex'], dependencies: [], permissions: [], examples: [] };

export interface SkillStudioOptions { root: string; managedRoot: string; journalRoot: string; stagingRoot: string; }
export interface SkillStudioService {
  listDrafts(): Promise<SkillDraftSummary[]>;
  createDraft(input: { skillId: string; metadata: SkillMetadata; instructions: string; files?: SkillDraftFile[]; scope: 'global' | 'project'; projectId?: string | null }): Promise<SkillEditorState>;
  openSkill(input: { skillId: string; sourcePath: string; scope: 'global' | 'project'; projectId?: string | null }): Promise<SkillEditorState>;
  getDraft(draftId: string): Promise<SkillEditorState>;
  saveDraft(input: { draftId: string; expectedRevision: number; metadata: SkillMetadata; instructions: string; files: SkillDraftFile[] }): Promise<SkillEditorState>;
  validateDraft(draftId: string): Promise<SkillValidationResult>;
  publishDraft(input: { draftId: string; confirmed: true }): Promise<SkillVersion>;
  listVersions(skillId: string): Promise<SkillVersion[]>;
  compareVersions(input: { skillId: string; fromVersionId: string; toVersionId: string }): Promise<{ skillId: string; fromVersionId: string; toVersionId: string; added: string[]; removed: string[]; changed: string[]; summary: string }>;
  restoreVersion(input: { skillId: string; versionId: string; confirmed: true; expectedFingerprint?: string | null }): Promise<SkillVersion>;
  previewImport(sourcePath: string): Promise<SkillImportPreview>;
  importDraft(input: { sourcePath: string; confirmed: true }): Promise<SkillEditorState>;
  exportVersion(input: { skillId: string; versionId: string }): Promise<SkillExportResult>;
  simulateRecommendation(draftId: string, context: RecommendationContext): Promise<SkillRecommendationSimulation>;
}

interface StudioSidecar { id: string; skillId: string; metadata: SkillMetadata; scope: 'global' | 'project'; projectId: string | null; sourcePath: string | null; baseFingerprint: string | null; revision: number; createdAt: string; updatedAt: string; }
interface StudioFile { relativePath: string; content: string; size: number; hash: string; }

export function validateSkillMetadata(metadata: SkillMetadata): string[] {
  const errors: string[] = [];
  if (!metadata.name.trim()) errors.push('name_required');
  if (!metadata.description.trim()) errors.push('description_required');
  return errors;
}

function frontmatterValue(value: string): string {
  return value.replace(/[\r\n]/gu, ' ').trim();
}

export function serializeStudioMarkdown(metadata: Pick<SkillMetadata, 'name' | 'description'>, instructions: string): string {
  return `---\nname: ${frontmatterValue(metadata.name)}\ndescription: ${frontmatterValue(metadata.description)}\n---\n\n${instructions.trim()}\n`;
}

export function parseStudioMarkdown(raw: string, fallbackName: string): { metadata: Pick<SkillMetadata, 'name' | 'description'>; instructions: string; valid: boolean } {
  const manifest = parseSkillManifest(raw, fallbackName);
  return { metadata: { name: manifest.name, description: manifest.description }, instructions: raw.replace(FRONTMATTER, '').trim(), valid: manifest.valid };
}

function now(): string { return new Date().toISOString(); }
function hash(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
function safeId(value: string): string { const id = value.trim().toLowerCase().replace(/\s+/gu, '-'); if (!/^[a-z0-9][a-z0-9._-]{0,119}$/u.test(id)) throw new Error('studio_skill_id_invalid: identificador inválido'); return id; }
function relativeSafe(root: string, value: string): string { const normalized = value.replaceAll('\\', '/'); if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/u.test(normalized)) throw new Error('studio_path_invalid: caminho auxiliar inválido'); const candidate = resolve(root, normalized); const rel = relative(resolve(root), candidate); if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || rel.includes(':')) throw new Error('studio_path_invalid: caminho auxiliar fora da raiz'); if (rel.split(/[\\/]/u).some((part) => part.startsWith('.'))) throw new Error('studio_hidden_file: arquivos ocultos não são suportados no Studio'); return rel.split(sep).join('/'); }
function assertTextFile(path: string): void { const extension = extname(path).toLowerCase(); const name = basename(path).toLowerCase(); if (!TEXT_EXTENSIONS.has(extension) && name !== 'readme' && name !== 'license') throw new Error('studio_file_type_unsupported: arquivo auxiliar não textual'); }
function defaultMetadata(metadata: Partial<SkillMetadata>, skillId: string): SkillMetadata { return { name: metadata.name ?? skillId, description: metadata.description ?? '', objective: metadata.objective ?? DRAFT_DEFAULTS.objective, triggers: [...(metadata.triggers ?? DRAFT_DEFAULTS.triggers)], agents: [...(metadata.agents ?? DRAFT_DEFAULTS.agents)], dependencies: [...(metadata.dependencies ?? DRAFT_DEFAULTS.dependencies)], permissions: [...(metadata.permissions ?? DRAFT_DEFAULTS.permissions)], examples: [...(metadata.examples ?? DRAFT_DEFAULTS.examples)] }; }
function draftDir(root: string, id: string): string { return resolve(root, 'drafts', id); }
function draftMarkdown(root: string, id: string): string { return join(draftDir(root, id), 'SKILL.md'); }
function draftSidecar(root: string, id: string): string { return join(draftDir(root, id), SIDECAR); }
function versionDir(root: string, skillId: string, versionId: string): string { return resolve(root, 'versions', skillId, versionId); }
function versionIndex(root: string, skillId: string): string { return resolve(root, 'versions', skillId, 'index.json'); }
function sidecarFromDraft(draft: SkillDraft): StudioSidecar { return { id: draft.id, skillId: draft.skillId, metadata: draft.metadata, scope: draft.scope, projectId: draft.projectId, sourcePath: draft.sourcePath, baseFingerprint: draft.baseFingerprint, revision: draft.revision, createdAt: draft.createdAt, updatedAt: draft.updatedAt }; }
async function exists(path: string): Promise<boolean> { return lstat(path).then(() => true).catch(() => false); }
async function atomicJson(path: string, value: unknown): Promise<void> { await mkdir(resolve(path, '..'), { recursive: true }); const temporary = `${path}.${randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8'); await rename(temporary, path); }
async function readJson<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, 'utf8')) as T; }
async function readSkillTree(root: string): Promise<{ manifest: string; files: SkillDraftFile[]; fingerprint: string; totalBytes: number }> {
  const base = resolve(root); const rootStat = await lstat(base); if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('studio_symlink_rejected: raiz da skill não é um diretório regular'); const files: StudioFile[] = []; let totalBytes = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) throw new Error('studio_depth_limit: profundidade máxima excedida');
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) throw new Error('studio_hidden_file: arquivos ocultos não são suportados no Studio');
      const path = resolve(dir, entry.name); const stat = await lstat(path);
      if (stat.isSymbolicLink()) throw new Error('studio_symlink_rejected: symlink não é seguido');
      if (stat.isDirectory()) { await walk(path, depth + 1); continue; }
      if (!stat.isFile()) continue;
      const relativePath = relative(base, path).split(sep).join('/');
      if (relativePath.split('/').length > MAX_DEPTH) throw new Error('studio_depth_limit: profundidade máxima excedida');
      if (relativePath === SIDECAR || relativePath === VERSION_META) continue;
      if (relativePath !== 'SKILL.md') { assertTextFile(relativePath); }
      if (stat.size > MAX_FILE_BYTES) throw new Error('studio_file_size_limit: arquivo auxiliar excede o limite');
      totalBytes += stat.size; if (totalBytes > MAX_TOTAL_BYTES) throw new Error('studio_total_size_limit: conteúdo excede o limite');
      if (files.length >= MAX_FILES) throw new Error('studio_file_count_limit: quantidade de arquivos excede o limite');
      const content = await readFile(path, 'utf8'); files.push({ relativePath, content, size: stat.size, hash: hash(content) });
    }
  };
  await walk(base, 0); const manifest = files.find((file) => file.relativePath === 'SKILL.md'); if (!manifest) throw new Error('studio_manifest_missing: SKILL.md não encontrado');
  const fingerprint = hash(files.map((file) => `${file.relativePath}\0${file.size}\0${file.hash}`).sort().join('\n'));
  return { manifest: manifest.content, files: files.filter((file) => file.relativePath !== 'SKILL.md').map((file) => ({ path: file.relativePath, content: file.content })), fingerprint, totalBytes };
}
async function writeTree(root: string, markdown: string, files: SkillDraftFile[], sidecar: StudioSidecar): Promise<void> {
  const current = await exists(root) ? await lstat(root) : null; if (current?.isSymbolicLink()) throw new Error('studio_symlink_rejected: raiz do draft não é um diretório regular');
  const normalizedFiles: SkillDraftFile[] = []; const seen = new Set<string>(); let totalBytes = Buffer.byteLength(markdown, 'utf8'); if (totalBytes > MAX_FILE_BYTES) throw new Error('studio_file_size_limit: SKILL.md excede o limite');
  for (const file of files) { const path = relativeSafe(root, file.path); if (path === 'SKILL.md' || path === SIDECAR || path === VERSION_META) throw new Error('studio_path_invalid: arquivo reservado'); assertTextFile(path); if (seen.has(path)) throw new Error('studio_path_invalid: arquivo auxiliar duplicado'); if (normalizedFiles.length >= MAX_FILES - 1) throw new Error('studio_file_count_limit: quantidade de arquivos excede o limite'); seen.add(path); if (path.split('/').length > MAX_DEPTH) throw new Error('studio_depth_limit: profundidade máxima excedida'); const size = Buffer.byteLength(file.content, 'utf8'); if (size > MAX_FILE_BYTES) throw new Error('studio_file_size_limit: arquivo auxiliar excede o limite'); totalBytes += size; if (totalBytes > MAX_TOTAL_BYTES) throw new Error('studio_total_size_limit: conteúdo excede o limite'); normalizedFiles.push({ path, content: file.content }); }
  if (normalizedFiles.length > MAX_FILES) throw new Error('studio_file_count_limit: quantidade de arquivos excede o limite');
  const staged = `${root}.${randomUUID()}.tmp`; const backup = `${root}.${randomUUID()}.bak`; await mkdir(staged, { recursive: true });
  try {
    await writeFile(join(staged, 'SKILL.md'), markdown, 'utf8');
    for (const file of normalizedFiles) { const target = join(staged, file.path); await mkdir(resolve(target, '..'), { recursive: true }); await writeFile(target, file.content, 'utf8'); }
    await atomicJson(join(staged, SIDECAR), sidecar);
    if (current) await rename(root, backup);
    try { await rename(staged, root); } catch (error) { if (current && await exists(backup) && !(await exists(root))) await rename(backup, root); throw error; }
    if (current) await rm(backup, { recursive: true, force: true });
  } catch (error) { await rm(staged, { recursive: true, force: true }); throw error; }
}
function editorState(draft: SkillDraft): SkillEditorState { return { draft, markdown: serializeStudioMarkdown(draft.metadata, draft.instructions), validation: null }; }
async function loadDraft(root: string, id: string): Promise<SkillDraft> { const sidecar = await readJson<StudioSidecar>(draftSidecar(root, id)); const raw = await readFile(draftMarkdown(root, id), 'utf8'); const parsed = parseStudioMarkdown(raw, sidecar.skillId); const tree = await readSkillTree(draftDir(root, id)); return { id: sidecar.id, skillId: sidecar.skillId, metadata: { ...defaultMetadata(sidecar.metadata, parsed.metadata.name), name: parsed.metadata.name, description: parsed.metadata.description }, instructions: parsed.instructions, files: tree.files, scope: sidecar.scope, projectId: sidecar.projectId, sourcePath: sidecar.sourcePath, baseFingerprint: sidecar.baseFingerprint, revision: sidecar.revision, createdAt: sidecar.createdAt, updatedAt: sidecar.updatedAt }; }
async function writeDraft(root: string, draft: SkillDraft): Promise<void> { await writeTree(draftDir(root, draft.id), serializeStudioMarkdown(draft.metadata, draft.instructions), draft.files, sidecarFromDraft(draft)); }
function validationErrors(metadata: SkillMetadata): string[] { return validateSkillMetadata(metadata); }
async function withDraftLock<T>(root: string, draftId: string, operation: () => Promise<T>): Promise<T> {
  const lock = resolve(root, 'locks', `${draftId}.lock`); await mkdir(resolve(lock, '..'), { recursive: true });
  try { await mkdir(lock); } catch (error: unknown) { if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') throw new Error('studio_revision_conflict: draft está sendo alterado por outra sessão', { cause: error }); throw error; }
  try { return await operation(); } finally { await rm(lock, { recursive: true, force: true }); }
}
async function withSkillLock<T>(root: string, skillId: string, operation: () => Promise<T>): Promise<T> {
  const lock = resolve(root, 'locks', 'versions', `${safeId(skillId)}.lock`); await mkdir(resolve(lock, '..'), { recursive: true });
  try { await mkdir(lock); } catch (error: unknown) { if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') throw new Error('studio_version_conflict: versões da skill estão sendo alteradas', { cause: error }); throw error; }
  try { return await operation(); } finally { await rm(lock, { recursive: true, force: true }); }
}
function treeMap(tree: { manifest: string; files: SkillDraftFile[] }): Map<string, string> {
  const entries: Array<[string, string]> = tree.files.map((file): [string, string] => [file.path, hash(file.content)]);
  entries.push(['SKILL.md', hash(tree.manifest)]);
  return new Map(entries);
}

interface PreparedVersion { version: SkillVersion; previousVersions: SkillVersion[]; }

export function createSkillStudioService(options: SkillStudioOptions): SkillStudioService {
  const root = resolve(options.root); const managedRoot = resolve(options.managedRoot); const trust = createTrustCenter();
  const validationFor = async (draft: SkillDraft): Promise<SkillValidationResult> => {
    const errors = validationErrors(draft.metadata); const tree = await readSkillTree(draftDir(root, draft.id)); const parsed = parseStudioMarkdown(tree.manifest, draft.skillId); if (!parsed.valid) errors.push('manifest_invalid'); const assessment = await trust.assess({ skillId: draft.skillId, root: draftDir(root, draft.id), source: { kind: 'local', value: draftDir(root, draft.id), scope: draft.scope }, destination: join(managedRoot, draft.skillId) });
    const warnings = assessment.findings.filter((item) => item.status === 'attention' || item.status === 'not-verified').map((item) => item.id);
    return { valid: errors.length === 0 && assessment.decision.allowed, errors, warnings, fingerprint: tree.fingerprint, manifest: { name: draft.metadata.name, description: draft.metadata.description }, trust: assessment };
  };
  const recoverVersions = async (skillId: string): Promise<SkillVersion[]> => {
    const normalizedSkillId = safeId(skillId);
    const indexPath = versionIndex(root, normalizedSkillId);
    const indexed = await readJson<SkillVersion[]>(indexPath).catch(() => []);
    const known = new Map(indexed.map((version) => [version.id, version]));
    const versionsRoot = resolve(root, 'versions', normalizedSkillId);
    const entries = await readdir(versionsRoot, { withFileTypes: true }).catch(() => []);
    let recovered = false;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      if (known.has(entry.name)) continue;
      const versionPath = versionDir(root, normalizedSkillId, entry.name);
      const candidate = await readJson<SkillVersion>(join(versionPath, VERSION_META)).catch(() => undefined);
      if (!candidate || candidate.id !== entry.name || candidate.skillId !== normalizedSkillId) continue;
      try {
        const tree = await readSkillTree(versionPath);
        if (tree.fingerprint !== candidate.fingerprint) continue;
        known.set(candidate.id, { ...candidate, path: versionPath });
        recovered = true;
      } catch {
        // An incomplete or malformed snapshot is deliberately ignored.
      }
    }
    const versions = [...known.values()].sort((left, right) => left.version - right.version || left.createdAt.localeCompare(right.createdAt));
    const latestId = versions.at(-1)?.id;
    const normalized = versions.map((version) => ({ ...version, current: version.id === latestId }));
    if (recovered || normalized.some((version, index) => version.current !== indexed[index]?.current || version.path !== indexed[index]?.path)) await atomicJson(indexPath, normalized);
    return normalized;
  };
  const loadVersion = async (skillId: string, id: string): Promise<SkillVersion> => { const versions = await recoverVersions(skillId); const version = versions.find((item) => item.id === id); if (!version) throw new Error('studio_version_not_found: versão não encontrada'); return version; };
  const prepareVersion = async (draft: Pick<SkillDraft, 'skillId'>, origin: SkillVersion['origin'], source: string, fingerprint: string): Promise<PreparedVersion> => {
    const skillId = safeId(draft.skillId); const previousVersions = await recoverVersions(skillId); const id = randomUUID(); const nextNumber = previousVersions.reduce((maximum, version) => Math.max(maximum, version.version), 0) + 1; const version: SkillVersion = { id, skillId, version: nextNumber, createdAt: now(), origin, fingerprint, path: versionDir(root, skillId, id), current: true };
    await mkdir(version.path, { recursive: true });
    try {
      await cp(source, version.path, { recursive: true, force: false });
      await atomicJson(join(version.path, VERSION_META), version);
    } catch (error) {
      await rm(version.path, { recursive: true, force: true });
      throw error;
    }
    return { version, previousVersions };
  };
  const finalizeVersion = async ({ version, previousVersions }: PreparedVersion): Promise<SkillVersion> => {
    await atomicJson(versionIndex(root, version.skillId), [...previousVersions.map((item) => ({ ...item, current: false })), version]);
    return version;
  };
  const discardPreparedVersion = async (prepared: PreparedVersion): Promise<void> => { await rm(prepared.version.path, { recursive: true, force: true }).catch(() => undefined); };
  return {
    async listDrafts() {
      const draftsRoot = resolve(root, 'drafts');
      const entries = await readdir(draftsRoot, { withFileTypes: true }).catch(() => []);
      const drafts = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
        const draft = await loadDraft(root, entry.name);
        return { id: draft.id, skillId: draft.skillId, name: draft.metadata.name, description: draft.metadata.description, scope: draft.scope, projectId: draft.projectId, revision: draft.revision, updatedAt: draft.updatedAt } satisfies SkillDraftSummary;
      }));
      return drafts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },
    async createDraft(input) {
      const skillId = safeId(input.skillId); const timestamp = now(); const draft: SkillDraft = { id: randomUUID(), skillId, metadata: defaultMetadata(input.metadata, skillId), instructions: input.instructions, files: input.files ?? [], scope: input.scope, projectId: input.projectId ?? null, sourcePath: null, baseFingerprint: null, revision: 1, createdAt: timestamp, updatedAt: timestamp };
      if (validationErrors(draft.metadata).length) throw new Error(`studio_metadata_invalid: ${validationErrors(draft.metadata).join(',')}`); await writeDraft(root, draft); return editorState(draft);
    },
    async openSkill(input) {
      const skillId = safeId(input.skillId); const tree = await readSkillTree(input.sourcePath); const parsed = parseStudioMarkdown(tree.manifest, skillId); const sidecar = await readJson<Partial<StudioSidecar>>(join(resolve(input.sourcePath), SIDECAR)).catch(() => undefined); const timestamp = now(); const draft: SkillDraft = { id: randomUUID(), skillId, metadata: { ...defaultMetadata(sidecar?.metadata ?? {}, parsed.metadata.name), name: parsed.metadata.name, description: parsed.metadata.description }, instructions: parsed.instructions, files: tree.files, scope: input.scope, projectId: input.projectId ?? null, sourcePath: resolve(input.sourcePath), baseFingerprint: tree.fingerprint, revision: 1, createdAt: timestamp, updatedAt: timestamp }; await writeDraft(root, draft); return editorState(draft);
    },
    async getDraft(draftId) { return editorState(await loadDraft(root, draftId)); },
    async saveDraft(input) {
      return withDraftLock(root, input.draftId, async () => {
        const current = await loadDraft(root, input.draftId); if (current.revision !== input.expectedRevision) throw new Error('studio_revision_conflict: draft foi alterado por outra sessão'); const files = input.files.map((file) => ({ path: relativeSafe(draftDir(root, current.id), file.path), content: file.content })); if (current.sourcePath && current.baseFingerprint && (await readSkillTree(current.sourcePath)).fingerprint !== current.baseFingerprint) throw new Error('studio_conflict: origem foi alterada externamente');
        const draft: SkillDraft = { ...current, metadata: input.metadata, instructions: input.instructions, files, revision: current.revision + 1, updatedAt: now() }; if (validationErrors(draft.metadata).length) throw new Error(`studio_metadata_invalid: ${validationErrors(draft.metadata).join(',')}`); await writeDraft(root, draft); return editorState(draft);
      });
    },
    async validateDraft(draftId) { return validationFor(await loadDraft(root, draftId)); },
    async publishDraft(input) {
      if (input.confirmed !== true) throw new Error('studio_confirmation_required: publicação exige confirmação explícita');
      return withDraftLock(root, input.draftId, async () => {
        const draft = await loadDraft(root, input.draftId); if (draft.scope !== 'global') throw new Error('unsupported_skill_scope: publicação do Studio suporta apenas escopo global'); const validation = await validationFor(draft); if (!validation.valid) throw new Error(`trust_blocked: ${[...validation.errors, ...validation.trust.decision.blockedBy].join(',')}`);
        return withSkillLock(root, draft.skillId, async () => {
          const destination = resolve(managedRoot, draft.skillId); const destinationExists = await exists(destination); if (destinationExists && (!draft.baseFingerprint || (await readSkillTree(destination)).fingerprint !== draft.baseFingerprint)) throw new Error('studio_conflict: destino publicado foi alterado externamente'); const expectedDestinationFingerprint = destinationExists ? (await trust.assess({ skillId: draft.skillId, root: destination, source: { kind: 'local', value: destination, scope: 'global' } })).contentFingerprint : null;
          const studioFingerprint = (await readSkillTree(draftDir(root, draft.id))).fingerprint; const preparedVersion = await prepareVersion(draft, draft.baseFingerprint ? 'edited' : 'created', draftDir(root, draft.id), studioFingerprint);
          try {
            const installer = createTransactionalSkillInstaller({ journalRoot: options.journalRoot }); const prepared = await installer.prepare({ skillId: draft.skillId, source: draftDir(root, draft.id), destination, allowedDestinationRoot: managedRoot, stagingRoot: options.stagingRoot, journalRoot: options.journalRoot, scope: 'global', sourceDescriptor: { kind: 'local', value: draftDir(root, draft.id), scope: 'global' }, expectedDestinationFingerprint }); await installer.commit(prepared.transaction.id, prepared.authorization);
          } catch (error) {
            await discardPreparedVersion(preparedVersion);
            throw error;
          }
          const version = await finalizeVersion(preparedVersion); const updated: SkillDraft = { ...draft, sourcePath: destination, baseFingerprint: studioFingerprint, revision: draft.revision + 1, updatedAt: now() }; await writeDraft(root, updated); return version;
        });
      });
    },
    async listVersions(skillId) { return withSkillLock(root, skillId, () => recoverVersions(skillId)); },
    async compareVersions(input) {
      const from = await loadVersion(input.skillId, input.fromVersionId); const to = await loadVersion(input.skillId, input.toVersionId); const left = treeMap(await readSkillTree(from.path)); const right = treeMap(await readSkillTree(to.path)); const added = [...right.keys()].filter((path) => !left.has(path)).sort(); const removed = [...left.keys()].filter((path) => !right.has(path)).sort(); const changed = [...right.keys()].filter((path) => left.has(path) && left.get(path) !== right.get(path)).sort(); return { skillId: safeId(input.skillId), fromVersionId: from.id, toVersionId: to.id, added, removed, changed, summary: `${added.length} adicionados, ${removed.length} removidos, ${changed.length} alterados` };
    },
    async restoreVersion(input) {
      if (input.confirmed !== true) throw new Error('studio_confirmation_required: restauração exige confirmação explícita'); const skillId = safeId(input.skillId);
      return withSkillLock(root, skillId, async () => {
        const version = await loadVersion(skillId, input.versionId); const destination = resolve(managedRoot, skillId); const destinationExists = await exists(destination); if (destinationExists && !input.expectedFingerprint) throw new Error('studio_conflict: fingerprint esperado é obrigatório para restaurar um destino existente'); if (destinationExists && (await readSkillTree(destination)).fingerprint !== input.expectedFingerprint) throw new Error('studio_conflict: destino publicado foi alterado externamente'); const expectedDestinationFingerprint = destinationExists ? (await trust.assess({ skillId, root: destination, source: { kind: 'local', value: destination, scope: 'global' } })).contentFingerprint : null; const restoredTree = await readSkillTree(version.path); const draft = { skillId }; const preparedVersion = await prepareVersion(draft, 'restored', version.path, restoredTree.fingerprint); const restoreSource = resolve(root, 'restore-staging', randomUUID());
        try {
          await mkdir(restoreSource, { recursive: true }); await cp(version.path, restoreSource, { recursive: true, force: false }); await rm(join(restoreSource, VERSION_META), { force: true });
          const installer = createTransactionalSkillInstaller({ journalRoot: options.journalRoot }); const prepared = await installer.prepare({ skillId, source: restoreSource, destination, allowedDestinationRoot: managedRoot, stagingRoot: options.stagingRoot, journalRoot: options.journalRoot, scope: 'global', sourceDescriptor: { kind: 'local', value: restoreSource, scope: 'global' }, expectedDestinationFingerprint }); await installer.commit(prepared.transaction.id, prepared.authorization);
        } catch (error) {
          await rm(restoreSource, { recursive: true, force: true }).catch(() => undefined);
          await discardPreparedVersion(preparedVersion);
          throw error;
        }
        await rm(restoreSource, { recursive: true, force: true }).catch(() => undefined);
        return finalizeVersion(preparedVersion);
      });
    },
    async previewImport(sourcePath) {
      const rootPath = resolve(sourcePath); const tree = await readSkillTree(rootPath); const parsed = parseStudioMarkdown(tree.manifest, basename(rootPath)); const skillId = safeId(parsed.metadata.name || basename(rootPath)); const draft: SkillDraft = { id: 'import-preview', skillId, metadata: defaultMetadata(parsed.metadata, skillId), instructions: parsed.instructions, files: tree.files, scope: 'global', projectId: null, sourcePath: rootPath, baseFingerprint: tree.fingerprint, revision: 1, createdAt: now(), updatedAt: now() }; const metadataErrors = validationErrors(draft.metadata); if (!parsed.valid) metadataErrors.push('manifest_invalid'); const assessment = await trust.assess({ skillId, root: rootPath, source: { kind: 'local', value: rootPath, scope: 'global' }, destination: join(managedRoot, skillId) }); const validation: SkillValidationResult = { valid: metadataErrors.length === 0 && assessment.decision.allowed, errors: metadataErrors, warnings: assessment.findings.filter((item) => item.status === 'attention' || item.status === 'not-verified').map((item) => item.id), fingerprint: tree.fingerprint, manifest: { name: draft.metadata.name, description: draft.metadata.description }, trust: assessment }; return { sourcePath: rootPath, skillId, metadata: draft.metadata, files: tree.files, totalBytes: tree.totalBytes, validation, conflict: await exists(join(managedRoot, skillId)) ? 'existing-published' : 'none' };
    },
    async importDraft(input) { if (input.confirmed !== true) throw new Error('studio_confirmation_required: importação exige confirmação explícita'); const preview = await this.previewImport(input.sourcePath); if (!preview.validation.valid) throw new Error(`trust_blocked: ${[...preview.validation.errors, ...preview.validation.trust.decision.blockedBy].join(',')}`); const created = await this.createDraft({ skillId: preview.skillId, metadata: preview.metadata, instructions: parseStudioMarkdown(await readFile(join(resolve(input.sourcePath), 'SKILL.md'), 'utf8'), preview.skillId).instructions, files: preview.files, scope: 'global' }); const draft = await loadDraft(root, created.draft.id); await writeDraft(root, { ...draft, sourcePath: resolve(input.sourcePath), baseFingerprint: preview.validation.fingerprint }); return editorState({ ...draft, sourcePath: resolve(input.sourcePath), baseFingerprint: preview.validation.fingerprint }); },
    async exportVersion(input) { const skillId = safeId(input.skillId); const version = await loadVersion(skillId, input.versionId); const target = resolve(root, 'exports', `${skillId}-${version.id}`); if (await exists(target)) throw new Error('studio_export_exists: exportação já existe'); await mkdir(resolve(target, '..'), { recursive: true }); await cp(version.path, target, { recursive: true, force: false }); await rm(join(target, VERSION_META), { force: true }); const tree = await readSkillTree(target); return { skillId, versionId: version.id, path: target, format: 'directory', files: ['SKILL.md', SIDECAR, ...tree.files.map((file) => file.path)], totalBytes: tree.totalBytes, fingerprint: tree.fingerprint }; },
    async simulateRecommendation(draftId, context) { const draft = await loadDraft(root, draftId); const candidate: DiscoveredSkill = { id: `studio:${draft.skillId}`, name: draft.metadata.name, description: draft.metadata.description, normalizedName: draft.metadata.name.toLocaleLowerCase(), normalizedDescription: draft.metadata.description.toLocaleLowerCase(), source: 'custom', scope: draft.scope, projectId: draft.projectId, agents: draft.metadata.agents, path: draftDir(root, draft.id), root: root, valid: validationErrors(draft.metadata).length === 0, installed: true, version: null, category: null, declaredFields: ['name', 'description'], inferredFields: ['studio'], unavailableFields: [], contentHash: hash(serializeStudioMarkdown(draft.metadata, draft.instructions)), scripts: draft.files.filter((file) => /\.(?:bat|cmd|com|exe|js|mjs|ps1|sh|vbs)$/iu.test(file.path)).map((file) => file.path), duplicateGroup: null, conflict: false }; const result = await createSkillRecommendationEngine(async () => ({ skills: [candidate] })).recommend(context); return { recommendations: result.recommendations.map((item) => ({ skillId: item.skillId, name: item.name, relevance: item.relevance, reasons: item.reasons, evidence: item.evidence })), excluded: result.excluded }; },
  };
}

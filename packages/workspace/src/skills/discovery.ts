import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { scanSkills, type SkillSummary } from '../skills.js';
import type { SkillAgent, SkillSource } from './contracts.js';

export type SkillScope = 'global' | 'project';

export interface SkillDiscoveryRoot {
  path: string;
  scope: SkillScope;
  projectId?: string;
  source?: SkillSource;
  agents?: readonly SkillAgent[];
}

export interface DiscoveredSkill {
  id: string;
  name: string;
  description: string;
  normalizedName: string;
  normalizedDescription: string;
  source: SkillSource;
  scope: SkillScope;
  projectId: string | null;
  agents: SkillAgent[];
  path: string;
  root: string;
  valid: boolean;
  installed: true;
  version: string | null;
  category: string | null;
  declaredFields: string[];
  inferredFields: string[];
  unavailableFields: string[];
  contentHash: string;
  scripts: string[];
  duplicateGroup: string | null;
  conflict: boolean;
}

export interface DiscoveryQuery {
  text?: string;
  agent?: SkillAgent;
  source?: SkillSource;
  scope?: SkillScope;
  projectId?: string;
  limit?: number;
  offset?: number;
}

export interface DiscoveryResult {
  skills: DiscoveredSkill[];
  total: number;
  duplicateGroups: Array<{ id: string; skillIds: string[]; reason: 'same-name' | 'same-path' }>;
}

export interface SkillDiscoveryEngine {
  discover(): Promise<DiscoveryResult>;
  list(query?: DiscoveryQuery): Promise<DiscoveredSkill[]>;
  get(id: string): Promise<DiscoveredSkill | null>;
}

const DEFAULT_AGENTS: readonly SkillAgent[] = ['claude', 'codex'];

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en-US').trim();
}

function inferSource(root: SkillDiscoveryRoot, skill: SkillSummary): SkillSource {
  if (root.source) return root.source;
  if (root.scope === 'project') return 'project';
  return skill.source;
}

function inferAgents(root: SkillDiscoveryRoot, source: SkillSource): SkillAgent[] {
  if (root.agents?.length) return [...new Set(root.agents)].sort();
  if (source === 'codex') return ['codex'];
  if (source === 'claude' || source === 'plugin') return ['claude'];
  return [...DEFAULT_AGENTS];
}

function hashContent(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function makeId(root: SkillDiscoveryRoot, skill: SkillSummary): string {
  return `${root.scope}:${root.projectId ?? 'global'}:${skill.id}`;
}

async function readableRoots(roots: readonly SkillDiscoveryRoot[]): Promise<SkillDiscoveryRoot[]> {
  const result: SkillDiscoveryRoot[] = [];
  for (const root of roots) {
    try {
      const stat = await lstat(resolve(root.path));
      if (stat.isDirectory()) result.push({ ...root, path: resolve(root.path) });
    } catch {
      // Discovery is best effort: missing or inaccessible roots simply yield no skills.
    }
  }
  return result;
}

function normalizeSkill(root: SkillDiscoveryRoot, skill: SkillSummary): DiscoveredSkill {
  const source = inferSource(root, skill);
  const agents = inferAgents(root, source);
  const declaredFields = ['name', ...(skill.description ? ['description'] : [])];
  return {
    id: makeId(root, skill),
    name: skill.name,
    description: skill.description,
    normalizedName: normalize(skill.name),
    normalizedDescription: normalize(skill.description),
    source,
    scope: root.scope,
    projectId: root.projectId ?? null,
    agents,
    path: skill.path,
    root: root.path,
    valid: skill.valid,
    installed: true,
    version: null,
    category: null,
    declaredFields,
    inferredFields: ['source', 'scope', 'agents', 'contentHash'],
    unavailableFields: ['version', 'category', 'updateMetadata'],
    contentHash: hashContent(skill.raw),
    scripts: [...skill.scripts].sort(),
    duplicateGroup: null,
    conflict: false,
  };
}

function markDuplicates(skills: DiscoveredSkill[]): { skills: DiscoveredSkill[]; groups: DiscoveryResult['duplicateGroups'] } {
  const byName = new Map<string, DiscoveredSkill[]>();
  const byPath = new Map<string, DiscoveredSkill[]>();
  for (const skill of skills) {
    const name = byName.get(skill.normalizedName) ?? [];
    name.push(skill); byName.set(skill.normalizedName, name);
    const path = byPath.get(skill.path) ?? [];
    path.push(skill); byPath.set(skill.path, path);
  }
  const groups: DiscoveryResult['duplicateGroups'] = [];
  const mark = (items: DiscoveredSkill[], reason: 'same-name' | 'same-path') => {
    if (items.length < 2) return;
    const id = `${reason}:${items.map((item) => item.id).sort().join('|')}`;
    groups.push({ id, skillIds: items.map((item) => item.id).sort(), reason });
    for (const item of items) { item.duplicateGroup = id; item.conflict = reason === 'same-name' && new Set(items.map((value) => value.contentHash)).size > 1; }
  };
  [...byName.values()].forEach((items) => mark(items, 'same-name'));
  [...byPath.values()].forEach((items) => mark(items, 'same-path'));
  return { skills: skills.sort((a, b) => a.normalizedName.localeCompare(b.normalizedName) || a.id.localeCompare(b.id)), groups: groups.sort((a, b) => a.id.localeCompare(b.id)) };
}

export function createSkillDiscoveryEngine(roots: readonly SkillDiscoveryRoot[]): SkillDiscoveryEngine {
  async function discover(): Promise<DiscoveryResult> {
    const configured = await readableRoots(roots);
    const discovered: DiscoveredSkill[] = [];
    for (const root of configured) {
      const skills = await scanSkills([root.path]);
      discovered.push(...skills.map((skill) => normalizeSkill(root, skill)));
    }
    const marked = markDuplicates(discovered);
    return { skills: marked.skills, total: marked.skills.length, duplicateGroups: marked.groups };
  }

  async function list(query: DiscoveryQuery = {}): Promise<DiscoveredSkill[]> {
    const result = await discover();
    const text = query.text ? normalize(query.text) : '';
    const filtered = result.skills.filter((skill) => (!text || `${skill.normalizedName} ${skill.normalizedDescription} ${normalize(skill.category ?? '')}`.includes(text)) && (!query.agent || skill.agents.includes(query.agent)) && (!query.source || skill.source === query.source) && (!query.scope || skill.scope === query.scope) && (query.projectId === undefined || skill.projectId === query.projectId));
    const offset = Math.max(0, query.offset ?? 0);
    const limit = Math.max(0, query.limit ?? filtered.length);
    return filtered.slice(offset, offset + limit);
  }

  return { discover, list, async get(id) { return (await discover()).skills.find((skill) => skill.id === id) ?? null; } };
}

export function defaultProjectSkillRoots(projectPath: string, projectId: string): SkillDiscoveryRoot[] {
  return [
    { path: resolve(projectPath, '.claude', 'skills'), scope: 'project', projectId, source: 'project', agents: ['claude'] },
    { path: resolve(projectPath, '.codex', 'skills'), scope: 'project', projectId, source: 'project', agents: ['codex'] },
    { path: resolve(projectPath, '.agents', 'skills'), scope: 'project', projectId, source: 'project' },
  ];
}

export function defaultGlobalSkillRoots(homePath: string): SkillDiscoveryRoot[] {
  return [
    { path: resolve(homePath, '.claude', 'skills'), scope: 'global', source: 'claude', agents: ['claude'] },
    { path: resolve(homePath, '.claude', 'plugins'), scope: 'global', source: 'plugin', agents: ['claude'] },
    { path: resolve(homePath, '.codex', 'skills'), scope: 'global', source: 'codex', agents: ['codex'] },
    { path: resolve(homePath, '.agents', 'skills'), scope: 'global', source: 'agents' },
  ];
}

export function skillDisplayLabel(skill: DiscoveredSkill): string {
  return `${skill.name} · ${skill.scope}${skill.projectId ? `:${skill.projectId}` : ''} · ${basename(skill.path)}`;
}

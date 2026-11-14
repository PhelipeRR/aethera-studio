import type { AgentId } from '@neuralbridge/shared/domain';
import type { ChangeStatus } from '@neuralbridge/shared/projects';
import type { SkillSummary } from '@neuralbridge/shared/channels';
import type { TaskDetail, TaskEvent } from '@neuralbridge/shared/tasks';

// Pure views over a conversation's stored task events for the right-hand panel. Everything here comes from
// what the CLIs and the TaskEngine actually reported; a missing figure stays null, never a guess.

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Agent of the step an event belongs to; task-level events have none. */
function agentOf(task: TaskDetail, event: TaskEvent): AgentId | null {
  return task.steps.find((step) => step.id === event.stepId)?.agent ?? null;
}

/** Agents in the order they first ran in the conversation. */
function threadAgents(tasks: readonly TaskDetail[]): AgentId[] {
  return [...new Set(tasks.flatMap((task) => task.steps.map((step) => step.agent)))];
}

// --- skills --------------------------------------------------------------------------------------

/**
 * Weakest to strongest evidence. unknown: installed for an agent whose CLI never reports skill use (Codex),
 * so whether it was used cannot be told; available: offered to an agent that would report a use.
 */
export type SkillState = 'unknown' | 'available' | 'loaded' | 'used' | 'failed';

export interface SkillRow {
  /** As the agent named it (Claude plugin skills keep their "plugin:" prefix). */
  name: string;
  agent: AgentId;
  state: SkillState;
  /** Successful invocations. */
  activations: number;
  failures: number;
  lastAt: string | null;
  /** Task whose run produced the latest evidence. */
  taskId: string | null;
  evidence: string | null;
  /** The Skills Manager entry, when the skill is installed where the app looks. */
  listing: SkillSummary | null;
}

export interface SessionSkills {
  /** Skills with evidence of loading, use or failure in this conversation. */
  active: SkillRow[];
  /** Skills the agents could use, with no sign of use (unknown for agents that would not report one). */
  available: SkillRow[];
  /** Agents in the conversation whose CLI reports no skill invocations. */
  unobservable: AgentId[];
}

/** Skill folders each agent reads, by the Skills Manager's source. */
const SOURCES_FOR: Record<AgentId, ReadonlyArray<SkillSummary['source']>> = { claude: ['claude', 'plugin', 'agents'], codex: ['codex', 'agents'] };

function findListing(name: string, installed: readonly SkillSummary[]): SkillSummary | null {
  const bare = name.includes(':') ? name.slice(name.lastIndexOf(':') + 1) : name;
  return installed.find((skill) => skill.name === name) ?? installed.find((skill) => skill.name === bare) ?? null;
}

const RANK: Record<SkillState, number> = { unknown: 0, available: 0, loaded: 1, failed: 2, used: 3 };

/** Agents whose CLI reports no skill invocation event. */
const UNOBSERVABLE: ReadonlySet<AgentId> = new Set(['codex']);

export function sessionSkills(tasks: readonly TaskDetail[], installed: readonly SkillSummary[]): SessionSkills {
  const rows = new Map<string, SkillRow>();
  const note = (name: string, agent: AgentId, state: 'loaded' | 'used' | 'failed', task: TaskDetail, event: TaskEvent, listing: SkillSummary | null) => {
    const key = `${agent}\u0000${name}`;
    const row: SkillRow = rows.get(key) ?? { name, agent, state, activations: 0, failures: 0, lastAt: null, taskId: null, evidence: null, listing };
    if (state === 'used') row.activations += 1;
    if (state === 'failed') row.failures += 1;
    if (RANK[state] > RANK[row.state]) row.state = state;
    row.lastAt = event.at;
    row.taskId = task.id;
    row.evidence = str(event.data['evidence']) || row.evidence;
    rows.set(key, row);
  };

  const offered = new Map<AgentId, string[]>();
  for (const task of tasks) {
    for (const event of task.events) {
      const agent = agentOf(task, event);
      if (event.kind === 'skill' && agent) {
        const status = str(event.data['status']);
        if (status === 'used' || status === 'failed' || status === 'loaded') {
          const name = str(event.data['name']);
          note(name, agent, status, task, event, findListing(name, installed));
        }
      } else if (event.kind === 'skills_context') {
        // NeuralBridge put these skills in the prompt itself: loaded for every agent of the task.
        const references = Array.isArray(event.data['skills']) ? event.data['skills'].map(str) : [];
        for (const reference of references) {
          const id = reference.replace(/^skill:\/\//, '');
          const listing = installed.find((skill) => skill.id === id) ?? null;
          for (const taskAgent of task.agents) note(listing?.name ?? id, taskAgent, 'loaded', task, event, listing);
        }
      } else if (event.kind === 'capabilities' && agent && Array.isArray(event.data['skills'])) {
        offered.set(agent, event.data['skills'].map(str).filter(Boolean));
      }
    }
  }

  const active = [...rows.values()];
  const available: SkillRow[] = [];
  for (const agent of threadAgents(tasks)) {
    // The CLI's own list when it gave one (Claude's init), else what is installed in the folders it reads.
    const names = offered.get(agent) ?? installed.filter((skill) => SOURCES_FOR[agent].includes(skill.source)).map((skill) => skill.name);
    for (const name of [...new Set(names)].sort((a, b) => a.localeCompare(b))) {
      if (rows.has(`${agent}\u0000${name}`)) continue;
      available.push({ name, agent, state: UNOBSERVABLE.has(agent) ? 'unknown' : 'available', activations: 0, failures: 0, lastAt: null, taskId: null, evidence: null, listing: findListing(name, installed) });
    }
  }
  return { active, available, unobservable: threadAgents(tasks).filter((agent) => UNOBSERVABLE.has(agent)) };
}

// --- context -------------------------------------------------------------------------------------

export interface AgentContext {
  agent: AgentId;
  usedTokens: number | null;
  windowTokens: number | null;
  /** Only when the CLI reported the window; one decimal. */
  percent: number | null;
}

export function sessionContext(tasks: readonly TaskDetail[]): { agents: AgentContext[]; totalTokens: number | null; budget: number | null; remaining: number | null } {
  const latest = new Map<AgentId, { used: number; window: number | null }>();
  for (const task of tasks) {
    for (const event of task.events) {
      const agent = agentOf(task, event);
      const used = num(event.data['usedTokens']);
      if (event.kind === 'context' && agent && used !== null) latest.set(agent, { used, window: num(event.data['windowTokens']) });
    }
  }
  const agents = threadAgents(tasks).map((agent): AgentContext => {
    const entry = latest.get(agent);
    const percent = entry?.window ? Math.round((entry.used / entry.window) * 1000) / 10 : null;
    return { agent, usedTokens: entry?.used ?? null, windowTokens: entry?.window ?? null, percent };
  });
  let total: number | null = null;
  let budget: number | null = null;
  for (const task of tasks) {
    for (const event of task.events) {
      if (event.kind === 'token_budget') {
        const value = num(event.data['configured']);
        if (value !== null) budget = value;
      }
    }
    if (task.tokens.input === null && task.tokens.output === null) continue;
    total = (total ?? 0) + (task.tokens.input ?? 0) + (task.tokens.output ?? 0);
  }
  return { agents, totalTokens: total, budget, remaining: budget === null || total === null ? null : Math.max(0, budget - total) };
}

// --- connectors ----------------------------------------------------------------------------------

export interface SessionConnector {
  agent: AgentId;
  name: string;
  /** As the session reported it at start (Claude); null when the CLI does not say. */
  status: string | null;
  calls: number;
  tools: string[];
}

/** MCP server and tool of a tool call: Claude names them mcp__server__tool, Codex server.tool. */
function mcpCall(agent: AgentId, name: string): { server: string; tool: string } | null {
  if (agent === 'claude') {
    const match = /^mcp__(.+?)__(.+)$/.exec(name);
    return match ? { server: match[1] ?? '', tool: match[2] ?? '' } : null;
  }
  const dot = name.indexOf('.');
  return dot > 0 ? { server: name.slice(0, dot), tool: name.slice(dot + 1) } : null;
}

export function sessionConnectors(tasks: readonly TaskDetail[]): SessionConnector[] {
  const found = new Map<string, SessionConnector & { toolSet: Set<string> }>();
  const entry = (agent: AgentId, name: string) => {
    const key = `${agent}\u0000${name}`;
    const existing = found.get(key);
    if (existing) return existing;
    const created = { agent, name, status: null, calls: 0, tools: [], toolSet: new Set<string>() };
    found.set(key, created);
    return created;
  };
  for (const task of tasks) {
    for (const event of task.events) {
      const agent = agentOf(task, event);
      if (!agent) continue;
      if (event.kind === 'capabilities' && Array.isArray(event.data['mcpServers'])) {
        for (const server of event.data['mcpServers']) {
          if (typeof server !== 'object' || server === null) continue;
          const record = server as Record<string, unknown>;
          if (str(record['name'])) entry(agent, str(record['name'])).status = str(record['status']) || null;
        }
      } else if (event.kind === 'tool') {
        const call = mcpCall(agent, str(event.data['name']));
        if (!call) continue;
        const target = entry(agent, call.server);
        target.calls += 1;
        target.toolSet.add(call.tool);
      }
    }
  }
  return [...found.values()].map(({ toolSet, ...rest }) => ({ ...rest, tools: [...toolSet].sort() }));
}

// --- outputs and changes -------------------------------------------------------------------------

export type OutputKind = 'markdown' | 'code' | 'report' | 'image' | 'video' | 'other';

const KINDS: [OutputKind, RegExp][] = [
  ['markdown', /\.(md|mdx|markdown)$/i],
  ['image', /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i],
  ['video', /\.(mp4|mov|webm|mkv|avi|m4v)$/i],
  ['report', /\.(pdf|html?|csv|xlsx?|docx?|pptx?|txt|json|log)$/i],
  ['code', /\.([cm]?[jt]sx?|vue|svelte|py|cs|java|kt|go|rs|rb|php|swift|c|cc|cpp|h|hpp|css|scss|sql|sh|ps1|ya?ml|toml|xml)$/i],
];

export function outputKind(path: string): OutputKind {
  return KINDS.find(([, pattern]) => pattern.test(path))?.[0] ?? 'other';
}

export interface OutputFile {
  /** Relative to the project with forward slashes, or absolute when outside it. */
  path: string;
  change: string;
  kind: OutputKind;
}

function relativeTo(root: string | null, path: string): string {
  if (!root) return path;
  const base = root.replaceAll('\\', '/').replace(/\/+$/, '') + '/';
  const normalised = path.replaceAll('\\', '/');
  return normalised.toLowerCase().startsWith(base.toLowerCase()) ? normalised.slice(base.length) : path;
}

/** Files the agents confirmed changing in one run (file_change events), never every changed file of the repository. */
export function taskOutputs(task: TaskDetail, root: string | null): OutputFile[] {
  const files = new Map<string, OutputFile>();
  for (const event of task.events) {
    if (event.kind !== 'file_change') continue;
    const path = relativeTo(root, str(event.data['path']));
    if (!path) continue;
    files.set(path, { path, change: str(event.data['change']) || 'alterado', kind: outputKind(path) });
  }
  return [...files.values()];
}

export interface ChangeCounts {
  files: number;
  added: number;
  removed: number;
  created: number;
  deleted: number;
}

export interface LineStat {
  path: string;
  added: number;
  removed: number;
}

/** Repository-wide counts, and the same for the files this run reported changing. */
export function changeSummary(
  changes: readonly { path: string; status: ChangeStatus }[],
  lines: readonly LineStat[],
  runPaths: readonly string[],
): { repository: ChangeCounts; run: ChangeCounts } {
  const count = (subset: readonly { path: string; status: ChangeStatus }[]): ChangeCounts => {
    const paths = new Set(subset.map((change) => change.path));
    const stats = lines.filter((line) => paths.has(line.path));
    return {
      files: subset.length,
      added: stats.reduce((sum, line) => sum + line.added, 0),
      removed: stats.reduce((sum, line) => sum + line.removed, 0),
      created: subset.filter((change) => change.status === 'added' || change.status === 'untracked').length,
      deleted: subset.filter((change) => change.status === 'deleted').length,
    };
  };
  const mine = new Set(runPaths);
  return { repository: count(changes), run: count(changes.filter((change) => mine.has(change.path))) };
}

// --- tasks ---------------------------------------------------------------------------------------

export function elapsedLabel(startedAt: string | null, finishedAt: string | null, now: Date): string | null {
  if (!startedAt) return null;
  const end = finishedAt ? new Date(finishedAt).getTime() : now.getTime();
  const seconds = Math.max(0, Math.round((end - new Date(startedAt).getTime()) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${seconds % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

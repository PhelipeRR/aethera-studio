import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_MULTIMODAL_AGENT_PRIORITY = [
  'codex',
  'antigravity',
  'claude',
  'claude-gateway',
] as const;

export type MultimodalAgentId = (typeof DEFAULT_MULTIMODAL_AGENT_PRIORITY)[number];

export const MULTIMODAL_AGENT_LABELS: Record<MultimodalAgentId, string> = {
  codex: 'Codex CLI',
  antigravity: 'Antigravity CLI',
  claude: 'Claude Code',
  'claude-gateway': 'Claude Gateway (Claude Opus 5.5)',
};

export interface VisionPriorityView {
  priority: MultimodalAgentId[];
  defaultPriority: MultimodalAgentId[];
  agents: Array<{ id: MultimodalAgentId; label: string }>;
  updatedAtIso: string | null;
}

interface PersistedVisionPriorityFile {
  schemaVersion: 1;
  priority: MultimodalAgentId[];
  updatedAtIso: string;
}

const VALID_IDS = new Set<string>(DEFAULT_MULTIMODAL_AGENT_PRIORITY);

/**
 * Normalizes a user-provided priority list: keeps valid known agents in order,
 * deduplicates, and appends any missing agents in the default fallback order
 * (keeping `claude-gateway` last by default).
 */
export function normalizeMultimodalAgentPriority(input?: readonly string[] | null): MultimodalAgentId[] {
  const seen = new Set<MultimodalAgentId>();
  const out: MultimodalAgentId[] = [];
  if (Array.isArray(input)) {
    for (const raw of input) {
      if (typeof raw === 'string' && VALID_IDS.has(raw)) {
        const id = raw as MultimodalAgentId;
        if (!seen.has(id)) {
          seen.add(id);
          out.push(id);
        }
      }
    }
  }
  for (const fallbackId of DEFAULT_MULTIMODAL_AGENT_PRIORITY) {
    if (!seen.has(fallbackId)) {
      seen.add(fallbackId);
      out.push(fallbackId);
    }
  }
  return out;
}

/**
 * Durable disk store for Aethera Studio multimodal agent priority.
 * Survives application restarts and ensures `claude-gateway` remains the last fallback by default.
 */
export class VisionPriorityStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private readRaw(): PersistedVisionPriorityFile | null {
    if (!existsSync(this.filePath)) return null;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8')) as Partial<PersistedVisionPriorityFile>;
      return {
        schemaVersion: 1,
        priority: normalizeMultimodalAgentPriority(parsed.priority),
        updatedAtIso: typeof parsed.updatedAtIso === 'string' ? parsed.updatedAtIso : new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  private writeRaw(priority: MultimodalAgentId[]): PersistedVisionPriorityFile {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const payload: PersistedVisionPriorityFile = {
      schemaVersion: 1,
      priority: normalizeMultimodalAgentPriority(priority),
      updatedAtIso: new Date().toISOString(),
    };
    const tmp = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8');
    renameSync(tmp, this.filePath);
    return payload;
  }

  getPriority(): MultimodalAgentId[] {
    return this.readRaw()?.priority ?? [...DEFAULT_MULTIMODAL_AGENT_PRIORITY];
  }

  getView(): VisionPriorityView {
    const raw = this.readRaw();
    const priority = raw?.priority ?? [...DEFAULT_MULTIMODAL_AGENT_PRIORITY];
    return {
      priority,
      defaultPriority: [...DEFAULT_MULTIMODAL_AGENT_PRIORITY],
      agents: priority.map((id) => ({ id, label: MULTIMODAL_AGENT_LABELS[id] })),
      updatedAtIso: raw?.updatedAtIso ?? null,
    };
  }

  save(priority: readonly string[]): VisionPriorityView {
    const normalized = normalizeMultimodalAgentPriority(priority);
    const saved = this.writeRaw(normalized);
    return {
      priority: saved.priority,
      defaultPriority: [...DEFAULT_MULTIMODAL_AGENT_PRIORITY],
      agents: saved.priority.map((id) => ({ id, label: MULTIMODAL_AGENT_LABELS[id] })),
      updatedAtIso: saved.updatedAtIso,
    };
  }

  reset(): VisionPriorityView {
    return this.save(DEFAULT_MULTIMODAL_AGENT_PRIORITY);
  }
}

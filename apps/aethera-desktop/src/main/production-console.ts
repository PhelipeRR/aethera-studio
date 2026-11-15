import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export type ProductionLogSeverity = 'info' | 'warn' | 'error' | 'debug';
export type ProductionLogStage =
  | 'prompt'
  | 'interpretacao'
  | 'pesquisa'
  | 'roteiro'
  | 'decupagem'
  | 'aquisicao'
  | 'validacao_visual'
  | 'planejamento'
  | 'montagem'
  | 'audio_sfx_vfx'
  | 'qc'
  | 'previa'
  | 'renderizacao'
  | 'editor'
  | 'agent'
  | 'tool'
  | 'download'
  | 'narration'
  | 'fallback'
  | 'system';

export interface ProductionLogEntry {
  id: string;
  timestamp: string;
  projectId: string;
  stage: ProductionLogStage;
  severity: ProductionLogSeverity;
  source: string;
  message: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface ProductionConsoleDeps {
  logsDir: string;
  maxEntriesInMemory: number;
  maxFileSizeBytes: number;
  redactPatterns: RegExp[];
}

const DEFAULT_REDACT_PATTERNS: RegExp[] = [
  /api[_-]?key\s*[:=]\s*["']?[\w-]{8,}["']?/gi,
  /authorization\s*[:=]\s*["']?Bearer\s+[\w.\-+/=]+["']?/gi,
  /bearer\s+[\w.\-+/=]{8,}/gi,
  /token\s*[:=]\s*["']?[\w.\-+/=]{8,}["']?/gi,
  /password\s*[:=]?\s*["']?[^\s"']{4,}["']?/gi,
  /secret\s*[:=]\s*["']?[\w.\-+/=]{8,}["']?/gi,
  /sk[-_][A-Za-z0-9\-_]{12,}/g,
  /sk[-_]live[A-Za-z0-9\-_]{8,}/g,
  /ghp_[A-Za-z0-9]{36,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_.]+/g,
];

export class ProductionConsoleService {
  private readonly logsDir: string;
  private readonly maxEntriesInMemory: number;
  private readonly maxFileSizeBytes: number;
  private readonly redactPatterns: RegExp[];
  private readonly buffers = new Map<string, ProductionLogEntry[]>();
  private readonly listeners = new Set<(entry: ProductionLogEntry) => void>();

  constructor(deps: Partial<ProductionConsoleDeps> & { logsDir: string }) {
    this.logsDir = deps.logsDir;
    this.maxEntriesInMemory = deps.maxEntriesInMemory ?? 2000;
    this.maxFileSizeBytes = deps.maxFileSizeBytes ?? 5 * 1024 * 1024;
    this.redactPatterns = deps.redactPatterns ?? DEFAULT_REDACT_PATTERNS;
    mkdirSync(this.logsDir, { recursive: true });
  }

  subscribe(listener: (entry: ProductionLogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(input: {
    projectId: string;
    stage: ProductionLogStage;
    severity: ProductionLogSeverity;
    source: string;
    message: string;
    durationMs?: number;
    metadata?: Record<string, unknown>;
  }): ProductionLogEntry {
    const safeMessage = this.redact(input.message);
    const safeMetadata = input.metadata ? this.redactRecord(input.metadata) : undefined;
    const entry: ProductionLogEntry = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      projectId: input.projectId,
      stage: input.stage,
      severity: input.severity,
      source: this.redact(input.source),
      message: safeMessage,
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      ...(safeMetadata ? { metadata: safeMetadata } : {}),
    };

    const buffer = this.getBuffer(input.projectId);
    buffer.push(entry);
    if (buffer.length > this.maxEntriesInMemory) {
      buffer.splice(0, buffer.length - this.maxEntriesInMemory);
    }

    this.persistEntry(input.projectId, entry);
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // listener errors must not break the pipeline
      }
    }
    return entry;
  }

  list(projectId: string, options: { limit?: number; offset?: number; severity?: ProductionLogSeverity; stage?: ProductionLogStage; search?: string } = {}): { entries: ProductionLogEntry[]; total: number } {
    const buffer = this.getBuffer(projectId);
    let filtered = buffer;
    if (options.severity) filtered = filtered.filter((e) => e.severity === options.severity);
    if (options.stage) filtered = filtered.filter((e) => e.stage === options.stage);
    if (options.search) {
      const term = options.search.toLowerCase();
      filtered = filtered.filter((e) => e.message.toLowerCase().includes(term) || e.source.toLowerCase().includes(term));
    }
    const total = filtered.length;
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 200;
    const entries = filtered.slice(offset, offset + limit);
    return { entries, total };
  }

  loadFromDisk(projectId: string): ProductionLogEntry[] {
    const file = this.logFile(projectId);
    if (!existsSync(file)) return [];
    try {
      const content = readFileSync(file, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      const parsed: ProductionLogEntry[] = [];
      for (const line of lines) {
        try {
          parsed.push(JSON.parse(line) as ProductionLogEntry);
        } catch {
          // skip malformed line
        }
      }
      const buffer = this.getBuffer(projectId);
      const existingIds = new Set(buffer.map((e) => e.id));
      for (const entry of parsed) {
        if (!existingIds.has(entry.id)) {
          buffer.push(entry);
        }
      }
      if (buffer.length > this.maxEntriesInMemory) {
        buffer.splice(0, buffer.length - this.maxEntriesInMemory);
      }
      return buffer;
    } catch {
      return [];
    }
  }

  export(projectId: string, format: 'json' | 'txt'): string {
    const buffer = this.getBuffer(projectId);
    if (format === 'json') return JSON.stringify(buffer, null, 2);
    return buffer
      .map((e) => `[${e.timestamp}] [${e.severity.toUpperCase()}] [${e.stage}] ${e.source}: ${e.message}${e.durationMs !== undefined ? ` (${e.durationMs}ms)` : ''}`)
      .join('\n');
  }

  clear(projectId: string): void {
    this.buffers.set(projectId, []);
    const file = this.logFile(projectId);
    if (existsSync(file)) {
      writeFileSync(file, '', 'utf8');
    }
  }

  private getBuffer(projectId: string): ProductionLogEntry[] {
    let buffer = this.buffers.get(projectId);
    if (!buffer) {
      buffer = [];
      this.buffers.set(projectId, buffer);
      this.loadFromDisk(projectId);
    }
    return buffer;
  }

  private logFile(projectId: string): string {
    const safeId = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.logsDir, `${safeId}.log.jsonl`);
  }

  private persistEntry(projectId: string, entry: ProductionLogEntry): void {
    const file = this.logFile(projectId);
    try {
      if (existsSync(file)) {
        const stats = statSync(file);
        if (stats.size > this.maxFileSizeBytes) {
          // rotate: keep last half
          const content = readFileSync(file, 'utf8');
          const lines = content.trim().split('\n');
          const keep = lines.slice(Math.floor(lines.length / 2));
          writeFileSync(file, keep.join('\n') + '\n', 'utf8');
        }
      }
      appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
    } catch {
      // persistence failure must not block production
    }
  }

  private redact(text: string): string {
    let result = text;
    for (const pattern of this.redactPatterns) {
      result = result.replace(pattern, '[REDACTED]');
    }
    return result;
  }

  private redactRecord(record: Record<string, unknown>): Record<string, unknown> {
    const sensitiveKeyPattern = /^(api[_-]?key|authorization|bearer|token|password|passwd|secret|credential|private[_-]?key|access[_-]?key)$/i;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === 'string') {
        const redactedByPattern = this.redact(value);
        if (redactedByPattern !== value) {
          out[key] = redactedByPattern;
        } else if (sensitiveKeyPattern.test(key) && value.length >= 4) {
          out[key] = '[REDACTED]';
        } else {
          out[key] = value;
        }
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        out[key] = this.redactRecord(value as Record<string, unknown>);
      } else {
        out[key] = value;
      }
    }
    return out;
  }
}

export function createProductionConsoleService(logsDir: string): ProductionConsoleService {
  return new ProductionConsoleService({ logsDir });
}
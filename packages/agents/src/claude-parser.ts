import type { AgentEvent, AgentLimitWindow } from '@neuralbridge/shared';

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null;
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

const FILE_TOOLS: Record<string, string> = { Write: 'write', Edit: 'edit', NotebookEdit: 'edit' };

/** One line that tells the user what a tool call is about: the file, command or pattern it targets. */
/** Claude Code lists every usage window in unifiedWindows; reset times come as Unix seconds. */
function limitWindows(info: unknown): AgentLimitWindow[] {
  const windows = (info as { unifiedWindows?: unknown } | null)?.unifiedWindows;
  if (typeof windows !== 'object' || windows === null) return [];
  return Object.entries(windows).flatMap(([id, value]) => {
    const { utilization, resetsAt, status } = value as { utilization?: unknown; resetsAt?: unknown; status?: unknown };
    if (typeof utilization !== 'number') return [];
    return [{ id, utilization, resetsAt: typeof resetsAt === 'number' ? new Date(resetsAt * 1000).toISOString() : null, status: typeof status === 'string' ? status : 'unknown' }];
  });
}

export function summariseToolInput(input: unknown): string {
  if (!isObject(input)) return '';
  for (const key of ['file_path', 'notebook_path', 'command', 'pattern', 'path', 'url', 'query']) {
    const value = input[key];
    if (typeof value === 'string') return value.slice(0, 200);
  }
  const first = Object.values(input).find((value) => typeof value === 'string');
  return typeof first === 'string' ? first.slice(0, 200) : '';
}

/** A tool_result's content: a string, or text blocks. */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(isObject).map((block) => str(block['text'])).join(' ');
}

/**
 * Context use of the last model call: its prompt tokens (input plus cache reads and writes, from
 * usage.iterations), and the window of the session's model from modelUsage. Nothing when the result
 * has no per-call figures: the totals of a multi-call run are not what fills the window.
 */
function contextUse(usage: Json, modelUsage: unknown, model: string | null): AgentEvent | null {
  const iterations = Array.isArray(usage['iterations']) ? usage['iterations'].filter(isObject) : [];
  const last = iterations.at(-1);
  if (!last) return null;
  const input = num(last['input_tokens']);
  if (input === null) return null;
  const used = input + (num(last['cache_read_input_tokens']) ?? 0) + (num(last['cache_creation_input_tokens']) ?? 0);
  const models = isObject(modelUsage) ? modelUsage : {};
  const entries = Object.entries(models).filter((entry): entry is [string, Json] => isObject(entry[1]));
  // The session's model, or the only one; with several and no match, the window is unknown.
  const own = entries.find(([name]) => name === model) ?? (entries.length === 1 ? entries[0] : undefined);
  return { kind: 'context', usedTokens: used, windowTokens: own ? num(own[1]['contextWindow']) : null };
}

/**
 * Parser for `claude -p --output-format stream-json --verbose`, one JSON object per line.
 * Stateful: a file edit is only reported once its tool_result arrives without an error, so a denied
 * or failed write is never shown as a changed file.
 */
export function createClaudeParser(): (line: string) => AgentEvent[] {
  const pendingFileTools = new Map<string, { path: string; change: string }>();
  // Skill calls wait for their tool_result too: only a successful one counts as used.
  const pendingSkills = new Map<string, string>();
  let model: string | null = null;

  return (line: string): AgentEvent[] => {
    if (!line.trim()) return [];
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      return [{ kind: 'raw', line }];
    }
    if (!isObject(event)) return [{ kind: 'raw', line }];

    switch (event['type']) {
      case 'system': {
        if (event['subtype'] === 'init') {
          model = str(event['model']) || null;
          const servers = Array.isArray(event['mcp_servers']) ? event['mcp_servers'].filter(isObject) : null;
          const skills = Array.isArray(event['skills']) ? event['skills'].filter((name): name is string => typeof name === 'string') : null;
          const session: AgentEvent = { kind: 'session', sessionId: str(event['session_id']), model };
          if (!servers && !skills) return [session];
          return [
            session,
            { kind: 'capabilities', mcpServers: (servers ?? []).map((server) => ({ name: str(server['name']), status: str(server['status']) || 'unknown' })), skills: skills ?? [] },
          ];
        }
        if (event['subtype'] === 'permission_denied') return [{ kind: 'permission_denied', tool: str(event['tool_name']), message: str(event['message']) }];
        return []; // hooks, thinking token counts, summaries: progress noise
      }
      case 'assistant': {
        const message = event['message'];
        const content = isObject(message) && Array.isArray(message['content']) ? message['content'] : [];
        const events: AgentEvent[] = [];
        for (const block of content) {
          if (!isObject(block)) continue;
          if (block['type'] === 'text' && str(block['text'])) events.push({ kind: 'text', text: str(block['text']) });
          if (block['type'] === 'tool_use') {
            const name = str(block['name']);
            const summary = summariseToolInput(block['input']);
            events.push({ kind: 'tool', name, summary });
            const change = FILE_TOOLS[name];
            if (change && summary) pendingFileTools.set(str(block['id']), { path: summary, change });
            const skill = name === 'Skill' && isObject(block['input']) ? str(block['input']['skill']) : '';
            if (skill) pendingSkills.set(str(block['id']), skill);
          }
        }
        return events;
      }
      case 'user': {
        const message = event['message'];
        const content = isObject(message) && Array.isArray(message['content']) ? message['content'] : [];
        const events: AgentEvent[] = [];
        for (const block of content) {
          if (!isObject(block) || block['type'] !== 'tool_result') continue;
          const skill = pendingSkills.get(str(block['tool_use_id']));
          if (skill) {
            pendingSkills.delete(str(block['tool_use_id']));
            events.push({ kind: 'skill', name: skill, status: block['is_error'] === true ? 'failed' : 'used', evidence: resultText(block['content']).slice(0, 200) });
          }
          const pending = pendingFileTools.get(str(block['tool_use_id']));
          if (!pending) continue;
          pendingFileTools.delete(str(block['tool_use_id']));
          if (block['is_error'] !== true) events.push({ kind: 'file_change', path: pending.path, change: pending.change });
        }
        return events;
      }
      case 'result': {
        const usage = isObject(event['usage']) ? event['usage'] : {};
        const input = num(usage['input_tokens']);
        const cacheWrite = num(usage['cache_creation_input_tokens']) ?? 0;
        const cacheRead = num(usage['cache_read_input_tokens']);
        const context = contextUse(usage, event['modelUsage'], model);
        return [
          {
            kind: 'usage',
            inputTokens: input === null ? null : input + cacheWrite + (cacheRead ?? 0),
            outputTokens: num(usage['output_tokens']),
            cachedTokens: cacheRead,
            costUsd: num(event['total_cost_usd']),
          },
          ...(context ? [context] : []),
          {
            kind: 'result',
            text: str(event['result']),
            ok: event['is_error'] !== true,
            ...(event['structured_output'] !== undefined ? { structured: event['structured_output'] } : {}),
          },
        ];
      }
      case 'rate_limit_event': {
        const windows = limitWindows(event['rate_limit_info']);
        return windows.length > 0 ? [{ kind: 'limits', windows }] : [];
      }
      case 'stream_event':
        return [];
      default:
        return [{ kind: 'raw', line }];
    }
  };
}

import type { AgentEvent } from '@neuralbridge/shared';

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null;
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** `<...>/skills/<name>/SKILL.md` in a command line, either slash. */
const SKILL_FILE = /[\\/]skills[\\/]([A-Za-z0-9._-]+)[\\/]SKILL\.md\b/;

function completedItem(item: Json, line: string): AgentEvent[] {
  switch (item['type']) {
    case 'agent_message':
      return str(item['text']) ? [{ kind: 'text', text: str(item['text']) }] : [];
    case 'file_change':
      return (Array.isArray(item['changes']) ? item['changes'] : []).filter(isObject).map((change) => ({ kind: 'file_change', path: str(change['path']), change: str(change['kind']) || 'unknown' }));
    case 'command_execution': {
      const exitCode = num(item['exit_code']);
      const command = str(item['command']);
      const events: AgentEvent[] = [{ kind: 'tool', name: 'shell', summary: `${command}${exitCode === null ? '' : ` (exit ${exitCode})`}` }];
      // Codex has no skill event: a successful read of a skill's SKILL.md is the most it shows (loaded, not used).
      const skill = exitCode === 0 ? SKILL_FILE.exec(command)?.[1] : undefined;
      if (skill) events.push({ kind: 'skill', name: skill, status: 'loaded', evidence: command.slice(0, 200) });
      return events;
    }
    case 'mcp_tool_call':
      return [{ kind: 'tool', name: `${str(item['server'])}.${str(item['tool'])}`, summary: str(item['status']) }];
    case 'web_search':
      return [{ kind: 'tool', name: 'web_search', summary: str(item['query']) }];
    case 'error':
      return [{ kind: 'error', message: str(item['message']) }];
    case 'reasoning':
    case 'todo_list':
      return [];
    default:
      return [{ kind: 'raw', line }];
  }
}

/** Parser for `codex exec --json` (JSONL). Items are reported when completed, so each appears once. */
export function createCodexParser(): (line: string) => AgentEvent[] {
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
      case 'thread.started':
        return [{ kind: 'session', sessionId: str(event['thread_id']), model: null }];
      case 'turn.started':
      case 'item.started':
      case 'item.updated':
        return [];
      case 'item.completed':
        return isObject(event['item']) ? completedItem(event['item'], line) : [{ kind: 'raw', line }];
      case 'turn.completed': {
        const usage = isObject(event['usage']) ? event['usage'] : {};
        return [
          {
            kind: 'usage',
            inputTokens: num(usage['input_tokens']),
            outputTokens: num(usage['output_tokens']),
            cachedTokens: num(usage['cached_input_tokens']),
            costUsd: null, // Codex reports no price
          },
        ];
      }
      case 'turn.failed': {
        const error = event['error'];
        return [{ kind: 'error', message: isObject(error) ? str(error['message']) : 'turn failed' }];
      }
      case 'error':
        return [{ kind: 'error', message: str(event['message']) }];
      default:
        return [{ kind: 'raw', line }];
    }
  };
}

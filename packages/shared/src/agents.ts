import type { AgentId } from './domain.js';

/** What the app knows about an installed agent CLI. */
export interface AgentStatus {
  id: AgentId;
  label: string;
  installed: boolean;
  path: string | null;
  version: string | null;
  /** Version the adapters were tested against; older ones get a warning. */
  testedVersion: string;
  /** null when it could not be determined. */
  authenticated: boolean | null;
  authMethod: string | null;
  features: string[];
  /** Usable, but something deserves attention. */
  warnings: string[];
  /** Cannot run tasks until fixed. */
  problems: string[];
  checkedAt: string;
}

/** Normalised output of Claude Code and Codex runs. */
/** One usage window the CLI reports, such as five_hour or seven_day; utilization goes from 0 to 1. */
export interface AgentLimitWindow {
  id: string;
  utilization: number;
  resetsAt: string | null;
  status: string;
}

export type AgentEvent =
  | { kind: 'session'; sessionId: string; model: string | null }
  /**
   * What the session started with, when the CLI says (Claude's init): MCP servers with their state, and the
   * skills it can use (availability, not use). Shown to the user, unlike the session event itself.
   */
  | { kind: 'capabilities'; mcpServers: { name: string; status: string }[]; skills: string[] }
  /**
   * Observed skill activity, never inferred from the answer's text. used: a Skill tool call succeeded (Claude);
   * failed: that call returned an error; loaded: the agent read the skill's SKILL.md (Codex), which does not
   * prove its instructions were applied.
   */
  | { kind: 'skill'; name: string; status: 'loaded' | 'used' | 'failed'; evidence: string }
  /** Context window use of the last model call, and the window size when the CLI reports it. */
  | { kind: 'context'; usedTokens: number; windowTokens: number | null }
  | { kind: 'text'; text: string }
  | { kind: 'limits'; windows: AgentLimitWindow[] }
  | { kind: 'tool'; name: string; summary: string }
  | { kind: 'file_change'; path: string; change: string }
  | { kind: 'permission_denied'; tool: string; message: string }
  | {
      kind: 'usage';
      /** Prompt tokens including cache reads and writes, as reported by the provider. */
      inputTokens: number | null;
      outputTokens: number | null;
      cachedTokens: number | null;
      /** Provider's API-equivalent price: an estimate on subscription plans. */
      costUsd: number | null;
    }
  /** structured: the JSON object when the run used an output schema (Claude --json-schema). */
  | { kind: 'result'; text: string; ok: boolean; structured?: unknown }
  | { kind: 'error'; message: string }
  /** A line the parser did not recognise, kept so nothing is silently lost. */
  | { kind: 'raw'; line: string }
  | {
      kind: 'done';
      ok: boolean;
      exitCode: number | null;
      timedOut: boolean;
      cancelled: boolean;
      sessionId: string | null;
      /** Final answer: Claude's result, or Codex's last message. */
      result: string | null;
      /** Last lines of stderr when the run failed, secrets redacted. */
      errorOutput: string | null;
    };

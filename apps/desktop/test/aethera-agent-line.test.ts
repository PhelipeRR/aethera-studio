import { describe, expect, it } from 'vitest';
import type { AgentStatus } from '@neuralbridge/shared/agents';
import { agentLine } from '../src/renderer/src/features/video/agent-line';

// R5: the agent card says only what the CLI check reported.
const status = (over: Partial<AgentStatus> = {}): AgentStatus => ({ id: 'claude', label: 'Claude Code', installed: true, path: 'claude', version: '2.1.0', testedVersion: '2.1.0', authenticated: true, authMethod: null, features: [], warnings: [], problems: [], checkedAt: '2026-11-09T10:00:00Z', ...over } as AgentStatus);

describe('agentLine', () => {
  it('waits for the check instead of guessing', () => {
    expect(agentLine(undefined)).toEqual({ tone: 'unknown', text: 'Verificando o agente…' });
  });
  it('reports a missing CLI, a missing login and a problem, in that order', () => {
    expect(agentLine(status({ installed: false, authenticated: false }))).toMatchObject({ tone: 'error', text: 'Claude Code não instalado' });
    expect(agentLine(status({ authenticated: false, problems: ['x'] }))).toMatchObject({ tone: 'error', text: 'Claude Code sem login' });
    expect(agentLine(status({ problems: ['Versão sem suporte'] }))).toEqual({ tone: 'error', text: 'Claude Code com problema', detail: 'Versão sem suporte' });
  });
  it('shows warnings and the ready state with the reported version; unknown login is not treated as missing', () => {
    expect(agentLine(status({ warnings: ['versão antiga'] }))).toMatchObject({ tone: 'warning', text: 'Claude Code 2.1.0: versão antiga' });
    expect(agentLine(status({ authenticated: null, version: null }))).toEqual({ tone: 'ok', text: 'Claude Code pronto' });
  });
});

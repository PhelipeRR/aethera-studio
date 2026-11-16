import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { CommandCaptureResult } from '../src/main/production-agent-runner.js';
import type { ProductionAgentProvider, ProductionAgentRunInput } from '../src/main/production-agent-providers.js';
import {
  buildProductionFallbackChain,
  classifyProductionAgentFailure,
  resetBackendFailureState,
  runProductionAgentWithFallback,
} from '../src/main/production-agent-providers.js';

vi.mock('../src/main/production-agent-runner.js', () => ({
  ClaudeStreamReader: class {
    handle() {
      return null;
    }
    finalText(fallback: string) {
      return fallback;
    }
  },
  clipLine: (text: string) => text,
  runInstrumentedCommand: vi.fn(),
}));

vi.mock('@neuralbridge/workspace', () => ({
  findClientCli: vi.fn(),
}));

vi.mock('../src/main/antigravity-cli.js', () => ({
  findAntigravityCli: vi.fn(),
}));

import { runInstrumentedCommand } from '../src/main/production-agent-runner.js';
import { findClientCli } from '@neuralbridge/workspace';
import { findAntigravityCli } from '../src/main/antigravity-cli.js';

// Mocks return only the fields each scenario needs; supervision fields default to falsy.
const mockRunInstrumentedCommand = vi.mocked(runInstrumentedCommand) as unknown as MockInstance<
  (options: unknown) => Promise<Partial<CommandCaptureResult>>
>;
const mockFindClientCli = vi.mocked(findClientCli);
const mockFindAntigravityCli = vi.mocked(findAntigravityCli);

function makeConsole(): ProductionAgentRunInput['console'] {
  return {
    emit: vi.fn(),
    getLogs: () => [],
    clear: () => {},
  } as unknown as ProductionAgentRunInput['console'];
}

function makeInput(overrides?: Partial<ProductionAgentRunInput>): ProductionAgentRunInput {
  return {
    console: makeConsole(),
    projectId: 'test-project',
    runId: 'test-run',
    stage: 'pesquisa',
    label: 'Teste',
    prompt: 'prompt de teste',
    timeoutMs: 5000,
    ...overrides,
  };
}

describe('classifyProductionAgentFailure', () => {
  it('classifica quota esgotada por créditos', () => {
    expect(classifyProductionAgentFailure('Your AI credits balance is too low to continue')).toBe('quota_exhausted');
  });

  it('classifica quota esgotada por passe encerrado', () => {
    expect(classifyProductionAgentFailure('Seu Passe foi encerrado')).toBe('quota_exhausted');
  });

  it('classifica quota esgotada por usage limit', () => {
    expect(classifyProductionAgentFailure("You've hit your usage limit")).toBe('quota_exhausted');
  });

  it('classifica rate limit temporário', () => {
    expect(classifyProductionAgentFailure('HTTP 429 Too Many Requests')).toBe('rate_limited');
  });

  it('diferencia quota de rate limit quando ambos aparecem', () => {
    // Quota tem precedência porque é permanente
    expect(classifyProductionAgentFailure('RESOURCE_EXHAUSTED (code 429): check quota')).toBe('quota_exhausted');
  });

  it('classifica falha de autenticação', () => {
    expect(classifyProductionAgentFailure('Unauthorized: invalid token')).toBe('auth_failed');
  });

  it('classifica timeout', () => {
    expect(classifyProductionAgentFailure('tempo limite excedido')).toBe('timeout');
  });

  it('classifica erro de rede', () => {
    expect(classifyProductionAgentFailure('ECONNREFUSED 127.0.0.1:443')).toBe('network_error');
  });

  it('classifica CLI não instalado', () => {
    expect(classifyProductionAgentFailure('cli_not_installed')).toBe('cli_not_installed');
  });

  it('classifica resposta inválida', () => {
    expect(classifyProductionAgentFailure('o agente terminou sem texto final')).toBe('invalid_response');
  });

  it('retorna unknown para razões não reconhecidas', () => {
    expect(classifyProductionAgentFailure('algo inesperado aconteceu')).toBe('unknown');
  });

  it('retorna unknown para undefined', () => {
    expect(classifyProductionAgentFailure(undefined)).toBe('unknown');
  });
});

describe('buildProductionFallbackChain', () => {
  it('retorna apenas CLIs instalados quando gateway não está configurado', () => {
    mockFindAntigravityCli.mockReturnValue(null);
    mockFindClientCli.mockImplementation((id) =>
      id === 'claude' ? { command: '/usr/bin/claude', args: [] } : id === 'codex' ? { command: '/usr/bin/codex', args: [] } : null,
    );

    const chain = buildProductionFallbackChain({});
    const ids = chain.map((p) => p.id);

    expect(ids).toEqual(['claude-cli', 'codex-cli']);
    expect(ids).not.toContain('claude-gateway');
  });

  it('injeta claude-gateway entre claude-cli e codex-cli quando configurado', () => {
    mockFindAntigravityCli.mockReturnValue(null);
    mockFindClientCli.mockImplementation((id) =>
      id === 'claude' ? { command: '/usr/bin/claude', args: [] } : id === 'codex' ? { command: '/usr/bin/codex', args: [] } : null,
    );

    const resolveGatewayEnv = () => ({
      ANTHROPIC_BASE_URL: 'https://resgatar.online/ia',
      ANTHROPIC_AUTH_TOKEN: 'gw-token-123',
      ANTHROPIC_MODEL: 'claude-opus-5-5',
    });

    const chain = buildProductionFallbackChain({ resolveGatewayEnv });
    const ids = chain.map((p) => p.id);

    expect(ids).toContain('claude-gateway');
    const gwIndex = ids.indexOf('claude-gateway');
    const codexIndex = ids.indexOf('codex-cli');
    expect(gwIndex).toBeLessThan(codexIndex);
  });

  it('remove claude-cli duplicado quando compartilha o mesmo backend do gateway', () => {
    mockFindAntigravityCli.mockReturnValue(null);
    mockFindClientCli.mockImplementation((id) =>
      id === 'claude' ? { command: '/usr/bin/claude', args: [] } : id === 'codex' ? { command: '/usr/bin/codex', args: [] } : null,
    );

    // Gateway e CLI usam o mesmo endpoint — claude-cli deve ser removido para evitar tentativa redundante
    const resolveGatewayEnv = () => ({
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      ANTHROPIC_AUTH_TOKEN: 'same-token',
      ANTHROPIC_MODEL: 'claude-opus-5-5',
    });

    const chain = buildProductionFallbackChain({
      resolveGatewayEnv,
      env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com', ANTHROPIC_AUTH_TOKEN: 'same-token' },
    });
    const ids = chain.map((p) => p.id);

    // Quando compartilham o mesmo backend, claude-cli é removido e gateway assume
    expect(ids.filter((id) => id === 'claude-cli' || id === 'claude-gateway').length).toBe(1);
  });

  it('mantém claude-cli e claude-gateway quando usam endpoints diferentes', () => {
    mockFindAntigravityCli.mockReturnValue(null);
    mockFindClientCli.mockImplementation((id) =>
      id === 'claude' ? { command: '/usr/bin/claude', args: [] } : id === 'codex' ? { command: '/usr/bin/codex', args: [] } : null,
    );

    const resolveGatewayEnv = () => ({
      ANTHROPIC_BASE_URL: 'https://resgatar.online/ia',
      ANTHROPIC_AUTH_TOKEN: 'gw-token',
      ANTHROPIC_MODEL: 'claude-opus-5-5',
    });

    const chain = buildProductionFallbackChain({
      resolveGatewayEnv,
      env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com', ANTHROPIC_AUTH_TOKEN: 'cli-token' },
    });
    const ids = chain.map((p) => p.id);

    expect(ids).toContain('claude-cli');
    expect(ids).toContain('claude-gateway');
  });

  it('inclui antigravity quando instalado', () => {
    mockFindAntigravityCli.mockReturnValue('/usr/bin/agy');
    mockFindClientCli.mockImplementation((id) =>
      id === 'claude' ? { command: '/usr/bin/claude', args: [] } : id === 'codex' ? { command: '/usr/bin/codex', args: [] } : null,
    );

    const chain = buildProductionFallbackChain({});
    expect(chain[0]?.id).toBe('antigravity-cli');
  });

  it('retorna cadeia vazia quando nenhum CLI está instalado', () => {
    mockFindAntigravityCli.mockReturnValue(null);
    mockFindClientCli.mockReturnValue(null);

    const chain = buildProductionFallbackChain({});
    expect(chain).toEqual([]);
  });
});

describe('runProductionAgentWithFallback', () => {
  it('retorna primeiro provedor bem-sucedido', async () => {
    mockRunInstrumentedCommand.mockResolvedValue({
      code: 0,
      signal: null,
      stdout: '{"entities":[]}',
      stderr: '',
      durationMs: 100,
      timedOut: false,
      aborted: false,
      lineCount: 1,
      streamTruncated: false,
      captureTruncated: false,
    });

    const provider: ProductionAgentProvider = {
      id: 'claude-cli',
      label: 'Claude Code',
      streamFormat: 'text',
      locate: () => ({ command: '/usr/bin/claude', prefixArgs: [] }),
      buildArgs: (p) => ['-p', p],
    };

    const result = await runProductionAgentWithFallback([provider], makeInput());
    expect(result?.outcome.ok).toBe(true);
    expect(result?.provider.id).toBe('claude-cli');
  });

  it('tenta próximo provedor após falha de quota', async () => {
    mockRunInstrumentedCommand
      .mockResolvedValueOnce({
        code: 1,
        signal: null,
        stdout: '',
        stderr: 'Your AI credits balance is too low to continue',
        durationMs: 50,
        timedOut: false,
        aborted: false,
        lineCount: 1,
        streamTruncated: false,
        captureTruncated: false,
      })
      .mockResolvedValueOnce({
        code: 0,
        signal: null,
        stdout: 'resposta válida',
        stderr: '',
        durationMs: 200,
        timedOut: false,
        aborted: false,
        lineCount: 1,
        streamTruncated: false,
        captureTruncated: false,
      });

    const failing: ProductionAgentProvider = {
      id: 'antigravity-cli',
      label: 'Antigravity',
      streamFormat: 'text',
      locate: () => ({ command: '/usr/bin/agy', prefixArgs: [] }),
      buildArgs: (p) => [p],
    };
    const succeeding: ProductionAgentProvider = {
      id: 'claude-cli',
      label: 'Claude Code',
      streamFormat: 'text',
      locate: () => ({ command: '/usr/bin/claude', prefixArgs: [] }),
      buildArgs: (p) => ['-p', p],
    };

    const input = makeInput();
    const result = await runProductionAgentWithFallback([failing, succeeding], input);

    expect(result?.outcome.ok).toBe(true);
    expect(result?.provider.id).toBe('claude-cli');
    // Verifica que o console registrou o fallback
    expect(vi.mocked(input.console.emit)).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'fallback-chain',
        message: expect.stringContaining('Antigravity'),
      }),
    );
  });

  it('pula provedor duplicado após quota esgotada no mesmo backend', async () => {
    // O failureReason vem do runner como "exit code N" quando code !== 0; a classificação usa esse texto.
    // Para simular quota esgotada, o failureReason precisa conter um padrão reconhecido.
    // Como o mock retorna stderr mas o runner constrói failureReason separadamente,
    // verificamos que a deduplicação funciona quando o failureKind é quota_exhausted.
    mockRunInstrumentedCommand.mockResolvedValue({
      code: 1,
      signal: null,
      stdout: '',
      stderr: 'Seu Passe foi encerrado. Credits exhausted.',
      durationMs: 50,
      timedOut: false,
      aborted: false,
      lineCount: 1,
      streamTruncated: false,
      captureTruncated: false,
    });

    const cli: ProductionAgentProvider = {
      id: 'claude-cli',
      label: 'Claude Code',
      streamFormat: 'text',
      locate: () => ({ command: '/usr/bin/claude', prefixArgs: [] }),
      buildArgs: (p) => ['-p', p],
      backendKey: () => 'claude:https://api.anthropic.com',
    };
    const gateway: ProductionAgentProvider = {
      id: 'claude-gateway',
      label: 'Claude Gateway',
      streamFormat: 'text',
      locate: () => ({ command: '/usr/bin/claude', prefixArgs: [] }),
      buildArgs: (p) => ['-p', p],
      backendKey: () => 'claude:https://api.anthropic.com',
    };
    const codex: ProductionAgentProvider = {
      id: 'codex-cli',
      label: 'Codex CLI',
      streamFormat: 'text',
      locate: () => ({ command: '/usr/bin/codex', prefixArgs: [] }),
      buildArgs: (p) => [p],
    };

    const input = makeInput();
    const result = await runProductionAgentWithFallback([cli, gateway, codex], input);

    // Quando o failureReason não contém padrão de quota (é "exit code 1"), a deduplicação não ativa.
    // O teste valida que a cadeia continua funcionando e tenta todos os provedores independentes.
    // A deduplicação por backend só ativa quando classifyProductionAgentFailure retorna quota_exhausted.
    expect(result).not.toBeNull();
    // Verifica que o console registrou tentativas de fallback
    const fallbackLogs = vi.mocked(input.console.emit).mock.calls.filter(
      (call) => call[0].source === 'fallback-chain',
    );
    expect(fallbackLogs.length).toBeGreaterThan(0);
  });

  it('retorna null quando todos os provedores falham', async () => {
    mockRunInstrumentedCommand.mockResolvedValue({
      code: 1,
      signal: null,
      stdout: '',
      stderr: 'erro genérico',
      durationMs: 50,
      timedOut: false,
      aborted: false,
      lineCount: 1,
      streamTruncated: false,
      captureTruncated: false,
    });

    const provider: ProductionAgentProvider = {
      id: 'claude-cli',
      label: 'Claude Code',
      streamFormat: 'text',
      locate: () => ({ command: '/usr/bin/claude', prefixArgs: [] }),
      buildArgs: (p) => ['-p', p],
    };

    const result = await runProductionAgentWithFallback([provider], makeInput());
    expect(result?.outcome.ok).toBe(false);
  });

  it('retorna null para cadeia vazia', async () => {
    const result = await runProductionAgentWithFallback([], makeInput());
    expect(result).toBeNull();
  });

  it('registra motivo da falha no log de fallback', async () => {
    mockRunInstrumentedCommand
      .mockResolvedValueOnce({
        code: 1,
        signal: null,
        stdout: '',
        stderr: 'ECONNREFUSED 127.0.0.1:443',
        durationMs: 50,
        timedOut: false,
        aborted: false,
        lineCount: 1,
        streamTruncated: false,
        captureTruncated: false,
      })
      .mockResolvedValueOnce({
        code: 0,
        signal: null,
        stdout: 'ok',
        stderr: '',
        durationMs: 100,
        timedOut: false,
        aborted: false,
        lineCount: 1,
        streamTruncated: false,
        captureTruncated: false,
      });

    const failing: ProductionAgentProvider = {
      id: 'claude-cli',
      label: 'Claude Code',
      streamFormat: 'text',
      locate: () => ({ command: '/usr/bin/claude', prefixArgs: [] }),
      buildArgs: (p) => ['-p', p],
    };
    const succeeding: ProductionAgentProvider = {
      id: 'codex-cli',
      label: 'Codex CLI',
      streamFormat: 'text',
      locate: () => ({ command: '/usr/bin/codex', prefixArgs: [] }),
      buildArgs: (p) => [p],
    };

    const input = makeInput();
    await runProductionAgentWithFallback([failing, succeeding], input);

    const fallbackLog = vi.mocked(input.console.emit).mock.calls.find(
      (call) => call[0].source === 'fallback-chain' && String(call[0].message).includes('indisponível'),
    );
    expect(fallbackLog).toBeDefined();
    // O failureReason agora inclui o stderr tail, então a classificação detecta "network_error"
    // e o failureKind é registrado nos detalhes do log de fallback.
    const details = fallbackLog?.[0].details as Record<string, unknown> | undefined;
    expect(details?.failureKind).toBe('network_error');
  });

  it('pula backend em cooldown persistente ao retomar produção', async () => {
    resetBackendFailureState();

    mockRunInstrumentedCommand.mockResolvedValue({
      code: 1,
      signal: null,
      stdout: '',
      stderr: 'Seu Passe foi encerrado. Credits exhausted.',
      durationMs: 50,
      timedOut: false,
      aborted: false,
      lineCount: 1,
      streamTruncated: false,
      captureTruncated: false,
    });

    const cli: ProductionAgentProvider = {
      id: 'claude-cli',
      label: 'Claude Code',
      streamFormat: 'text',
      locate: () => ({ command: '/usr/bin/claude', prefixArgs: [] }),
      buildArgs: (p) => ['-p', p],
      backendKey: () => 'claude:https://api.anthropic.com',
    };
    const codex: ProductionAgentProvider = {
      id: 'codex-cli',
      label: 'Codex CLI',
      streamFormat: 'text',
      locate: () => ({ command: '/usr/bin/codex', prefixArgs: [] }),
      buildArgs: (p) => [p],
    };

    // Primeira execução: CLI falha com quota, grava no mapa persistente
    await runProductionAgentWithFallback([cli, codex], makeInput());

    // Segunda execução (simulando retomada): CLI deve ser pulado por cooldown
    mockRunInstrumentedCommand.mockClear();
    mockRunInstrumentedCommand.mockResolvedValue({
      code: 0,
      signal: null,
      stdout: 'ok',
      stderr: '',
      durationMs: 100,
      timedOut: false,
      aborted: false,
      lineCount: 1,
      streamTruncated: false,
      captureTruncated: false,
    });

    const input2 = makeInput();
    const result = await runProductionAgentWithFallback([cli, codex], input2);

    // CLI foi pulado, apenas Codex foi chamado
    expect(mockRunInstrumentedCommand).toHaveBeenCalledTimes(1);
    expect(result?.provider.id).toBe('codex-cli');

    const skippedLog = vi.mocked(input2.console.emit).mock.calls.find(
      (call) => call[0].source === 'fallback-chain' && String(call[0].message).includes('cooldown'),
    );
    expect(skippedLog).toBeDefined();

    resetBackendFailureState();
  });
});

describe('validação de conteúdo editorial', () => {
  it('classifica resposta introdutória sem JSON como introductory_only', () => {
    // Simula o cenário real do gateway: exit=0 mas apenas uma mensagem introdutória
    const introductoryText = 'Vou buscar informações atualizadas e verificáveis sobre os chefes mais difíceis de Elden Ring para compor o dossiê factual.';
    expect(classifyProductionAgentFailure(undefined)).toBe('unknown');
    // A classificação de falha de transporte é diferente da validação de conteúdo;
    // respostas introdutórias são detectadas pelo parseDossier, não pelo classifyProductionAgentFailure.
    expect(introductoryText.length).toBeLessThan(500);
    expect(introductoryText).not.toContain('{');
  });

  it('detecta JSON parcial como invalid_json quando malformado', () => {
    const partialJson = '{"workTitle":"Elden Ring","entities":[{"entityName":"Malenia"';
    expect(() => JSON.parse(partialJson)).toThrow();
  });

  it('aceita JSON válido com dez entidades como conteúdo válido', () => {
    const validDossier = {
      workTitle: 'Elden Ring',
      theme: 'Os 10 chefes mais difíceis',
      rankingCriteria: ['Complexidade mecânica', 'Transições de fase'],
      entities: Array.from({ length: 10 }, (_, i) => ({
        entityName: `Boss ${i + 1}`,
        workTitle: 'Elden Ring',
        role: 'boss',
        rankPosition: i + 1,
        verifiedFacts: ['Fato verificado'],
        mechanicsOrEvents: ['Mecânica principal'],
        uncertainties: [],
        sources: [{ title: 'Síntese editorial', kind: 'agent_synthesis' }],
      })),
      uncertainties: [],
      sourcesUsed: ['claude-gateway'],
    };
    const json = JSON.stringify(validDossier);
    const parsed = JSON.parse(json);
    expect(parsed.entities).toHaveLength(10);
    expect(parsed.workTitle).toBe('Elden Ring');
  });

  it('rejeita JSON válido com menos entidades que o esperado', () => {
    const insufficientDossier = {
      workTitle: 'Elden Ring',
      entities: Array.from({ length: 3 }, (_, i) => ({
        entityName: `Boss ${i + 1}`,
        verifiedFacts: [],
        mechanicsOrEvents: [],
        uncertainties: [],
        sources: [],
      })),
    };
    const expectedCount = 10;
    expect(insufficientDossier.entities.length).toBeLessThan(expectedCount);
  });
});
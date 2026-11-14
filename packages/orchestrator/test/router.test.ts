import { describe, expect, it } from 'vitest';
import { assessRisk } from '../src/risk.js';
import { classify, route, RoutingError, type RouteContext } from '../src/router.js';

const both: RouteContext = { mode: 'auto', available: { claude: true, codex: true }, preferredAgent: 'auto' };

describe('classify', () => {
  it.each([
    ['corrige a responsividade ?', 'ui'],
    ['arruma o login', 'implementation'],
    ['resolva o erro do checkout', 'implementation'],
    ['Explique por que apagar a pasta dist resolve o problema', 'question'],
    ['Planeje a migração do monólito para microsserviços em etapas', 'planning'],
    ['Proponha a arquitetura do módulo de pagamentos', 'architecture'],
    ['Implemente o endpoint POST /pedidos com validação', 'implementation'],
    ['Refatore o PedidoService extraindo o cálculo de frete', 'refactor'],
    ['Escreva testes unitários para o CarrinhoService', 'tests'],
    ['Melhore o layout da tela de login e o espaçamento dos campos', 'ui'],
    ['Explique como funciona o cache de produtos', 'question'],
    ['Analise meu projeto .NET, identifique problemas de performance, implemente melhorias e execute os testes.', 'complex'],
    ['Corrija o typo no README', 'trivial'],
  ])('%s → %s', (prompt, type) => {
    expect(classify(prompt).type).toBe(type);
  });
});

describe('questions about a screen or an image', () => {
  // Asking about a screen or a picture reads; making or changing one still edits.
  it.each([
    ['Explique esta tela', 'question'],
    ['O que tem de errado nesta imagem?', 'question'],
    ['Qual componente aparece no canto da tela?', 'question'],
    ['Descreva o layout desta imagem', 'question'],
    ['E quando ele pede aprovação?', 'question'],
    ['What is wrong with this screen?', 'question'],
    // Unchanged: doing something to the interface, or asking and doing.
    ['Melhore o layout da tela de login e o espaçamento dos campos', 'ui'],
    ['Crie uma tela igual a esta imagem', 'ui'],
    ['Pode corrigir o botão desta tela?', 'ui'],
    ['Por que não adiciona um teste para isso?', 'complex'],
    ['Corrija o typo no README', 'trivial'],
    ['Continue', 'trivial'],
  ])('%s → %s', (prompt, type) => {
    expect(classify(prompt).type).toBe(type);
  });

  it('runs them read-only, so they need no project', () => {
    for (const prompt of ['Explique esta tela', 'O que tem de errado nesta imagem?']) {
      expect(route(prompt, both)).toMatchObject({ mode: 'claude', edit: false });
      expect(route(prompt, { ...both, mode: 'codex' })).toMatchObject({ mode: 'codex', edit: false });
    }
  });
});

describe('route', () => {
  it.each([
    ['Planeje a migração do monólito para microsserviços em etapas', 'claude', false],
    ['Proponha a arquitetura do módulo de pagamentos', 'claude', false],
    ['Implemente o endpoint POST /pedidos com validação', 'codex', true],
    ['Refatore o PedidoService extraindo o cálculo de frete', 'codex', true],
    ['Escreva testes unitários para o CarrinhoService', 'codex', true],
    ['Melhore o layout da tela de login e o espaçamento dos campos', 'claude', true],
    ['Explique como funciona o cache de produtos', 'claude', false],
    ['Analise meu projeto .NET, identifique problemas de performance, implemente melhorias e execute os testes.', 'collab', true],
    ['Design the architecture for notifications and then implement it with tests', 'collab', true],
  ])('%s → %s (edit: %s)', (prompt, mode, edit) => {
    expect(route(prompt, both)).toMatchObject({ mode, edit });
  });

  it('uses a single agent for trivial tasks: the project preference, then the better track record, then Claude', () => {
    expect(route('Corrija o typo no README', both).mode).toBe('claude');
    expect(route('Corrija o typo no README', { ...both, preferredAgent: 'codex' }).mode).toBe('codex');
    const record = { claude: { runs: 10, succeeded: 5 }, codex: { runs: 10, succeeded: 9 } };
    expect(route('Corrija o typo no README', { ...both, successRates: record }).mode).toBe('codex');
    const thin = { claude: { runs: 10, succeeded: 5 }, codex: { runs: 3, succeeded: 3 } };
    expect(route('Corrija o typo no README', { ...both, successRates: thin }).mode).toBe('claude');
  });

  it('lets the user choose the agent', () => {
    expect(route('Proponha a arquitetura do módulo', { ...both, mode: 'codex' })).toMatchObject({ mode: 'codex', reasons: [expect.stringContaining('escolhido')] });
    expect(route('Corrija o typo', { ...both, mode: 'collab' }).mode).toBe('collab');
  });

  it('falls back to the agent that is available, and explains it', () => {
    const noCodex: RouteContext = { ...both, available: { claude: true, codex: false } };
    expect(route('Implemente o endpoint POST /pedidos', noCodex)).toMatchObject({ mode: 'claude', reasons: expect.arrayContaining([expect.stringContaining('Codex CLI indisponível')]) });
    expect(route('Analise o projeto e implemente melhorias de performance com testes', noCodex).mode).toBe('claude');
    expect(route('Proponha a arquitetura', { ...both, mode: 'claude', available: { claude: false, codex: true } }).mode).toBe('codex');
    expect(() => route('Qualquer coisa', { ...both, available: { claude: false, codex: false } })).toThrow(RoutingError);
  });

  it('always says why', () => {
    expect(route('Escreva testes para o CarrinhoService', both).reasons[0]).toMatch(/testes/i);
  });

  it('restricts automatic skill selection to an explicitly requested enabled skill', () => {
    const context: RouteContext = {
      ...both,
      skillPreferences: [
        { skillId: 'dev', taskTypes: ['implementation'], agents: ['codex'], enabled: true },
        { skillId: 'review', taskTypes: ['question'], agents: ['codex'], enabled: true },
      ],
      explicitSkillIds: ['review'],
    };
    expect(route('Implemente o endpoint', context).skillIds).toEqual(['review']);
  });
});

describe('assessRisk', () => {
  it.each([
    'Apague a tabela de pedidos antigos',
    'drop the users table',
    'Faça git push --force na main',
    'rode git reset --hard origin/main',
    'remova a pasta de uploads com rm -rf',
    'Exclua todos os registros de log do banco',
    'truncate table audit',
    'reverta a última migração do banco',
  ])('flags: %s', (prompt) => {
    expect(assessRisk(prompt)).not.toEqual([]);
  });

  it.each(['Implemente o endpoint de exclusão lógica de pedidos com testes', 'Explique o padrão de soft delete', 'Adicione um botão de remover item do carrinho'])(
    'does not flag ordinary work: %s',
    (prompt) => {
      expect(assessRisk(prompt)).toEqual([]);
    },
  );
});

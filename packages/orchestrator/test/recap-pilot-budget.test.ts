import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { RecapPilotBudget, RecapPilotBudgetError } from '../src/aethera/recap-pilot-budget.js';

test('orçamento: painéis, blocos, OCR e fallback têm limites próprios', () => {
  const budget = new RecapPilotBudget({ jobId: 'budget-limits', config: { maxPanels: 1, maxBlocks: 2, maxCalls: 3, maxOcrCalls: 1, maxCpuFallbacks: 1, maxInputTokens: 1000, maxOutputTokens: 1000, maxWallTimeMs: 60_000, maxVramMb: 6500, workerCount: 1, unknownInputTokensPerCall: 100, unknownOutputTokensPerCall: 100 } });
  budget.registerPanel('p0');
  budget.registerBlocks(2);
  assert.throws(() => budget.registerPanel('p1'), (error: unknown) => error instanceof RecapPilotBudgetError && error.code === 'RECAP_PILOT_BUDGET_EXCEEDED');
  assert.equal(budget.state().panels, 1);
});

test('orçamento: tokens desconhecidos continuam desconhecidos e reservam margem conservadora', async () => {
  const budget = new RecapPilotBudget({ jobId: 'budget-unknown', config: { maxCalls: 2, maxInputTokens: 800, maxOutputTokens: 800, unknownInputTokensPerCall: 400, unknownOutputTokensPerCall: 300, maxPanels: 40, maxBlocks: 64, maxOcrCalls: 12, maxCpuFallbacks: 2, maxWallTimeMs: 60_000, maxVramMb: 6500, workerCount: 1 } });
  const reservation = budget.reserveCall({ kind: 'analysis' });
  await budget.settleCall(reservation, { inputTokens: null, outputTokens: null, wallMs: 1 });
  assert.equal(budget.state().inputTokens, null);
  assert.equal(budget.state().outputTokens, null);
  assert.equal(budget.state().unknownInputCalls, 1);
  const second = budget.reserveCall({ kind: 'analysis' });
  await budget.settleCall(second, { inputTokens: null, outputTokens: null, wallMs: 1 });
  assert.throws(() => budget.reserveCall({ kind: 'analysis' }), /RECAP_PILOT_BUDGET_EXCEEDED|RECAP_PILOT_PAUSED/);
});

test('orçamento: VRAM acima do limite pausa antes de uma chamada nova', async () => {
  const budget = new RecapPilotBudget({ jobId: 'budget-vram', vramSampler: async () => 6501 });
  await assert.rejects(budget.runExclusive(async () => 'never'), (error: unknown) => error instanceof RecapPilotBudgetError && error.code === 'RECAP_PILOT_BUDGET_EXCEEDED');
  assert.equal(budget.state().paused, true);
  assert.match(budget.state().pauseReason ?? '', /VRAM/);
});

test('orçamento: worker único serializa chamadas concorrentes', async () => {
  const budget = new RecapPilotBudget({ jobId: 'budget-worker' });
  const order: string[] = [];
  await Promise.all([
    budget.runExclusive(async () => { order.push('a-start'); await new Promise((resolve) => setTimeout(resolve, 5)); order.push('a-end'); }),
    budget.runExclusive(async () => { order.push('b-start'); order.push('b-end'); }),
  ]);
  assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end']);
});

test('hard budget: quatro reservas passam e a quinta é bloqueada antes da execução', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'recap-hard-budget-'));
  try {
    const ledgerPath = join(directory, 'budget.jsonl');
    const budget = new RecapPilotBudget({ jobId: 'hard-four', ledgerPath, config: { maxCalls: 4, maxInputTokens: 10_000, maxOutputTokens: 10_000 } });
    let executed = 0;
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => budget.runExclusive(async () => {
      const reservation = budget.reserveCall({ kind: 'analysis', estimatedInputTokens: 10, estimatedOutputTokens: 10 });
      executed += 1;
      await budget.settleCall(reservation, { inputTokens: 10, outputTokens: 10, wallMs: 1 });
    })));
    assert.equal(executed, 4);
    assert.equal(results.filter((item) => item.status === 'rejected').length, 1);
    assert.equal(budget.state().calls, 4);
    assert.equal(budget.state().blockedCalls, 1);
    assert.match(readFileSync(ledgerPath, 'utf8'), /"status":"blocked"/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('hard budget: falhas de runtime e serialização consomem tentativas', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'recap-hard-budget-'));
  try {
    const budget = new RecapPilotBudget({ jobId: 'hard-failures', ledgerPath: join(directory, 'budget.jsonl'), config: { maxCalls: 2, maxInputTokens: 10_000, maxOutputTokens: 10_000 } });
    for (const errorCode of ['OLLAMA_RUNTIME_ERROR', 'SERIALIZATION_ERROR']) {
      const reservation = budget.reserveCall({ kind: 'analysis', estimatedInputTokens: 10, estimatedOutputTokens: 10 });
      await budget.settleCall(reservation, { inputTokens: null, outputTokens: null, errorCode, wallMs: 1 });
    }
    assert.equal(budget.state().calls, 2);
    assert.equal(budget.state().unknownInputCalls, 2);
    assert.throws(() => budget.reserveCall({ kind: 'analysis' }), /RECAP_PILOT/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('hard budget: consumo e pausa persistem após reinicialização', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'recap-hard-budget-'));
  try {
    const ledgerPath = join(directory, 'budget.jsonl');
    const first = new RecapPilotBudget({ jobId: 'hard-resume', ledgerPath, config: { maxCalls: 2, maxInputTokens: 10_000, maxOutputTokens: 10_000 } });
    const reservation = first.reserveCall({ kind: 'analysis', estimatedInputTokens: 10, estimatedOutputTokens: 10 });
    await first.settleCall(reservation, { inputTokens: 10, outputTokens: 10, wallMs: 1 });
    const second = new RecapPilotBudget({ jobId: 'hard-resume', ledgerPath, config: { maxCalls: 2, maxInputTokens: 10_000, maxOutputTokens: 10_000 } });
    assert.equal(second.state().calls, 1);
    assert.equal(second.state().inputTokens, 10);
    assert.equal(second.state().outputTokens, 10);
    const next = second.reserveCall({ kind: 'analysis', estimatedInputTokens: 10, estimatedOutputTokens: 10 });
    await second.settleCall(next, { inputTokens: 10, outputTokens: 10, wallMs: 1 });
    const third = new RecapPilotBudget({ jobId: 'hard-resume', ledgerPath, config: { maxCalls: 2, maxInputTokens: 10_000, maxOutputTokens: 10_000 } });
    assert.equal(third.state().calls, 2);
    assert.equal(third.state().inputTokens, 20);
    assert.equal(third.state().outputTokens, 20);
    assert.throws(() => third.reserveCall({ kind: 'analysis' }), /RECAP_PILOT/);
    assert.equal(third.state().blockedCalls, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('hard budget: fallback CPU compartilha o teto e cancelamento fica no ledger', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'recap-hard-budget-'));
  try {
    const ledgerPath = join(directory, 'budget.jsonl');
    const budget = new RecapPilotBudget({ jobId: 'hard-fallback', ledgerPath, config: { maxCalls: 2, maxCpuFallbacks: 1, maxInputTokens: 10_000, maxOutputTokens: 10_000 } });
    const fallback = budget.reserveCall({ kind: 'cpu-fallback', estimatedInputTokens: 10, estimatedOutputTokens: 10 });
    await budget.settleCall(fallback, { inputTokens: 10, outputTokens: 10, errorCode: 'CANCELLED', wallMs: 1 });
    assert.throws(() => budget.reserveCall({ kind: 'cpu-fallback' }), /RECAP_PILOT/);
    assert.equal(budget.state().cpuFallbacks, 1);
    assert.equal(budget.state().calls, 1);
    assert.match(readFileSync(ledgerPath, 'utf8'), /CANCELLED/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

// Regression (Fase 4B.11, recap-1795538364251): the wall-time limit was measured from the
// first `opened` event in calendar time, so 54.5 s of real inference spread over 2.5 h paused
// the job, and the persisted pause was restored on every resume, failing panel 61 instantly.
test('hard budget: prazo conta só tempo ativo liquidado, não calendário nem app fechado', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'recap-active-time-'));
  try {
    const ledgerPath = join(directory, 'budget.jsonl');
    const opened = Date.now() - 3 * 60 * 60_000; // ledger opened 3 h ago (app closed / paused since)
    writeFileSync(ledgerPath, [
      { budgetVersion: 'recap-pilot-budget-v2', ts: new Date(opened).toISOString(), jobId: 'active-time', kind: 'budget', status: 'opened', startedAtMs: opened },
      { budgetVersion: 'recap-pilot-budget-v2', ts: new Date(opened + 1).toISOString(), jobId: 'active-time', kind: 'analysis', status: 'reserved', callId: 1, reservedInputTokens: 100, reservedOutputTokens: 100 },
      { budgetVersion: 'recap-pilot-budget-v2', ts: new Date(opened + 2).toISOString(), jobId: 'active-time', kind: 'analysis', status: 'settled', callId: 1, inputTokens: 90, outputTokens: 80, wallMs: 54_535, outcome: 'ok' },
    ].map((event) => JSON.stringify(event)).join('\n') + '\n');
    const budget = new RecapPilotBudget({ jobId: 'active-time', ledgerPath, config: { maxWallTimeMs: 30 * 60_000 } });
    assert.equal(budget.state().wallTimeMs, 54_535);
    await budget.ensureCanCall();
    assert.equal(budget.state().paused, false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('hard budget: pausa persistida por prazo calendário é reavaliada na retomada, com auditoria idempotente', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'recap-stale-pause-'));
  try {
    const ledgerPath = join(directory, 'budget.jsonl');
    const opened = Date.now() - 3 * 60 * 60_000;
    writeFileSync(ledgerPath, [
      { budgetVersion: 'recap-pilot-budget-v2', ts: new Date(opened).toISOString(), jobId: 'stale-pause', kind: 'budget', status: 'opened', startedAtMs: opened },
      { budgetVersion: 'recap-pilot-budget-v2', ts: new Date(opened + 1).toISOString(), jobId: 'stale-pause', kind: 'analysis', status: 'reserved', callId: 1, reservedInputTokens: 100, reservedOutputTokens: 100 },
      { budgetVersion: 'recap-pilot-budget-v2', ts: new Date(opened + 2).toISOString(), jobId: 'stale-pause', kind: 'analysis', status: 'settled', callId: 1, inputTokens: 90, outputTokens: 80, wallMs: 1_000, outcome: 'ok' },
      { budgetVersion: 'recap-pilot-budget-v2', ts: new Date().toISOString(), jobId: 'stale-pause', kind: 'budget', status: 'paused', reason: 'prazo de 1800000 ms excedido.' },
    ].map((event) => JSON.stringify(event)).join('\n') + '\n');
    const config = { maxCalls: 2, maxWallTimeMs: 30 * 60_000 };
    const resumed = new RecapPilotBudget({ jobId: 'stale-pause', ledgerPath, config });
    assert.equal(resumed.state().paused, false);
    assert.equal(resumed.state().calls, 1, 'consumo histórico preservado');
    assert.equal(resumed.state().inputTokens, 90);
    await resumed.ensureCanCall();
    const again = new RecapPilotBudget({ jobId: 'stale-pause', ledgerPath, config });
    assert.equal(again.state().paused, false);
    const events = readFileSync(ledgerPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(events.filter((event) => event['status'] === 'resumed').length, 1, 'reavaliação registrada uma única vez');
    assert.equal(events.filter((event) => event['status'] === 'paused').length, 1, 'pausa histórica preservada');
    // Limits are not renewed: the second call is the last one allowed.
    const reservation = again.reserveCall({ kind: 'analysis', estimatedInputTokens: 10, estimatedOutputTokens: 10 });
    await again.settleCall(reservation, { inputTokens: 10, outputTokens: 10, wallMs: 1 });
    assert.throws(() => again.reserveCall({ kind: 'analysis' }), /RECAP_PILOT/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('hard budget: pausa persistida continua quando o tempo ativo realmente esgotou', () => {
  const directory = mkdtempSync(join(tmpdir(), 'recap-real-pause-'));
  try {
    const ledgerPath = join(directory, 'budget.jsonl');
    writeFileSync(ledgerPath, [
      { budgetVersion: 'recap-pilot-budget-v2', ts: new Date().toISOString(), jobId: 'real-pause', kind: 'budget', status: 'opened', startedAtMs: Date.now() },
      { budgetVersion: 'recap-pilot-budget-v2', ts: new Date().toISOString(), jobId: 'real-pause', kind: 'analysis', status: 'reserved', callId: 1, reservedInputTokens: 1, reservedOutputTokens: 1 },
      { budgetVersion: 'recap-pilot-budget-v2', ts: new Date().toISOString(), jobId: 'real-pause', kind: 'analysis', status: 'settled', callId: 1, inputTokens: 1, outputTokens: 1, wallMs: 60_000, outcome: 'ok' },
      { budgetVersion: 'recap-pilot-budget-v2', ts: new Date().toISOString(), jobId: 'real-pause', kind: 'budget', status: 'paused', reason: 'prazo de 60000 ms excedido.' },
    ].map((event) => JSON.stringify(event)).join('\n') + '\n');
    const budget = new RecapPilotBudget({ jobId: 'real-pause', ledgerPath, config: { maxWallTimeMs: 60_000 } });
    assert.equal(budget.state().paused, true);
    assert.equal(readFileSync(ledgerPath, 'utf8').includes('"resumed"'), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

// Regression (Fase 4B.11, panel 61 retry 19:49): VRAM sampled after a successful call exceeded
// the limit; settleCall threw, the provider discarded a paid structured result (1075/397 tokens).
test('hard budget: limite detectado após chamada concluída pausa a próxima, sem descartar o resultado', async () => {
  let vram = 6_000;
  const budget = new RecapPilotBudget({ jobId: 'settle-no-throw', vramSampler: async () => vram, config: { maxVramMb: 6_500 } });
  const result = await budget.runExclusive(async () => {
    const reservation = budget.reserveCall({ kind: 'analysis', estimatedInputTokens: 10, estimatedOutputTokens: 10 });
    vram = 6_792;
    await budget.settleCall(reservation, { inputTokens: 1_075, outputTokens: 397, wallMs: 16_307 });
    return 'structured-result';
  });
  assert.equal(result, 'structured-result');
  assert.equal(budget.state().paused, true);
  assert.match(budget.state().pauseReason ?? '', /VRAM observada 6792/);
  await assert.rejects(budget.runExclusive(async () => 'next'), /RECAP_PILOT/);
});

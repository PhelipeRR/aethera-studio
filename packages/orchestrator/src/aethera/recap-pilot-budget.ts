import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const RECAP_PILOT_BUDGET_EXCEEDED = 'RECAP_PILOT_BUDGET_EXCEEDED';
export const RECAP_PILOT_VRAM_EXCEEDED = 'RECAP_PILOT_VRAM_EXCEEDED';
export const RECAP_PILOT_PAUSED = 'RECAP_PILOT_PAUSED';
export const RECAP_PILOT_BUDGET_VERSION = 'recap-pilot-budget-v2';

export type RecapPilotCallKind = 'analysis' | 'ocr' | 'cpu-fallback';

export interface RecapPilotBudgetConfig {
  maxPanels: number;
  maxBlocks: number;
  maxCalls: number;
  maxOcrCalls: number;
  maxCpuFallbacks: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxWallTimeMs: number;
  maxVramMb: number;
  workerCount: 1;
  unknownInputTokensPerCall: number;
  unknownOutputTokensPerCall: number;
}

export const DEFAULT_RECAP_PILOT_BUDGET: RecapPilotBudgetConfig = {
  maxPanels: 40,
  maxBlocks: 64,
  maxCalls: 80,
  maxOcrCalls: 12,
  maxCpuFallbacks: 2,
  maxInputTokens: 90_000,
  maxOutputTokens: 30_000,
  maxWallTimeMs: 15 * 60_000,
  maxVramMb: 6_500,
  workerCount: 1,
  unknownInputTokensPerCall: 4_096,
  unknownOutputTokensPerCall: 1_200,
};

export interface RecapPilotUsage {
  inputTokens?: number | null;
  outputTokens?: number | null;
  wallMs?: number | null;
  vramMb?: number | null;
  errorCode?: string | null;
}

export interface RecapPilotBudgetState {
  panels: number;
  blocks: number;
  calls: number;
  ocrCalls: number;
  cpuFallbacks: number;
  inputTokens: number | null;
  outputTokens: number | null;
  unknownInputCalls: number;
  unknownOutputCalls: number;
  blockedCalls: number;
  peakVramMb: number | null;
  wallTimeMs: number;
  paused: boolean;
  pauseReason: string | null;
}

export interface RecapPilotCallReservation {
  readonly id: number;
  readonly kind: RecapPilotCallKind;
  readonly reservedInputTokens: number;
  readonly reservedOutputTokens: number;
  readonly startedAt: number;
  settled: boolean;
}

export type RecapPilotVramSampler = () => Promise<number | null>;

export class RecapPilotBudgetError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'RecapPilotBudgetError';
    this.code = code;
  }
}

/** Reads total device VRAM usage without assuming that the process owns all WDDM memory. */
export async function sampleNvidiaVramMb(binary = 'nvidia-smi'): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(binary, ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 2_000, maxBuffer: 16 * 1024 });
    const first = stdout.trim().split(/\r?\n/u)[0]?.trim();
    const value = Number(first);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function knownToken(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Job-local hard budget. Unknown provider usage reserves a conservative allowance and remains
 * unknown in the ledger; it is never converted to zero.
 */
export class RecapPilotBudget {
  private readonly config: RecapPilotBudgetConfig;
  private readonly vramSampler: RecapPilotVramSampler | undefined;
  private readonly ledgerPath: string | undefined;
  private readonly jobId: string;
  private readonly panelIds = new Set<string>();
  private readonly reservations = new Map<number, RecapPilotCallReservation>();
  private startedAt = Date.now();
  /**
   * Active processing time: the sum of measured `wallMs` of every settled call (ok or failed),
   * hydrated from the ledger. Pauses, idle time and periods with the app closed are excluded;
   * the calendar time since `opened` is never charged against `maxWallTimeMs`.
   */
  private activeWallTimeMs = 0;
  private nextReservation = 1;
  private lastVramMb: number | null = null;
  private peakVramMb: number | null = null;
  private inputTokensKnown = 0;
  private outputTokensKnown = 0;
  private unknownInputCalls = 0;
  private unknownOutputCalls = 0;
  private blockedCalls = 0;
  private blocks = 0;
  private calls = 0;
  private ocrCalls = 0;
  private cpuFallbacks = 0;
  private paused = false;
  private pauseReason: string | null = null;
  private workerTail: Promise<void> = Promise.resolve();

  constructor(input: { jobId: string; config?: Partial<RecapPilotBudgetConfig>; vramSampler?: RecapPilotVramSampler; ledgerPath?: string }) {
    this.jobId = input.jobId;
    this.config = { ...DEFAULT_RECAP_PILOT_BUDGET, ...(input.config ?? {}) };
    if (this.config.workerCount !== 1) throw new RecapPilotBudgetError(RECAP_PILOT_BUDGET_EXCEEDED, 'o piloto exige exatamente um worker de inferência.');
    this.vramSampler = input.vramSampler;
    this.ledgerPath = input.ledgerPath;
    const hadPersistedState = this.hydrate();
    if (this.ledgerPath && !hadPersistedState) this.append({ kind: 'budget', status: 'opened', startedAtMs: this.startedAt });
    if (this.paused) this.reevaluatePersistedPause();
  }

  /**
   * A pause read back from the ledger is a record, not a permanent state. Every limit is
   * enforced again from hydrated counters (calls, tokens, blocks, panels, OCR, CPU fallback,
   * active time, sampled VRAM), so nothing is renewed. Only the active-time check can be decided
   * here; when it still holds the job stays paused, otherwise one auditable `resumed` event is
   * written and the next replay sees it, which keeps the re-evaluation idempotent.
   */
  private reevaluatePersistedPause(): void {
    if (this.activeWallTimeMs >= this.config.maxWallTimeMs) return;
    if (this.inputTokensKnown > this.config.maxInputTokens || this.outputTokensKnown > this.config.maxOutputTokens) return;
    const previousReason = this.pauseReason;
    this.paused = false;
    this.pauseReason = null;
    this.append({ kind: 'budget', status: 'resumed', previousReason, activeWallTimeMs: this.activeWallTimeMs, calls: this.calls, inputTokens: this.inputTokensKnown, outputTokens: this.outputTokensKnown });
  }

  get limits(): RecapPilotBudgetConfig { return { ...this.config }; }

  state(): RecapPilotBudgetState {
    return {
      panels: this.panelIds.size,
      blocks: this.blocks,
      calls: this.calls,
      ocrCalls: this.ocrCalls,
      cpuFallbacks: this.cpuFallbacks,
      inputTokens: this.unknownInputCalls ? null : this.inputTokensKnown,
      outputTokens: this.unknownOutputCalls ? null : this.outputTokensKnown,
      unknownInputCalls: this.unknownInputCalls,
      unknownOutputCalls: this.unknownOutputCalls,
      blockedCalls: this.blockedCalls,
      peakVramMb: this.peakVramMb,
      wallTimeMs: this.activeWallTimeMs,
      paused: this.paused,
      pauseReason: this.pauseReason,
    };
  }

  registerPanel(panelId: string): void {
    if (this.panelIds.has(panelId)) return;
    if (this.panelIds.size >= this.config.maxPanels) this.pause(`${this.panelIds.size + 1} painéis excedem o máximo de ${this.config.maxPanels}.`);
    this.panelIds.add(panelId);
    this.append({ kind: 'panel', panelId, status: 'registered' });
  }

  registerBlocks(count: number): void {
    if (!Number.isInteger(count) || count < 1) throw new RecapPilotBudgetError(RECAP_PILOT_BUDGET_EXCEEDED, `quantidade de blocos inválida: ${count}.`);
    if (this.blocks + count > this.config.maxBlocks) this.pause(`${this.blocks + count} blocos excedem o máximo de ${this.config.maxBlocks}.`);
    this.blocks += count;
    this.append({ kind: 'blocks', count, status: 'registered' });
  }

  async ensureCanCall(): Promise<void> {
    if (this.paused) throw new RecapPilotBudgetError(RECAP_PILOT_PAUSED, this.pauseReason ?? 'job pausado.');
    if (this.activeWallTimeMs >= this.config.maxWallTimeMs) this.pause(`prazo de ${this.config.maxWallTimeMs} ms excedido.`);
    if (this.vramSampler) {
      const vramMb = await this.vramSampler();
      this.updateVram(vramMb);
      if (vramMb !== null && vramMb > this.config.maxVramMb) this.pause(`VRAM observada ${vramMb} MiB acima do limite ${this.config.maxVramMb} MiB.`);
    }
    if (this.paused) throw new RecapPilotBudgetError(RECAP_PILOT_VRAM_EXCEEDED, this.pauseReason ?? 'limite de recurso excedido.');
  }

  reserveCall(input: { kind: RecapPilotCallKind; estimatedInputTokens?: number | null; estimatedOutputTokens?: number | null }): RecapPilotCallReservation {
    if (this.paused) throw new RecapPilotBudgetError(RECAP_PILOT_PAUSED, this.pauseReason ?? 'job pausado.');
    if (this.calls >= this.config.maxCalls) this.blockCall(input.kind, `chamada ${this.calls + 1} excederia o máximo de ${this.config.maxCalls}.`);
    if (input.kind === 'ocr' && this.ocrCalls >= this.config.maxOcrCalls) this.blockCall(input.kind, `OCR ${this.ocrCalls + 1} excederia o máximo de ${this.config.maxOcrCalls}.`);
    if (input.kind === 'cpu-fallback' && this.cpuFallbacks >= this.config.maxCpuFallbacks) this.blockCall(input.kind, `fallback CPU ${this.cpuFallbacks + 1} excederia o máximo de ${this.config.maxCpuFallbacks}.`);
    const reservedInputTokens = knownToken(input.estimatedInputTokens) ? input.estimatedInputTokens : this.config.unknownInputTokensPerCall;
    const reservedOutputTokens = knownToken(input.estimatedOutputTokens) ? input.estimatedOutputTokens : this.config.unknownOutputTokensPerCall;
    if (this.inputTokensKnown + reservedInputTokens > this.config.maxInputTokens || this.outputTokensKnown + reservedOutputTokens > this.config.maxOutputTokens) {
      this.blockCall(input.kind, `reserva de tokens excederia os limites (${this.config.maxInputTokens} entrada/${this.config.maxOutputTokens} saída).`);
    }
    const reservation: RecapPilotCallReservation = { id: this.nextReservation++, kind: input.kind, reservedInputTokens, reservedOutputTokens, startedAt: Date.now(), settled: false };
    this.append({ kind: input.kind, status: 'reserved', callId: reservation.id, reservedInputTokens, reservedOutputTokens });
    this.reservations.set(reservation.id, reservation);
    this.calls += 1;
    if (input.kind === 'ocr') this.ocrCalls += 1;
    if (input.kind === 'cpu-fallback') this.cpuFallbacks += 1;
    this.inputTokensKnown += reservedInputTokens;
    this.outputTokensKnown += reservedOutputTokens;
    return reservation;
  }

  async settleCall(reservation: RecapPilotCallReservation, usage: RecapPilotUsage): Promise<void> {
    if (reservation.settled) return;
    reservation.settled = true;
    this.reservations.delete(reservation.id);
    const inputKnown = knownToken(usage.inputTokens);
    const outputKnown = knownToken(usage.outputTokens);
    // Keep the conservative reservation when the provider does not report usage. Unknown
    // values therefore continue to consume the per-call allowance and remain null in state.
    const inputValue = usage.inputTokens;
    const outputValue = usage.outputTokens;
    if (knownToken(inputValue)) this.inputTokensKnown += inputValue - reservation.reservedInputTokens;
    if (knownToken(outputValue)) this.outputTokensKnown += outputValue - reservation.reservedOutputTokens;
    if (!inputKnown) this.unknownInputCalls += 1;
    if (!outputKnown) this.unknownOutputCalls += 1;
    const settledWallMs = usage.wallMs ?? (Date.now() - reservation.startedAt);
    this.activeWallTimeMs += Math.max(0, settledWallMs);
    const observedVram = usage.vramMb ?? (this.vramSampler ? await this.vramSampler() : null);
    this.updateVram(observedVram);
    this.append({ kind: reservation.kind, callId: reservation.id, inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null, wallMs: settledWallMs, vramMb: observedVram, errorCode: usage.errorCode ?? null, status: 'settled', outcome: usage.errorCode ? 'failed' : 'ok' });
    // The call already completed and was paid for: a limit observed now blocks the NEXT call
    // and never throws here, otherwise the provider would discard a valid structured result.
    if (this.inputTokensKnown > this.config.maxInputTokens || this.outputTokensKnown > this.config.maxOutputTokens) this.markPaused('uso efetivo de tokens excedeu o limite após a chamada; novas chamadas bloqueadas.');
    else if (this.activeWallTimeMs >= this.config.maxWallTimeMs) this.markPaused(`prazo de ${this.config.maxWallTimeMs} ms excedido.`);
    else if (observedVram !== null && observedVram > this.config.maxVramMb) this.markPaused(`VRAM observada ${observedVram} MiB acima do limite ${this.config.maxVramMb} MiB.`);
  }

  private markPaused(reason: string): void {
    if (this.paused) return;
    this.append({ kind: 'budget', status: 'paused', reason });
    this.paused = true;
    this.pauseReason = reason;
  }

  async runExclusive<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const previous = this.workerTail;
    let release!: () => void;
    const turn = new Promise<void>((resolve) => { release = resolve; });
    this.workerTail = previous.then(() => turn);
    let abort: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new RecapPilotBudgetError(RECAP_PILOT_PAUSED, 'inferência cancelada.'));
      signal?.addEventListener('abort', abort, { once: true });
    });
    try {
      await Promise.race([previous, cancelled]);
      await this.ensureCanCall();
      return await work();
    } finally {
      if (abort) signal?.removeEventListener('abort', abort);
      release();
    }
  }

  pause(reason: string): never {
    if (!this.paused) this.append({ kind: 'budget', status: 'paused', reason });
    this.paused = true;
    this.pauseReason = reason;
    throw new RecapPilotBudgetError(RECAP_PILOT_BUDGET_EXCEEDED, reason);
  }

  private updateVram(value: number | null): void {
    if (value === null) return;
    this.lastVramMb = value;
    this.peakVramMb = this.peakVramMb === null ? value : Math.max(this.peakVramMb, value);
  }

  private append(entry: Record<string, unknown>): void {
    if (!this.ledgerPath) return;
    mkdirSync(dirname(this.ledgerPath), { recursive: true });
    appendFileSync(this.ledgerPath, `${JSON.stringify({ budgetVersion: RECAP_PILOT_BUDGET_VERSION, ts: new Date().toISOString(), jobId: this.jobId, ...entry })}\n`, 'utf8');
  }

  private blockCall(kind: RecapPilotCallKind, reason: string): never {
    this.blockedCalls += 1;
    this.append({ kind, status: 'blocked', reason });
    return this.pause(reason);
  }

  private hydrate(): boolean {
    if (!this.ledgerPath) return false;
    try {
      const lines = readFileSync(this.ledgerPath, 'utf8').split(/\r?\n/u).filter(Boolean) as string[];
      let found = false;
      let openedAt: number | null = null;
      const reservationsById = new Map<number, { input: number; output: number }>();
      const settlementsById = new Map<number, { input: number | null; output: number | null; vram: number | null }>();
      for (const line of lines) {
        let event: Record<string, unknown>;
        try { event = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
        if (event['budgetVersion'] !== RECAP_PILOT_BUDGET_VERSION || event['jobId'] !== this.jobId) continue;
        found = true;
        if (event['status'] === 'opened' && typeof event['startedAtMs'] === 'number') openedAt = openedAt === null ? event['startedAtMs'] : Math.min(openedAt, event['startedAtMs']);
        if (event['kind'] === 'panel' && event['status'] === 'registered' && typeof event['panelId'] === 'string') this.panelIds.add(event['panelId']);
        if (event['kind'] === 'blocks' && event['status'] === 'registered' && typeof event['count'] === 'number') this.blocks += event['count'];
        if (event['status'] === 'reserved') {
          this.calls += 1;
          if (event['kind'] === 'ocr') this.ocrCalls += 1;
          if (event['kind'] === 'cpu-fallback') this.cpuFallbacks += 1;
          if (typeof event['callId'] === 'number' && typeof event['reservedInputTokens'] === 'number' && typeof event['reservedOutputTokens'] === 'number') {
            reservationsById.set(event['callId'], { input: event['reservedInputTokens'], output: event['reservedOutputTokens'] });
          }
        }
        if (event['status'] === 'blocked') this.blockedCalls += 1;
        if (event['status'] === 'settled' && typeof event['callId'] === 'number') {
          settlementsById.set(event['callId'], {
            input: knownToken(typeof event['inputTokens'] === 'number' ? event['inputTokens'] : null) ? event['inputTokens'] as number : null,
            output: knownToken(typeof event['outputTokens'] === 'number' ? event['outputTokens'] : null) ? event['outputTokens'] as number : null,
            vram: knownToken(typeof event['vramMb'] === 'number' ? event['vramMb'] : null) ? event['vramMb'] as number : null,
          });
          if (typeof event['wallMs'] === 'number' && Number.isFinite(event['wallMs']) && event['wallMs'] > 0) this.activeWallTimeMs += event['wallMs'];
        }
        if (event['status'] === 'paused') { this.paused = true; this.pauseReason = typeof event['reason'] === 'string' ? event['reason'] : 'job pausado.'; }
        if (event['kind'] === 'budget' && event['status'] === 'resumed') { this.paused = false; this.pauseReason = null; }
      }
      // Reconstruct measured usage for settled calls and retain the conservative reservation
      // for a call that was reserved but not settled before a process interruption.
      for (const [callId, reservation] of reservationsById) {
        const settlement = settlementsById.get(callId);
        if (!settlement || settlement.input === null) {
          if (settlement) this.unknownInputCalls += 1;
          this.inputTokensKnown += reservation.input;
        } else this.inputTokensKnown += settlement.input;
        if (!settlement || settlement.output === null) {
          if (settlement) this.unknownOutputCalls += 1;
          this.outputTokensKnown += reservation.output;
        } else this.outputTokensKnown += settlement.output;
        if (settlement?.vram !== null && settlement?.vram !== undefined) this.updateVram(settlement.vram);
      }
      if (openedAt !== null) this.startedAt = openedAt;
      this.nextReservation = this.calls + 1;
      return found;
    } catch {
      // A corrupt budget ledger never restores consumed capacity. The caller gets a fresh
      // job-local budget and the corruption remains diagnosable in the ledger path.
      return false;
    }
  }
}

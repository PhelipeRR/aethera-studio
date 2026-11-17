import { createHash } from 'node:crypto';
import { z } from 'zod';
import { calibratedProbability, confidenceBand, segmentAnalysisSchema, segmentKinds, type SegmentAnalysis, type ConfidenceCalibration, type ConfidenceBand, type SegmentKind, type VisionCapability, type VisionPolicy, type VisionTask } from '@neuralbridge/shared';
import { visionGpuScheduler, type VisualWorkScheduler } from './visual-work-scheduler.js';

/** `atMs` is the frame's position in the source, kept so an analysis can cite when something was seen. */
export interface VisionFrame { hash: string; path: string; atMs?: number }
export interface VisionClassification { kind: SegmentKind; confidence: number }
export interface VisionDescription { description: string; tags: string[] }
export interface VisualAnalysisProvider {
  id: string; model: string; capabilities: readonly VisionCapability[];
  limits: { maxImagesPerCall: number; vramMb?: number; costPerImageUsd?: number };
  detect(signal?: AbortSignal): Promise<{ available: true } | { available: false; reason: string }>;
  classify?(input: { frames: readonly VisionFrame[]; labels: readonly SegmentKind[]; signal?: AbortSignal }): Promise<VisionClassification>;
  describe?(input: { frames: readonly VisionFrame[]; signal?: AbortSignal }): Promise<VisionDescription>;
  embedImage?(input: { frames: readonly VisionFrame[]; signal?: AbortSignal }): Promise<number[][]>;
  embedText?(input: { texts: readonly string[]; signal?: AbortSignal }): Promise<number[][]>;
  ocr?(input: { frames: readonly VisionFrame[]; signal?: AbortSignal }): Promise<string[]>;
  /** Universal segment analysis (AP-04): every frame of one segment in one call. */
  analyze?(input: { frames: readonly VisionFrame[]; context?: string; signal?: AbortSignal }): Promise<SegmentAnalysis>;
  /** Model the provider reported for its last fresh call (provider version for the record), when known. */
  lastReportedModel?(): string | null;
}
export type VisionCacheKey = { frameHash: string; provider: string; model: string; promptVersion: string; task: VisionTask };
export interface VisionCachePort { get(key: VisionCacheKey): unknown; put(key: VisionCacheKey, value: unknown): void }
export interface VisionSpendPort { get(key: string): number; add(key: string, amount: number): number }
export type VisionAttemptOutcome = 'ok' | 'cached' | 'low_confidence' | 'unavailable' | 'over_budget' | 'error';
export interface VisionCooldownEntry { untilMs: number; reason: string }
export interface VisionProviderTelemetry {
  provider: string;
  calls: number;
  successes: number;
  failures: number;
  timeouts: number;
  avgLatencyMs: number;
  lastError?: string;
}
export function isVisionQuotaError(message: string): boolean {
  return /usage limit|quota|rate[- ]limit|too many requests|\b429\b|try again at|insufficient[_ ]quota|credit balance/i.test(message);
}
export type VisionAttempt = { provider: string; outcome: VisionAttemptOutcome; detail?: string; durationMs?: number };
type Attempt = VisionAttempt;
export interface VisionRouting extends VisionClassification { provider: string | null; model: string | null; band: ConfidenceBand; calibratedConfidence: number | null; costUsd: number; attempts: Attempt[] }
export interface VisionResult<T> { value: T | null; provider: string | null; model: string | null; costUsd: number; attempts: Attempt[]; refs: string[]; reportedModel?: string | null; durationMs?: number }
type Request = { frames?: readonly VisionFrame[]; texts?: readonly string[]; labels?: readonly SegmentKind[]; context?: string; policy: VisionPolicy; signal?: AbortSignal; budgetKey?: string };
const classification = z.strictObject({ kind: z.enum(segmentKinds), confidence: z.number().min(0).max(1) });
const description = z.strictObject({ description: z.string().min(1), tags: z.array(z.string().min(1)) });
const vectors = z.array(z.array(z.number().finite()).min(1)).min(1);
class VisionOverBudgetError extends Error { constructor() { super('vision budget exceeded'); this.name = 'VisionOverBudgetError'; } }

/** Cache keys bind ordered inputs, capability, provider, model and prompt. All capabilities share the run budget. */
export class VisionRouter {
  private readonly providers: Map<string, VisualAnalysisProvider>;
  private readonly spend: VisionSpendPort;
  private readonly telemetry = new Map<string, { calls: number; successes: number; failures: number; timeouts: number; totalLatencyMs: number; lastError?: string }>();
  constructor(
    providers: readonly VisualAnalysisProvider[],
    private readonly cache: VisionCachePort,
    private readonly calibrations: readonly ConfidenceCalibration[] = [],
    spend?: VisionSpendPort,
    private readonly scheduler: VisualWorkScheduler = visionGpuScheduler,
    private readonly cooldowns: Map<string, VisionCooldownEntry> = new Map(),
    private readonly timeoutFailures: Map<string, number> = new Map(),
  ) {
    this.providers = new Map(providers.map((provider) => [provider.id, provider]));
    const amounts = new Map<string, number>();
    this.spend = spend ?? { get: (key) => amounts.get(key) ?? 0, add: (key, amount) => { const total = (amounts.get(key) ?? 0) + amount; amounts.set(key, total); return total; } };
  }

  async checkProvidersHealth(chain: readonly string[]): Promise<Array<{ provider: string; available: boolean; reason?: string }>> {
    const out: Array<{ provider: string; available: boolean; reason?: string }> = [];
    for (const id of chain) {
      const cd = this.cooldowns.get(id);
      if (cd && cd.untilMs > Date.now()) {
        out.push({ provider: id, available: false, reason: `quota_cooldown: ${cd.reason}` });
        continue;
      }
      const provider = this.providers.get(id);
      if (!provider) {
        out.push({ provider: id, available: false, reason: 'not configured' });
        continue;
      }
      try {
        const res = await provider.detect();
        out.push(res.available ? { provider: id, available: true } : { provider: id, available: false, reason: res.reason });
      } catch (err) {
        out.push({ provider: id, available: false, reason: err instanceof Error ? err.message : 'detect failed' });
      }
    }
    return out;
  }

  async classify(input: Request & { frames: readonly VisionFrame[]; labels: readonly SegmentKind[] }): Promise<VisionRouting> {
    const attempts: Attempt[] = [];
    let best: VisionRouting | null = null;
    let costUsd = 0;
    for (const id of input.policy.chain) {
      const result = await this.route('classify', { ...input, policy: { ...input.policy, chain: [id] } });
      attempts.push(...result.attempts); costUsd += result.costUsd;
      if (!result.value) continue;
      const value = classification.parse(result.value);
      const profile = this.calibrations.find((profile) => profile.provider === result.provider && profile.model === result.model && profile.promptVersion === input.policy.version && profile.label === value.kind);
      const calibratedConfidence = profile ? calibratedProbability(profile, value.confidence) : null;
      const thresholds = profile?.thresholds ? { autoAt: Math.max(profile.thresholds.autoAt, input.policy.thresholds?.autoAt ?? 0), reviewAt: Math.max(profile.thresholds.reviewAt, input.policy.thresholds?.reviewAt ?? 0) } : null;
      const band = input.policy.thresholds && thresholds && calibratedConfidence !== null ? confidenceBand(calibratedConfidence, thresholds) : 'review';
      const routed: VisionRouting = { ...value, provider: result.provider, model: result.model, calibratedConfidence, band, costUsd, attempts };
      if (band === 'automatic') return routed;
      attempts[attempts.length - 1] = { provider: id, outcome: 'low_confidence' };
      if (!best || (calibratedConfidence ?? 0) > (best.calibratedConfidence ?? 0) || (calibratedConfidence === best.calibratedConfidence && value.confidence > best.confidence)) best = routed;
    }
    return best ? { ...best, costUsd, attempts } : { kind: 'unknown', confidence: 0, calibratedConfidence: null, provider: null, model: null, band: 'review', costUsd, attempts };
  }
  async describe(input: Request & { frames: readonly VisionFrame[] }): Promise<VisionResult<VisionDescription>> { return this.route('describe', input) as Promise<VisionResult<VisionDescription>>; }
  async embedImage(input: Request & { frames: readonly VisionFrame[] }): Promise<VisionResult<number[][]>> { return this.route('embed_image', input) as Promise<VisionResult<number[][]>>; }
  async embedText(input: Request & { texts: readonly string[] }): Promise<VisionResult<number[][]>> { return this.route('embed_text', input) as Promise<VisionResult<number[][]>>; }
  async ocr(input: Request & { frames: readonly VisionFrame[] }): Promise<VisionResult<string[]>> { return this.route('ocr', input) as Promise<VisionResult<string[]>>; }
  /** One segment, all its frames in one call; the cache key covers frames, timestamps, context, provider, model and prompt. */
  async analyze(input: Request & { frames: readonly VisionFrame[] }): Promise<VisionResult<SegmentAnalysis>> { return this.route('analyze', input) as Promise<VisionResult<SegmentAnalysis>>; }

  /** Returns observed latency, success, failure and timeout telemetry per vision provider. */
  getProviderTelemetry(): VisionProviderTelemetry[] {
    return [...this.telemetry.entries()].map(([provider, s]) => ({
      provider,
      calls: s.calls,
      successes: s.successes,
      failures: s.failures,
      timeouts: s.timeouts,
      avgLatencyMs: s.successes > 0 ? Math.round(s.totalLatencyMs / s.successes) : 0,
      ...(s.lastError ? { lastError: s.lastError } : {}),
    }));
  }

  private prioritizedChain(chain: readonly string[]): string[] {
    if (this.telemetry.size === 0) return [...chain];
    const indexOf = new Map(chain.map((id, idx) => [id, idx]));
    const scoreOf = (id: string): number => {
      if (id === 'ffmpeg-heuristics') return 10_000;
      // Only timeout history changes the order. Other provider errors remain
      // retryable in the declared policy order, preserving fallback evidence.
      return (this.telemetry.get(id)?.timeouts ?? 0) * 100;
    };
    return [...chain].sort((a, b) => {
      const diff = scoreOf(a) - scoreOf(b);
      return Math.abs(diff) > 0.5 ? diff : (indexOf.get(a) ?? 0) - (indexOf.get(b) ?? 0);
    });
  }

  private async route(capability: VisionCapability, input: Request): Promise<VisionResult<unknown>> {
    const attempts: Attempt[] = [];
    let costUsd = 0;
    const empty = (): VisionResult<unknown> => ({ value: null, provider: null, model: null, costUsd, attempts, refs: [] });
    const budgetKey = input.budgetKey ?? `${input.policy.scope}:${input.policy.version}`;
    for (const id of this.prioritizedChain(input.policy.chain)) {
      if (input.signal?.aborted) throw new Error('cancelled: visual analysis interrupted.');
      const cd = this.cooldowns.get(id);
      if (cd && cd.untilMs > Date.now()) {
        attempts.push({ provider: id, outcome: 'unavailable', detail: `quota_cooldown: ${cd.reason}` });
        continue;
      }
      const provider = this.providers.get(id);
      if (!provider || !provider.capabilities.includes(capability)) { attempts.push({ provider: id, outcome: 'unavailable', detail: `capability ${capability} unavailable` }); continue; }
      const controller = new AbortController();
      const abort = () => controller.abort(input.signal?.reason);
      input.signal?.addEventListener('abort', abort, { once: true });
      const attemptStart = Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const execute = async (): Promise<VisionResult<unknown>> => {
          const size = provider.limits.maxImagesPerCall;
          if (!Number.isInteger(size) || size < 1) throw new Error('invalid batch size');
          const count = capability === 'embed_text' ? input.texts?.length ?? 0 : input.frames?.length ?? 0;
          if (!count) throw new Error('empty vision input');
          if (capability === 'analyze' && count > size) throw new Error(`analyze: ${count} quadros excedem o limite de ${size} por chamada; um trecho não é dividido.`);
          const results: unknown[] = []; const refs: string[] = [];
          let allCached = true; let detected = false;
          for (let offset = 0; offset < count; offset += size) {
            controller.signal.throwIfAborted();
            const frames = input.frames?.slice(offset, offset + size) ?? [];
            const texts = input.texts?.slice(offset, offset + size) ?? [];
            const task: VisionTask = capability.startsWith('embed_') ? 'embed' : capability === 'ocr' ? 'identity' : capability === 'analyze' ? 'describe' : capability as VisionTask;
            const key: VisionCacheKey = { frameHash: createHash('sha256').update(JSON.stringify(capability === 'analyze' ? [capability, frames.map((frame) => [frame.hash, frame.atMs ?? null]), input.context ?? ''] : [capability, frames.map((frame) => frame.hash), texts, input.labels ?? []])).digest('hex'), provider: id, model: provider.model, promptVersion: input.policy.version, task };
            const parse = (value: unknown): unknown => {
              if (capability === 'classify') { const parsed = classification.parse(value); if (!input.labels?.includes(parsed.kind) && parsed.kind !== 'unknown') throw new Error('unrequested label'); return parsed; }
              if (capability === 'describe') return description.parse(value);
              if (capability === 'analyze') return segmentAnalysisSchema.parse(value);
              if (capability === 'ocr') { const parsed = z.array(z.string()).parse(value); if (parsed.length !== frames.length) throw new Error('OCR cardinality'); return parsed; }
              const parsed = vectors.parse(value);
              const dimension = parsed[0]?.length;
              if (dimension === undefined || parsed.length !== (capability === 'embed_text' ? texts.length : frames.length) || parsed.some((vector) => vector.length !== dimension)) throw new Error('embedding cardinality/dimensions');
              return parsed;
            };
            let value: unknown = this.cache.get(key);
            if (value !== null && value !== undefined) { try { value = parse(value); } catch { value = undefined; } }
            if (value === null || value === undefined) {
              allCached = false;
              if (!detected) {
                const availability = await provider.detect(controller.signal);
                detected = true;
                if (!availability.available) {
                  attempts.push({ provider: id, outcome: 'unavailable', detail: availability.reason });
                  return empty();
                }
              }
              const cost = (provider.limits.costPerImageUsd ?? 0) * (capability === 'embed_text' ? texts.length : frames.length);
              if (cost < 0 || !Number.isFinite(cost)) { attempts.push({ provider: id, outcome: 'over_budget', detail: 'invalid provider cost' }); return empty(); }
              const call = async () => {
                switch (capability) {
                  case 'classify': return provider.classify?.({ frames, labels: input.labels ?? [], signal: controller.signal });
                  case 'describe': return provider.describe?.({ frames, signal: controller.signal });
                  case 'embed_image': return provider.embedImage?.({ frames, signal: controller.signal });
                  case 'embed_text': return provider.embedText?.({ texts, signal: controller.signal });
                  case 'ocr': return provider.ocr?.({ frames, signal: controller.signal });
                  case 'analyze': return provider.analyze?.({ frames, ...(input.context ? { context: input.context } : {}), signal: controller.signal });
                }
              };
              value = parse(await this.scheduler.run(async () => {
                if (this.spend.get(budgetKey) + cost > input.policy.budgetUsd + 1e-9) throw new VisionOverBudgetError();
                this.spend.add(budgetKey, cost); costUsd += cost;
                return call();
              }, controller.signal));
              controller.signal.throwIfAborted();
              // A zero-confidence analysis is a failed reading (no image received, unreadable frames): never sticky.
              if (!(capability === 'analyze' && (value as SegmentAnalysis).confidence === 0)) this.cache.put(key, value);
            }
            results.push(value); refs.push(JSON.stringify(key));
          }
          let value: unknown;
          if (capability === 'classify') {
            const votes = results.map((result) => classification.parse(result));
            const winner = [...votes].sort((a, b) => votes.filter((vote) => vote.kind === b.kind).length - votes.filter((vote) => vote.kind === a.kind).length)[0];
            if (!winner) throw new Error('empty classification result');
            value = { kind: winner.kind, confidence: votes.reduce((sum, vote) => sum + (vote.kind === winner.kind ? vote.confidence : 0), 0) / votes.length };
          } else if (capability === 'describe') {
            const descriptions = results.map((result) => description.parse(result));
            value = { description: descriptions.map((result) => result.description).join('\n'), tags: [...new Set(descriptions.flatMap((result) => result.tags))] };
          } else if (capability === 'analyze') value = results[0];
          else value = results.flat();
          const durationMs = Date.now() - attemptStart;
          if (!allCached) {
            this.timeoutFailures.delete(id);
            const t = this.telemetry.get(id) ?? { calls: 0, successes: 0, failures: 0, timeouts: 0, totalLatencyMs: 0 };
            t.calls += 1;
            t.successes += 1;
            t.totalLatencyMs += durationMs;
            this.telemetry.set(id, t);
          }
          attempts.push({ provider: id, outcome: allCached ? 'cached' : 'ok', durationMs });
          return { value, provider: id, model: provider.model, costUsd, attempts, refs, durationMs, ...(capability === 'analyze' && !allCached ? { reportedModel: provider.lastReportedModel?.() ?? null } : {}) };
        };
        const interrupted = new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error(input.signal?.aborted ? 'cancelled: visual analysis interrupted.' : 'vision provider timeout')), { once: true });
          timer = setTimeout(() => controller.abort(), input.policy.maxLatencyMs);
        });
        const result = await Promise.race([execute(), interrupted]);
        if (result.value !== null) return result;
      } catch (error) {
        const durationMs = Date.now() - attemptStart;
        if (input.signal?.aborted) throw new Error('cancelled: visual analysis interrupted.', { cause: error });
        if (error instanceof VisionOverBudgetError) attempts.push({ provider: id, outcome: 'over_budget', durationMs });
        else {
          const detail = error instanceof Error ? error.message : 'provider error';
          const isTimeout = /vision provider timeout|timed out|timeout|ETIMEDOUT|deadline/i.test(detail);
          const t = this.telemetry.get(id) ?? { calls: 0, successes: 0, failures: 0, timeouts: 0, totalLatencyMs: 0 };
          t.calls += 1;
          t.failures += 1;
          if (isTimeout) t.timeouts += 1;
          t.lastError = detail.slice(-160);
          this.telemetry.set(id, t);
          if (isVisionQuotaError(detail)) {
            this.cooldowns.set(id, { untilMs: Date.now() + 10 * 60_000, reason: detail.slice(-160) });
          } else if (isTimeout) {
            const count = (this.timeoutFailures.get(id) ?? 0) + 1;
            this.timeoutFailures.set(id, count);
            if (count >= 2) {
              this.cooldowns.set(id, { untilMs: Date.now() + 10 * 60_000, reason: `timeouts consecutivos (${count}): ${detail}` });
            }
          } else {
            this.timeoutFailures.delete(id);
          }
          attempts.push({ provider: id, outcome: 'error', detail, durationMs });
        }
      } finally { clearTimeout(timer); input.signal?.removeEventListener('abort', abort); }
    }
    return empty();
  }
}

import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import type { AetheraAudioPlan } from '@neuralbridge/shared';
import { runExclusiveRender } from './aethera-visual-scheduler.js';

const exec = promisify(execFile);

const duckExpression = (plan: AetheraAudioPlan): string => plan.ducking.reduce((expression, envelope) => `if(between(t,${(envelope.startMs / 1_000).toFixed(3)},${(envelope.endMs / 1_000).toFixed(3)}),${(10 ** (envelope.gainDb / 20)).toFixed(6)},${expression})`, '1');

/** Builds a deterministic FFmpeg graph: licensed music is ducked at measured word/SFX windows, SFX are frame-aligned, and final bus uses limiter + EBU R128 loudnorm. */
export function buildAetheraAudioFilter(plan: AetheraAudioPlan, hasMusic: boolean): { inputs: string[]; filters: string[]; outputLabel: string } {
  const inputs: string[] = [`[0:a]aresample=48000,volume=${plan.narrationGainDb}dB[narration]`];
  const mixLabels = ['[narration]'];
  let inputIndex = 1;
  if (hasMusic && plan.music) {
    const expression = duckExpression(plan);
    inputs.push(`[${inputIndex}:a]aresample=48000,volume=${plan.musicGainDb}dB,volume='${expression}':eval=frame[music]`);
    mixLabels.push('[music]');
    inputIndex += 1;
  }
  plan.sfx.forEach((event, index) => {
    inputs.push(`[${inputIndex}:a]aresample=48000,adelay=${event.atMs}|${event.atMs},volume=${event.gainDb}dB[sfx${index}]`);
    mixLabels.push(`[sfx${index}]`);
    inputIndex += 1;
  });
  const limiterLinear = Math.min(0.99, Math.max(0.1, 10 ** (plan.truePeakDb / 20))).toFixed(4);
  inputs.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=first:dropout_transition=0,alimiter=limit=${limiterLinear}:attack=5:release=50,loudnorm=I=${plan.targetLufs}:TP=${plan.truePeakDb}:LRA=7:print_format=summary[out]`);
  return { inputs, filters: inputs, outputLabel: '[out]' };
}

export async function renderAetheraAudio(input: { ffmpeg: string; narration: string; music?: string; plan: AetheraAudioPlan; output: string; durationMs: number; signal?: AbortSignal }): Promise<void> {
  await runExclusiveRender(() => renderAetheraAudioUnlocked(input), input.signal);
}

/** Same render without taking the process-wide lease; used by the already-serialized video assembler. */
export async function renderAetheraAudioUnlocked(input: { ffmpeg: string; narration: string; music?: string; plan: AetheraAudioPlan; output: string; durationMs: number; signal?: AbortSignal }): Promise<void> {
  const hasMusic = !!input.music && !!input.plan.music;
  const graph = buildAetheraAudioFilter(input.plan, hasMusic);
  const files = [input.narration, ...(hasMusic && input.music ? [input.music] : []), ...input.plan.sfx.map((event) => event.relativePath)];
  mkdirSync(dirname(input.output), { recursive: true });
  await exec(input.ffmpeg, ['-y', '-v', 'error', ...files.flatMap((file) => ['-i', file]), '-filter_complex', graph.filters.join(';'), '-map', graph.outputLabel, '-t', (input.durationMs / 1_000).toFixed(3), '-c:a', 'aac', '-b:a', '192k', input.output], { windowsHide: true, ...(input.signal ? { signal: input.signal } : {}) } as Parameters<typeof exec>[2]);
}

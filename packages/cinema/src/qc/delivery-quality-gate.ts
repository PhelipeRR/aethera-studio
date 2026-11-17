export interface DeliveryGateProbe {
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  audioCodec: string | null;
  audioSampleRate: number | null;
}

export interface DeliveryGateInput {
  probe: DeliveryGateProbe;
  expected: { width: number; height: number; fps: number; durationSec: number; durationToleranceMs?: number };
  audioFirst?: { completeNarrationPreserved: boolean; measuredNarrationDurationMs: number; finalAudioStreamDurationMs: number | null };
  captions?: { enabled: boolean; coverageEndMs: number; measuredNarrationDurationMs: number; wordCount: number };
  audioSources?: { music: 'asset' | 'missing'; ambience: 'asset' | 'missing'; sfx: 'asset' | 'missing' };
  technicalSample?: boolean;
}

export interface DeliveryGateFinding {
  id: 'file' | 'resolution' | 'fps' | 'duration' | 'audio' | 'narration' | 'captions' | 'real-audio' | 'sample';
  severity: 'block' | 'review';
  message: string;
}

export interface DeliveryQualityGateReport {
  passed: boolean;
  status: 'approved' | 'technical_blocked' | 'needs_review';
  findings: DeliveryGateFinding[];
}

export function evaluateDeliveryQualityGate(input: DeliveryGateInput, options: { requireRealAudio?: boolean } = {}): DeliveryQualityGateReport {
  const findings: DeliveryGateFinding[] = [];
  if (input.probe.width !== input.expected.width || input.probe.height !== input.expected.height) findings.push({ id: 'resolution', severity: 'block', message: `Resolução ${input.probe.width}x${input.probe.height} diverge de ${input.expected.width}x${input.expected.height}.` });
  if (Math.abs(input.probe.fps - input.expected.fps) > 0.1) findings.push({ id: 'fps', severity: 'block', message: `FPS ${input.probe.fps} diverge de ${input.expected.fps}.` });
  const toleranceMs = input.expected.durationToleranceMs ?? 250;
  if (Math.abs(input.probe.durationSec * 1_000 - input.expected.durationSec * 1_000) > toleranceMs) findings.push({ id: 'duration', severity: 'block', message: `Duração ${input.probe.durationSec.toFixed(3)}s diverge do alvo ${input.expected.durationSec.toFixed(3)}s.` });
  if (!input.probe.audioCodec || !input.probe.audioSampleRate) findings.push({ id: 'audio', severity: 'block', message: 'O MP4 não possui stream de áudio mensurável.' });
  if (input.audioFirst && (!input.audioFirst.completeNarrationPreserved || input.audioFirst.finalAudioStreamDurationMs === null || input.audioFirst.finalAudioStreamDurationMs + toleranceMs < input.audioFirst.measuredNarrationDurationMs)) findings.push({ id: 'narration', severity: 'block', message: 'A narração medida não está integralmente presente no stream final.' });
  if (input.captions && (!input.captions.enabled || input.captions.wordCount <= 0 || input.captions.coverageEndMs + toleranceMs < input.captions.measuredNarrationDurationMs)) findings.push({ id: 'captions', severity: 'review', message: 'A cobertura de captions não alcança todas as palavras medidas; requer revisão humana.' });
  if (options.requireRealAudio && (!input.audioSources || Object.values(input.audioSources).some((source) => source !== 'asset'))) findings.push({ id: 'real-audio', severity: 'block', message: 'Produção estrita exige assets reais de música, ambience e SFX.' });
  if (input.technicalSample) findings.push({ id: 'sample', severity: 'review', message: 'O resultado é uma amostra técnica e não representa a produção completa.' });
  const blocked = findings.some((finding) => finding.severity === 'block');
  return { passed: findings.length === 0, status: blocked ? 'technical_blocked' : findings.length > 0 ? 'needs_review' : 'approved', findings };
}


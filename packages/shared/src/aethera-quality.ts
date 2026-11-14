import { z } from 'zod';
import type { ProductionQualityCheck } from './velix-production.js';

const intervalSchema = z.strictObject({ startMs: z.number().nonnegative(), durationMs: z.number().nonnegative() });
const sceneIdSchema = z.string().min(1);

/** Measurements produced by FFmpeg or by the deterministic visual/identity pipeline. No provider output is trusted raw. */
export const qualityDirectorSignalsSchema = z.strictObject({
  silenceIntervals: z.array(intervalSchema).default([]),
  blackIntervals: z.array(intervalSchema).default([]),
  frozenIntervals: z.array(intervalSchema).default([]),
  loudness: z.strictObject({ integratedLufs: z.number(), truePeakDb: z.number(), clippedSamples: z.number().int().nonnegative() }).nullable().default(null),
  captionSyncOffsetsMs: z.array(z.strictObject({ sceneId: sceneIdSchema, offsetMs: z.number() })).default([]),
  subjectMismatches: z.array(z.strictObject({ sceneId: sceneIdSchema, expectedSubjectId: z.string().min(1), observedSubjectId: z.string().min(1).nullable() })).default([]),
  repeatedSegmentIds: z.array(z.string().min(1)).default([]),
  watermarkSceneIds: z.array(sceneIdSchema).default([]),
  identityUnverifiedSceneIds: z.array(sceneIdSchema).default([]),
  unconfirmedSubjectIds: z.array(z.string().min(1)).default([]),
  /** D-AP-17: scenes shown as text/graphics on a flat background although footage of the same subject exists. */
  flatBackgroundSceneIds: z.array(sceneIdSchema).default([]),
});
export type QualityDirectorSignals = z.infer<typeof qualityDirectorSignalsSchema>;

const MAX_SILENCE_MS = 3_000;
const MAX_CAPTION_OFFSET_MS = 250;
const MIN_DEFECT_INTERVAL_MS = 250;
const MIN_LOUDNESS_LUFS = -24;
const MAX_LOUDNESS_LUFS = -9;
const MAX_TRUE_PEAK_DB = -1;

const check = (id: string, label: string, severity: ProductionQualityCheck['severity'], passed: boolean, evidence: string): ProductionQualityCheck => ({ id, label, severity, passed, evidence });

/** Quality Director checks are deterministic and explainable; a clean reference must produce no failed check. */
export function qualityDirectorChecks(input: QualityDirectorSignals): ProductionQualityCheck[] {
  const signals = qualityDirectorSignalsSchema.parse(input);
  const silence = signals.silenceIntervals.filter((item) => item.durationMs >= MAX_SILENCE_MS);
  const black = signals.blackIntervals.filter((item) => item.durationMs >= MIN_DEFECT_INTERVAL_MS);
  const frozen = signals.frozenIntervals.filter((item) => item.durationMs >= MIN_DEFECT_INTERVAL_MS);
  const loudness = signals.loudness;
  const captionSync = signals.captionSyncOffsetsMs.filter((item) => Math.abs(item.offsetMs) > MAX_CAPTION_OFFSET_MS);
  const repeated = [...new Set(signals.repeatedSegmentIds)].filter((id) => signals.repeatedSegmentIds.filter((item) => item === id).length > 1);

  return [
    check('director-silence', 'Sem silêncio longo no áudio', 'blocking', silence.length === 0, silence.length ? `${silence.length} intervalo(s) com pelo menos ${MAX_SILENCE_MS / 1_000} s.` : 'Nenhum silêncio longo detectado.'),
    check('director-black', 'Sem quadro preto prolongado', 'blocking', black.length === 0, black.length ? `${black.length} intervalo(s) preto(s) detectado(s).` : 'Nenhum quadro preto prolongado detectado.'),
    check('director-frozen', 'Sem imagem congelada prolongada', 'blocking', frozen.length === 0, frozen.length ? `${frozen.length} intervalo(s) congelado(s) detectado(s).` : 'Nenhuma imagem congelada prolongada detectada.'),
    check('director-loudness', 'Loudness dentro da faixa segura', 'blocking', !!loudness && loudness.integratedLufs >= MIN_LOUDNESS_LUFS && loudness.integratedLufs <= MAX_LOUDNESS_LUFS && loudness.truePeakDb <= MAX_TRUE_PEAK_DB, loudness ? `${loudness.integratedLufs.toFixed(1)} LUFS; pico ${loudness.truePeakDb.toFixed(1)} dBTP.` : 'Medição EBU R128 indisponível.'),
    check('director-clipping', 'Sem clipping de áudio', 'blocking', !!loudness && loudness.clippedSamples === 0, loudness ? `${loudness.clippedSamples} amostra(s) clipada(s).` : 'Medição de clipping indisponível.'),
    check('director-caption-sync', 'Legendas sincronizadas com a narração', 'blocking', captionSync.length === 0, captionSync.length ? `${captionSync.length} legenda(s) com desvio acima de ${MAX_CAPTION_OFFSET_MS} ms.` : 'Nenhum desvio de legenda acima do limite.'),
    check('director-subject-mismatch', 'Identidade visual corresponde ao jogo da cena', 'blocking', signals.subjectMismatches.length === 0, signals.subjectMismatches.length ? `${signals.subjectMismatches.length} cena(s) associada(s) a outro jogo.` : 'Nenhuma divergência de identidade detectada.'),
    check('director-repeated-segment', 'Trechos visuais não se repetem indevidamente', 'blocking', repeated.length === 0, repeated.length ? `Segmento(s) repetido(s): ${repeated.join(', ')}.` : 'Nenhum segmento repetido detectado.'),
    check('director-watermark', 'Marca d’água avaliada', 'warning', signals.watermarkSceneIds.length === 0, signals.watermarkSceneIds.length ? `${signals.watermarkSceneIds.length} cena(s) com marca d’água para revisão.` : 'Nenhuma marca d’água detectada.'),
    check('director-identity', 'Identidade de cada cena confirmada', 'blocking', signals.identityUnverifiedSceneIds.length === 0, signals.identityUnverifiedSceneIds.length ? `Cena(s) sem identidade confirmada: ${signals.identityUnverifiedSceneIds.join(', ')}.` : 'Todas as cenas exigidas têm identidade confirmada.'),
    check('director-unconfirmed-subject', 'Jogos usados estão confirmados', 'blocking', signals.unconfirmedSubjectIds.length === 0, signals.unconfirmedSubjectIds.length ? `Jogo(s) não confirmado(s): ${signals.unconfirmedSubjectIds.join(', ')}.` : 'Todos os jogos usados estão confirmados.'),
    check('director-flat-background', 'Texto acompanhado de imagens do assunto', 'warning', signals.flatBackgroundSceneIds.length === 0, signals.flatBackgroundSceneIds.length ? `Cena(s) com fundo chapado evitável: ${signals.flatBackgroundSceneIds.join(', ')}.` : 'Nenhum fundo chapado evitável.'),
  ];
}

const TECHNICAL_IDS = new Set(['file', 'resolution', 'aspect', 'fps', 'audio', 'duration', 'captions', 'safe-area', 'director-silence', 'director-black', 'director-frozen', 'director-loudness', 'director-clipping', 'director-caption-sync', 'director-repeated-segment']);
const FACTUAL_IDS = new Set(['rights', 'claims', 'director-subject-mismatch', 'director-identity', 'director-unconfirmed-subject']);

/** Computes only automatic G1/G2; G3 editorial and G4 publication remain explicit human decisions. */
export function gatePassedFromQualityChecks(gate: 'technical' | 'factual' | 'editorial' | 'publication', checks: readonly ProductionQualityCheck[]): boolean {
  const ids = gate === 'technical' ? TECHNICAL_IDS : gate === 'factual' ? FACTUAL_IDS : null;
  if (!ids) return false;
  return checks.filter((item) => ids.has(item.id)).every((item) => item.passed || item.approved === true);
}

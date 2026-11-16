import { describe, expect, it } from 'vitest';
import {
  evaluateProductionContract,
  extractProductionContract,
  recordContractEvidence,
  recordContractRecovery,
  reviseProductionContract,
  type ProductionContractControls,
} from '../src/production-contract.js';

const LONG_BRIEFING = `# TOP 5 Animes com Sistemas de Magia Incríveis para Quem Gostou de Black Clover

**Formato:** Ranking com análise aprofundada
**Duração:** 10 minutos
**Idioma:** Português brasileiro (pt-BR)
**Plataforma:** YouTube — 16:9 — Full HD (1920×1080)

Pesquise fontes oficiais, Crunchyroll e Anime News Network.
Não invente informações, personagens, habilidades ou acontecimentos.
Utilize humor moderado entre 15% e 20% do roteiro.
Dedique aproximadamente 1 minuto e 38 segundos a cada anime.
Use voz jovem, natural e expressiva em português brasileiro.
Faça cortes sincronizados com a narração, com cartelas e comparações visuais.
Use whooshes suaves, partículas mágicas e trilha épica com ducking.
Configure a mixagem em -14 LUFS integrados e -1 dBTP.
Antes de apresentar, verifique a precisão factual, a sincronização e a ausência de mídia corrompida.`;

const MANUAL_CONTROLS: ProductionContractControls = {
  genre: 'gameplay_essay',
  format: 'youtube_16_9',
  targetDurationSec: 720,
  humorIntensity: 35,
  renderProfile: 'review_720p',
  language: 'pt-BR',
  voiceId: 'manual-voice',
};

describe('Production Contract', () => {
  it('extracts explicit requirements from a long briefing without dropping instructions', () => {
    const contract = extractProductionContract({ projectId: 'job_1', prompt: LONG_BRIEFING, now: '2026-11-16T12:00:00.000Z' });

    expect(contract.schemaVersion).toBe(1);
    expect(contract.revision).toBe(1);
    expect(contract.sourcePrompt).toBe(LONG_BRIEFING);
    expect(contract.interpretation.requestedCount).toBe(5);
    expect(contract.controls.genre).toBe('top_list');
    expect(contract.controls.targetDurationSec).toBe(600);
    expect(contract.controls.language).toBe('pt-BR');
    expect(contract.controls.format).toBe('youtube_16_9');

    const categories = new Set(contract.requirements.map((requirement) => requirement.category));
    expect([...categories]).toEqual(expect.arrayContaining([
      'format', 'duration', 'language', 'narrative', 'research', 'narration', 'editing', 'sfx', 'vfx', 'music', 'mixing', 'quality',
    ]));
    expect(contract.requirements.some((requirement) => requirement.sourceText.includes('Não invente informações'))).toBe(true);
    expect(contract.acceptanceCriteria).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: 'duration_sec', target: { exact: 600 } }),
      expect.objectContaining({ metric: 'chapter_count', target: { exact: 5 } }),
      expect.objectContaining({ metric: 'resolution', target: { width: 1920, height: 1080 } }),
      expect.objectContaining({ metric: 'integrated_lufs', target: { exact: -14 } }),
      expect.objectContaining({ metric: 'true_peak_dbtp', target: { exact: -1 } }),
    ]));
  });

  it('preserves manual controls and records conflicts instead of overwriting them', () => {
    const contract = extractProductionContract({
      projectId: 'job_2',
      prompt: LONG_BRIEFING,
      controls: MANUAL_CONTROLS,
      manuallyChangedFields: ['genre', 'targetDurationSec', 'humorIntensity', 'renderProfile'],
      now: '2026-11-16T12:00:00.000Z',
    });

    expect(contract.controls).toMatchObject(MANUAL_CONTROLS);
    expect(contract.conflicts.map((conflict) => conflict.field)).toEqual(expect.arrayContaining([
      'genre',
      'targetDurationSec',
      'humorIntensity',
      'renderProfile',
    ]));
    expect(contract.manualOverrides).toHaveLength(4);
    expect(contract.conflicts.every((conflict) => conflict.resolution === 'manual_value_wins')).toBe(true);
  });

  it('creates a new revision, keeps stable requirement identity, and scopes changed evidence', () => {
    const initial = extractProductionContract({ projectId: 'job_3', prompt: LONG_BRIEFING, now: '2026-11-16T12:00:00.000Z' });
    const researchRequirementId = initial.requirements.find((requirement) => requirement.category === 'research')?.id;
    expect(researchRequirementId).toBeTruthy();

    const revised = reviseProductionContract(initial, {
      prompt: LONG_BRIEFING.replace('10 minutos', '12 minutos'),
      controls: initial.controls,
      reason: 'Usuário alterou a duração do vídeo',
      now: '2026-11-16T12:05:00.000Z',
    });

    expect(revised.previous.revision).toBe(1);
    expect(revised.current.revision).toBe(2);
    expect(revised.current.requirements.find((requirement) => requirement.category === 'research')?.id).toBe(researchRequirementId);
    expect(revised.current.controls.targetDurationSec).toBe(720);
    expect(revised.current.requirements.find((requirement) => requirement.category === 'duration')?.status).toBe('pending');
    expect(revised.current.requirements.flatMap((requirement) => requirement.evidence).every((evidence) => evidence.revision === 2)).toBe(true);
  });

  it('marks measurable requirements with render evidence and blocks non-compliant output', () => {
    const contract = extractProductionContract({ projectId: 'job_4', prompt: LONG_BRIEFING, now: '2026-11-16T12:00:00.000Z' });
    const result = evaluateProductionContract(contract, {
      durationSec: 548,
      chapterCount: 4,
      width: 1280,
      height: 720,
      integratedLufs: -11,
      truePeakDbtp: -0.2,
      mediaIntegrity: true,
      synchronization: false,
      exportParametersValid: true,
      now: '2026-11-16T12:30:00.000Z',
    });

    expect(result.report.blocking).toBe(true);
    expect(result.report.notMetCount).toBeGreaterThanOrEqual(5);
    expect(result.report.humanReviewCount).toBeGreaterThan(0);
    expect(result.contract.requirements.some((requirement) => requirement.status === 'not_met')).toBe(true);
    expect(result.contract.requirements.flatMap((requirement) => requirement.evidence).some((evidence) => evidence.kind === 'measurement')).toBe(true);
  });

  it('keeps stage evidence separate from objective acceptance', () => {
    const contract = extractProductionContract({ projectId: 'job_stage', prompt: 'Vídeo de 5 minutos sobre um jogo.', now: '2026-11-16T12:00:00.000Z' });
    const duration = contract.requirements.find((requirement) => requirement.category === 'duration');
    expect(duration).toBeTruthy();
    const observed = recordContractEvidence(contract, {
      requirementId: duration!.id,
      stage: 'roteiro',
      kind: 'script',
      outcome: 'supports',
      summary: 'O roteiro recebeu a duração alvo como dependência.',
    });
    expect(observed.requirements.find((requirement) => requirement.id === duration!.id)?.status).toBe('in_progress');
    expect(observed.requirements.find((requirement) => requirement.id === duration!.id)?.evidence[0]?.kind).toBe('script');
  });

  it('stops repeated recovery signatures at a finite budget and leaves the requirement blocked', () => {
    const contract = extractProductionContract({ projectId: 'job_5', prompt: LONG_BRIEFING, now: '2026-11-16T12:00:00.000Z' });
    const requirementId = contract.requirements.find((requirement) => requirement.category === 'media')?.id;
    expect(requirementId).toBeTruthy();

    let recovered = recordContractRecovery(contract, { requirementId: requirementId!, signature: 'query:a', action: 'alternate_query', outcome: 'empty', at: '2026-11-16T12:01:00.000Z' });
    recovered = recordContractRecovery(recovered, { requirementId: requirementId!, signature: 'query:a', action: 'alternate_query', outcome: 'empty', at: '2026-11-16T12:02:00.000Z' });
    recovered = recordContractRecovery(recovered, { requirementId: requirementId!, signature: 'query:b', action: 'alternate_query', outcome: 'empty', at: '2026-11-16T12:03:00.000Z' });
    recovered = recordContractRecovery(recovered, { requirementId: requirementId!, signature: 'graphic:c', action: 'explanatory_graphic', outcome: 'pending_human', at: '2026-11-16T12:04:00.000Z' });

    expect(recovered.recovery.attemptsByRequirement[requirementId!]).toHaveLength(3);
    expect(recovered.requirements.find((requirement) => requirement.id === requirementId)?.status).toBe('blocked');
  });
});

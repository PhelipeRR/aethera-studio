import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  auditEditorialScript,
  buildEditorialScript,
  produceCinemaPackage,
  renderRealCinemaMp4,
  verifyEditorialConsistency,
} from '../src/index.js';

const tempDirs: string[] = [];
function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aethera-editorial-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('Editorial Integrity & TTS Consistency', () => {
  it('detects template prose, production jargon, briefing leaks, and repetitive openings', () => {
    const badAudit = auditEditorialScript(
      [
        {
          segmentId: 'seg_1',
          beatId: 'b1',
          stage: 'hook',
          title: 'Cena 1',
          spokenText:
            'Abertura cinematográfica apresentando Título: Top 5 jogos com decupagem e ducking controlado.',
          estimatedDurationSec: 6,
          approved: true,
        },
        {
          segmentId: 'seg_2',
          beatId: 'b2',
          stage: 'progression',
          title: 'Cena 2',
          spokenText:
            'Abertura cinematográfica apresentando outro trecho repetido sem naturalidade.',
          estimatedDurationSec: 6,
          approved: true,
        },
      ],
      ['Evitar jargão técnico na narração'],
    );

    expect(badAudit.passed).toBe(false);
    expect(badAudit.academyRulesRespected).toBe(false);
    expect(badAudit.naturalnessIssues.some((i) => i.code === 'bureaucratic_template')).toBe(true);
    expect(badAudit.naturalnessIssues.some((i) => i.code === 'production_jargon')).toBe(true);
    expect(badAudit.naturalnessIssues.some((i) => i.code === 'briefing_leak')).toBe(true);
    expect(badAudit.naturalnessIssues.some((i) => i.code === 'repetitive_opening')).toBe(true);
  });

  it('produces a real game script, renders narration & MP4, and proves TTS === EditorialScript consistency', async () => {
    const dir = createTempDir();
    const gameSegments = [
      {
        beatId: 'nbeat_1_hook',
        stage: 'hook' as const,
        title: 'Abertura',
        spokenText:
          'Poucos estúdios conseguem transformar um conteúdo adicional em um jogo inteiro, mas Shadow of the Erdtree fez exatamente isso com Elden Ring.',
        estimatedDurationSec: 6,
      },
      {
        beatId: 'nbeat_2_promise',
        stage: 'promise' as const,
        title: 'Contexto',
        spokenText:
          'Hoje vamos analisar por que a Terra das Sombras mudou o ritmo do combate e elevou a barra para qualquer RPG de ação.',
        estimatedDurationSec: 6,
      },
      {
        beatId: 'nbeat_3_progression',
        stage: 'progression' as const,
        title: 'Exploração',
        spokenText:
          'Logo na chegada, o mapa vertical recompensa quem observa cada penhasco e desconfia de qualquer caminho aparentemente vazio.',
        estimatedDurationSec: 6,
      },
      {
        beatId: 'nbeat_4_tension',
        stage: 'tension' as const,
        title: 'Chefes',
        spokenText:
          'Nos confrontos principais, a janela de recuperação diminui e cada erro de posicionamento cobra um preço imediato.',
        estimatedDurationSec: 6,
      },
      {
        beatId: 'nbeat_5_climax',
        stage: 'climax' as const,
        title: 'Clímax',
        spokenText:
          'Quando Messmer entra em cena, a leitura de ritmo e paciência vale mais do que qualquer atributo bruto da ficha.',
        estimatedDurationSec: 6,
      },
      {
        beatId: 'nbeat_6_resolution',
        stage: 'resolution' as const,
        title: 'Conclusão',
        spokenText:
          'No fim, a expansão prova que respeito à inteligência do jogador continua sendo o maior trunfo da FromSoftware.',
        estimatedDurationSec: 6,
      },
    ];

    const editorialScript = buildEditorialScript({
      scriptId: 'elden_ring_editorial_test',
      source: 'agent',
      providerUsed: 'claude-cli',
      treatment: 'Análise direta e envolvente sobre Elden Ring: Shadow of the Erdtree.',
      academyRulesApplied: [
        'Começar com fato forte sem assinatura artificial',
        'Evitar jargão técnico de produção na fala',
      ],
      segments: gameSegments,
    });

    expect(editorialScript.editorialAudit.passed).toBe(true);
    expect(editorialScript.editorialAudit.score).toBe(100);
    expect(editorialScript.editorialAudit.academyRulesRespected).toBe(true);

    const pkg = produceCinemaPackage({
      projectId: 'elden_ring_editorial_e2e',
      prompt: 'Análise de Elden Ring Shadow of the Erdtree',
      genre: 'gameplay_essay',
      format: 'youtube_16_9',
      targetDurationSec: 36,
      humorIntensity: 0,
      editorialScript,
      externalDirection: {
        treatment: editorialScript.treatment,
        beats: gameSegments.map((s) => ({ stage: s.stage, summary: s.spokenText })),
      },
    });
    // This test asserts editorial/TTS identity; the audio-first duration extension is covered separately.
    pkg.timeline.clips = pkg.timeline.clips.slice(0, 1);
    pkg.direction.shots = pkg.direction.shots.slice(0, 1);
    pkg.direction.narrativeBeats = pkg.direction.narrativeBeats.slice(0, 1);

    const render = await renderRealCinemaMp4({
      pkg,
      outputDir: join(dir, 'renders'),
      fileName: 'elden_ring_editorial.mp4',
      useNvenc: false,
    });

    expect(render.probe.durationSec).toBeGreaterThan(10);
    expect(render.narrationTextSent).toBe(editorialScript.fullSpokenText);
    expect(render.editorialConsistency?.consistent).toBe(true);
    expect(render.editorialConsistency?.ttsTextMatchesScript).toBe(true);
    expect(render.editorialConsistency?.discrepancies).toEqual([]);

    const tampered = verifyEditorialConsistency({
      editorialScript,
      ttsTextSent: 'Aethera Studio apresentando texto alterado.',
      timelineClipCount: pkg.timeline.clips.length,
    });
    expect(tampered.consistent).toBe(false);
    expect(tampered.ttsTextMatchesScript).toBe(false);
  }, 120_000);
});

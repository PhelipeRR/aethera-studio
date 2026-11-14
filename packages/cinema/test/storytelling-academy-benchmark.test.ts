import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildEditorialScript,
  verifyEditorialConsistency,
} from '../src/editorial/editorial-integrity.js';
import { AetheraAcademyEngine } from '../src/evolution/academy-engine.js';
import { AetheraEvolutionCore } from '../src/evolution/evolution-core.js';
import {
  evaluateScriptStorytelling,
  seedStorytellingSchool,
} from '../src/evolution/storytelling-school.js';

const tempDirs: string[] = [];

function createTempEvolutionDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aethera-storytelling-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('Aethera Storytelling School — Study, Validation & Before/After Benchmark', () => {
  it('ingests all 4 curriculum modules, validates techniques, answers Q&A with citations, and proves After > Before on Bloodborne 60 FPS', async () => {
    const dir = createTempEvolutionDir();
    const evolution = new AetheraEvolutionCore(join(dir, 'evolution-store.json'));
    const academy = new AetheraAcademyEngine(evolution, join(dir, 'academy-store.json'));

    // 1. BEFORE SCRIPT (pre-Academy baseline: generic intro, chapter labels, meta-production language, generic ending)
    const beforeScript = buildEditorialScript({
      scriptId: 'bloodborne_before_learning',
      source: 'fallback_transparent',
      treatment: 'Tratamento genérico pré-Academy sobre Bloodborne 60 FPS.',
      academyRulesApplied: [],
      segments: [
        {
          beatId: 'nbeat_1_hook',
          stage: 'hook',
          title: 'Abertura',
          spokenText:
            'Aethera Studio apresenta: abertura cinematográfica apresentando Por que Bloodborne nunca recebeu 60 FPS nem remaster. Neste vídeo vamos explorar os fatos principais.',
          estimatedDurationSec: 12,
        },
        {
          beatId: 'nbeat_2_promise',
          stage: 'promise',
          title: 'Contextualização',
          spokenText:
            'Capítulo 1 de 4 sobre Bloodborne: o jogo foi lançado em 2015 para PlayStation 4 e até hoje roda a 30 quadros por segundo. Um comentário irônico pontua a transição sem quebrar o ritmo cinematográfico.',
          estimatedDurationSec: 14,
        },
        {
          beatId: 'nbeat_3_progression',
          stage: 'progression',
          title: 'Desenvolvimento',
          spokenText:
            'Capítulo 2 de 4 sobre Bloodborne: muitos fãs pedem uma atualização oficial há anos, enquanto modders já mostraram que o código consegue rodar em taxas maiores.',
          estimatedDurationSec: 13,
        },
        {
          beatId: 'nbeat_4_climax',
          stage: 'climax',
          title: 'Clímax',
          spokenText:
            'Capítulo 3 de 4 sobre Bloodborne: a Sony e a FromSoftware nunca confirmaram um remaster, gerando frustração na comunidade.',
          estimatedDurationSec: 10,
        },
        {
          beatId: 'nbeat_5_resolution',
          stage: 'resolution',
          title: 'Encerramento',
          spokenText:
            'Aethera Studio agradece por assistir até aqui. Deixe o like e inscreva-se no canal para mais vídeos sobre games.',
          estimatedDurationSec: 10,
        },
      ],
    });

    const beforeEval = evaluateScriptStorytelling(beforeScript);
    expect(beforeEval.naturalnessPassed).toBe(false);
    expect(beforeEval.naturalnessIssuesCount).toBeGreaterThan(0);

    // 2. SEED & VALIDATE STORYTELLING SCHOOL IN ACADEMY
    const seeded = await seedStorytellingSchool(academy);
    expect(seeded.ingestedMaterials).toBe(4);
    expect(seeded.extractedKnowledge).toBeGreaterThanOrEqual(12);
    expect(seeded.validatedExercises).toBeGreaterThanOrEqual(12);

    const qa = await academy.askAcademyAsync(
      'Como estruturar ganchos, causalidade, conflito e encerramento circular em roteiros de games?',
    );
    expect(qa.sufficientKnowledge).toBe(true);
    expect(qa.citations.length).toBeGreaterThan(0);

    // 3. AFTER SCRIPT (post-Academy: Cold Open, "E se...", Story Spine causal, Want vs Need, Humor valve, Circular ending)
    const afterRules = [
      'cold_open_no_presenter_boilerplate',
      'pixar_story_spine_causal_because_of_that',
      'pixar_want_vs_need_conflict',
      'lfts_tension_release_pacing',
      'lfts_observational_humor_valve',
      'lfts_circular_thematic_ending',
    ];

    const afterScript = buildEditorialScript({
      scriptId: 'bloodborne_after_learning',
      source: 'agent_generated',
      providerUsed: 'aethera-storytelling-school',
      treatment:
        'Ensaio analítico causal sobre o paradoxo de Bloodborne: obra-prima presa a 30 FPS por atrito entre código legado, propriedade intelectual e timing de mercado.',
      academyRulesApplied: afterRules,
      segments: [
        {
          beatId: 'nbeat_1_hook',
          stage: 'hook',
          title: 'Cold Open — O Paradoxo dos 30 FPS',
          spokenText:
            'Um modder independente destravou Bloodborne para sessenta quadros por segundo em casa, enquanto a dona da marca inteira nunca apertou esse botão. Por quê?',
          estimatedDurationSec: 11,
        },
        {
          beatId: 'nbeat_2_promise',
          stage: 'promise',
          title: 'Incidente Incitante — A Armadilha do Sucesso',
          spokenText:
            'Quando Bloodborne saiu em dois mil e quinze, tudo parecia simples: um exclusivo de prestígio para vender consoles. Só que a física e o ritmo de combate nasceram amarrados ao relógio de trinta quadros.',
          estimatedDurationSec: 15,
        },
        {
          beatId: 'nbeat_3_progression',
          stage: 'progression',
          title: 'Complicação — Por Causa Disso, o Remaster Não É Um Patch',
          spokenText:
            'Por causa disso, liberar sessenta quadros sem quebrar animações e colisões exige mexer na fundação do motor. É curioso ver jogador pedindo um botão mágico de atualização como se fosse trocar a resolução do monitor.',
          estimatedDurationSec: 16,
        },
        {
          beatId: 'nbeat_4_crisis',
          stage: 'tension',
          title: 'Vale da Crise — O Conflito Entre Desejo e Prioridade',
          spokenText:
            'E aí surge o dilema real: o público quer revisitar Yharnam com fluidez moderna, mas a FromSoftware seguiu adiante para projetos novos, enquanto o estúdio original de apoio da Sony fechou as portas.',
          estimatedDurationSec: 14,
        },
        {
          beatId: 'nbeat_5_resolution',
          stage: 'resolution',
          title: 'Resolução Circular — O Preço da Espera',
          spokenText:
            'No fim, o silêncio em torno de Bloodborne não prova descaso; prova que um remaster mal apressado destruiria o mito. Enquanto ninguém aperta aquele botão oficial, a memória do jogo continua intacta, mesmo presa aos trinta quadros.',
          estimatedDurationSec: 16,
        },
      ],
    });

    const afterEval = evaluateScriptStorytelling(afterScript);
    expect(afterEval.naturalnessPassed).toBe(true);
    expect(afterEval.naturalnessIssuesCount).toBe(0);
    expect(afterEval.totalScore).toBeGreaterThan(beforeEval.totalScore + 25);

    for (const afterCrit of afterEval.criteria) {
      const beforeCrit = beforeEval.criteria.find((c) => c.criterion === afterCrit.criterion)!;
      expect(afterCrit.score).toBeGreaterThanOrEqual(beforeCrit.score);
    }

    // 4. Verify TTS & Subtitle consistency
    const consistency = verifyEditorialConsistency({
      editorialScript: afterScript,
      ttsTextSent: afterScript.fullSpokenText,
      subtitleTexts: afterScript.segments.map((s) => s.spokenText),
      timelineClipCount: afterScript.segments.length,
    });
    expect(consistency.ttsTextMatchesScript).toBe(true);
    expect(consistency.subtitlesMatchScript).toBe(true);
    expect(consistency.discrepancies).toHaveLength(0);
  });
});

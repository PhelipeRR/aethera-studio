import { describe, expect, it } from 'vitest';
import {
  buildEditorialRecoveryPlan,
  buildEditorialScript,
  buildSemanticDecupagem,
  computeIncrementalInvalidation,
  evaluateMediaRelevance,
  interpretProductionPrompt,
  validateEditorialResearchDossier,
  validateScriptAgainstDossier,
  type EditorialResearchDossier,
} from '../src/index.js';

const ELDEN_RING_PROMPT =
  'Crie um vídeo cinematográfico sobre os 10 chefes mais difíceis de Elden Ring, com narrativa épica, humor pontual e duração de 12 minutos.';

const ELDEN_RING_DOSSIER: EditorialResearchDossier = {
  dossierId: 'dossier_elden_ring_top10',
  dossierHash: 'er_top10_v1',
  promptHash: 'p_er_12m',
  workTitle: 'Elden Ring',
  theme: 'Os 10 chefes mais difíceis de Elden Ring',
  rankingCriteria: [
    'Complexidade mecânica e leitura de padrões de ataque',
    'Transições de fase e punição de erros',
    'Agressividade, alcance e pressão sobre o jogador',
    'Consenso histórico de dificuldade na comunidade',
  ],
  entities: [
    {
      entityName: 'Malenia, Blade of Miquella',
      workTitle: 'Elden Ring',
      role: 'Chefe opcional (Elphael)',
      rankPosition: 1,
      verifiedFacts: ['Possui duas barras completas de vida e cura a cada golpe conectado.'],
      mechanicsOrEvents: ['Waterfowl Dance em três rajadas rápidas', 'Scarlet Aeonia na fase 2'],
      attackPatternsOrPhases: ['Fase 1: Blade of Miquella', 'Fase 2: Goddess of Rot'],
      communityConsensus: 'Amplamente considerada a chefe mais difícil do jogo base.',
      uncertainties: ['Variação de dificuldade conforme build de sangramento ou invocação.'],
      sources: [{ title: 'Elden Ring Fextralife Wiki', kind: 'community' }],
    },
    {
      entityName: 'Promised Consort Radahn',
      workTitle: 'Elden Ring',
      role: 'Chefe final da expansão Shadow of the Erdtree',
      rankPosition: 2,
      verifiedFacts: ['Pressiona o jogador com combos gravitacionais e clones de luz na fase 2.'],
      mechanicsOrEvents: ['Ataques gravitacionais em área', 'Combo cruzado e pilares de luz'],
      communityConsensus: 'Considerado o pico de dificuldade da DLC.',
      uncertainties: ['Balanceado por patches pós-lançamento.'],
      sources: [{ title: 'Bandai Namco Patch Notes', kind: 'official' }],
    },
    {
      entityName: 'Maliketh, the Black Blade',
      workTitle: 'Elden Ring',
      role: 'Chefe obrigatório de Crumbling Farum Azula',
      rankPosition: 3,
      verifiedFacts: ['Aplica redução máxima de HP e dano contínuo via Destined Death.'],
      mechanicsOrEvents: ['Destined Death aérea com cortes em arco', 'Transição de Beast Clergyman'],
      uncertainties: [],
      sources: [{ title: 'Elden Ring Wiki', kind: 'community' }],
    },
    {
      entityName: 'Mohg, Lord of Blood',
      workTitle: 'Elden Ring',
      role: 'Semideus em Mohgwyn Palace',
      rankPosition: 4,
      verifiedFacts: ['Executa Bloodboon Ritual ("Nihil") três vezes na transição de fase.'],
      mechanicsOrEvents: ['Bloodboon Ritual Nihil', 'Chamas de Bloodflame na arena'],
      uncertainties: [],
      sources: [{ title: 'Elden Ring Wiki', kind: 'community' }],
    },
    {
      entityName: 'Godfrey, First Elden Lord',
      workTitle: 'Elden Ring',
      role: 'Chefe da Capital Cinzenta',
      rankPosition: 5,
      verifiedFacts: ['Assume a forma Hoarah Loux na fase 2 com agarrões de alto dano.'],
      mechanicsOrEvents: ['Pisões sísmicos em área', 'Agarrões de Hoarah Loux'],
      uncertainties: [],
      sources: [{ title: 'Elden Ring Wiki', kind: 'community' }],
    },
    {
      entityName: 'Radagon of the Golden Order & Elden Beast',
      workTitle: 'Elden Ring',
      role: 'Confronto final do jogo base',
      rankPosition: 6,
      verifiedFacts: ['Luta consecutiva em duas etapas sem descanso entre chefes.'],
      mechanicsOrEvents: ['Martelo sagrado de Radagon', 'Elden Stars teleguiado'],
      uncertainties: [],
      sources: [{ title: 'Elden Ring Wiki', kind: 'community' }],
    },
    {
      entityName: 'Messmer the Impaler',
      workTitle: 'Elden Ring',
      role: 'Chefe central de Shadow Keep',
      rankPosition: 7,
      verifiedFacts: ['Combina lança flamejante com transformações de serpente na fase 2.'],
      mechanicsOrEvents: ['Investidas de Messmer Flame', 'Serpente abissal'],
      uncertainties: [],
      sources: [{ title: 'Elden Ring Wiki', kind: 'community' }],
    },
    {
      entityName: 'Dragonlord Placidusax',
      workTitle: 'Elden Ring',
      role: 'Chefe secreto de Farum Azula',
      rankPosition: 8,
      verifiedFacts: ['Teleporta-se em nuvem de relâmpagos e dispara lasers dourados.'],
      mechanicsOrEvents: ['Placidusax Ruin laser', 'Investida relâmpago invisível'],
      uncertainties: [],
      sources: [{ title: 'Elden Ring Wiki', kind: 'community' }],
    },
    {
      entityName: 'Starscourge Radahn',
      workTitle: 'Elden Ring',
      role: 'Semideus do Festival de Caelid',
      rankPosition: 9,
      verifiedFacts: ['Desce como meteoro da órbita no início da fase 2.'],
      mechanicsOrEvents: ['Entrada em meteoro na fase 2', 'Flechas gravitacionais de longo alcance'],
      uncertainties: [],
      sources: [{ title: 'Elden Ring Wiki', kind: 'community' }],
    },
    {
      entityName: 'Commander Gaius',
      workTitle: 'Elden Ring',
      role: 'Chefe montado em Shadow of the Erdtree',
      rankPosition: 10,
      verifiedFacts: ['Investida inicial rápida e combos combinados com gravidade.'],
      mechanicsOrEvents: ['Investida em javali com hitbox ampla', 'Salto gravitacional'],
      uncertainties: [],
      sources: [{ title: 'Elden Ring Wiki', kind: 'community' }],
    },
  ],
  uncertainties: ['Ordem exata entre posições 5 e 10 varia conforme build do jogador.'],
  sourcesUsed: ['Elden Ring Fextralife Wiki', 'Bandai Namco Patch Notes'],
  providerUsed: 'antigravity-cli',
  createdAt: new Date().toISOString(),
};

describe('Pipeline Research-First & Semantic Decupagem (Elden Ring 12 min)', () => {
  it('interprets Elden Ring prompt, validates 10-boss dossier, generates 12-min script & specific decupagem queries', async () => {
    const interpretation = interpretProductionPrompt(ELDEN_RING_PROMPT, {
      genre: 'top_list',
      targetDurationSec: 720,
      humorIntensity: 35,
      language: 'pt-BR',
    });

    expect(interpretation.workTitle).toBe('Elden Ring');
    expect(interpretation.requestedCount).toBe(10);
    expect(interpretation.targetDurationSec).toBe(720);
    expect(interpretation.rankingCriteria.length).toBeGreaterThanOrEqual(3);

    const dossierCheck = validateEditorialResearchDossier(ELDEN_RING_DOSSIER, interpretation);
    expect(dossierCheck.valid).toBe(true);
    expect(ELDEN_RING_DOSSIER.entities).toHaveLength(10);

    // Build 12-min script mentioning each of the 10 bosses individually
    const script = buildEditorialScript({
      scriptId: 'elden_ring_12m_script',
      source: 'agent',
      providerUsed: 'antigravity-cli',
      treatment: 'Ranking épico e bem-humorado dos 10 chefes mais difíceis de Elden Ring.',
      academyRulesApplied: [],
      segments: [
        {
          segmentId: 'seg_intro',
          beatId: 'nbeat_intro',
          stage: 'hook',
          title: 'Abertura',
          spokenText:
            'Se você acha que já sofreu em Elden Ring, prepare o frasco de Lágrima Carmesim: hoje ranqueamos os 10 chefes mais implacáveis das Terras Intermédias.',
          estimatedDurationSec: 45,
          approved: true,
        },
        ...ELDEN_RING_DOSSIER.entities
          .slice()
          .reverse()
          .map((boss, idx) => ({
            segmentId: `seg_boss_${idx + 1}`,
            beatId: `nbeat_boss_${idx + 1}`,
            stage: (idx === 9 ? 'climax' : 'progression') as 'climax' | 'progression',
            title: `#${boss.rankPosition} ${boss.entityName}`,
            spokenText: `Na posição ${boss.rankPosition}, ${boss.entityName} testa seus reflexos com ${boss.mechanicsOrEvents[0]}. ${boss.verifiedFacts[0]}`,
            estimatedDurationSec: 63,
            approved: true,
          })),
        {
          segmentId: 'seg_outro',
          beatId: 'nbeat_outro',
          stage: 'resolution',
          title: 'Encerramento',
          spokenText:
            'De Commander Gaius a Malenia, cada derrota em Elden Ring ensina um padrão novo. Qual chefe tirou mais horas do seu save?',
          estimatedDurationSec: 45,
          approved: true,
        },
      ],
    });

    const scriptCheck = validateScriptAgainstDossier(script, ELDEN_RING_DOSSIER, interpretation);
    expect(scriptCheck.valid).toBe(true);
    expect(scriptCheck.missingEntities).toEqual([]);

    const decupagem = buildSemanticDecupagem(script, ELDEN_RING_DOSSIER, interpretation);
    expect(decupagem).toHaveLength(12);
    const totalPlannedSec = decupagem.reduce((s, c) => s + c.durationSec, 0);
    expect(totalPlannedSec).toBeGreaterThanOrEqual(700);
    expect(totalPlannedSec).toBeLessThanOrEqual(740);

    // Every boss scene must have specific queries and NEVER repeat the raw prompt
    const maleniaScene = decupagem.find((c) => c.entities.includes('Malenia, Blade of Miquella'));
    expect(maleniaScene).toBeDefined();
    expect(maleniaScene?.mediaQueries[0]).toContain('Malenia');
    expect(maleniaScene?.mediaQueries.some((q) => q.includes('Elden Ring'))).toBe(true);
    for (const scene of decupagem) {
      for (const q of scene.mediaQueries) {
        expect(q.toLowerCase()).not.toContain('crie um vídeo cinematográfico');
      }
    }

    // Scene Grounding validates Malenia clip and rejects wrong-boss clip
    const maleniaMatch = await evaluateMediaRelevance(
      {
        mediaId: 'vid_malenia',
        uri: 'memory://malenia.mp4',
        title: 'Elden Ring Malenia Blade of Miquella Waterfowl Dance Boss Fight',
        origin: 'yt_dlp',
        durationSec: 45,
      },
      {
        segmentId: maleniaScene!.sceneId,
        prompt: ELDEN_RING_PROMPT,
        genre: 'gameplay_essay',
        narrationText: maleniaScene!.narrationText,
        expectedEntities: maleniaScene!.matchingCriteria.requiredEntities,
        expectedActions: maleniaScene!.matchingCriteria.expectedActions,
      },
      {
        requireVisualVerification: true,
        analyzeFrames: async () => [
          {
            timestampSec: 4,
            visualCategory: 'gameplay',
            detectedEntities: ['malenia', 'elden ring'],
            detectedActions: ['waterfowl dance'],
            description: 'Gameplay de Elden Ring mostrando Malenia em luta de chefe executando Waterfowl Dance.',
            confidence: 0.91,
          },
          {
            timestampSec: 10,
            visualCategory: 'gameplay',
            detectedEntities: ['malenia', 'elden ring'],
            detectedActions: ['waterfowl dance'],
            description: 'Malenia na arena da Árvore Sacra durante luta de chefe.',
            confidence: 0.89,
          },
        ],
      },
    );
    expect(maleniaMatch.accepted).toBe(true);
    expect(maleniaMatch.matchedIntervals[0]?.provingTimestampsSec).toEqual([4, 10]);

    // Editorial recovery never authorizes Motion Visual automatically
    const recovery = buildEditorialRecoveryPlan(maleniaScene!, maleniaScene!.mediaQueries);
    expect(recovery).toHaveLength(5);
    expect(recovery.every((r) => r.autoApproveMotionVisual === false)).toBe(true);

    // Incremental invalidation preserves unchanged scenes when script/dossier unchanged
    const sameCheck = computeIncrementalInvalidation({
      previousPromptHash: interpretation.promptHash,
      nextInterpretation: interpretation,
      previousDossier: ELDEN_RING_DOSSIER,
      nextDossier: ELDEN_RING_DOSSIER,
      previousScenes: decupagem,
      nextScenes: decupagem,
    });
    expect(sameCheck.researchValid).toBe(true);
    expect(sameCheck.scriptValid).toBe(true);
    expect(sameCheck.decupagemValid).toBe(true);
    expect(sameCheck.validSceneIds).toHaveLength(12);
    expect(sameCheck.invalidatedSceneIds).toEqual([]);
  });
});

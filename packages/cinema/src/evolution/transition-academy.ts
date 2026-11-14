import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TimelineTransition } from '../ir/timeline-ir.js';
import type { LearningState } from './evolution-core.js';
import type { AetheraAcademyEngine } from './academy-engine.js';

export type TransitionCategory =
  | 'narrative_cinematic'
  | 'anime_amv'
  | 'games_tech'
  | 'documentary_storytelling'
  | 'motion_graphics_advanced';

export type TransitionGenre =
  | 'anime'
  | 'amv'
  | 'games'
  | 'documentary'
  | 'trailer'
  | 'curiosities'
  | 'ranking'
  | 'motion_graphics'
  | 'suspense';

export type NarrativeDeltaKind =
  | 'continuity'
  | 'topic_shift'
  | 'time_skip'
  | 'climax_impact'
  | 'comparison'
  | 'reveal'
  | 'emotional_beat';

export interface TransitionTechniqueSpec {
  techniqueId: string;
  name: string;
  category: TransitionCategory;
  timelineKind: TimelineTransition['kind'];
  ffmpegXfade?: string;
  recommendedFrames30fps: [number, number];
  sfxCue: string;
  principle: string;
  usageContexts: string[];
  contraindications: string[];
  validationState: LearningState;
}

const t = (
  techniqueId: string,
  name: string,
  category: TransitionCategory,
  timelineKind: TimelineTransition['kind'],
  recommendedFrames30fps: [number, number],
  sfxCue: string,
  principle: string,
  usageContexts: string[],
  contraindications: string[],
  ffmpegXfade?: string,
): TransitionTechniqueSpec => ({
  techniqueId,
  name,
  category,
  timelineKind,
  ...(ffmpegXfade ? { ffmpegXfade } : {}),
  recommendedFrames30fps,
  sfxCue,
  principle,
  usageContexts,
  contraindications,
  validationState: 'proposed',
});

/**
 * 60-technique Aethera Transition Academy catalog (12 per category A-E).
 * All entries start in `studied` state until verified by real lab experiments.
 */
export const TRANSITION_TECHNIQUE_CATALOG: readonly TransitionTechniqueSpec[] = [
  // A. Cortes narrativos e cinematográficos (12)
  t('hard_cut', 'Hard Cut', 'narrative_cinematic', 'cut', [0, 0], 'cut_breath', 'Invisibilidade gramatical que preserva ritmo e atenção na narrativa.', ['continuity', 'topic_shift', 'dialogue'], ['Evitar jump involuntário no mesmo eixo']),
  t('match_cut', 'Match Cut', 'narrative_cinematic', 'match_cut', [0, 8], 'whoosh_soft', 'Continuidade geométrica ou conceitual conectando duas realidades.', ['time_skip', 'reveal'], ['Sem âncora visual compatível']),
  t('action_match', 'Action Match', 'narrative_cinematic', 'match_cut', [0, 0], 'whoosh_soft', 'O olho segue o arco do movimento tornando o corte imperceptível.', ['continuity', 'climax_impact'], ['Ações descontínuas']),
  t('graphic_match', 'Graphic Match', 'narrative_cinematic', 'match_cut', [6, 14], 'riser_soft', 'Formas ou silhuetas idênticas criam ponte poética.', ['emotional_beat', 'reveal'], ['Silhuetas incompatíveis'], 'fade'),
  t('smash_cut', 'Smash Cut', 'narrative_cinematic', 'cut', [0, 0], 'impact_sub', 'Contraste abrupto de energia ou silêncio gera choque ou humor.', ['climax_impact', 'reveal'], ['Uso excessivo (>2x por vídeo)']),
  t('jump_cut', 'Jump Cut', 'narrative_cinematic', 'cut', [0, 0], 'cut_breath', 'Supressão de pausas injeta urgência e dinamismo.', ['topic_shift', 'curiosities'], ['Narração contemplativa']),
  t('j_cut', 'J-Cut', 'narrative_cinematic', 'j_cut', [12, 30], 'ambient_lead', 'Áudio da Cena B antecipa a imagem puxando a atenção suavemente.', ['topic_shift', 'documentary'], ['Troca brusca sem pausa de fala']),
  t('l_cut', 'L-Cut', 'narrative_cinematic', 'l_cut', [12, 30], 'ambient_tail', 'Áudio da Cena A continua sobre a Cena B mantendo coesão vocal.', ['continuity', 'broll'], ['Cena B com diálogo concorrente']),
  t('cross_dissolve', 'Cross Dissolve', 'narrative_cinematic', 'dissolve', [15, 24], 'pad_swell', 'Sobreposição gradual comunica passagem de tempo ou reflexão.', ['time_skip', 'emotional_beat'], ['Ritmo frenético / AMV rápido'], 'dissolve'),
  t('fade_to_black', 'Fade to Black', 'narrative_cinematic', 'dissolve', [18, 30], 'silence_tail', 'Fechamento definitivo de ato e respiração dramática.', ['time_skip', 'act_end'], ['Cortes comuns (risco de parecer black frame)'], 'fadeblack'),
  t('fade_to_white', 'Fade to White', 'narrative_cinematic', 'dissolve', [15, 24], 'chime_swell', 'Clarão emocional para memórias, revelações ou transcendência.', ['emotional_beat', 'flashback'], ['Excesso em telas HDR / fotossensibilidade'], 'fadewhite'),
  t('dip_to_color', 'Dip to Color', 'narrative_cinematic', 'dissolve', [12, 20], 'sub_drop', 'Pulso cromático temático alinhado à paleta da obra.', ['trailer', 'tone_shift'], ['Cores fora da paleta'], 'fade'),

  // B. Anime e AMV (12)
  t('impact_cut', 'Impact Cut', 'anime_amv', 'cut', [0, 4], 'impact_punch', 'Corte no frame exato de colisão amplia força cinética.', ['climax_impact', 'anime', 'amv'], ['Sem batida ou golpe real']),
  t('white_flash', 'White Flash', 'anime_amv', 'dissolve', [3, 6], 'impact_bright', 'Descarga luminosa breve reforça transformação ou golpe crítico.', ['climax_impact', 'anime'], ['Frequência > 3 Hz (epilepsy QC)'], 'fadewhite'),
  t('black_flash', 'Black Flash', 'anime_amv', 'dissolve', [2, 5], 'sub_drop', 'Micro-escurecimento cria contraste antes do impacto.', ['climax_impact', 'trailer'], ['Duração > 6 frames (parece erro)'], 'fadeblack'),
  t('impact_shake', 'Impact Shake', 'anime_amv', 'cut', [6, 10], 'rumble_impact', 'Vibração amortecida transmite onda de choque física.', ['climax_impact', 'anime'], ['Texto pequeno na tela']),
  t('directional_shake', 'Directional Shake', 'anime_amv', 'cut', [5, 8], 'whoosh_heavy', 'Empurrão vetorial acompanha direção do golpe.', ['climax_impact', 'anime'], ['Vetor contrário ao golpe']),
  t('zoom_punch', 'Zoom Punch', 'anime_amv', 'wipe', [6, 10], 'riser_impact', 'Aproximação rápida empurra o espectador para dentro da ação.', ['climax_impact', 'amv'], ['Mídia abaixo de 720p'], 'zoomin'),
  t('speed_ramp', 'Speed Ramp', 'anime_amv', 'match_cut', [10, 16], 'whoosh_sweep', 'Aceleração na saída e desaceleração na entrada criam fluidez sakuga.', ['continuity', 'amv', 'games'], ['Clipes < 24fps sem motion blur']),
  t('velocity_edit', 'Velocity Edit', 'anime_amv', 'cut', [4, 8], 'beat_hit', 'Pulsos de velocidade travados no BPM da música.', ['amv', 'climax_impact'], ['Vídeos falados/documentários']),
  t('rgb_split', 'RGB Split', 'anime_amv', 'cut', [4, 8], 'glitch_zap', 'Separação cromática simula sobrecarga de energia.', ['climax_impact', 'amv'], ['Sobre legendas centrais']),
  t('chromatic_aberration', 'Chromatic Aberration', 'anime_amv', 'dissolve', [6, 12], 'whoosh_glass', 'Distorção óptica periférica sutil adiciona peso dramático.', ['emotional_beat', 'climax_impact'], ['Excesso contínuo']),
  t('energy_wipe', 'Energy Wipe', 'anime_amv', 'wipe', [8, 14], 'energy_whoosh', 'Varredura luminosa conecta ataques de energia.', ['climax_impact', 'anime'], ['Cenas sem elemento luminoso'], 'smoothleft'),
  t('manga_panel_transition', 'Manga Panel Transition', 'anime_amv', 'wipe', [12, 18], 'paper_whoosh', 'Divisão em quadros remete à linguagem de mangá.', ['topic_shift', 'anime'], ['Cortar rostos ao meio'], 'diagtl'),

  // C. Games e tecnologia (12)
  t('glitch_cut', 'Glitch Cut', 'games_tech', 'wipe', [4, 8], 'glitch_burst', 'Ruptura digital comunica falha de sistema ou virada sci-fi.', ['topic_shift', 'games', 'tech'], ['Documentário histórico/orgânico'], 'pixelize'),
  t('digital_distortion', 'Digital Distortion', 'games_tech', 'dissolve', [6, 10], 'digital_static', 'Deformação de sinal prepara revelação técnica.', ['reveal', 'tech'], ['Texto fino ilegível'], 'fade'),
  t('pixel_sorting', 'Pixel Sorting', 'games_tech', 'dissolve', [10, 16], 'shimmer_digital', 'Dissolução por luminância cria estética futurista.', ['reveal', 'games'], ['Alto custo CPU sem GPU'], 'pixelize'),
  t('scanline_wipe', 'Scanline Wipe', 'games_tech', 'wipe', [8, 14], 'ui_sweep', 'Varredura estilo monitor tático para reviews e rankings.', ['ranking', 'games'], ['Texto fino em 9:16'], 'hlslice'),
  t('hud_transition', 'HUD Transition', 'games_tech', 'wipe', [10, 16], 'ui_lock_beep', 'Elementos de visor/interface guiam a troca de cena.', ['games', 'ranking'], ['Cobrir legenda central'], 'smoothleft'),
  t('datamosh_style', 'Datamosh-style Effect', 'games_tech', 'dissolve', [8, 14], 'glitch_warp', 'Fusão surreal de vetores entre cenas experimentais.', ['amv', 'games'], ['Vídeos corporativos/sérios'], 'hblur'),
  t('camera_whip', 'Camera Whip', 'games_tech', 'wipe', [6, 10], 'whip_pan_whoosh', 'Panorâmica rápida com blur direcional conecta cenários.', ['topic_shift', 'games', 'curiosities'], ['Direção inconsistente'], 'smoothright'),
  t('cross_zoom', 'Cross Zoom', 'games_tech', 'wipe', [8, 14], 'whoosh_zoom', 'Zoom contínuo une dois espaços distintos com energia.', ['topic_shift', 'games'], ['Mídia de baixa resolução'], 'zoomin'),
  t('radial_blur', 'Radial Blur', 'games_tech', 'wipe', [8, 12], 'riser_wind', 'Desfoque centrífugo foca o olhar no novo plano.', ['reveal', 'games'], ['Uso consecutivo repetido'], 'radial'),
  t('displacement_transition', 'Displacement Transition', 'games_tech', 'dissolve', [10, 16], 'whoosh_liquid', 'Mapa de luminância distorce a imagem na troca.', ['games', 'fantasy'], ['Sem mapa compatível'], 'dissolve'),
  t('pixel_dissolve', 'Pixel Dissolve', 'games_tech', 'dissolve', [10, 16], '8bit_blip', 'Blocos de pixels se recompõem em estética retrô.', ['games', 'ranking'], ['Live-action dramático'], 'pixelize'),
  t('hud_reveal', 'HUD Reveal', 'games_tech', 'wipe', [10, 16], 'ui_open_chime', 'Abertura geométrica tipo visor revela novo item do ranking.', ['ranking', 'games'], ['Baixo contraste no título'], 'horzopen'),

  // D. Documentários e storytelling (12)
  t('film_burn', 'Film Burn', 'documentary_storytelling', 'dissolve', [14, 22], 'tape_crackle', 'Queima orgânica evoca memória e material de arquivo.', ['time_skip', 'documentary'], ['Vídeos tech modernos'], 'fade'),
  t('light_leak', 'Light Leak', 'documentary_storytelling', 'dissolve', [14, 24], 'shimmer_warm', 'Vazamento quente suaviza passagem íntima ou nostálgica.', ['emotional_beat', 'documentary'], ['Legendas brancas sem sombra'], 'dissolve'),
  t('iris_wipe', 'Iris Wipe', 'documentary_storytelling', 'wipe', [14, 22], 'soft_whoosh', 'Fechamento circular isola detalhe narrativo clássico.', ['reveal', 'documentary'], ['Uso repetido'], 'circleclose'),
  t('luma_wipe', 'Luma Wipe', 'documentary_storytelling', 'wipe', [14, 24], 'ambient_lead', 'Regiões de luz revelam a próxima cena organicamente.', ['documentary', 'nature'], ['Cenas totalmente escuras'], 'distance'),
  t('masked_reveal', 'Masked Reveal', 'documentary_storytelling', 'wipe', [10, 18], 'whoosh_air', 'Elemento físico da cena funciona como cortina natural.', ['continuity', 'documentary'], ['Sem objeto oclusor'], 'wipeleft'),
  t('parallax_transition', 'Parallax Transition', 'documentary_storytelling', 'wipe', [16, 26], 'wind_whoosh', 'Camadas deslizam em velocidades distintas gerando profundidade.', ['documentary', 'chapter'], ['Asset único sem separação'], 'smoothleft'),
  t('rack_focus_blur', 'Rack-Focus-Style Blur', 'documentary_storytelling', 'dissolve', [12, 18], 'pad_swell', 'Desfoque óptico em rampa simula troca real de lente.', ['emotional_beat', 'suspense'], ['Leitura imediata de texto'], 'hblur'),
  t('time_lapse_bridge', 'Time-Lapse Bridge', 'documentary_storytelling', 'dissolve', [18, 30], 'clock_tick', 'Aceleração temporal conecta dois momentos do mesmo local.', ['time_skip', 'documentary'], ['Locais sem âncora comum'], 'dissolve'),
  t('environmental_wipe', 'Environmental Wipe', 'documentary_storytelling', 'wipe', [12, 20], 'wind_whoosh', 'Nuvem, fumaça ou folhagem limpa o quadro naturalmente.', ['documentary', 'adventure'], ['Sem elemento móvel'], 'smoothright'),
  t('foreground_object_wipe', 'Foreground Object Wipe', 'documentary_storytelling', 'wipe', [8, 14], 'whoosh_passby', 'Objeto em primeiro plano cruza a lente ocultando o corte.', ['continuity', 'documentary'], ['Sem movimento lateral'], 'wiperight'),
  t('whip_match', 'Whip Match', 'documentary_storytelling', 'match_cut', [6, 10], 'whip_pan_whoosh', 'Chicote termina na mesma cor ou posição na Cena B.', ['topic_shift', 'travel'], ['Inversão brusca de eixo'], 'smoothleft'),
  t('morph_transition', 'Morph Transition', 'documentary_storytelling', 'dissolve', [16, 24], 'morph_synth', 'Transformação contínua conecta evolução de conceito.', ['comparison', 'documentary'], ['Rostos humanos (uncanny)'], 'dissolve'),

  // E. Motion graphics avançados (12)
  t('shape_wipe', 'Shape Wipe', 'motion_graphics_advanced', 'wipe', [10, 16], 'ui_swipe_clean', 'Formas geométricas limpas estruturam mudança de capítulo.', ['ranking', 'motion_graphics'], ['Drama realista'], 'rectcrop'),
  t('liquid_wipe', 'Liquid Wipe', 'motion_graphics_advanced', 'wipe', [12, 20], 'liquid_whoosh', 'Onda fluida suaviza transições gráficas criativas.', ['motion_graphics', 'curiosities'], ['Paletas conflitantes'], 'smoothup'),
  t('particle_dissolve', 'Particle Dissolve', 'motion_graphics_advanced', 'dissolve', [14, 22], 'shimmer_particles', 'Cena ou título se desfaz em partículas direcionais.', ['reveal', 'outro'], ['60fps CPU sem cache'], 'dissolve'),
  t('typography_morph', 'Typography Morph', 'motion_graphics_advanced', 'match_cut', [12, 20], 'type_whoosh', 'Palavra-chave anterior se transforma no título seguinte.', ['ranking', 'motion_graphics'], ['Texto ilegível em movimento'], 'fade'),
  t('3d_cube', '3D Cube', 'motion_graphics_advanced', 'wipe', [14, 20], 'mechanical_turn', 'Rotação 3D alterna blocos ou perspectivas A vs B.', ['comparison', 'ranking'], ['Uso excessivo estilo slide'], 'slideleft'),
  t('perspective_flip', 'Perspective Flip', 'motion_graphics_advanced', 'wipe', [12, 18], 'card_flip_whoosh', 'Giro de cartão 3D revela fato ou verso.', ['curiosities', 'comparison'], ['Texto longo girando rápido'], 'horzopen'),
  t('split_screen_reveal', 'Split-Screen Reveal', 'motion_graphics_advanced', 'wipe', [12, 20], 'slide_click', 'Divisão comparativa antes de expandir a Cena B.', ['comparison', 'analysis'], ['9:16 estreito em split vertical'], 'vertopen'),
  t('seamless_zoom', 'Seamless Zoom', 'motion_graphics_advanced', 'match_cut', [14, 24], 'riser_deep', 'Mergulho exponencial contínuo através de ponto focal.', ['trailer', 'curiosities'], ['Centro desfocado'], 'zoomin'),
  t('camera_tracking_transition', 'Camera-Tracking Transition', 'motion_graphics_advanced', 'match_cut', [10, 18], 'whoosh_track', 'Movimento virtual ancora título ao vetor real da câmera.', ['documentary', 'trailer'], ['Sem vetor confiável'], 'smoothleft'),
  t('3d_parallax', '3D Parallax', 'motion_graphics_advanced', 'wipe', [14, 22], 'deep_whoosh', 'Múltiplos planos em profundidade Z durante a troca.', ['chapter', 'motion_graphics'], ['Asset único plano'], 'smoothright'),
  t('elastic_slide', 'Elastic Slide', 'motion_graphics_advanced', 'wipe', [10, 16], 'pop_whoosh', 'Deslizamento com overshoot elástico traz leveza e humor.', ['curiosities', 'comedy'], ['Documentário sério ou suspense'], 'slideright'),
  t('ripple_transition', 'Ripple Transition', 'motion_graphics_advanced', 'dissolve', [14, 22], 'dream_chime', 'Ondulação concêntrica remete a sonho, memória ou portal.', ['emotional_beat', 'fantasy'], ['Legenda central ativa'], 'radial'),
];

const byId = new Map(TRANSITION_TECHNIQUE_CATALOG.map((item) => [item.techniqueId, item]));

export interface TransitionDecisionInput {
  genre: TransitionGenre;
  narrativeDelta: NarrativeDeltaKind;
  emotionalIntensity: number; // 0..1
  hasBeatHit?: boolean;
  narrationGapMs?: number;
  previousTransitionId?: string | null;
  hasActiveCaptionInCenter?: boolean;
  fps?: 30 | 60;
}

export interface TransitionDecisionResult {
  technique: TransitionTechniqueSpec;
  timelineKind: TimelineTransition['kind'];
  durationSec: number;
  sfxCue: string;
  whyBetterThanHardCut: string;
  validationState: LearningState;
}

/**
 * Intelligent Transition Director:
 * Treats `hard_cut` as first-class default and selects a stylized transition ONLY
 * when narrative delta, rhythm, audio/beat sync, and safety constraints justify it.
 */
export function recommendTransitionDecision(
  input: TransitionDecisionInput,
): TransitionDecisionResult {
  const fps = input.fps ?? 30;
  const pick = (id: string, why: string): TransitionDecisionResult => {
    const spec = byId.get(id) ?? byId.get('hard_cut')!;
    const avgFrames = Math.round((spec.recommendedFrames30fps[0] + spec.recommendedFrames30fps[1]) / 2);
    const durationSec = Number((avgFrames / 30).toFixed(2));
    return {
      technique: spec,
      timelineKind: spec.timelineKind,
      durationSec,
      sfxCue: spec.sfxCue,
      whyBetterThanHardCut: why,
      validationState: spec.validationState,
    };
  };

  // Anti-repetition guard: never repeat the same stylized transition back-to-back
  const blockedRepeat = (id: string) => input.previousTransitionId === id && id !== 'hard_cut';

  // 1. Continuity within same subject/scene -> hard cut is almost always superior
  if (input.narrativeDelta === 'continuity' && !input.hasBeatHit) {
    if ((input.narrationGapMs ?? 0) >= 350 && input.genre === 'documentary') {
      return pick(
        'l_cut',
        'L-cut mantém a continuidade vocal da narração sobre a entrada do B-roll, evitando quebra seca de contexto.',
      );
    }
    return pick(
      'hard_cut',
      `Corte seco (0 frames @${fps}fps) preserva invisibilidade gramatical e ritmo natural sem efeito artificial.`,
    );
  }

  // 2. Climax / Impact
  if (input.narrativeDelta === 'climax_impact') {
    if ((input.genre === 'anime' || input.genre === 'amv') && input.hasBeatHit) {
      const candidate =
        input.emotionalIntensity >= 0.85 && !input.hasActiveCaptionInCenter && !blockedRepeat('white_flash')
          ? 'white_flash'
          : !blockedRepeat('impact_cut')
            ? 'impact_cut'
            : 'hard_cut';
      if (candidate === 'white_flash') {
        return pick(
          'white_flash',
          'White flash curto (<0.18s) sincronizado à batida amplifica o impacto de transformação/golpe muito além de um corte seco.',
        );
      }
      if (candidate === 'impact_cut') {
        return pick(
          'impact_cut',
          'Impact cut alinhado ao pico sonoro reforça a colisão cinética sem degradar legibilidade.',
        );
      }
    }
    if (input.genre === 'trailer' && !blockedRepeat('smash_cut')) {
      return pick(
        'smash_cut',
        'Smash cut com sub-drop cria contraste dramático imediato superior a uma transição suave.',
      );
    }
  }

  // 3. Topic shift / Ranking / Reveal
  if (input.narrativeDelta === 'topic_shift' || input.narrativeDelta === 'reveal') {
    if (input.genre === 'documentary' || input.genre === 'suspense') {
      if (!blockedRepeat('j_cut')) {
        return pick(
          'j_cut',
          'J-cut antecipa a atmosfera da próxima cena antes do corte visual, guiando o espectador melhor que um corte seco abrupto.',
        );
      }
    }
    if ((input.genre === 'ranking' || input.genre === 'motion_graphics') && !blockedRepeat('hud_reveal')) {
      const id = input.genre === 'ranking' ? 'hud_reveal' : 'shape_wipe';
      if (!blockedRepeat(id)) {
        return pick(
          id,
          `${id === 'hud_reveal' ? 'HUD Reveal' : 'Shape Wipe'} sinaliza claramente a mudança de item/capítulo no ranking.`,
        );
      }
    }
    if (input.genre === 'games' && input.emotionalIntensity >= 0.65 && !blockedRepeat('camera_whip')) {
      return pick(
        'camera_whip',
        'Camera whip mantém energia cinética entre cenas de gameplay diferentes onde um corte seco perderia momentum.',
      );
    }
  }

  // 4. Time skip / Emotional beat
  if (input.narrativeDelta === 'time_skip' || input.narrativeDelta === 'emotional_beat') {
    if (input.genre === 'documentary' || input.genre === 'anime' || input.genre === 'trailer') {
      if (input.narrativeDelta === 'time_skip' && !blockedRepeat('cross_dissolve')) {
        return pick(
          'cross_dissolve',
          'Cross dissolve comunica passagem de tempo de forma orgânica, evitando que um corte seco pareça continuidade imediata.',
        );
      }
      if (input.emotionalIntensity >= 0.75 && !blockedRepeat('fade_to_black')) {
        return pick(
          'fade_to_black',
          'Fade to black oferece respiração dramática de encerramento de ato impossível num corte seco.',
        );
      }
    }
  }

  // 5. Comparison
  if (input.narrativeDelta === 'comparison' && !input.hasActiveCaptionInCenter && !blockedRepeat('split_screen_reveal')) {
    return pick(
      'split_screen_reveal',
      'Split-screen reveal permite comparar Cena A e Cena B lado a lado antes da transição completa.',
    );
  }

  return pick(
    'hard_cut',
    `Corte seco é a escolha editorial mais limpa aqui: nenhuma transição estilizada agregaria clareza narrativa superior.`,
  );
}

export async function registerTransitionAcademyCurriculum(academy: AetheraAcademyEngine): Promise<{
  imported: boolean;
  materialId?: string;
}> {
  const here = dirname(fileURLToPath(import.meta.url));
  const curriculumPath = join(here, '..', '..', 'academy-curriculum', '05_aethera_transition_academy.md');
  if (!existsSync(curriculumPath)) {
    return { imported: false };
  }
  const content = readFileSync(curriculumPath, 'utf8');
  const rec = await academy.ingestMaterial({
    title: 'Aethera Transition Academy — Currículo de Transições Cinematográficas',
    kind: 'document',
    sourceUri: curriculumPath,
    author: 'Aethera Academy',
    license: 'Propriedade Editorial Aethera Studio',
    rightsScope: 'reusable_owned',
    mode: 'study',
    manualDirectors: ['cinematography_director', 'editing_director', 'sound_director', 'vfx_director', 'motion_director'],
    textContent: content,
  });
  return { imported: true, materialId: rec.material.materialId };
}

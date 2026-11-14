import { portugueseNumber, type StoryboardScene } from '@neuralbridge/shared';
import { resolveTitleMentions, type VisualTitleCandidate } from './visual-index.js';

/**
 * AP-02: which game each scene talks about, inferred only from what is said — the titles named in the narration, spread
 * to the scenes of a chapter that names a single game. Deterministic; a scene that names two games, or none in a chapter
 * without a single game, stays without a game for a person to decide. A game a person already chose is never changed.
 */
export interface SceneSubjectDecision { sceneId: string; subjectId: string | null; reason: string }

export function inferSceneSubjects(scenes: readonly StoryboardScene[], subjects: readonly VisualTitleCandidate[]): { scenes: StoryboardScene[]; decisions: SceneSubjectDecision[] } {
  // The narration spells numbers out for the voice: "Cyberpunk 2077" is said "Cyberpunk dois mil e setenta e sete".
  const spoken = subjects.map((subject) => ({ ...subject, aliases: [...subject.aliases, ...[subject.title, ...subject.aliases].map(spellNumbers).filter((alias) => !subject.aliases.includes(alias) && alias !== subject.title)] }));
  const named = new Map(scenes.map((scene) => [scene.id, resolveTitleMentions(scene.narration, spoken).map((subject) => subject.id)]));
  // The games each chapter names across its scenes; a chapter has a game only when it names exactly one.
  const chapterNames = new Map<number, Set<string>>();
  for (const scene of scenes) {
    if (scene.chapter === null) continue;
    const ids = chapterNames.get(scene.chapter) ?? new Set<string>();
    for (const id of named.get(scene.id) ?? []) ids.add(id);
    chapterNames.set(scene.chapter, ids);
  }
  const chapterGame = new Map([...chapterNames].flatMap(([chapter, ids]) => (ids.size === 1 ? [[chapter, [...ids][0] as string] as const] : [])));
  const decisions: SceneSubjectDecision[] = [];
  const next = scenes.map((scene) => {
    if (scene.subjectId) { decisions.push({ sceneId: scene.id, subjectId: scene.subjectId, reason: 'Escolhido antes; mantido.' }); return scene; }
    const own = named.get(scene.id) ?? [];
    if (own.length > 1) { decisions.push({ sceneId: scene.id, subjectId: null, reason: 'A cena cita mais de um jogo; escolha qual mostrar.' }); return scene; }
    if (own.length === 1) { decisions.push({ sceneId: scene.id, subjectId: own[0] as string, reason: 'O jogo é citado na narração da cena.' }); return { ...scene, subjectId: own[0] as string }; }
    const chapter = scene.chapter === null ? undefined : chapterGame.get(scene.chapter);
    if (chapter) { decisions.push({ sceneId: scene.id, subjectId: chapter, reason: 'O capítulo da cena cita um único jogo.' }); return { ...scene, subjectId: chapter }; }
    decisions.push({ sceneId: scene.id, subjectId: null, reason: 'A cena não cita nenhum jogo da pesquisa.' });
    return scene;
  });
  return { scenes: next, decisions };
}

const spellNumbers = (title: string) => title.replace(/\b\d{1,6}\b/gu, (digits) => portugueseNumber(Number(digits)));

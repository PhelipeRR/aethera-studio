import type { SemanticSceneCut } from '../editorial/research-and-decupagem.js';
import { mentionsName, significantTokens, type WorkReference } from './media-providers/semantic-media.js';

type SceneLike = Pick<SemanticSceneCut, 'workTitle' | 'expectedEvent'> &
  Partial<Pick<SemanticSceneCut, 'works' | 'visualKeywords' | 'matchingCriteria' | 'entities'>>;

const clean = (value: string) => value.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();

/** "pt-BR" → "pt"; keeps two-letter codes. */
function languageCode(value: string | undefined): string | undefined {
  const code = value?.trim().toLowerCase().split(/[-_]/)[0];
  return code && /^[a-z]{2}$/.test(code) ? code : undefined;
}

/**
 * Work reference of one decupagem scene, for search and identity: the scene's single work (if it has exactly one),
 * the characters/techniques it names, the narrated event and the production language. In a ranking of several works
 * the list label is not a work, so overview scenes with several works carry no canonical title.
 */
export function workReferenceForScene(scene: SceneLike, options: { multiWork: boolean; language?: string }): WorkReference | undefined {
  const works = (options.multiWork ? (scene.works ?? []) : [scene.workTitle]).map(clean).filter((w) => significantTokens(w).length > 0);
  const canonicalTitle = works.length === 1 ? works[0] : undefined;
  const isWork = (name: string) => works.some((w) => mentionsName(w, name) || mentionsName(name, w));
  const characters = [...new Set([...(scene.visualKeywords ?? []), ...(scene.matchingCriteria?.requiredEntities ?? [])].map(clean))]
    .filter((c) => significantTokens(c).length > 0 && !isWork(c))
    .slice(0, 4);
  const event = scene.expectedEvent?.trim();
  const language = languageCode(options.language);
  const ref: WorkReference = {
    ...(canonicalTitle ? { canonicalTitle } : {}),
    ...(characters.length ? { characters } : {}),
    ...(event ? { event } : {}),
    ...(language ? { language } : {}),
  };
  return Object.keys(ref).length > 0 ? ref : undefined;
}

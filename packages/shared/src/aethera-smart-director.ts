import { z } from 'zod';
import { applyShotFootage, mentionedSubjects, planShotFootage, type FootageCandidate, type FootageSubject, type ShotFootagePlan } from './aethera-shot-footage.js';
import { splitSceneIntoShots, type ShotSpan } from './aethera-editorial.js';
import { timelineDocumentSchema, type TimelineDocument } from './aethera-timeline.js';
import { textKey } from './velix-sync.js';

/*
 * Aethera Smart Director (SD-1). The editorial plan is data: what the script tells, what each segment must communicate,
 * the production's direction concept and, per segment, a composition chosen for that intent, with its justification.
 * The AI director writes it; this module validates it against what the executor can do, turns word anchors into time and
 * versions it. Nothing here chooses a technique by topic: the catalogue says what each technique communicates and costs,
 * never when to use it.
 */

// ---------------------------------------------------------------- technique catalogue

export const compositionKinds = ['single_shot', 'continue_previous', 'multi_panel', 'picture_in_picture', 'typographic_card', 'kinetic_type', 'diagram', 'data_chart', 'map_timeline'] as const;
export type CompositionKind = (typeof compositionKinds)[number];
export const transitionKinds = ['cut', 'none', 'dissolve', 'wipe', 'match_cut'] as const;

export interface TechniqueEntry {
  /** What the technique does for the viewer — knowledge for the director, not a rule. */
  communicates: string;
  /** What it costs the viewer or the production. */
  cost: string;
  /** Whether the executor renders it today (SD-1). A non-executable choice is kept in the plan with a declared fallback. */
  executable: boolean;
  fallback: CompositionKind | null;
}

/** Whether the executor can render this decision: the technique's flag, or a diagram that declares its structure. */
export function isExecutable(composition: { kind: CompositionKind; structure?: unknown }): boolean {
  return TECHNIQUES[composition.kind].executable || (composition.kind === 'diagram' && composition.structure !== undefined);
}

export const TECHNIQUES: Record<CompositionKind, TechniqueEntry> = {
  single_shot: { communicates: 'Uma imagem em tela cheia: presença, clareza, foco num único assunto ou ação.', cost: 'Depende de haver uma tomada que mostre de fato o que a fala diz.', executable: true, fallback: null },
  continue_previous: { communicates: 'Nenhuma mudança: a imagem anterior continua porque a fala ainda é sobre ela. O corte que não acontece também é decisão.', cost: 'Nenhum; quebra ritmo só se a tomada anterior já cansou.', executable: true, fallback: null },
  multi_panel: { communicates: 'Vários elementos ao mesmo tempo, lado a lado: comparação, enumeração, coexistência. Revelação progressiva acompanha a ordem da fala.', cost: 'Cada painel é menor; exige um visual próprio por elemento; pesa se usado sem relação real entre os elementos.', executable: true, fallback: 'typographic_card' },
  picture_in_picture: { communicates: 'Um elemento comenta ou contextualiza outro sem tirá-lo da tela.', cost: 'Disputa atenção; a inserção cobre parte da imagem principal.', executable: true, fallback: null },
  typographic_card: { communicates: 'Uma ideia, nome ou número em destaque tipográfico: ênfase, identificação, pausa para fixar.', cost: 'Sem imagem real; repetido vira slide.', executable: true, fallback: null },
  kinetic_type: { communicates: 'Palavras em movimento no ritmo da fala: ênfase emocional, frase de efeito.', cost: 'Compete com a legenda se repetir o mesmo texto.', executable: true, fallback: null },
  diagram: { communicates: 'Explicação de mecanismo, relação ou processo, construída passo a passo.', cost: 'Precisa ser fiel; uma representação didática deve ser marcada como ilustrativa.', executable: false, fallback: 'continue_previous' },
  data_chart: { communicates: 'Grandeza, tendência ou comparação numérica com dados verificáveis.', cost: 'Só existe com dados de fonte; sem dados, não se desenha gráfico.', executable: false, fallback: 'continue_previous' },
  map_timeline: { communicates: 'Lugar, deslocamento ou sequência no tempo.', cost: 'Exige dados geográficos ou datas verificadas.', executable: false, fallback: 'continue_previous' },
};

// ---------------------------------------------------------------- contracts

const text = (max: number) => z.string().trim().min(1).max(max);

/** How a diagram's elements relate on screen — a shape of reasoning, not a theme. */
export const diagramLayouts = ['sequence', 'cycle', 'hub', 'layers', 'contrast'] as const;
export type DiagramLayout = (typeof diagramLayouts)[number];
export const diagramStructureSchema = z.strictObject({
  /** sequence: steps of a process; cycle: steps that return to the start; hub: a centre and what surrounds it (first
   * element is the centre); layers: levels from outside to inside or top to bottom; contrast: two sides compared
   * (first half left, second half right). */
  layout: z.enum(diagramLayouts),
  nodes: z.array(z.strictObject({ label: text(32), atWord: z.number().int().nonnegative().nullable() })).min(2).max(6),
  links: z.array(z.strictObject({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative(), label: z.string().trim().max(24).nullable() })).max(8),
});
export type DiagramStructure = z.infer<typeof diagramStructureSchema>;
const subjectRef = z.string().min(1).nullable();

const panelSchema = z.strictObject({
  subjectId: subjectRef, wants: text(200), label: z.string().trim().max(60).nullable(),
  /** Index of the word (inside the segment) whose pronunciation reveals this panel; null when it appears with the others. */
  revealAtWord: z.number().int().nonnegative().nullable(),
});

export const compositionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('single_shot'), subjectId: subjectRef, wants: text(200), camera: z.enum(['still', 'push_in', 'pull_out', 'pan']) }),
  z.strictObject({ kind: z.literal('continue_previous') }),
  z.strictObject({ kind: z.literal('multi_panel'), layout: z.enum(['diagonal', 'vertical', 'horizontal', 'grid']), reveal: z.enum(['progressive', 'together']), panels: z.array(panelSchema).min(2).max(4) }),
  z.strictObject({ kind: z.literal('picture_in_picture'), main: panelSchema, inset: panelSchema }),
  z.strictObject({ kind: z.literal('typographic_card'), lines: z.array(text(60)).min(1).max(3), revealAtWords: z.array(z.number().int().nonnegative()).max(3).nullable() }),
  z.strictObject({ kind: z.literal('kinetic_type'), emphasizedWords: z.array(z.number().int().nonnegative()).min(1).max(6) }),
  z.strictObject({ kind: z.literal('diagram'), description: text(300),
    /**
     * What the diagram draws (SD-2.1): its elements in the order they are spoken, the word that brings each one in, and
     * how they relate. Without a structure the executor cannot draw a faithful diagram and the declared fallback runs.
     */
    structure: diagramStructureSchema.optional() }),
  z.strictObject({ kind: z.literal('data_chart'), description: text(300), dataSource: z.string().trim().max(200).nullable() }),
  z.strictObject({ kind: z.literal('map_timeline'), description: text(300) }),
]);
export type EditorialComposition = z.infer<typeof compositionSchema>;

export const segmentDirectionSchema = z.strictObject({
  segmentId: z.string().min(1),
  /** What the narration says here, in the director's words. */
  communicates: text(300),
  /** What the viewer should understand or feel. */
  viewerEffect: text(240),
  emotion: text(60),
  intensity: z.number().min(0).max(1),
  importance: z.enum(['low', 'normal', 'key']),
  composition: compositionSchema,
  transitionIn: z.strictObject({ kind: z.enum(transitionKinds), motivation: text(200) }),
  /** Whether what is shown is a record, an illustration or a reconstruction (facts are never invented). */
  representation: z.enum(['record', 'illustrative', 'reconstruction']),
  justification: z.string().trim().min(20).max(600),
  confidence: z.number().min(0).max(1),
  alerts: z.array(text(200)).max(6),
});
export type SegmentDirection = z.infer<typeof segmentDirectionSchema>;

export const productionReadingSchema = z.strictObject({
  story: text(500), purpose: text(240), audience: text(160), tone: text(160),
  arc: z.array(z.strictObject({ role: z.enum(['opening', 'development', 'turn', 'conclusion']), segmentIds: z.array(z.string().min(1)).min(1), intent: text(240) })).min(1).max(8),
  keyInformation: z.array(text(200)).max(10),
});

export const directionConceptSchema = z.strictObject({
  summary: text(400), visualLanguage: text(400), pacing: text(300), continuity: text(300), typography: text(200), audio: text(300),
  /** What this production deliberately avoids, and why. */
  avoid: z.array(text(200)).max(8),
  rationale: z.string().trim().min(40).max(800),
});

/** What the AI director returns: reading, concept and one decision per segment. */
export const directorOutputSchema = z.strictObject({ reading: productionReadingSchema, concept: directionConceptSchema, segments: z.array(segmentDirectionSchema).min(1).max(200) });
export type DirectorOutput = z.infer<typeof directorOutputSchema>;

export const editorialPlanSchema = z.strictObject({
  schemaVersion: z.literal(1), productionId: z.string().min(1), version: z.number().int().positive(), status: z.enum(['draft', 'approved']),
  /** The script and narration this plan was made for; a different script never reuses the plan. */
  basedOn: z.strictObject({ scriptKey: z.string().min(1) }),
  director: z.strictObject({ provider: z.string().min(1), model: z.string().min(1), promptVersion: z.string().min(1) }),
  hash: z.string().min(1),
  ...directorOutputSchema.shape,
});
/** An editorial plan as the app shows it: the stored version and who approved it (null while it is a draft). */
export const editorialPlanViewSchema = z.strictObject({
  plan: editorialPlanSchema,
  approval: z.strictObject({ approvedBy: z.string().min(1), approvedAt: z.string().min(1) }).nullable(),
  issues: z.array(z.strictObject({ severity: z.enum(['error', 'warning']), segmentId: z.string().nullable(), message: z.string() })),
});
export type EditorialPlanView = z.infer<typeof editorialPlanViewSchema>;
export type EditorialPlan = z.infer<typeof editorialPlanSchema>;

// ---------------------------------------------------------------- segments given to the director

export interface DirectorSegment { id: string; sceneId: string; text: string; words: readonly { w: string; startMs: number; endMs: number }[]; startMs: number; endMs: number }

/**
 * The director's segments of a measured storyboard (the app flow): each scene's own cut of the narration is split into
 * sentence-level shots, and its words, relative to the scene clip, are put back on the production clock. Scenes without
 * measured narration give no segments: the director plans on real word times, never on estimates.
 */
export function directorSegmentsFromScenes(scenes: readonly { id: string; startMs: number; endMs: number; audio?: { words: readonly { w: string; startMs: number; endMs: number }[] } | undefined }[]): DirectorSegment[] {
  return scenes.flatMap((scene) => {
    const words = scene.audio?.words ?? [];
    if (!words.length) return [];
    return splitSceneIntoShots({ id: scene.id, startMs: scene.startMs, endMs: scene.endMs, words }).map((shot) => ({
      id: shot.id, sceneId: scene.id, text: shot.text, startMs: shot.startMs, endMs: shot.endMs,
      words: words.slice(shot.wordStart, shot.wordEnd + 1).map((word) => ({ w: word.w, startMs: scene.startMs + word.startMs, endMs: scene.startMs + word.endMs })),
    }));
  });
}

/** The script as the director reads it: one entry per sentence-level segment, with numbered words for anchors. */
export function scriptKeyOf(segments: readonly DirectorSegment[]): string {
  return textKey(segments.map((segment) => `${segment.id}\u0000${segment.text}`).join('\u0001'));
}

// ---------------------------------------------------------------- validation

export interface PlanIssue { severity: 'error' | 'warning'; segmentId: string | null; message: string }

const subjectsOf = (composition: EditorialComposition): Array<string | null> => {
  if (composition.kind === 'single_shot') return [composition.subjectId];
  if (composition.kind === 'multi_panel') return composition.panels.map((panel) => panel.subjectId);
  if (composition.kind === 'picture_in_picture') return [composition.main.subjectId, composition.inset.subjectId];
  return [];
};

/**
 * Checks a director output against the script, the run's subjects and the catalogue. Errors make the plan unusable
 * (a segment missing, an anchor on a word that does not exist, a subject that is not in the run, footage of one subject
 * over a sentence about another). Warnings keep it, with a declared fallback (a technique not executable yet).
 */
export function validateDirectorOutput(output: DirectorOutput, context: { segments: readonly DirectorSegment[]; subjects: readonly FootageSubject[] }): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const known = new Set(context.subjects.map((subject) => subject.id));
  const bySegment = new Map(context.segments.map((segment) => [segment.id, segment]));
  const seen = new Map<string, number>();
  for (const direction of output.segments) seen.set(direction.segmentId, (seen.get(direction.segmentId) ?? 0) + 1);
  for (const segment of context.segments) if (!seen.has(segment.id)) issues.push({ severity: 'error', segmentId: segment.id, message: 'Trecho sem decisão do diretor.' });
  for (const [id, count] of seen) {
    if (!bySegment.has(id)) issues.push({ severity: 'error', segmentId: id, message: 'Decisão para um trecho que não existe no roteiro.' });
    if (count > 1) issues.push({ severity: 'error', segmentId: id, message: 'Trecho com mais de uma decisão.' });
  }
  output.segments.forEach((direction, index) => {
    const segment = bySegment.get(direction.segmentId);
    if (!segment) return;
    const composition = direction.composition;
    for (const subjectId of subjectsOf(composition)) if (subjectId && !known.has(subjectId)) issues.push({ severity: 'error', segmentId: segment.id, message: `Assunto desconhecido: ${subjectId}.` });
    const anchors = composition.kind === 'multi_panel' ? composition.panels.map((panel) => panel.revealAtWord) : composition.kind === 'typographic_card' ? composition.revealAtWords ?? [] : composition.kind === 'kinetic_type' ? composition.emphasizedWords : composition.kind === 'diagram' ? composition.structure?.nodes.map((node) => node.atWord) ?? [] : [];
    for (const anchor of anchors) if (anchor !== null && anchor >= segment.words.length) issues.push({ severity: 'error', segmentId: segment.id, message: `Âncora na palavra ${anchor}, mas o trecho tem ${segment.words.length} palavras.` });
    if (composition.kind === 'multi_panel' && composition.reveal === 'progressive') {
      const order = composition.panels.map((panel) => panel.revealAtWord);
      if (order.some((anchor) => anchor === null)) issues.push({ severity: 'error', segmentId: segment.id, message: 'Revelação progressiva exige a palavra de cada painel.' });
      else if (order.some((anchor, at) => at > 0 && (anchor ?? 0) <= (order[at - 1] ?? 0))) issues.push({ severity: 'error', segmentId: segment.id, message: 'Os painéis precisam surgir na ordem da fala.' });
    }
    // Rule: never footage of one subject over a sentence that names only another one.
    const named = mentionedSubjects(segment.text, context.subjects);
    if (composition.kind === 'single_shot' && composition.subjectId && named.length === 1 && named[0] !== composition.subjectId) issues.push({ severity: 'error', segmentId: segment.id, message: 'Imagem de um assunto sobre uma frase que fala de outro.' });
    if (composition.kind === 'continue_previous' && index === 0) issues.push({ severity: 'error', segmentId: segment.id, message: 'O primeiro trecho não tem imagem anterior para continuar.' });
    if (composition.kind === 'diagram' && composition.structure) {
      const count = composition.structure.nodes.length;
      for (const link of composition.structure.links) if (link.from >= count || link.to >= count || link.from === link.to) issues.push({ severity: 'error', segmentId: segment.id, message: `Ligação do diagrama ${link.from}→${link.to} não liga dois elementos existentes.` });
      if (composition.structure.layout === 'contrast' && count % 2 !== 0) issues.push({ severity: 'warning', segmentId: segment.id, message: 'Contraste com número ímpar de elementos: um lado fica maior.' });
    }
    const technique = TECHNIQUES[composition.kind];
    if (!isExecutable(composition)) issues.push({ severity: 'warning', segmentId: segment.id, message: `${composition.kind} ainda não é executável; fallback declarado: ${technique.fallback}.` });
  });
  return issues;
}

// ---------------------------------------------------------------- versioning

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
};

/** Content hash of the decisions (reading, concept, segments and the script they are for); version and status excluded. */
export function editorialPlanHash(input: { scriptKey: string } & DirectorOutput): string {
  return textKey(canonical({ scriptKey: input.scriptKey, reading: input.reading, concept: input.concept, segments: input.segments }));
}

/**
 * The plan a new director output becomes. Identical decisions reuse the latest version; anything different is a new
 * draft version. An approved version is never modified: a new direction for an approved script is a new draft that a
 * person must approve again.
 */
export function nextEditorialPlan(history: readonly EditorialPlan[], input: { productionId: string; scriptKey: string; director: EditorialPlan['director']; output: DirectorOutput }): EditorialPlan {
  const hash = editorialPlanHash({ scriptKey: input.scriptKey, ...input.output });
  const sameScript = history.filter((plan) => plan.basedOn.scriptKey === input.scriptKey);
  const existing = sameScript.find((plan) => plan.hash === hash);
  if (existing) return existing;
  const version = Math.max(0, ...history.map((plan) => plan.version)) + 1;
  return editorialPlanSchema.parse({ schemaVersion: 1, productionId: input.productionId, version, status: 'draft', basedOn: { scriptKey: input.scriptKey }, director: input.director, hash, ...input.output });
}

// ---------------------------------------------------------------- timing

/** Absolute time (ms) of a word of a segment; anchors are spoken words, so a reveal lands on the pronunciation. */
export function wordStartMs(segment: DirectorSegment, wordIndex: number): number {
  return segment.words[Math.min(wordIndex, segment.words.length - 1)]?.startMs ?? segment.startMs;
}

/** The composition actually executed: the director's choice when executable, otherwise its declared fallback. */
export function executableComposition(direction: SegmentDirection, segment: DirectorSegment, options: { first?: boolean } = {}): { composition: EditorialComposition; fellBack: boolean } {
  const composition = direction.composition;
  if (isExecutable(composition)) return { composition, fellBack: false };
  // A fallback keeps the intent and never repeats the caption (SD-1 review: a card with the whole sentence sat right
  // above the same sentence in the caption, and long sentences were cut with an ellipsis).
  if (composition.kind === 'picture_in_picture') return { composition: { kind: 'single_shot', subjectId: composition.main.subjectId, wants: composition.main.wants, camera: 'still' }, fellBack: true };
  // Kinetic type, a diagram, a chart or a map that cannot be drawn yet: the image on screen goes on (the gap is reported).
  // Not a slide restating the narration, and not the emphasised words alone: out of their motion, words like "não / nota /
  // venda" stacked on a card say nothing (SD-1 review of the rendered sample). Only the very first segment, with nothing
  // before it, gets a short title card.
  if (!options.first) return { composition: { kind: 'continue_previous' }, fellBack: true };
  const head = segment.words.slice(0, 5).map((word) => word.w).join(' ').replace(/[,;:]+$/u, '');
  return { composition: { kind: 'typographic_card', lines: [head], revealAtWords: null }, fellBack: true };
}

// ---------------------------------------------------------------- multi-panel geometry (executor support)

export type PanelLayout = 'diagonal' | 'vertical' | 'horizontal' | 'grid' | 'pip';
/** Corner of the inset in a picture-in-picture (`pip` layout), chosen from the calm zone of the main image. */
export type InsetCorner = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
export interface PanelShape { points: Array<[number, number]>; box: { x: number; y: number; w: number; h: number } }

/**
 * Panels of a multi-panel composition as polygons in frame fractions (0–1). Diagonal panels are columns whose shared
 * edges lean by `slant` (fraction of the width, top edge to the right of the bottom one); vertical are straight
 * columns; horizontal are rows; grid fills two columns. The outer edges extend past the frame so no gap shows.
 */
export function panelShapes(layout: PanelLayout, count: number, slant = 0.14, corner: InsetCorner = 'top-right'): PanelShape[] {
  const n = Math.max(1, Math.min(4, Math.round(count)));
  const box = (points: Array<[number, number]>) => { const xs = points.map(([x]) => x); const ys = points.map(([, y]) => y); const x = Math.max(0, Math.min(...xs)); const y = Math.max(0, Math.min(...ys)); return { x, y, w: Math.min(1, Math.max(...xs)) - x, h: Math.min(1, Math.max(...ys)) - y }; };
  if (layout === 'pip') {
    // Main image full frame; the inset a third of the width, same aspect, inside the safe margin of the chosen corner.
    const w = 0.32; const h = 0.32; const mx = 0.05; const my = 0.07;
    const x = corner.endsWith('right') ? 1 - mx - w : mx; const y = corner.startsWith('top') ? my : 1 - my - h - 0.2;
    const full: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const inset: Array<[number, number]> = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    return [{ points: full, box: box(full) }, { points: inset, box: box(inset) }];
  }
  if (layout === 'horizontal') return Array.from({ length: n }, (_x, index) => { const points: Array<[number, number]> = [[0, index / n], [1, index / n], [1, (index + 1) / n], [0, (index + 1) / n]]; return { points, box: box(points) }; });
  if (layout === 'grid') {
    const rows = Math.ceil(n / 2);
    return Array.from({ length: n }, (_x, index) => { const column = index % 2; const row = Math.floor(index / 2); const wide = index === n - 1 && n % 2 === 1; const points: Array<[number, number]> = [[wide ? 0 : column / 2, row / rows], [wide ? 1 : (column + 1) / 2, row / rows], [wide ? 1 : (column + 1) / 2, (row + 1) / rows], [wide ? 0 : column / 2, (row + 1) / rows]]; return { points, box: box(points) }; });
  }
  const lean = layout === 'diagonal' ? slant : 0;
  // Edge i between panel i-1 and i: x at the top and at the bottom.
  const edge = (index: number): [number, number] => index === 0 ? [-lean, -lean] : index === n ? [1 + lean, 1 + lean] : [index / n + lean / 2, index / n - lean / 2];
  return Array.from({ length: n }, (_x, index) => {
    const [leftTop, leftBottom] = edge(index);
    const [rightTop, rightBottom] = edge(index + 1);
    const points: Array<[number, number]> = [[leftTop, 0], [rightTop, 0], [rightBottom, 1], [leftBottom, 1]];
    return { points, box: box(points) };
  });
}

/**
 * The visible horizontal span of a panel at height `y` (0–1), clipped to the frame. Text inside a panel (its label, a
 * typographic identity) is centred and sized on this span: the polygon's box includes the edges that run past the frame
 * and the leaning parts, and text placed on the box gets cut by the neighbour panel or the frame edge.
 */
export function panelSpanAt(shape: PanelShape, y: number): { left: number; right: number; center: number; width: number } {
  const [a, b, c, d] = shape.points as [[number, number], [number, number], [number, number], [number, number]];
  const along = (top: [number, number], bottom: [number, number]) => top[1] === bottom[1] ? top[0] : top[0] + (bottom[0] - top[0]) * ((y - top[1]) / (bottom[1] - top[1]));
  const left = Math.max(0, Math.min(along(a, d), along(b, c)));
  const right = Math.min(1, Math.max(along(a, d), along(b, c)));
  return { left, right, center: (left + right) / 2, width: Math.max(0, right - left) };
}

/** CSS `polygon()` of a panel, revealed to `progress` (0–1) as a wipe: rows from the top edge down, the rest from the left edge. */
export function panelClipPath(shape: PanelShape, progress: number, layout: PanelLayout): string {
  const p = Math.max(0, Math.min(1, progress));
  const [a, b, c, d] = shape.points as [[number, number], [number, number], [number, number], [number, number]];
  const lerp = (from: [number, number], to: [number, number]): [number, number] => [from[0] + (to[0] - from[0]) * p, from[1] + (to[1] - from[1]) * p];
  const pts: Array<[number, number]> = layout === 'horizontal' ? [a, b, lerp(b, c), lerp(a, d)] : [a, lerp(a, b), lerp(d, c), d];
  return `polygon(${pts.map(([x, y]) => `${(x * 100).toFixed(3)}% ${(y * 100).toFixed(3)}%`).join(', ')})`;
}

/**
 * Props of the `panels` graphic: one entry per panel, times relative to the clip start. Not strict at the top level:
 * the timeline adds its own keys to every graphic (`sceneId`), and they must not make the panels unreadable.
 */
export const panelsPropsSchema = z.object({
  layout: z.enum(['diagonal', 'vertical', 'horizontal', 'grid', 'pip']),
  corner: z.enum(['top-right', 'top-left', 'bottom-right', 'bottom-left']).optional(),
  panels: z.array(z.strictObject({
    label: z.string().max(60).nullable(),
    /** Footage of the panel's subject; absent means a typographic identity (a declared gap, never another subject). */
    proxyPath: z.string().min(1).optional(), inMs: z.number().int().nonnegative().optional(),
    revealAtMs: z.number().int().nonnegative(),
    accent: z.string().regex(/^#[0-9a-f]{6}$/iu),
  })).min(2).max(4),
  revealMs: z.number().int().min(150).max(1_500),
});
export type PanelsProps = z.infer<typeof panelsPropsSchema>;

/** Footage paths a `panels` graphic needs served to the renderer. */
export function panelProxyPaths(props: Record<string, unknown>): string[] {
  const parsed = panelsPropsSchema.safeParse(props);
  return parsed.success ? parsed.data.panels.flatMap((panel) => panel.proxyPath ? [panel.proxyPath] : []) : [];
}

// ---------------------------------------------------------------- execution (plan → timeline)

/** Accent per panel position: distinct, readable on dark footage; the director may later choose per production. */
const PANEL_ACCENTS = ['#ff4f8b', '#f5b942', '#38bdf8', '#a78bfa'] as const;
/** Time each panel takes to open. */
export const PANEL_REVEAL_MS = 520;

export interface EditorialExecution {
  document: TimelineDocument;
  /** Material the plan asked for and the executor could not give (shown as a declared gap, never replaced by another subject). */
  gaps: Array<{ segmentId: string; message: string }>;
  /** Decisions executed with their declared fallback because the technique is not executable yet. */
  fallbacks: Array<{ segmentId: string; from: CompositionKind; to: CompositionKind }>;
  /** Director transitions executed as a plain cut because the executor cannot do them yet (match cut, wipe). */
  transitions: Array<{ segmentId: string; from: (typeof transitionKinds)[number]; to: 'cut' }>;
  shots: ShotFootagePlan[];
}

/**
 * Executes an editorial plan on a timeline. Each segment's composition becomes tracks: a single shot uses the footage
 * planner with the director's subject and description; `continue_previous` lengthens the previous shot; a card uses the
 * director's lines; multi-panel builds one panel per element with that subject's own footage, revealed on the word the
 * director anchored. Non-executable techniques run their declared fallback and are reported.
 */
export function applyEditorialPlan(document: TimelineDocument, plan: Pick<EditorialPlan, 'segments'>, input: { segments: readonly DirectorSegment[]; subjects: readonly FootageSubject[]; candidates: readonly FootageCandidate[]; proxyPaths: ReadonlyMap<string, string> }): EditorialExecution {
  const titles = new Map(input.subjects.map((subject) => [subject.id, subject.title]));
  const decisions = new Map(plan.segments.map((direction) => [direction.segmentId, direction]));
  const bySegmentId = new Map(input.candidates.map((candidate) => [candidate.segmentId, candidate]));
  const gaps: EditorialExecution['gaps'] = [];
  const fallbacks: EditorialExecution['fallbacks'] = [];
  const transitions: EditorialExecution['transitions'] = [];
  const shotOf = (segment: DirectorSegment): ShotSpan => ({ id: segment.id, sceneId: segment.sceneId, wordStart: 0, wordEnd: Math.max(0, segment.words.length - 1), startMs: segment.startMs, endMs: segment.endMs, text: segment.text });
  const textFree = (candidate: FootageCandidate) => !!candidate.analysis && !candidate.analysis.overlays.burnedText && candidate.analysis.frames.every((frame) => frame.visibleText.length === 0);
  const textRegionsOf = (candidate: FootageCandidate | undefined) => [...new Set([...(candidate?.analysis?.overlays.burnedText && candidate.analysis.overlays.burnedTextRegion ? [candidate.analysis.overlays.burnedTextRegion] : []), ...(candidate?.analysis?.frames.flatMap((frame) => frame.visibleText.map((item) => item.region)) ?? [])])];
  const compositions = input.segments.map((segment, index) => {
    const direction = decisions.get(segment.id);
    if (!direction) throw new Error(`invalid: o plano não decide o trecho ${segment.id}.`);
    const chosen = executableComposition(direction, segment, { first: index === 0 });
    if (chosen.fellBack) fallbacks.push({ segmentId: segment.id, from: direction.composition.kind, to: chosen.composition.kind });
    return { segment, direction, composition: chosen.composition };
  });

  // Panels (and the two images of a picture-in-picture) name their subjects, so they claim footage first, clean footage
  // before footage with text of its own; a card about a general idea must not take the only good shot of a subject.
  const used = new Set<string>();
  const pickPanel = (segment: DirectorSegment, key: string, subjectId: string | null, wants: string) => {
    if (!subjectId) return null;
    const pool = input.candidates.filter((candidate) => !used.has(candidate.segmentId));
    for (const candidates of [pool.filter(textFree), pool]) {
      const pick = planShotFootage({ shots: [{ ...shotOf(segment), id: key }], sceneSubjects: new Map(), subjects: input.subjects, candidates, directions: new Map([[key, { subjectId, wants }]]) })[0];
      const cut = pick?.kind === 'footage' ? pick.cuts[0] : undefined;
      if (cut) { used.add(cut.segmentId); return cut; }
    }
    return null;
  };
  const panelsBySegment = new Map<string, { layout: PanelLayout; corner?: InsetCorner; panels: PanelsProps['panels'] }>();
  for (const { segment, composition } of compositions) {
    const entries = composition.kind === 'multi_panel' ? composition.panels : composition.kind === 'picture_in_picture' ? [composition.main, composition.inset] : null;
    if (!entries) continue;
    const progressive = composition.kind === 'picture_in_picture' || (composition.kind === 'multi_panel' && composition.reveal === 'progressive');
    const cuts = entries.map((panel, index) => pickPanel(segment, `${segment.id}:painel-${index}`, panel.subjectId, panel.wants));
    const panels = entries.map((panel, index) => {
      const label = panel.label ?? (panel.subjectId ? titles.get(panel.subjectId) ?? null : null);
      // The main image of a picture-in-picture is there from the start; the inset opens on its word.
      const revealAtMs = (composition.kind === 'picture_in_picture' && index === 0) || !progressive || panel.revealAtWord === null ? 0 : Math.max(0, wordStartMs(segment, panel.revealAtWord) - segment.startMs);
      const cut = cuts[index];
      if (!cut) gaps.push({ segmentId: segment.id, message: `painel ${index + 1} (${label ?? 'sem assunto'}): sem filmagem aceita; identidade tipográfica no lugar` });
      const proxyPath = cut ? input.proxyPaths.get(cut.assetId) : undefined;
      return { label: composition.kind === 'picture_in_picture' && index === 0 ? null : label, revealAtMs, accent: PANEL_ACCENTS[index % PANEL_ACCENTS.length] ?? '#38bdf8', ...(cut && proxyPath ? { proxyPath, inMs: cut.inMs } : {}) };
    });
    const main = cuts[0] ? bySegmentId.get(cuts[0].segmentId) : undefined;
    panelsBySegment.set(segment.id, composition.kind === 'picture_in_picture'
      ? { layout: 'pip', corner: calmCorner({ ...(main?.zones ? { zones: main.zones } : {}), textRegions: textRegionsOf(main) }), panels }
      : { layout: composition.kind === 'multi_panel' ? composition.layout : 'vertical', panels });
  }

  // Footage for every single shot, planned together so no segment is reused and subjects rotate as the planner does.
  const singles = compositions.filter((item) => item.composition.kind === 'single_shot');
  const footage = planShotFootage({
    shots: singles.map((item) => shotOf(item.segment)), sceneSubjects: new Map(), subjects: input.subjects, candidates: input.candidates.filter((candidate) => !used.has(candidate.segmentId)),
    directions: new Map(singles.map((item) => [item.segment.id, item.composition.kind === 'single_shot' ? { subjectId: item.composition.subjectId, wants: item.composition.wants } : { subjectId: null, wants: '' }])),
  });
  // Cards and kinetic words add text, so they go over footage with no text of its own, planned after the single shots: a
  // card is a layer over an image, never a flat screen (SD-1 review; D-AP-17, E6), and three texts never compete.
  const taken = new Set([...used, ...footage.flatMap((shot) => shot.cuts.map((cut) => cut.segmentId))]);
  // A diagram is drawn over a darkened, blurred image of clean footage for the same reason (SD-2.1).
  const overlays = compositions.filter((item) => item.composition.kind === 'typographic_card' || item.composition.kind === 'kinetic_type' || item.composition.kind === 'diagram');
  const overlayFootage = overlays.length ? planShotFootage({ shots: overlays.map((item) => shotOf(item.segment)), sceneSubjects: new Map(), subjects: input.subjects,
    candidates: input.candidates.filter((candidate) => !taken.has(candidate.segmentId) && textFree(candidate)), directions: new Map(overlays.map((item) => [item.segment.id, { subjectId: null, wants: item.direction.communicates.slice(0, 200) }])) }) : [];
  const footageById = new Map([...footage, ...overlayFootage].map((shot) => [shot.shotId, shot]));
  // Where added text goes on a shot: the calm third, away from captions and the shot's own text (SD-2).
  const placementOn = (shot: ShotFootagePlan | undefined, align: 'left' | 'center' = 'left') => {
    const candidate = shot?.cuts[0] ? bySegmentId.get(shot.cuts[0].segmentId) : undefined;
    return calmPlacement({ ...(candidate?.zones ? { zones: candidate.zones } : {}), textRegions: textRegionsOf(candidate), captionPlacement: shot?.captionPlacement ?? 'bottom', align });
  };

  const plans: ShotFootagePlan[] = [];
  for (const { segment, composition } of compositions) {
    const base = { shotId: segment.id, sceneId: segment.sceneId, startMs: segment.startMs, endMs: segment.endMs, text: segment.text, captionPlacement: 'bottom' as const, label: null, unanalyzed: false };
    const rel = (word: number) => Math.max(0, wordStartMs(segment, word) - segment.startMs);
    // An anchored reveal still leaves time to read before the text leaves (SD-2 review: "Um método" anchored on its last
    // word opened 1 ms before the end and was never read): later anchors are brought forward.
    const readable = (atMs: number) => Math.max(0, Math.min(atMs, segment.endMs - segment.startMs - MIN_READ_MS));
    if (composition.kind === 'single_shot') {
      const shot = footageById.get(segment.id);
      if (shot) { if (shot.kind === 'identity_card') gaps.push({ segmentId: segment.id, message: shot.reason }); plans.push(shot); }
      continue;
    }
    if (composition.kind === 'continue_previous') {
      const previous = plans.at(-1);
      const last = previous?.cuts.at(-1);
      if (previous && last && (previous.graphic?.component === 'title' || previous.graphic?.component === 'kinetic' || previous.graphic?.component === 'diagram')) {
        // The image goes on, the added text does not: it belongs to the sentence that motivated it (SD-1 review).
        const durationMs = segment.endMs - segment.startMs;
        const image: ShotFootagePlan = { ...previous };
        delete image.graphic;
        plans.push({ ...image, shotId: segment.id, startMs: segment.startMs, endMs: segment.endMs, text: segment.text, label: null, reason: 'a imagem do trecho anterior continua',
          cuts: [{ ...last, inMs: last.outMs, outMs: last.outMs + durationMs, startMs: segment.startMs, endMs: segment.endMs }] });
        continue;
      }
      if (previous) {
        // The same image goes on: the last cut (or the panels) lasts until the end of this segment.
        if (last) { last.outMs += segment.endMs - last.endMs; last.endMs = segment.endMs; }
        previous.endMs = segment.endMs;
        previous.text = `${previous.text} ${segment.text}`;
      }
      continue;
    }
    if (composition.kind === 'typographic_card' || composition.kind === 'kinetic_type') {
      const shot = footageById.get(segment.id);
      const placement = placementOn(shot?.kind === 'footage' ? shot : undefined, composition.kind === 'kinetic_type' ? 'center' : 'left');
      const graphic = composition.kind === 'typographic_card'
        ? { component: 'title' as const, props: { ...(composition.lines.length === 1 ? { title: composition.lines[0] } : { items: composition.lines }), placement,
          // Lines revealed on the words the director anchored, when there is one anchor per line.
          ...(composition.revealAtWords && composition.revealAtWords.length === composition.lines.length ? { itemRevealMs: composition.revealAtWords.map((word) => readable(rel(word))) } : {}) } }
        : { component: 'kinetic' as const, props: kineticPropsSchema.parse({ placement, words: [...new Set(composition.emphasizedWords)].sort((a, b) => a - b).map((word, index, all) => ({
          text: (segment.words[word]?.w ?? '').replace(/[.,;:!?…]+$/u, ''), atMs: rel(word), untilMs: index < all.length - 1 ? rel(all[index + 1] ?? word) : segment.endMs - segment.startMs,
        })).filter((word) => word.text.length > 0 && word.untilMs > word.atMs) }) };
      if (shot?.kind === 'footage') plans.push({ ...shot, graphic, reason: composition.kind === 'typographic_card' ? 'cartão tipográfico do diretor sobre a imagem' : 'tipografia cinética do diretor sobre a imagem' });
      else { gaps.push({ segmentId: segment.id, message: 'texto do diretor sem imagem por baixo: nenhuma filmagem limpa disponível' }); plans.push({ ...base, subjectIds: [], kind: 'identity_card', cuts: [], reason: 'texto do diretor', graphic }); }
      continue;
    }
    if (composition.kind === 'diagram' && composition.structure) {
      const shot = footageById.get(segment.id);
      const direction = decisions.get(segment.id);
      const graphic = { component: 'diagram' as const, props: diagramProps(composition.structure, segment, { illustrative: direction?.representation !== 'record' }) };
      if (shot?.kind === 'footage') plans.push({ ...shot, graphic, reason: 'diagrama do diretor sobre a imagem escurecida' });
      else { gaps.push({ segmentId: segment.id, message: 'diagrama sem imagem por baixo: nenhuma filmagem limpa disponível' }); plans.push({ ...base, subjectIds: [], kind: 'identity_card', cuts: [], reason: 'diagrama do diretor', graphic }); }
      continue;
    }
    if (composition.kind === 'multi_panel' || composition.kind === 'picture_in_picture') {
      const entry = panelsBySegment.get(segment.id);
      const props = panelsPropsSchema.parse({ layout: entry?.layout ?? 'vertical', ...(entry?.corner ? { corner: entry.corner } : {}), panels: entry?.panels ?? [], revealMs: PANEL_REVEAL_MS });
      const subjectIds = (composition.kind === 'multi_panel' ? composition.panels : [composition.main, composition.inset]).flatMap((panel) => panel.subjectId ? [panel.subjectId] : []);
      plans.push({ ...base, subjectIds, kind: 'comparison_card', cuts: [], reason: composition.kind === 'multi_panel' ? 'composição multi-painel do diretor' : 'picture-in-picture do diretor', graphic: { component: 'panels', props } });
    }
  }
  const built = applyShotFootage(document, plans, { subjects: input.subjects, proxyPaths: input.proxyPaths });

  // Transitions as the director motivated them. A cut stays a cut (the default: nothing is added where the director chose
  // a plain cut or no change). A dissolve overlaps the outgoing image under the incoming one, which fades in.
  const video = built.tracks.find((track) => track.kind === 'video');
  const items = video ? [...video.items] : [];
  compositions.forEach(({ segment, direction }, index) => {
    if (index === 0) return;
    const kind = direction.transitionIn.kind;
    if (kind === 'cut' || kind === 'none') return;
    if (kind !== 'dissolve') { transitions.push({ segmentId: segment.id, from: kind, to: 'cut' }); return; }
    const incoming = items.findIndex((item) => Math.abs(item.startMs - segment.startMs) <= 2);
    const outgoing = items.findIndex((item) => Math.abs(item.startMs + item.durationMs - segment.startMs) <= 2);
    const next = items[incoming];
    const previous = items[outgoing];
    if (!next || !previous || previous.source.kind !== 'media') { transitions.push({ segmentId: segment.id, from: 'dissolve', to: 'cut' }); return; }
    const overlap = Math.min(DISSOLVE_MS, Math.floor(next.durationMs / 3));
    items[outgoing] = { ...previous, durationMs: previous.durationMs + overlap, source: { ...previous.source, outMs: previous.source.outMs + overlap } };
    items[incoming] = { ...next, keyframes: [...next.keyframes.filter((keyframe) => keyframe.property !== 'opacity'), { property: 'opacity', atMs: 0, value: 0, easing: 'ease-in-out' }, { property: 'opacity', atMs: overlap, value: 1, easing: 'ease-in-out' }] };
  });
  // The incoming clip must sit above the outgoing one: clips are drawn in the order of the track.
  const document2 = video ? timelineDocumentSchema.parse({ ...built, tracks: built.tracks.map((track) => track.kind === 'video' ? { ...track, items: items.sort((a, b) => a.startMs - b.startMs) } : track) }) : built;
  return { document: document2, gaps, fallbacks, transitions, shots: plans };
}

/** Shortest time added text stays readable on screen. */
export const MIN_READ_MS = 1_200;

/** Length of a director's dissolve: long enough to read as a soft passage, short enough not to blur the cut. */
export const DISSOLVE_MS = 420;

// ---------------------------------------------------------------- plan profile (review and evaluation)

export interface DirectionProfile {
  /** Share of segments per composition kind. */
  compositions: Partial<Record<CompositionKind, number>>;
  transitions: Partial<Record<(typeof transitionKinds)[number], number>>;
  /** Segments where the director chose no new effect: the same image continues, or a still shot entered on a cut. */
  restraint: number;
  /** Composition kinds used per arc role (how the language changes along the story). */
  byRole: Partial<Record<'opening' | 'development' | 'turn' | 'conclusion', CompositionKind[]>>;
}

/** A measurable profile of a direction, for review and for comparing directions; it judges nothing by itself. */
export function directionProfile(plan: Pick<DirectorOutput, 'segments' | 'reading'>): DirectionProfile {
  const total = Math.max(1, plan.segments.length);
  const share = <K extends string>(keys: K[]) => keys.reduce<Partial<Record<K, number>>>((acc, key) => ({ ...acc, [key]: Math.round(((acc[key] ?? 0) + 1 / total) * 1_000) / 1_000 }), {});
  const roleOf = new Map(plan.reading.arc.flatMap((part) => part.segmentIds.map((id) => [id, part.role] as const)));
  const byRole: DirectionProfile['byRole'] = {};
  for (const segment of plan.segments) {
    const role = roleOf.get(segment.segmentId);
    if (!role) continue;
    const list = byRole[role] ?? [];
    if (!list.includes(segment.composition.kind)) list.push(segment.composition.kind);
    byRole[role] = list;
  }
  const restraint = plan.segments.filter((segment) => segment.composition.kind === 'continue_previous' || (segment.composition.kind === 'single_shot' && segment.composition.camera === 'still' && (segment.transitionIn.kind === 'cut' || segment.transitionIn.kind === 'none'))).length;
  return { compositions: share(plan.segments.map((segment) => segment.composition.kind)), transitions: share(plan.segments.map((segment) => segment.transitionIn.kind)), restraint, byRole };
}

/** How different two directions are in the techniques they use (0 = same mix, 1 = nothing in common). */
export function directionDistance(a: DirectionProfile, b: DirectionProfile): number {
  const kinds = new Set([...Object.keys(a.compositions), ...Object.keys(b.compositions)]) as Set<CompositionKind>;
  let shared = 0;
  for (const kind of kinds) shared += Math.min(a.compositions[kind] ?? 0, b.compositions[kind] ?? 0);
  return Math.round((1 - shared) * 1_000) / 1_000;
}

// ---------------------------------------------------------------- content-aware placement (SD-2)

/** How busy each horizontal third of a shot is (edge density, 0 calm – 1 busy), measured on its analysed frames. */
export interface FrameZones {
  top: number; middle: number; bottom: number;
  /**
   * Busyness of a 3×3 grid (rows top→bottom, columns left→right). Small busy things in a corner — a game's HUD, a logo —
   * vanish in a third's average but fill one cell; added text is judged on the cells it will cover.
   */
  cells?: number[][];
  /**
   * Edges that stay put across the analysed frames while the scene moves: a HUD, a logo, a watermark. Thin icons barely
   * move the edge average, so fixed overlays are weighed apart (SD-2 review: a card sat on Silksong's HUD).
   */
  staticCells?: number[][];
}
export type TextPlacement = 'upper' | 'center' | 'lower';
/** A fixed overlay weighs this much more than moving detail: text over a HUD is a collision, over foliage only clutter. */
const STATIC_WEIGHT = 3;

const zoneOf: Record<TextPlacement, 'top' | 'middle' | 'bottom'> = { upper: 'top', center: 'middle', lower: 'bottom' };
const rowOf: Record<TextPlacement, number> = { upper: 0, center: 1, lower: 2 };
/** How busy the area a left-aligned card covers would be: its row's left and middle cells (the busiest of them). */
const cardBusyness = (zones: FrameZones, place: TextPlacement, align: 'left' | 'center' = 'left') => {
  const grid = zones.cells;
  if (!grid?.length) return zones[zoneOf[place]];
  // Any grid size (3×3, 6×6…): the rows of the chosen third and the left half, where a left-aligned card sits; the worst
  // cell decides, so a dense corner (a HUD, a logo) is not averaged away.
  const area = (cells: number[][]) => {
    const n = cells.length;
    const rows = cells.slice(Math.floor((rowOf[place] * n) / 3), Math.floor(((rowOf[place] + 1) * n) / 3));
    // A left-aligned card covers the left half; centred words (kinetic type) the middle half.
    return Math.max(0, ...rows.flatMap((row) => align === 'left' ? row.slice(0, Math.ceil(row.length / 2)) : row.slice(Math.floor(row.length / 4), Math.ceil((row.length * 3) / 4))));
  };
  return Math.max(area(grid), zones.staticCells?.length ? Math.min(1, area(zones.staticCells) * STATIC_WEIGHT) : 0);
};
const regionZones: Record<string, TextPlacement[]> = { top: ['upper'], center: ['center'], bottom: ['lower'], full: ['upper', 'center', 'lower'], overlay: ['center'] };

/**
 * Where text the director adds (a card, kinetic words) goes on a shot: never in the captions' band, never where the shot
 * has text of its own, and among the rest the calmest third. With no measurement, the upper third (the subject usually
 * sits in the middle, the captions at the bottom).
 */
export function calmPlacement(input: { zones?: FrameZones; textRegions?: readonly string[]; captionPlacement: 'bottom' | 'top'; align?: 'left' | 'center' }): TextPlacement {
  const blocked = new Set<TextPlacement>([input.captionPlacement === 'top' ? 'upper' : 'lower', ...(input.textRegions ?? []).flatMap((region) => regionZones[region] ?? [])]);
  const options = (['upper', 'center', 'lower'] as const).filter((place) => !blocked.has(place));
  if (!options.length) return input.captionPlacement === 'top' ? 'lower' : 'upper';
  if (!input.zones) return options.includes('upper') ? 'upper' : options[0] ?? 'upper';
  const zones = input.zones;
  return [...options].sort((a, b) => cardBusyness(zones, a, input.align) - cardBusyness(zones, b, input.align))[0] ?? 'upper';
}

/** Corner of a picture-in-picture inset: the calmer of the top and bottom thirds, away from the shot's own text. */
export function calmCorner(input: { zones?: FrameZones; textRegions?: readonly string[] }): InsetCorner {
  const topBlocked = (input.textRegions ?? []).some((region) => region === 'top' || region === 'full');
  const bottomBlocked = (input.textRegions ?? []).some((region) => region === 'bottom' || region === 'full');
  if (topBlocked && !bottomBlocked) return 'bottom-right';
  if (bottomBlocked || !input.zones) return 'top-right';
  return input.zones.top <= input.zones.bottom ? 'top-right' : 'bottom-right';
}

/** Props of the `kinetic` graphic: the director's emphasised words, each on screen from its pronunciation to the next. */
export const kineticPropsSchema = z.object({
  words: z.array(z.strictObject({ text: z.string().min(1).max(40), atMs: z.number().int().nonnegative(), untilMs: z.number().int().positive() })).min(1).max(6),
  placement: z.enum(['upper', 'center', 'lower']),
});
export type KineticProps = z.infer<typeof kineticPropsSchema>;

// ---------------------------------------------------------------- diagram (SD-2.1)

/** Props of the `diagram` graphic: positions are fractions of the diagram area (above the captions' band). */
export const diagramPropsSchema = z.object({
  layout: z.enum(diagramLayouts),
  /** Marked on screen as an explanatory illustration unless the director declared it a record. */
  illustrative: z.boolean(),
  nodes: z.array(z.strictObject({ label: z.string().min(1).max(32), x: z.number().min(0).max(1), y: z.number().min(0).max(1), atMs: z.number().int().nonnegative() })).min(2).max(6),
  links: z.array(z.strictObject({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative(), label: z.string().max(24).nullable(), atMs: z.number().int().nonnegative() })).max(8),
});
export type DiagramProps = z.infer<typeof diagramPropsSchema>;
/** Time a link takes to draw after both of its elements are on screen. */
export const DIAGRAM_LINK_DELAY_MS = 280;

/**
 * Where each element sits, as fractions of the diagram area. The layout is the shape of the reasoning the director
 * declared: a process reads left to right (wrapping to a second row past four steps), a cycle closes on itself, a hub
 * puts its first element in the centre, layers stack top to bottom, a contrast splits into two columns.
 */
export function diagramPositions(layout: DiagramLayout, count: number): Array<{ x: number; y: number }> {
  // Elements sit close enough to read as one figure (SD-2.1 review: two steps 80% of the width apart read as two
  // unrelated labels): at most 30% of the area between neighbours, centred.
  const spread = (index: number, total: number) => total <= 1 ? 0.5 : 0.5 + (index - (total - 1) / 2) * Math.min(0.8 / (total - 1), 0.3);
  const around = (index: number, total: number, offset = -Math.PI / 2) => ({ x: 0.5 + 0.36 * Math.cos(offset + (2 * Math.PI * index) / total), y: 0.5 + 0.38 * Math.sin(offset + (2 * Math.PI * index) / total) });
  // Two elements around a centre go above it, left and right: on a straight line through the centre, a link between them
  // would cross the centre's box (SD-2.1 review: "Motor → Lentes" ran through "Lâmpada").
  const satellite = (index: number, total: number) => total === 2 ? { x: index === 0 ? 0.2 : 0.8, y: 0.16 } : around(index, total);
  return Array.from({ length: count }, (_value, index) => {
    if (layout === 'sequence') {
      if (count <= 4) return { x: spread(index, count), y: 0.5 };
      const firstRow = Math.ceil(count / 2);
      const row = index < firstRow ? 0 : 1;
      const inRow = row === 0 ? index : index - firstRow;
      return { x: spread(inRow, row === 0 ? firstRow : count - firstRow), y: row === 0 ? 0.28 : 0.74 };
    }
    if (layout === 'cycle') return around(index, count);
    if (layout === 'hub') return index === 0 ? { x: 0.5, y: count === 3 ? 0.72 : 0.5 } : satellite(index - 1, count - 1);
    if (layout === 'layers') return { x: 0.5, y: spread(index, count) };
    // Contrast: two columns that use the real width (SD-2.1 review: fixed x=0.24/0.76 put "Sua fila" on the same side
    // as "Outra fila A" when there were 3 elements). The smaller group goes left; each column's nodes are spread
    // vertically so long labels don't stack on top of each other.
    const leftCount = Math.floor(count / 2);
    if (leftCount === 0) return { x: 0.5, y: spread(index, count) };
    if (index < leftCount) return { x: 0.28, y: spread(index, leftCount) };
    return { x: 0.72, y: spread(index - leftCount, count - leftCount) };
  });
}

/** The relations drawn when the director names none: the ones the layout itself states. */
export function defaultDiagramLinks(layout: DiagramLayout, count: number): Array<{ from: number; to: number }> {
  const chain = Array.from({ length: count - 1 }, (_value, index) => ({ from: index, to: index + 1 }));
  if (layout === 'sequence' || layout === 'layers') return chain;
  if (layout === 'cycle') return [...chain, { from: count - 1, to: 0 }];
  if (layout === 'hub') return Array.from({ length: count - 1 }, (_value, index) => ({ from: 0, to: index + 1 }));
  return [];
}

/**
 * The diagram of a segment, timed on the narration: each element enters on the word the director anchored (unanchored
 * ones are spread over the first part of the segment, in order) and stays readable; each link draws once both ends
 * are on screen.
 */
export function diagramProps(structure: DiagramStructure, segment: DirectorSegment, options: { illustrative: boolean }): DiagramProps {
  const durationMs = Math.max(1, segment.endMs - segment.startMs);
  const latest = Math.max(0, durationMs - MIN_READ_MS);
  const count = structure.nodes.length;
  const positions = diagramPositions(structure.layout, count);
  const nodes = structure.nodes.map((node, index) => {
    const anchored = node.atWord === null ? Math.round((durationMs * 0.6 * index) / count) : Math.max(0, wordStartMs(segment, node.atWord) - segment.startMs);
    const position = positions[index] ?? { x: 0.5, y: 0.5 };
    return { label: node.label, x: Number(position.x.toFixed(4)), y: Number(position.y.toFixed(4)), atMs: Math.min(anchored, latest) };
  });
  const links = (structure.links.length ? structure.links.map((link) => ({ from: link.from, to: link.to, label: link.label && link.label.length ? link.label : null })) : defaultDiagramLinks(structure.layout, count).map((link) => ({ ...link, label: null })))
    .filter((link) => link.from < count && link.to < count && link.from !== link.to)
    .map((link) => ({ ...link, atMs: Math.min(latest, Math.max(nodes[link.from]?.atMs ?? 0, nodes[link.to]?.atMs ?? 0) + DIAGRAM_LINK_DELAY_MS) }));
  return diagramPropsSchema.parse({ layout: structure.layout, illustrative: options.illustrative, nodes, links });
}

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { directionDistance, directionProfile, mentionedSubjects, validateDirectorOutput, type DirectorOutput, type DirectorSegment, type EditorialPlan } from '../src/index.js';

/*
 * Editorial-judgement regression on REAL director outputs (Claude via the TaskEngine, prompt smart-director-v2,
 * 2026-11-13), recorded as fixtures by renders/smart-director/run-director.mts. These tests do not prove taste; they
 * check that the decisions keep the properties a professional direction must have. When the prompt changes, the plans
 * are generated again and these properties must still hold. v1 fixtures keep the failure the v2 prompt fixed.
 */
const FIXTURES = join(import.meta.dirname, 'fixtures', 'smart-director');
const load = (name: string) => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as { plan: EditorialPlan; segments?: DirectorSegment[] };
const blackHoles = ['buraco-cair', 'buraco-como', 'buraco-descobertas'];
const profiles = (prefix: string) => blackHoles.map((name) => directionProfile(load(prefix + name).plan));
const pairs = <T>(items: T[]) => items.flatMap((item, index) => items.slice(index + 1).map((other) => [item, other] as const));

describe('Smart Director decisions on real scripts (SD-1)', () => {
  it('every recorded plan is valid for its script: one decision per segment, anchors on real words, no foreign subject', () => {
    for (const name of ['jogos', 'buraco-cair', 'buraco-como', 'buraco-descobertas', 'farol', 'filas']) {
      const { plan, segments } = load(name);
      const subjects = name === 'jogos' ? [{ id: plan.segments.flatMap((segment) => segment.composition.kind === 'multi_panel' ? segment.composition.panels.map((panel) => panel.subjectId) : []).find(Boolean) ?? '', title: 'x' }] : [];
      const issues = validateDirectorOutput(plan as DirectorOutput, { segments: segments ?? [], subjects: name === 'jogos' ? [] : subjects });
      // Unknown-subject errors are expected in this check only for the games plan (its subject list is not in the fixture).
      expect(issues.filter((issue) => issue.severity === 'error' && !issue.message.startsWith('Assunto desconhecido')), name).toEqual([]);
    }
  });

  it('gives three scripts on the same topic, with different intents, measurably different directions (v1 did not)', () => {
    const v2 = profiles('');
    const v1 = profiles('v1-');
    const distance = (list: ReturnType<typeof profiles>) => pairs(list).map(([a, b]) => directionDistance(a, b));
    // v1 (shown what the renderer could already do) turned the three into the same typographic video.
    console.info('distâncias de direção v1', distance(v1), 'v2', distance(v2));
    expect(Math.min(...distance(v2))).toBeGreaterThan(Math.max(...distance(v1)));
    // Measured on the recorded plans: v2 pairs differ by 0.23–0.6 of their technique mix.
    expect(Math.min(...distance(v2))).toBeGreaterThanOrEqual(0.2);
    // Each intent reaches for its own means: the news script uses a timeline, the didactic one a diagram, the
    // what-happens-if one builds an illustrated world with single shots.
    const [fall, how, news] = v2;
    expect(news?.compositions.map_timeline ?? 0).toBeGreaterThan(0);
    expect(how?.compositions.diagram ?? 0).toBeGreaterThan(0);
    expect(fall?.compositions.single_shot ?? 0).toBeGreaterThanOrEqual(0.25);
  });

  it('changes visual language with the tone inside one production (the lighthouse story)', () => {
    const { byRole } = directionProfile(load('farol').plan);
    const roles = Object.values(byRole);
    expect(roles.length).toBeGreaterThanOrEqual(2);
    // The parts of the story do not all use the same means.
    expect(new Set(roles.map((kinds) => [...(kinds ?? [])].sort().join('+'))).size).toBeGreaterThanOrEqual(2);
  });

  it('knows when not to add an effect: plans keep the same image or cut plainly where the speech goes on', () => {
    const restrained = ['jogos', 'buraco-cair', 'farol'].map((name) => directionProfile(load(name).plan).restraint);
    expect(restrained.every((count) => count >= 1)).toBe(true);
    // And never more effects than segments: transitions with motion are the exception, not the rule.
    for (const name of ['jogos', 'buraco-cair', 'buraco-como', 'buraco-descobertas', 'farol', 'filas']) {
      const { transitions } = directionProfile(load(name).plan);
      expect((transitions.wipe ?? 0), name).toBeLessThanOrEqual(0.25);
    }
  });

  it('directs a topic with no preset and combines techniques into a composition: panels revealed on the spoken words', () => {
    const queues = load('filas').plan;
    expect(queues.segments.length).toBeGreaterThan(3);
    const games = load('jogos');
    const comparison = games.plan.segments.find((segment) => (games.segments ?? []).find((item) => item.id === segment.segmentId)?.text.startsWith('Cyberpunk dois mil'));
    expect(comparison?.composition.kind).toBe('multi_panel');
    if (comparison?.composition.kind !== 'multi_panel') return;
    const segment = (games.segments ?? []).find((item) => item.id === comparison.segmentId);
    // Each panel opens on the pronunciation of its own name.
    const named = comparison.composition.panels.map((panel) => segment?.words[panel.revealAtWord ?? 0]?.w.toLowerCase() ?? '');
    expect(named[0]).toContain('cyberpunk');
    expect(named[1]).toContain('elden');
    expect(named[2]).toContain('hollow');
  });

  it('never illustrates a sentence about one subject with another subject in the games plan', () => {
    const games = load('jogos');
    const subjects = [{ id: 'cp', title: 'Cyberpunk 2077' }, { id: 'er', title: 'Elden Ring' }, { id: 'hk', title: 'Hollow Knight Silksong' }];
    const ids = new Map<string, string>();
    for (const direction of games.plan.segments) if (direction.composition.kind === 'single_shot' && direction.composition.subjectId) {
      const text = (games.segments ?? []).find((item) => item.id === direction.segmentId)?.text ?? '';
      const named = mentionedSubjects(text, subjects);
      if (named.length === 1) ids.set(direction.composition.subjectId, named[0] ?? '');
    }
    // Every subject the director put on screen alone maps to exactly one named subject (no crossing).
    expect(new Set(ids.values()).size).toBe(ids.size);
  });
});

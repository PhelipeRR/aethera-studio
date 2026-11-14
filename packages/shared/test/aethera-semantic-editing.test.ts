import { describe, expect, it } from 'vitest';
import { applySemanticEditPlan, editPlanSchema, type Storyboard } from '../src/index.js';

const storyboard = (): Storyboard => ({
  schemaVersion: 1,
  timing: 'measured',
  narrationKey: 'narration-key',
  scenes: [
    { id: 'scene-1', subjectId: 'game-1', chapter: 1, narration: 'Jogo um.', startMs: 0, endMs: 1_000, claimIds: [], visualObjective: 'Mostrar cena', sceneType: 'broll', searchTerms: ['jogo'], visual: { type: 'asset', referenceId: 'asset-1', title: 'Jogo um', kind: 'video', score: 0.9, reason: 'match' }, onScreenText: '', transition: 'cut', camera: 'static', locked: false, reviewStatus: 'approved', audio: { relativePath: 'audio/scene-1.wav', durationMs: 1_000, key: 'audio-1', words: [{ w: 'Jogo', startMs: 0, endMs: 400 }] } },
    { id: 'scene-2', subjectId: 'game-2', chapter: 1, narration: 'Jogo dois.', startMs: 1_000, endMs: 2_000, claimIds: [], visualObjective: 'Mostrar cena', sceneType: 'broll', searchTerms: ['jogo'], visual: { type: 'asset', referenceId: 'asset-2', title: 'Jogo dois', kind: 'video', score: 0.9, reason: 'match' }, onScreenText: '', transition: 'cut', camera: 'static', locked: false, reviewStatus: 'approved', audio: { relativePath: 'audio/scene-2.wav', durationMs: 1_000, key: 'audio-2', words: [{ w: 'Jogo', startMs: 0, endMs: 400 }] } },
    { id: 'scene-3', subjectId: 'game-1', chapter: 1, narration: 'Ainda jogo um.', startMs: 2_000, endMs: 3_000, claimIds: [], visualObjective: 'Mostrar cena', sceneType: 'broll', searchTerms: ['jogo'], visual: { type: 'fallback', kind: 'animation', reason: 'fallback' }, onScreenText: '', transition: 'cut', camera: 'static', locked: false, reviewStatus: 'approved' },
  ],
});

describe('Aethera semantic editing contract', () => {
  it('accepts only a closed read-only-agent plan and models ambiguity as confirmation', () => {
    const plan = editPlanSchema.parse({ schemaVersion: 1, command: 'troque a cena do jogo 2 por uma de combate', status: 'ready', confirmation: { required: false, question: null }, planner: { mode: 'read-only', provider: 'codex', model: 'synthetic' }, operations: [{ op: 'replace_subject_visual', subjectId: 'game-2', requestedKind: 'combat' }] });
    expect(plan.operations).toHaveLength(1);
    expect(() => editPlanSchema.parse({ ...plan, unexpected: true })).toThrow();
    expect(editPlanSchema.parse({ schemaVersion: 1, command: 'troque por algo melhor', status: 'needs_confirmation', confirmation: { required: true, question: 'Qual jogo e qual tipo de cena devo trocar?' }, planner: { mode: 'read-only', provider: 'codex', model: 'synthetic' }, operations: [] }).status).toBe('needs_confirmation');
  });

  it('changes only matching subject scenes, preserves the measured narration contract and lists only affected segments', () => {
    const before = storyboard();
    const result = applySemanticEditPlan(before, editPlanSchema.parse({ schemaVersion: 1, command: 'troque a cena do jogo 2 por uma de combate', status: 'ready', confirmation: { required: false, question: null }, planner: { mode: 'read-only', provider: 'codex', model: 'synthetic' }, operations: [{ op: 'replace_subject_visual', subjectId: 'game-2', requestedKind: 'combat' }] }), { pace: 'standard', candidates: [], makeId: () => 'unused', segmentIdsForScene: (scene) => scene.id === 'scene-2' ? ['render-segment-2'] : [`render-${scene.id}`] });

    expect(result.affectedSceneIds).toEqual(['scene-2']);
    expect(result.rerenderSegmentIds).toEqual(['render-segment-2']);
    expect(result.storyboard.scenes[0]).toEqual(before.scenes[0]);
    expect(result.storyboard.scenes[1]).toMatchObject({ visualObjective: 'Mostrar combate', searchTerms: ['jogo', 'combate'], visual: { type: 'fallback', kind: 'animation' } });
    expect(result.storyboard.scenes[1]?.narration).toBe(before.scenes[1]?.narration);
    expect(result.storyboard.scenes[1]?.startMs).toBe(before.scenes[1]?.startMs);
    expect(result.storyboard.scenes[1]?.endMs).toBe(before.scenes[1]?.endMs);
    expect(result.storyboard.scenes[1]?.audio).toEqual(before.scenes[1]?.audio);
    expect(result.storyboard.narrationKey).toBe(before.narrationKey);
  });

  it('refuses a semantic plan that targets no subject or a locked scene', () => {
    const plan = editPlanSchema.parse({ schemaVersion: 1, command: 'combate', status: 'ready', confirmation: { required: false, question: null }, planner: { mode: 'read-only', provider: 'codex', model: 'synthetic' }, operations: [{ op: 'replace_subject_visual', subjectId: 'missing', requestedKind: 'combat' }] });
    expect(() => applySemanticEditPlan(storyboard(), plan, { pace: 'standard', candidates: [], makeId: () => 'unused', segmentIdsForScene: (scene) => [scene.id] })).toThrow(/subject|jogo|cena/i);
    const locked = storyboard();
    const second = locked.scenes[1];
    if (!second) throw new Error('fixture missing scene');
    locked.scenes[1] = { ...second, locked: true };
    expect(() => applySemanticEditPlan(locked, editPlanSchema.parse({ ...plan, operations: [{ op: 'replace_subject_visual', subjectId: 'game-2', requestedKind: 'combat' }] }), { pace: 'standard', candidates: [], makeId: () => 'unused', segmentIdsForScene: (scene) => [scene.id] })).toThrow(/bloqueada/i);
  });
});

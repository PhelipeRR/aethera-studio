import { describe, expect, it } from 'vitest';
import { characterGateRank, evaluateCharacterComposition, type CharacterGateEvidence } from '../src/character-gate.js';
import evidence from './fixtures/character-gate-cs9-evidence.json' with { type: 'json' };

// Real detector output (scripts/character_gate_worker.py) on CS9 images whose content was checked by eye.
const sample = (key: string) => (evidence as Record<string, CharacterGateEvidence>)[key]!;

describe('Character Composition Gate on real CS9 evidence', () => {
  it('passes (pending human review) a clean duo and a clean trio, never approving them outright', () => {
    const duo = evaluateCharacterComposition({ evidence: sample('run-cs9-2026-11-17T1117/anime-two-preview.png'), expectedCount: 2 });
    expect(duo).toMatchObject({ verdict: 'passed_pending_human_review', mainCount: 2, backgroundCount: 0, failureClass: 'none' });
    expect(duo.countsByDetector).toMatchObject({ yolo_person: 2, openpose: 2 });
    const trio = evaluateCharacterComposition({ evidence: sample('run-cs9-lora-2026-11-17T1109/cyberpunk-trio-preview.png'), expectedCount: 3 });
    expect(trio).toMatchObject({ verdict: 'passed_pending_human_review', mainCount: 3 });
  });

  it('rejects an extra mid-ground character confirmed by two detectors', () => {
    const result = evaluateCharacterComposition({ evidence: sample('run-cs9-2026-11-17T1117/cyberpunk-trio-preview.png'), expectedCount: 3 });
    expect(result.verdict).toBe('rejected');
    expect(result.failureClass).toBe('extras');
    expect(result.reasons).toContainEqual(expect.objectContaining({ code: 'extra_main_characters', severity: 'reject', detectors: ['yolo_person', 'openpose'] }));
  });

  it('rejects confident background pedestrians but only flags low-confidence ones', () => {
    const result = evaluateCharacterComposition({ evidence: sample('run-cs9-2026-11-17T1050/cyberpunk-trio-professional.png'), expectedCount: 3 });
    expect(result.verdict).toBe('rejected');
    expect(result.mainCount).toBe(3);
    expect(result.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining(['background_figures', 'possible_background_figures']));
  });

  it('marks needs_review instead of rejecting when a back-view character escapes every detector', () => {
    const result = evaluateCharacterComposition({ evidence: sample('run-cs9-2026-11-17T1050/anime-two-professional.png'), expectedCount: 2 });
    expect(result).toMatchObject({ verdict: 'needs_review', mainCount: 1, failureClass: 'missing' });
  });

  it('never passes illegible or erased casts', () => {
    const eight = evaluateCharacterComposition({ evidence: sample('run-cs9-2026-11-17T1050/cyberpunk-group-eight-preview.png'), expectedCount: 8 });
    expect(eight.verdict).toBe('needs_review');
    expect(eight.reasons[0]?.code).toBe('characters_not_detected');
    const erased = evaluateCharacterComposition({ evidence: sample('run-cs9-lora-2026-11-17T1121/anime-two-preview.png'), expectedCount: 2 });
    expect(erased.verdict).not.toBe('passed_pending_human_review');
  });

  it('keeps a stylized banner with only face evidence in review and checks the title safe area', () => {
    const banner = sample('run-cs9-2026-11-17T1050/nextworth-banner-preview.png');
    const safeArea = { x: 400, y: 200, width: 544, height: 360 };
    const result = evaluateCharacterComposition({ evidence: banner, expectedCount: 2, calmZones: [safeArea] });
    expect(result.verdict).toBe('needs_review');
    expect(result.reasons.map((reason) => reason.code)).toContain('low_detector_agreement');
    const intruding = evaluateCharacterComposition({ evidence: banner, expectedCount: 2, calmZones: [{ x: 0, y: 0, width: 1344, height: 768 }] });
    expect(intruding.verdict).toBe('rejected');
    expect(intruding.failureClass).toBe('placement');
  });

  it('reports detector failures as review reasons and ranks attempts', () => {
    const failed = evaluateCharacterComposition({ evidence: { width: 100, height: 100, detectors: { openpose: { error: 'cuda oom' } } }, expectedCount: 2 });
    expect(failed.verdict).toBe('needs_review');
    expect(failed.reasons).toContainEqual(expect.objectContaining({ code: 'detector_error' }));
    const passed = evaluateCharacterComposition({ evidence: sample('run-cs9-2026-11-17T1117/anime-two-preview.png'), expectedCount: 2 });
    const rejected = evaluateCharacterComposition({ evidence: sample('run-cs9-2026-11-17T1117/cyberpunk-trio-preview.png'), expectedCount: 3 });
    expect(characterGateRank(passed)).toBeGreaterThan(characterGateRank(failed));
    expect(characterGateRank(failed)).toBeGreaterThan(characterGateRank(rejected));
  });
});

describe('Character Composition Gate placement', () => {
  it('flags a main character much smaller than its planned region', () => {
    const evidence: CharacterGateEvidence = {
      width: 1344,
      height: 768,
      detectors: {
        yolo_person: { boxes: [{ x: 300, y: 400, width: 120, height: 240, confidence: 0.9 }, { x: 900, y: 80, width: 160, height: 620, confidence: 0.9 }] },
        openpose: { people: [] },
        yolo_face: { boxes: [] },
      },
    };
    const regions = [{ x: 200, y: 60, width: 330, height: 645 }, { x: 800, y: 60, width: 330, height: 645 }];
    const result = evaluateCharacterComposition({ evidence, expectedCount: 2, regions });
    expect(result.reasons.map((reason) => reason.code)).toContain('undersized_character');
    expect(result.verdict).toBe('needs_review');
    expect(result.failureClass).toBe('placement');
  });

  it('rejects the preview duo with confident background figures', () => {
    const result = evaluateCharacterComposition({ evidence: sample('run-cs9-2026-11-17T1050/anime-two-preview.png'), expectedCount: 2 });
    expect(result).toMatchObject({ verdict: 'rejected', mainCount: 2, failureClass: 'extras' });
  });
});

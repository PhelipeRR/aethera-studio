import { describe, expect, it } from 'vitest';
import {
  resolveContractControlConflict,
  syncPromptToControls,
  type ProductionControlDraft,
} from '../../../packages/desktop-shared/src/renderer/src/features/video/production-contract-ui-model.js';

const BASE_CONTROLS: ProductionControlDraft = {
  genre: 'gameplay_essay',
  format: 'youtube_16_9',
  targetDurationSec: 720,
  humorIntensity: 35,
  renderProfile: 'review_720p',
  language: 'pt-BR',
  voiceId: '9190edfa',
};

describe('production contract UI synchronization', () => {
  it('uses explicit prompt values until a control is manually changed', () => {
    const synced = syncPromptToControls(
      'Crie um TOP 5 de animes em português, com duração de 10 minutos.',
      BASE_CONTROLS,
      [],
    );

    expect(synced.controls.targetDurationSec).toBe(600);
    expect(synced.controls.genre).toBe('top_list');
    expect(synced.conflicts).toHaveLength(0);
  });

  it('keeps a manual value and exposes the prompt conflict instead of overwriting it', () => {
    const synced = syncPromptToControls(
      'Crie um TOP 5 de animes em português, com duração de 10 minutos.',
      { ...BASE_CONTROLS, targetDurationSec: 720 },
      ['targetDurationSec'],
    );

    expect(synced.controls.targetDurationSec).toBe(720);
    expect(synced.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'targetDurationSec', resolution: 'manual_value_wins' }),
    ]));
  });

  it('resolves a conflict explicitly in either direction', () => {
    const conflictState = syncPromptToControls(
      'Crie um TOP 5 de animes em português, com duração de 10 minutos.',
      { ...BASE_CONTROLS, targetDurationSec: 720 },
      ['targetDurationSec'],
    );
    const promptWins = resolveContractControlConflict(conflictState, 'targetDurationSec', 'use_prompt');
    const manualWins = resolveContractControlConflict(promptWins, 'targetDurationSec', 'keep_manual');

    expect(promptWins.controls.targetDurationSec).toBe(600);
    expect(promptWins.manualFields).not.toContain('targetDurationSec');
    expect(manualWins.controls.targetDurationSec).toBe(600);
    expect(manualWins.conflicts).toHaveLength(0);
  });
});

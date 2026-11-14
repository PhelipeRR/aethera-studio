import { describe, expect, it } from 'vitest';
import { extensionDisplayName } from '../src/renderer/src/app/extension-names.js';

describe('extension display names (AET-02)', () => {
  it('shows Aethera for the velix extension even when the stored manifest still says Velix', () => {
    expect(extensionDisplayName({ id: 'velix', name: 'Velix' })).toBe('Aethera');
    expect(extensionDisplayName({ id: 'velix', name: 'Aethera' })).toBe('Aethera');
  });

  it('keeps every other extension name as stored', () => {
    expect(extensionDisplayName({ id: 'neura', name: 'Neura' })).toBe('Neura');
    expect(extensionDisplayName({ id: 'other', name: 'Outra' })).toBe('Outra');
  });
});

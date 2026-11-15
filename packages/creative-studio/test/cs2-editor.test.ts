import { describe, expect, it } from 'vitest';
import {
  CREATIVE_PROJECT_SCHEMA_VERSION,
  LayeredDocumentEditor,
  creativeProjectDocumentSchema,
  type CreativeProjectDocument,
} from '../src/index.js';

function makeDoc(): CreativeProjectDocument {
  const now = new Date().toISOString();
  return creativeProjectDocumentSchema.parse({
    schemaVersion: CREATIVE_PROJECT_SCHEMA_VERSION,
    id: 'proj-ed-1',
    title: 'Editor Test',
    artType: 'banner',
    width: 2560,
    height: 1440,
    prompt: 'Banner gamer futurista',
    layers: [
      {
        id: 'bg-1',
        type: 'background',
        name: 'Fundo',
        zIndex: 0,
        fillColor: '#070B14',
        transform: { x: 0, y: 0, width: 2560, height: 1440 },
      },
      {
        id: 'text-1',
        type: 'text',
        name: 'Título Canal',
        zIndex: 1,
        text: 'NEURAL GAMING',
        fontSize: 110,
        transform: { x: 600, y: 600, width: 1000, height: 200 },
      },
      {
        id: 'wm-1',
        type: 'watermark',
        name: 'Watermark',
        zIndex: 2,
        label: 'NG',
        transform: { x: 2350, y: 1250, width: 150, height: 150 },
      },
    ],
    createdAt: now,
    updatedAt: now,
  });
}

describe('CS-2 LayeredDocumentEditor', () => {
  it('supports undo/redo, alignment to safe-center, reorder, effects and localized prompt edits', () => {
    const editor = new LayeredDocumentEditor(makeDoc());
    expect(editor.isDirty()).toBe(false);

    // Align title to banner safe area center
    editor.alignLayer('text-1', 'safe-center');
    const aligned = editor.getDocument().layers.find((l) => l.id === 'text-1');
    expect(aligned?.transform.x).toBe(Math.round((2560 - 1546) / 2 + (1546 - 1000) / 2));
    expect(editor.isDirty()).toBe(true);

    // Undo restores previous coordinates
    editor.undo();
    const reverted = editor.getDocument().layers.find((l) => l.id === 'text-1');
    expect(reverted?.transform.x).toBe(600);

    // Redo re-applies
    editor.redo();
    expect(editor.getDocument().layers.find((l) => l.id === 'text-1')?.transform.x).toBe(780);

    // Non-destructive effect upsert/remove
    editor.upsertEffect('text-1', { kind: 'dropShadow', enabled: true, offsetX: 0, offsetY: 10, blur: 20, color: '#000000' });
    expect(editor.getDocument().layers.find((l) => l.id === 'text-1')?.effects).toHaveLength(1);
    editor.removeEffect('text-1', 'dropShadow');
    expect(editor.getDocument().layers.find((l) => l.id === 'text-1')?.effects).toHaveLength(0);

    // Localized prompt edit changes only title & color, leaving background & watermark intact
    const promptRes = editor.applyLocalizedPromptEdit('Mude o título para "CYBER ARENA" na cor #00F0FF e adicione speed_lines');
    expect(promptRes.applied).toBe(true);
    const afterPrompt = editor.getDocument();
    const textLayer = afterPrompt.layers.find((l) => l.id === 'text-1');
    expect(textLayer?.type === 'text' && textLayer.text).toBe('CYBER ARENA');
    expect(textLayer?.type === 'text' && textLayer.color).toBe('#00F0FF');
    expect(afterPrompt.layers.some((l) => l.type === 'vfx' && l.preset === 'speed_lines')).toBe(true);
  });
});

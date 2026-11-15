import { randomUUID } from 'node:crypto';
import {
  ART_SPECIFICATIONS,
  creativeLayerSchema,
  creativeProjectDocumentSchema,
  type CreativeLayer,
  type CreativeProjectDocument,
  type LayerEffect,
  type LayerMask,
  type LayerTransform,
} from './schemas.js';

export type AlignTarget = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom' | 'safe-center';

export interface PromptEditResult {
  applied: boolean;
  summary: string;
  affectedLayerIds: string[];
}

function cloneDoc(doc: CreativeProjectDocument): CreativeProjectDocument {
  return structuredClone(doc);
}

function normalizeZIndices(layers: CreativeLayer[]): CreativeLayer[] {
  return [...layers]
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((layer, idx) => ({ ...layer, zIndex: idx }));
}

export class LayeredDocumentEditor {
  private current: CreativeProjectDocument;
  private undoStack: CreativeProjectDocument[] = [];
  private redoStack: CreativeProjectDocument[] = [];
  private lastSavedAt: string | null = null;
  private dirty = false;
  private readonly maxHistory: number;

  constructor(initialDoc: CreativeProjectDocument, options?: { maxHistory?: number }) {
    this.current = creativeProjectDocumentSchema.parse(cloneDoc(initialDoc));
    this.maxHistory = options?.maxHistory ?? 50;
  }

  getDocument(): CreativeProjectDocument {
    return cloneDoc(this.current);
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  isDirty(): boolean {
    return this.dirty;
  }

  getLastSavedAt(): string | null {
    return this.lastSavedAt;
  }

  markSaved(savedAt = new Date().toISOString()): void {
    this.lastSavedAt = savedAt;
    this.dirty = false;
  }

  private commit(mutator: (draft: CreativeProjectDocument) => void): CreativeProjectDocument {
    const snapshot = cloneDoc(this.current);
    const draft = cloneDoc(this.current);
    mutator(draft);
    draft.layers = normalizeZIndices(draft.layers);
    draft.updatedAt = new Date().toISOString();
    const validated = creativeProjectDocumentSchema.parse(draft);

    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.current = validated;
    this.dirty = true;
    return this.getDocument();
  }

  undo(): CreativeProjectDocument {
    const prev = this.undoStack.pop();
    if (!prev) return this.getDocument();
    this.redoStack.push(cloneDoc(this.current));
    this.current = prev;
    this.dirty = true;
    return this.getDocument();
  }

  redo(): CreativeProjectDocument {
    const next = this.redoStack.pop();
    if (!next) return this.getDocument();
    this.undoStack.push(cloneDoc(this.current));
    this.current = next;
    this.dirty = true;
    return this.getDocument();
  }

  addLayer(layer: CreativeLayer): CreativeProjectDocument {
    const parsed = creativeLayerSchema.parse(layer);
    return this.commit((draft) => {
      const maxZ = draft.layers.reduce((acc, l) => Math.max(acc, l.zIndex), -1);
      draft.layers.push({ ...parsed, zIndex: parsed.zIndex ?? maxZ + 1 });
    });
  }

  removeLayer(layerId: string): CreativeProjectDocument {
    return this.commit((draft) => {
      if (draft.layers.length <= 1) {
        throw new Error('Cannot remove the last remaining layer from a Creative Studio document.');
      }
      draft.layers = draft.layers.filter((l) => l.id !== layerId);
    });
  }

  duplicateLayer(layerId: string): CreativeProjectDocument {
    return this.commit((draft) => {
      const target = draft.layers.find((l) => l.id === layerId);
      if (!target) throw new Error(`Layer not found: ${layerId}`);
      const copy: CreativeLayer = {
        ...cloneDoc(target as unknown as CreativeProjectDocument) as unknown as CreativeLayer,
        id: `layer-${randomUUID().slice(0, 8)}`,
        name: `${target.name} (Cópia)`,
        zIndex: target.zIndex + 1,
        transform: {
          ...target.transform,
          x: target.transform.x + 24,
          y: target.transform.y + 24,
        },
      };
      draft.layers.push(copy);
    });
  }

  reorderLayer(layerId: string, direction: 'up' | 'down' | 'top' | 'bottom'): CreativeProjectDocument {
    return this.commit((draft) => {
      const sorted = normalizeZIndices(draft.layers);
      const idx = sorted.findIndex((l) => l.id === layerId);
      if (idx === -1) throw new Error(`Layer not found: ${layerId}`);
      const [item] = sorted.splice(idx, 1);
      if (!item) return;
      if (direction === 'up') sorted.splice(Math.min(sorted.length, idx + 1), 0, item);
      else if (direction === 'down') sorted.splice(Math.max(0, idx - 1), 0, item);
      else if (direction === 'top') sorted.push(item);
      else sorted.unshift(item);
      draft.layers = sorted.map((l, i) => ({ ...l, zIndex: i }));
    });
  }

  updateLayer(
    layerId: string,
    patch: Partial<CreativeLayer>,
  ): CreativeProjectDocument {
    return this.commit((draft) => {
      const idx = draft.layers.findIndex((l) => l.id === layerId);
      if (idx === -1) throw new Error(`Layer not found: ${layerId}`);
      const existing = draft.layers[idx]!;
      if (existing.locked && patch.locked !== false) {
        throw new Error(`Layer "${existing.name}" is locked.`);
      }
      draft.layers[idx] = creativeLayerSchema.parse({
        ...existing,
        ...patch,
        type: existing.type,
        id: existing.id,
      });
    });
  }

  updateTransform(layerId: string, transformPatch: Partial<LayerTransform>): CreativeProjectDocument {
    return this.commit((draft) => {
      const layer = draft.layers.find((l) => l.id === layerId);
      if (!layer) throw new Error(`Layer not found: ${layerId}`);
      if (layer.locked) throw new Error(`Layer "${layer.name}" is locked.`);
      layer.transform = {
        ...layer.transform,
        ...transformPatch,
      };
    });
  }

  alignLayer(layerId: string, align: AlignTarget): CreativeProjectDocument {
    return this.commit((draft) => {
      const layer = draft.layers.find((l) => l.id === layerId);
      if (!layer) throw new Error(`Layer not found: ${layerId}`);
      if (layer.locked) throw new Error(`Layer "${layer.name}" is locked.`);
      const w = layer.transform.width * layer.transform.scaleX;
      const h = layer.transform.height * layer.transform.scaleY;
      const safe = ART_SPECIFICATIONS[draft.artType].safeArea;

      switch (align) {
        case 'left':
          layer.transform.x = 32;
          break;
        case 'center-x':
          layer.transform.x = Math.round((draft.width - w) / 2);
          break;
        case 'right':
          layer.transform.x = Math.round(draft.width - w - 32);
          break;
        case 'top':
          layer.transform.y = 32;
          break;
        case 'center-y':
          layer.transform.y = Math.round((draft.height - h) / 2);
          break;
        case 'bottom':
          layer.transform.y = Math.round(draft.height - h - 32);
          break;
        case 'safe-center':
          if (safe) {
            layer.transform.x = Math.round(safe.x + (safe.width - w) / 2);
            layer.transform.y = Math.round(safe.y + (safe.height - h) / 2);
          } else {
            layer.transform.x = Math.round((draft.width - w) / 2);
            layer.transform.y = Math.round((draft.height - h) / 2);
          }
          break;
      }
    });
  }

  setMask(layerId: string, mask: LayerMask): CreativeProjectDocument {
    return this.commit((draft) => {
      const layer = draft.layers.find((l) => l.id === layerId);
      if (!layer) throw new Error(`Layer not found: ${layerId}`);
      layer.mask = mask;
    });
  }

  upsertEffect(layerId: string, effect: LayerEffect): CreativeProjectDocument {
    return this.commit((draft) => {
      const layer = draft.layers.find((l) => l.id === layerId);
      if (!layer) throw new Error(`Layer not found: ${layerId}`);
      const existingIdx = layer.effects.findIndex((e) => e.kind === effect.kind);
      if (existingIdx >= 0) {
        layer.effects[existingIdx] = effect;
      } else {
        layer.effects.push(effect);
      }
    });
  }

  removeEffect(layerId: string, kind: LayerEffect['kind']): CreativeProjectDocument {
    return this.commit((draft) => {
      const layer = draft.layers.find((l) => l.id === layerId);
      if (!layer) throw new Error(`Layer not found: ${layerId}`);
      layer.effects = layer.effects.filter((e) => e.kind !== kind);
    });
  }

  /**
   * Localized prompt editing: updates only the targeted layer(s) requested by the user
   * without regenerating unrelated layers.
   */
  applyLocalizedPromptEdit(instruction: string): PromptEditResult {
    const trimmed = instruction.trim();
    if (!trimmed) {
      return { applied: false, summary: 'Instrução vazia.', affectedLayerIds: [] };
    }

    const lower = trimmed.toLowerCase();
    const affected: string[] = [];
    const actions: string[] = [];

    // 1. Change title text: "mude o título para X" / "change title to X" / "título: X"
    const titleMatch = trimmed.match(/(?:t[ií]tulo|texto|title)\s*(?:para|to|:)\s*["“]?([^"”]+)["”]?/i);
    if (titleMatch?.[1]) {
      const newText = titleMatch[1].trim();
      this.commit((draft) => {
        const textLayer =
          draft.layers.find((l) => l.type === 'text' && l.role === 'headline') ??
          draft.layers.find((l) => l.type === 'text');
        if (textLayer && textLayer.type === 'text') {
          textLayer.text = newText;
          affected.push(textLayer.id);
          actions.push(`Título alterado para "${newText}"`);
        }
      });
    }

    // 2. Hex color update: "cor ... #RRGGBB" (skip when explicitly setting neon/rim light)
    const colorMatch = trimmed.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/);
    if (colorMatch && !/(?:ilumina[cç][aã]o\s+neon|rim\s*light|luz\s+direcional)/i.test(lower)) {
      const hex = `#${colorMatch[1]!.toUpperCase()}`;
      this.commit((draft) => {
        if (lower.includes('fundo') || lower.includes('background')) {
          const bg = draft.layers.find((l) => l.type === 'background');
          if (bg && bg.type === 'background') {
            bg.fillColor = hex;
            affected.push(bg.id);
            actions.push(`Cor de fundo alterada para ${hex}`);
          }
        } else {
          const textLayer =
            draft.layers.find((l) => l.type === 'text' && l.role === 'headline') ??
            draft.layers.find((l) => l.type === 'text');
          if (textLayer && textLayer.type === 'text') {
            textLayer.color = hex;
            affected.push(textLayer.id);
            actions.push(`Cor do texto alterada para ${hex}`);
          }
        }
      });
    }

    // 3. Toggle visibility of watermark/vfx/subject
    if (/(?:ocultar|esconder|hide|remover|remove)\s+(?:a\s+)?(?:marca|watermark)/i.test(lower)) {
      this.commit((draft) => {
        for (const l of draft.layers) {
          if (l.type === 'watermark') {
            l.visible = false;
            affected.push(l.id);
            actions.push('Marca d\'água ocultada');
          }
        }
      });
    } else if (/(?:mostrar|exibir|show)\s+(?:a\s+)?(?:marca|watermark)/i.test(lower)) {
      this.commit((draft) => {
        for (const l of draft.layers) {
          if (l.type === 'watermark') {
            l.visible = true;
            affected.push(l.id);
            actions.push('Marca d\'água exibida');
          }
        }
      });
    }

    // 4. Font size adjustment
    if (/(?:aumentar|maior|bigger)\s+(?:o\s+)?(?:t[ií]tulo|texto|fonte)/i.test(lower)) {
      this.commit((draft) => {
        const textLayer = draft.layers.find((l) => l.type === 'text');
        if (textLayer && textLayer.type === 'text') {
          textLayer.fontSize = Math.min(260, Math.round(textLayer.fontSize * 1.15));
          affected.push(textLayer.id);
          actions.push(`Fonte aumentada para ${textLayer.fontSize}px`);
        }
      });
    } else if (/(?:diminuir|menor|smaller)\s+(?:o\s+)?(?:t[ií]tulo|texto|fonte)/i.test(lower)) {
      this.commit((draft) => {
        const textLayer = draft.layers.find((l) => l.type === 'text');
        if (textLayer && textLayer.type === 'text') {
          textLayer.fontSize = Math.max(24, Math.round(textLayer.fontSize * 0.85));
          affected.push(textLayer.id);
          actions.push(`Fonte reduzida para ${textLayer.fontSize}px`);
        }
      });
    }

    // 5. Rotation on subject
    const rotMatch = trimmed.match(/(?:girar|rotacionar|rotate)\s+(?:o\s+)?(?:personagem|sujeito|subject)?\s*(-?\d+)\s*(?:graus|deg)?/i);
    if (rotMatch?.[1]) {
      const deg = Number(rotMatch[1]);
      this.commit((draft) => {
        const subject = draft.layers.find((l) => l.type === 'subject');
        if (subject) {
          subject.transform.rotationDeg = Math.max(-180, Math.min(180, deg));
          affected.push(subject.id);
          actions.push(`Personagem rotacionado para ${subject.transform.rotationDeg}°`);
        }
      });
    }

    // 6. Scale subject: "aumente o personagem" / "diminua o personagem"
    if (/(?:aumente|aumentar|ampliar|crescer|enlarge|scale up)\s+(?:o\s+)?(?:personagem|sujeito|subject|mascote)/i.test(lower)) {
      this.commit((draft) => {
        const subject = draft.layers.find((l) => l.type === 'subject');
        if (subject) {
          subject.transform.scaleX = Math.min(2.2, Number((subject.transform.scaleX * 1.18).toFixed(2)));
          subject.transform.scaleY = Math.min(2.2, Number((subject.transform.scaleY * 1.18).toFixed(2)));
          affected.push(subject.id);
          actions.push(`Personagem ampliado (${subject.transform.scaleX}x)`);
        }
      });
    } else if (/(?:diminua|diminuir|reduzir|shrink|scale down)\s+(?:o\s+)?(?:personagem|sujeito|subject|mascote)/i.test(lower)) {
      this.commit((draft) => {
        const subject = draft.layers.find((l) => l.type === 'subject');
        if (subject) {
          subject.transform.scaleX = Math.max(0.4, Number((subject.transform.scaleX * 0.85).toFixed(2)));
          subject.transform.scaleY = Math.max(0.4, Number((subject.transform.scaleY * 0.85).toFixed(2)));
          affected.push(subject.id);
          actions.push(`Personagem reduzido (${subject.transform.scaleX}x)`);
        }
      });
    }

    // 7. Make title more impactful: "deixe o título mais impactante"
    if (/(?:t[ií]tulo|texto|title).*(?:impactante|forte|destaque|bold|punchy)/i.test(lower)) {
      this.commit((draft) => {
        const textLayer = draft.layers.find((l) => l.type === 'text');
        if (textLayer && textLayer.type === 'text') {
          textLayer.fontSize = Math.min(220, Math.round(textLayer.fontSize * 1.12));
          textLayer.strokeWidth = Math.max(textLayer.strokeWidth, 10);
          textLayer.effects = [
            ...textLayer.effects.filter((e) => e.kind !== 'dropShadow' && e.kind !== 'outerGlow'),
            { kind: 'dropShadow', enabled: true, offsetX: 0, offsetY: 10, blur: 18, color: '#000000CC' },
            { kind: 'outerGlow', enabled: true, radius: 20, intensity: 0.75, color: textLayer.color },
          ];
          affected.push(textLayer.id);
          actions.push('Título reforçado com fonte ampliada, sombra e brilho');
        }
      });
    }

    // 8. Add neon / rim lighting: "adicione iluminação neon"
    if (/(?:ilumina[cç][aã]o\s+neon|rim\s*light|luz\s+direcional)/i.test(lower)) {
      this.commit((draft) => {
        const neonColor = colorMatch ? `#${colorMatch[1]!.toUpperCase()}` : '#00F0FF';
        const subject = draft.layers.find((l) => l.type === 'subject');
        if (subject && subject.type === 'subject') {
          subject.rimLightColor = neonColor;
          affected.push(subject.id);
        }
        const bg = draft.layers.find((l) => l.type === 'background');
        if (bg) {
          bg.effects = [
            ...bg.effects.filter((e) => e.kind !== 'directionalLight'),
            { kind: 'directionalLight', enabled: true, angleDeg: 35, color: neonColor, intensity: 0.5 },
          ];
          affected.push(bg.id);
        }
        actions.push(`Iluminação neon (${neonColor}) aplicada`);
      });
    }

    // 9. Swap/tint background: "troque o fundo"
    if (/(?:troque|trocar|mude|mudar|alterar)\s+(?:o\s+)?fundo/i.test(lower) && !colorMatch) {
      this.commit((draft) => {
        const bg = draft.layers.find((l) => l.type === 'background');
        if (bg && bg.type === 'background') {
          bg.fillColor = lower.includes('vermelho') || lower.includes('red') ? '#450A0A' : lower.includes('roxo') || lower.includes('purple') ? '#2E1065' : '#090D16';
          bg.gradientTo = lower.includes('neon') || lower.includes('cyber') ? '#0E7490' : '#1E1B4B';
          bg.effects = [
            ...bg.effects.filter((e) => e.kind !== 'depthBlur'),
            { kind: 'depthBlur', enabled: true, radius: 3.5 },
          ];
          affected.push(bg.id);
          actions.push('Fundo atualizado com gradiente e profundidade');
        }
      });
    }

    // 10. Add or switch VFX preset
    const vfxPresets = ['particles', 'speed_lines', 'light_leak', 'cyber_grid', 'rim_glow', 'duotone_wash'] as const;
    for (const preset of vfxPresets) {
      if (lower.includes(preset) || lower.includes(preset.replace('_', ' '))) {
        this.commit((draft) => {
          const existing = draft.layers.find((l) => l.type === 'vfx');
          if (existing && existing.type === 'vfx') {
            existing.preset = preset;
            existing.visible = true;
            affected.push(existing.id);
            actions.push(`Efeito VFX alterado para ${preset}`);
          } else {
            const id = `vfx-${randomUUID().slice(0, 6)}`;
            draft.layers.push(
              creativeLayerSchema.parse({
                id,
                type: 'vfx',
                name: `VFX ${preset}`,
                zIndex: draft.layers.length,
                preset,
                transform: { x: 0, y: 0, width: draft.width, height: draft.height },
              }),
            );
            affected.push(id);
            actions.push(`Camada VFX ${preset} adicionada`);
          }
        });
        break;
      }
    }

    const uniqueAffected = Array.from(new Set(affected));
    return {
      applied: uniqueAffected.length > 0,
      summary: actions.length > 0 ? actions.join('; ') : 'Nenhuma camada correspondente foi alterada pela instrução.',
      affectedLayerIds: uniqueAffected,
    };
  }
}

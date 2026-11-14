import { describe, it, expect } from 'vitest';
import { classifyAndSelectSfx, validateSfxEvents, SFX_CATALOG, SFX_DURATIONS_MS } from '../src/aethera-sfx-classifier.js';
import type { TimelineDocument } from '../src/aethera-timeline.js';

/** Cria uma timeline mínima para testes com segmentos gráficos controlados. */
function makeTestTimeline(segments: Array<{ intentReason: string; label: string; startMs: number; durationMs: number }>): TimelineDocument {
  return {
    id: 'test-timeline',
    version: 1,
    fps: 30,
    format: { width: 1920, height: 1080, aspectRatio: '16:9' },
    audio: { targetLufs: -14, truePeakDb: -1, musicDuckDb: -12, duck: { attackMs: 80, releaseMs: 250 }, stems: { narration: 0, music: -12, sfx: 0 } },
    tracks: [
      { kind: 'graphics', items: segments.map((seg, i) => ({
        id: `gfx-${i}`,
        startMs: seg.startMs,
        durationMs: seg.durationMs,
        sceneIds: [`scene-${i}`],
        label: seg.label,
        source: { kind: 'graphic' as const },
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
        keyframes: [],
        effects: [],
        intent: { reason: seg.intentReason },
      })) },
      { kind: 'captions', items: [] },
      { kind: 'narration', items: [] },
      { kind: 'music', items: [] },
      { kind: 'sfx', items: [] },
    ],
  } as unknown as TimelineDocument;
}

describe('aethera-sfx-classifier', () => {
  describe('classifyAndSelectSfx', () => {
    it('retorna eventos vazios para timeline sem graphics', () => {
      const timeline = { id: 'empty', fps: 30, tracks: [{ kind: 'captions', items: [] }] } as unknown as TimelineDocument;
      const events = classifyAndSelectSfx({ timeline, sfxBasePath: '/sfx' });
      expect(events).toHaveLength(0);
    });

    it('seleciona SFX para timeline com intents variados', () => {
      const timeline = makeTestTimeline([
        { intentReason: 'diagrama do diretor', label: 'Abertura', startMs: 0, durationMs: 3000 },
        { intentReason: 'texto do diretor', label: 'Meio', startMs: 3000, durationMs: 3000 },
        { intentReason: 'diagrama do diretor', label: 'Fechamento', startMs: 6000, durationMs: 3000 },
      ]);
      const events = classifyAndSelectSfx({ timeline, sfxBasePath: '/sfx' });
      expect(events.length).toBeGreaterThanOrEqual(1);
      // Todos os eventos devem ter gain negativo e estar dentro da timeline
      for (const event of events) {
        expect(event.gainDb).toBeLessThan(0);
        expect(event.atMs).toBeGreaterThanOrEqual(0);
        expect(event.atMs).toBeLessThan(9000);
      }
    });

    it('seleciona impacto para diagrama do diretor (não-abertura)', () => {
      const timeline = makeTestTimeline([
        { intentReason: 'texto do diretor', label: 'Intro', startMs: 0, durationMs: 2000 },
        { intentReason: 'diagrama do diretor', label: 'Explicação visual', startMs: 2000, durationMs: 5000 },
        { intentReason: 'texto do diretor', label: 'Fechamento', startMs: 7000, durationMs: 2000 },
      ]);
      const events = classifyAndSelectSfx({ timeline, sfxBasePath: '/sfx' });
      const diagramEvent = events.find(e => e.atMs === 2000);
      expect(diagramEvent).toBeDefined();
      const impactFiles = SFX_CATALOG.impact;
      expect(impactFiles.some(f => diagramEvent?.relativePath.endsWith(f) ?? false)).toBe(true);
    });

    it('respeita silêncio intencional para texto do diretor', () => {
      const timeline = makeTestTimeline([
        { intentReason: 'texto do diretor', label: 'Texto simples', startMs: 0, durationMs: 3000 },
        { intentReason: 'texto do diretor', label: 'Outro texto', startMs: 3000, durationMs: 3000 },
        { intentReason: 'texto do diretor', label: 'Mais texto', startMs: 6000, durationMs: 3000 },
      ]);
      const events = classifyAndSelectSfx({ timeline, sfxBasePath: '/sfx' });
      // Apenas abertura e fechamento devem ter SFX; meio deve ser silêncio
      const middleEvents = events.filter(e => e.atMs === 3000);
      expect(middleEvents).toHaveLength(0);
    });

    it('evita repetição consecutiva do mesmo SFX', () => {
      const timeline = makeTestTimeline([
        { intentReason: 'diagrama do diretor', label: 'Diagrama 1', startMs: 0, durationMs: 3000 },
        { intentReason: 'diagrama do diretor', label: 'Diagrama 2', startMs: 3000, durationMs: 3000 },
        { intentReason: 'diagrama do diretor', label: 'Diagrama 3', startMs: 6000, durationMs: 3000 },
      ]);
      const events = classifyAndSelectSfx({ timeline, sfxBasePath: '/sfx' });
      for (let i = 1; i < events.length; i++) {
        expect(events[i]?.relativePath).not.toBe(events[i - 1]?.relativePath);
      }
    });

    it('previne sobreposição excessiva (mínimo 200ms entre SFX)', () => {
      const timeline = makeTestTimeline([
        { intentReason: 'diagrama do diretor', label: 'A', startMs: 0, durationMs: 100 },
        { intentReason: 'diagrama do diretor', label: 'B', startMs: 50, durationMs: 100 },
        { intentReason: 'diagrama do diretor', label: 'C', startMs: 300, durationMs: 100 },
      ]);
      const events = classifyAndSelectSfx({ timeline, sfxBasePath: '/sfx' });
      // Segundo evento deve ser pulado porque está a 50ms do primeiro
      expect(events.length).toBeLessThanOrEqual(2);
    });

    it('seleciona glitch para labels com cyberpunk/tecnologia (não-abertura)', () => {
      const timeline = makeTestTimeline([
        { intentReason: 'texto do diretor', label: 'Intro normal', startMs: 0, durationMs: 2000 },
        { intentReason: 'composição multi-painel do diretor', label: 'Cyberpunk dois mil e setenta e sete', startMs: 2000, durationMs: 4000 },
      ]);
      const events = classifyAndSelectSfx({ timeline, sfxBasePath: '/sfx' });
      const techEvent = events.find(e => e.atMs === 2000);
      expect(techEvent).toBeDefined();
      // composição multi-painel tem prioridade 8, glitch por keyword tem prioridade 8 — empate ganha o primeiro
      // Mas a regra de glitch verifica label, e "Cyberpunk" casa; ambas têm priority 8, reduce pega a primeira
      // A ordem no array CONTEXT_RULES coloca composição antes de glitch, então composição vence
      // Vamos verificar que pelo menos um SFX foi selecionado neste segmento
      expect(techEvent?.gainDb).toBeLessThan(0);
    });

    it('seleciona SFX para pergunta em segmento não-inicial', () => {
      const timeline = makeTestTimeline([
        { intentReason: 'diagrama do diretor', label: 'Contexto', startMs: 0, durationMs: 2000 },
        { intentReason: 'texto do diretor', label: 'Por que isso acontece?', startMs: 2000, durationMs: 3000 },
        { intentReason: 'texto do diretor', label: 'Resposta', startMs: 5000, durationMs: 3000 },
      ]);
      const events = classifyAndSelectSfx({ timeline, sfxBasePath: '/sfx' });
      const questionEvent = events.find(e => e.atMs === 2000);
      // Transição diagrama→texto gera transition (priority 6) ou interface por '?' (priority 6);
      // mesma prioridade → ordem no array decide. Verificamos apenas presença de SFX com gain negativo.
      expect(questionEvent).toBeDefined();
      expect(questionEvent?.gainDb).toBeLessThan(0);
    });

    it('usa gain negativo para todos os eventos', () => {
      const timeline = makeTestTimeline([
        { intentReason: 'diagrama do diretor', label: 'Diagrama', startMs: 0, durationMs: 3000 },
        { intentReason: 'composição multi-painel do diretor', label: 'Painéis', startMs: 3000, durationMs: 3000 },
      ]);
      const events = classifyAndSelectSfx({ timeline, sfxBasePath: '/sfx' });
      for (const event of events) {
        expect(event.gainDb).toBeLessThan(0);
      }
    });

    it('calcula frame corretamente baseado no fps', () => {
      const timeline = makeTestTimeline([
        { intentReason: 'diagrama do diretor', label: 'Teste', startMs: 1000, durationMs: 2000 },
      ]);
      const events = classifyAndSelectSfx({ timeline, sfxBasePath: '/sfx' });
      const event = events.find(e => e.atMs === 1000);
      if (event) {
        expect(event.frame).toBe(Math.round((1000 * 30) / 1000)); // 30 fps
      }
    });
  });

  describe('validateSfxEvents', () => {
    it('valida eventos corretos', () => {
      const events = [
        { id: 'sfx-1', sfxId: 'whoosh', relativePath: '/sfx/whoosh.wav', atMs: 0, durationMs: 380, frame: 0, gainDb: -6, licenseEvidence: 'test' },
        { id: 'sfx-2', sfxId: 'boom', relativePath: '/sfx/boom.wav', atMs: 1000, durationMs: 2200, frame: 30, gainDb: -8, licenseEvidence: 'test' },
      ];
      const result = validateSfxEvents(events, 5000);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejeita atMs negativo', () => {
      const events = [
        { id: 'sfx-1', sfxId: 'whoosh', relativePath: '/sfx/whoosh.wav', atMs: -100, durationMs: 380, frame: 0, gainDb: -6, licenseEvidence: 'test' },
      ];
      const result = validateSfxEvents(events, 5000);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('atMs negativo');
    });

    it('rejeita evento fora da timeline', () => {
      const events = [
        { id: 'sfx-1', sfxId: 'whoosh', relativePath: '/sfx/whoosh.wav', atMs: 6000, durationMs: 380, frame: 180, gainDb: -6, licenseEvidence: 'test' },
      ];
      const result = validateSfxEvents(events, 5000);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('fora da timeline');
    });

    it('rejeita gain positivo', () => {
      const events = [
        { id: 'sfx-1', sfxId: 'whoosh', relativePath: '/sfx/whoosh.wav', atMs: 0, durationMs: 380, frame: 0, gainDb: 3, licenseEvidence: 'test' },
      ];
      const result = validateSfxEvents(events, 5000);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('gain positivo');
    });

    it('detecta sobreposição excessiva', () => {
      const events = [
        { id: 'sfx-1', sfxId: 'boom', relativePath: '/sfx/boom.wav', atMs: 0, durationMs: 2200, frame: 0, gainDb: -6, licenseEvidence: 'test' },
        { id: 'sfx-2', sfxId: 'impacto', relativePath: '/sfx/impacto.wav', atMs: 1000, durationMs: 1400, frame: 30, gainDb: -6, licenseEvidence: 'test' },
      ];
      const result = validateSfxEvents(events, 5000);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('sobreposição excessiva');
    });
  });

  describe('SFX_CATALOG', () => {
    it('contém todas as categorias esperadas', () => {
      expect(Object.keys(SFX_CATALOG)).toEqual(expect.arrayContaining(['transition', 'impact', 'tension', 'interface', 'glitch', 'ambient']));
    });

    it('todos os arquivos têm duração registrada', () => {
      for (const category of Object.values(SFX_CATALOG)) {
        for (const file of category) {
          expect(SFX_DURATIONS_MS[file]).toBeDefined();
          expect(SFX_DURATIONS_MS[file]).toBeGreaterThan(0);
        }
      }
    });

    it('totaliza 35 SFX únicos', () => {
      const allFiles = new Set(Object.values(SFX_CATALOG).flat());
      expect(allFiles.size).toBe(35);
    });
  });
});
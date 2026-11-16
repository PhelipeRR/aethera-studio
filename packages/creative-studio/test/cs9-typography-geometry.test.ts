import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AssetIngestionService,
  QualityGateService,
  SharpSvgCompositionEngine,
  auditTypographyGeometry,
  creativeProjectDocumentSchema,
  type CreativeProjectDocument,
  type ManagedAssetRef,
} from '../src/index.js';

/**
 * CS-9 — Typography audited on the real rendered geometry of each layer.
 * Every defective fixture reproduces a defect observed in the CS-9 artifacts
 * (title over an object, kicker chip over the title, divider crossing the title,
 * text over a busy background, text cut by the canvas, unreadable vertical kicker).
 */

let root: string;
let ingestion: AssetIngestionService;
let engine: SharpSvgCompositionEngine;
let busyAsset: ManagedAssetRef;
let opaqueSubject: ManagedAssetRef;

const now = new Date().toISOString();

function textLayer(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'title',
    name: 'Título',
    type: 'text',
    role: 'headline',
    zIndex: 10,
    text: 'NEON CITY',
    fontFamily: 'Arial',
    fontSize: 110,
    fontWeight: 800,
    color: '#FFFFFF',
    strokeColor: '#000000',
    strokeWidth: 4,
    transform: { x: 90, y: 420, width: 760, height: 150 },
    ...over,
  };
}

function doc(layers: Array<Record<string, unknown>>, manifest: Record<string, ManagedAssetRef> = {}): CreativeProjectDocument {
  return creativeProjectDocumentSchema.parse({
    schemaVersion: 1,
    id: `doc-${Math.random().toString(36).slice(2, 8)}`,
    title: 'CS-9 geometry fixture',
    artType: 'thumbnail',
    width: 1280,
    height: 720,
    prompt: 'neon city fixture',
    layers: [
      {
        id: 'bg',
        name: 'Fundo',
        type: 'background',
        zIndex: 0,
        fillColor: '#0B1020',
        gradientTo: '#101830',
        transform: { x: 0, y: 0, width: 1280, height: 720 },
      },
      ...layers,
    ],
    assetManifest: manifest,
    createdAt: now,
    updatedAt: now,
  });
}

function codes(report: { findings: Array<{ code: string; severity: string }> }, severity?: string): string[] {
  return report.findings.filter((f) => !severity || f.severity === severity).map((f) => f.code);
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'cs9-geo-'));
  ingestion = new AssetIngestionService({ storageRoot: root });
  engine = new SharpSvgCompositionEngine(ingestion);
  // High-frequency mid/high-luma pattern: the kind of busy brass/pipe texture seen in the CS-9 Cyberpunk A render.
  const W = 1280;
  const H = 720;
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const on = (Math.floor(x / 48) + Math.floor(y / 48)) % 2 === 0;
      const o = (y * W + x) * 3;
      raw[o] = on ? 235 : 40;
      raw[o + 1] = on ? 190 : 35;
      raw[o + 2] = on ? 90 : 20;
    }
  }
  busyAsset = await ingestion.ingestBuffer({
    buffer: await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer(),
    kind: 'image',
    extension: 'png',
    originalName: 'busy.png',
  });
  opaqueSubject = await ingestion.ingestBuffer({
    buffer: await sharp({ create: { width: 600, height: 400, channels: 4, background: { r: 120, g: 30, b: 30, alpha: 1 } } }).png().toBuffer(),
    kind: 'image',
    extension: 'png',
    originalName: 'subject.png',
  });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('CS-9 — auditTypographyGeometry (real rendered geometry)', () => {
  it('accepts a large, high-contrast title inside the safe area with no collisions', async () => {
    const report = await auditTypographyGeometry(engine, doc([textLayer({})]));
    expect(codes(report, 'critical')).toEqual([]);
    const [title] = report.layers;
    if (!title?.glyphBox) throw new Error('title glyphs were not measured');
    // Glyph box is measured from pixels, so it is tighter than the declared box.
    expect(title.glyphBox.width).toBeLessThan(title.declaredBox.width);
    expect(title.lineGlyphHeightAt224).toBeGreaterThanOrEqual(9);
    expect(title.contrastRatioAt224).toBeGreaterThanOrEqual(3);
  });

  it('detects glyphs cut by the canvas edge', async () => {
    const report = await auditTypographyGeometry(engine, doc([textLayer({ transform: { x: -160, y: 420, width: 760, height: 150 } })]));
    expect(codes(report, 'critical')).toContain('TEXT_CLIPPED_BY_CANVAS');
    expect(report.layers[0]?.glyphOutsideCanvasRatio).toBeGreaterThan(0);
  });

  it('detects glyphs dropped by the rasterizer when the text cannot fit its box', async () => {
    // Measured: in a 260px box only 4355 glyph pixels render vs 5003 with room — librsvg drops whole letters.
    const report = await auditTypographyGeometry(
      engine,
      doc([textLayer({ text: 'SANDEVISTANMAXIMO', transform: { x: 90, y: 420, width: 260, height: 40 } })]),
    );
    expect(codes(report, 'critical')).toContain('TEXT_CLIPPED_BY_BOX');
    expect(codes(report, 'critical')).toContain('TEXT_TOO_SMALL_AT_224');
  });

  it('detects glyphs cut by their own layer box when even the minimum size overflows', async () => {
    const report = await auditTypographyGeometry(
      engine,
      doc([textLayer({ text: 'SANDEVISTANMAXIMOULTRA', strokeWidth: 0, transform: { x: 90, y: 420, width: 140, height: 40 } })]),
    );
    expect(codes(report, 'critical')).toContain('TEXT_CLIPPED_BY_BOX');
  });

  it('detects a kicker chip colliding with the title', async () => {
    const report = await auditTypographyGeometry(
      engine,
      doc([
        textLayer({}),
        textLayer({
          id: 'kicker',
          name: 'Kicker',
          role: 'kicker',
          text: 'ARQUIVO',
          fontSize: 34,
          strokeWidth: 0,
          pillColor: '#1E293B',
          zIndex: 11,
          transform: { x: 90, y: 440, width: 260, height: 60 },
        }),
      ]),
    );
    expect(codes(report, 'critical')).toContain('TEXT_TEXT_COLLISION');
  });

  it('detects a split divider crossing the title', async () => {
    const report = await auditTypographyGeometry(
      engine,
      doc([
        textLayer({ text: 'TELESCOPIO PROFUNDO', transform: { x: 200, y: 420, width: 900, height: 150 } }),
        {
          id: 'divider',
          name: 'Divisor',
          type: 'shape',
          shapeKind: 'rect',
          fillColor: '#FACC15',
          borderRadius: 0,
          zIndex: 12,
          transform: { x: 400, y: 0, width: 8, height: 720 },
        },
      ]),
    );
    expect(codes(report)).toContain('TEXT_SHAPE_COLLISION');
  });

  it('detects text hidden behind a subject layer', async () => {
    const report = await auditTypographyGeometry(
      engine,
      doc(
        [
          textLayer({}),
          {
            id: 'subject',
            name: 'Sujeito',
            type: 'subject',
            assetId: opaqueSubject.id,
            zIndex: 20,
            transform: { x: 60, y: 380, width: 900, height: 240 },
          },
        ],
        { [opaqueSubject.id]: opaqueSubject },
      ),
    );
    expect(codes(report, 'critical')).toContain('TEXT_OCCLUDED_OR_INVISIBLE');
    expect(codes(report)).toContain('TEXT_SUBJECT_COLLISION');
  });

  it('flags text outside the title-safe area and under the duration badge', async () => {
    const report = await auditTypographyGeometry(
      engine,
      doc([textLayer({ text: 'FIM', fontSize: 80, transform: { x: 1080, y: 610, width: 200, height: 110 } })]),
    );
    expect(codes(report)).toContain('TEXT_OUTSIDE_SAFE_AREA');
    expect(codes(report)).toContain('TEXT_UNDER_TIMESTAMP_BADGE');
  });

  it('measures headline size at 224×126 and rejects a tiny title', async () => {
    const report = await auditTypographyGeometry(
      engine,
      doc([textLayer({ fontSize: 26, strokeWidth: 0, transform: { x: 90, y: 420, width: 760, height: 60 } })]),
    );
    expect(codes(report, 'critical')).toContain('TEXT_TOO_SMALL_AT_224');
    expect(report.layers[0]?.lineGlyphHeightAt224).toBeLessThan(7);
  });

  it('measures WCAG contrast against the immediate surround, not global image stdev', async () => {
    const report = await auditTypographyGeometry(
      engine,
      doc([textLayer({ color: '#1A2238', strokeWidth: 0 })]),
    );
    const contrast = report.layers[0]?.contrastRatioAt224;
    expect(contrast).not.toBeNull();
    expect(contrast ?? 99).toBeLessThan(3);
    expect(codes(report, 'critical')).toContain('TEXT_LOW_CONTRAST_AT_224');
  });

  it('flags a mid-tone title over a busy background', async () => {
    const report = await auditTypographyGeometry(
      engine,
      doc(
        [
          {
            id: 'bg-busy',
            name: 'Fundo Detalhado',
            type: 'background',
            assetId: busyAsset.id,
            zIndex: 1,
            transform: { x: 0, y: 0, width: 1280, height: 720 },
          },
          textLayer({ color: '#D4A84A', strokeWidth: 0 }),
        ],
        { [busyAsset.id]: busyAsset },
      ),
    );
    expect(codes(report)).toContain('TEXT_BUSY_BACKGROUND_AT_224');
  });

  it('QualityGateService blocks thumbnails on measured typography defects', async () => {
    const gate = new QualityGateService(engine);
    const good = await gate.auditProject(doc([textLayer({})]));
    const geometryCodes = (r: typeof good) =>
      r.findings.filter((f) => f.code.startsWith('TEXT_') && f.severity === 'critical').map((f) => f.code);
    expect(geometryCodes(good)).toEqual([]);
    expect(good.typographyGeometry?.length).toBe(1);

    const clipped = await gate.auditProject(doc([textLayer({ transform: { x: -160, y: 420, width: 760, height: 150 } })]));
    expect(clipped.passed).toBe(false);
    expect(geometryCodes(clipped)).toContain('TEXT_CLIPPED_BY_CANVAS');
  });
});

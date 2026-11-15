import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ART_SPECIFICATIONS,
  AssetIngestionService,
  BrandKitManager,
  CREATIVE_PROJECT_SCHEMA_VERSION,
  ExportService,
  SharpSvgCompositionEngine,
  creativeProjectDocumentSchema,
  type CreativeProjectDocument,
} from '../src/index.js';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('CS-1 Foundation: Schemas, Ingestion, BrandKit, Sharp/SVG Composition & Export', () => {
  it('defines exact art dimensions and banner safe area', () => {
    expect(ART_SPECIFICATIONS.thumbnail).toMatchObject({ width: 1280, height: 720, aspectRatio: '16:9' });
    expect(ART_SPECIFICATIONS.banner).toMatchObject({
      width: 2560,
      height: 1440,
      safeArea: { width: 1546, height: 423 },
    });
    expect(ART_SPECIFICATIONS.avatar).toMatchObject({ width: 800, height: 800, aspectRatio: '1:1' });
    expect(ART_SPECIFICATIONS.watermark).toMatchObject({
      width: 150,
      height: 150,
      requiresTransparency: true,
    });
  });

  it('ingests assets into managed portable storage and rejects path traversal', async () => {
    const root = makeTempDir('cs1-ingest-');
    const ingestion = new AssetIngestionService({ storageRoot: root });

    const samplePng = await sharp({
      create: { width: 320, height: 180, channels: 4, background: { r: 20, g: 180, b: 220, alpha: 1 } },
    })
      .png()
      .toBuffer();

    const ref = await ingestion.ingestBuffer({
      buffer: samplePng,
      kind: 'image',
      extension: 'png',
      originalName: 'sample-frame.png',
    });

    expect(ref.relativePath).toMatch(/^assets\/image\/asset-/);
    expect(ref.width).toBe(320);
    expect(ref.height).toBe(180);
    expect(ref.sha256).toHaveLength(64);
    expect(() => ingestion.resolvePortablePath('../outside.png')).toThrow();
    expect(() => ingestion.resolvePortablePath('C:\\Windows\\system32\\evil.png')).toThrow();
  });

  it('manages Brand Kits with channel palette and typography', () => {
    const manager = new BrandKitManager();
    const kit = manager.create({
      channelName: 'CyberChannel BR',
      palette: { primary: '#00F0FF', accent: '#FACC15' },
    });
    expect(kit.channelName).toBe('CyberChannel BR');
    expect(kit.palette.primary).toBe('#00F0FF');

    const updated = manager.update(kit.id, { channelName: 'CyberChannel Pro' });
    expect(updated.channelName).toBe('CyberChannel Pro');
    expect(manager.list()).toHaveLength(1);
    expect(manager.delete(kit.id)).toBe(true);
  });

  it('renders editable layered thumbnail, exports PNG/JPG/WebP/project, and reopens for targeted edits', async () => {
    const root = makeTempDir('cs1-render-');
    const ingestion = new AssetIngestionService({ storageRoot: root });
    const engine = new SharpSvgCompositionEngine(ingestion);
    const exporter = new ExportService(engine);

    const subjectPng = await sharp({
      create: { width: 420, height: 420, channels: 4, background: { r: 10, g: 10, b: 14, alpha: 1 } },
    })
      .composite([
        {
          input: Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="420"><circle cx="210" cy="210" r="140" fill="#00F0FF"/></svg>',
          ),
        },
      ])
      .png()
      .toBuffer();

    const subjectRef = await ingestion.ingestBuffer({
      buffer: subjectPng,
      kind: 'subject' as never,
      extension: 'png',
      originalName: 'hero.png',
    }).catch(() =>
      ingestion.ingestBuffer({
        buffer: subjectPng,
        kind: 'image',
        extension: 'png',
        originalName: 'hero.png',
      }),
    );

    const now = new Date().toISOString();
    const doc: CreativeProjectDocument = creativeProjectDocumentSchema.parse({
      schemaVersion: CREATIVE_PROJECT_SCHEMA_VERSION,
      id: 'proj-thumb-1',
      title: 'Cyberpunk 2077 Upgrades',
      artType: 'thumbnail',
      width: 1280,
      height: 720,
      prompt: 'Thumbnail Cyberpunk 2077 upgrades cibernéticos',
      assetManifest: { [subjectRef.id]: subjectRef },
      layers: [
        {
          id: 'layer-bg',
          type: 'background',
          name: 'Fundo Neon',
          zIndex: 0,
          fillColor: '#090D16',
          gradientTo: '#1E1B4B',
          transform: { x: 0, y: 0, width: 1280, height: 720 },
          effects: [{ kind: 'vignette', enabled: true, strength: 0.4, color: '#000000' }],
        },
        {
          id: 'layer-vfx',
          type: 'vfx',
          name: 'Cyber Grid',
          zIndex: 1,
          preset: 'cyber_grid',
          primaryColor: '#00F0FF',
          secondaryColor: '#FF006E',
          intensity: 0.8,
          transform: { x: 0, y: 0, width: 1280, height: 720 },
        },
        {
          id: 'layer-subject',
          type: 'subject',
          name: 'Personagem',
          zIndex: 2,
          assetId: subjectRef.id,
          removeBackground: true,
          transform: { x: 740, y: 120, width: 460, height: 520 },
        },
        {
          id: 'layer-title',
          type: 'text',
          name: 'Título Principal',
          zIndex: 3,
          text: 'IMPLANTES INSANOS',
          fontSize: 96,
          color: '#FACC15',
          strokeColor: '#000000',
          strokeWidth: 8,
          transform: { x: 64, y: 180, width: 640, height: 340 },
        },
      ],
      createdAt: now,
      updatedAt: now,
    });

    const outDir = join(root, 'exports');
    const pngRes = await exporter.exportProject(doc, { outputPath: join(outDir, 'thumb.png'), format: 'png' });
    const jpgRes = await exporter.exportProject(doc, { outputPath: join(outDir, 'thumb.jpg'), format: 'jpg' });
    const webpRes = await exporter.exportProject(doc, { outputPath: join(outDir, 'thumb.webp'), format: 'webp' });
    const projRes = await exporter.exportProject(doc, {
      outputPath: join(outDir, 'thumb.aethera-creative.json'),
      format: 'project',
    });

    expect(pngRes.width).toBe(1280);
    expect(pngRes.height).toBe(720);
    expect(jpgRes.width).toBe(1280);
    expect(webpRes.width).toBe(1280);
    expect(projRes.bytes).toBeGreaterThan(200);

    // Reopen portable project and edit only the title layer
    const reopened = exporter.loadPortableProject(projRes.outputPath);
    const updatedDoc: CreativeProjectDocument = {
      ...reopened,
      layers: reopened.layers.map((l) =>
        l.id === 'layer-title' && l.type === 'text' ? { ...l, text: 'CYBERWARE PRO' } : l,
      ),
    };
    const editedPng = await exporter.exportProject(updatedDoc, {
      outputPath: join(outDir, 'thumb-edited.png'),
      format: 'png',
    });
    expect(editedPng.sha256).not.toBe(pngRes.sha256);
  });

  it('preserves real alpha transparency on 150x150 watermark export', async () => {
    const root = makeTempDir('cs1-wm-');
    const ingestion = new AssetIngestionService({ storageRoot: root });
    const engine = new SharpSvgCompositionEngine(ingestion);
    const exporter = new ExportService(engine);

    const now = new Date().toISOString();
    const wmDoc: CreativeProjectDocument = creativeProjectDocumentSchema.parse({
      schemaVersion: CREATIVE_PROJECT_SCHEMA_VERSION,
      id: 'proj-wm-1',
      title: 'Aethera Watermark',
      artType: 'watermark',
      width: 150,
      height: 150,
      prompt: 'Transparent watermark',
      layers: [
        {
          id: 'wm-1',
          type: 'watermark',
          name: 'Marca Aethera',
          zIndex: 0,
          label: 'AETHERA',
          opacity: 0.75,
          transform: { x: 0, y: 0, width: 150, height: 150 },
        },
      ],
      createdAt: now,
      updatedAt: now,
    });

    const wmRes = await exporter.exportProject(wmDoc, {
      outputPath: join(root, 'wm.png'),
      format: 'png',
    });
    expect(wmRes.width).toBe(150);
    expect(wmRes.height).toBe(150);
    expect(wmRes.hasAlpha).toBe(true);

    // Verify center/corner transparency actually has alpha < 255
    const { data } = await sharp(wmRes.outputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0);
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AssetIngestionService,
  BrandKitManager,
  CREATIVE_PROJECT_SCHEMA_VERSION,
  LayeredDocumentEditor,
  LocalPythonAiAdapter,
  ProviderChainImageAdapter,
  QualityGateService,
  SharpSvgCompositionEngine,
  creativeProjectDocumentSchema,
  type CreativeProjectDocument,
  type ExternalImageAdapter,
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

describe('CS-6 Visual Intelligence: Local AI Probe, Provider Chain, Cinematic Effects & Prompt Edits', () => {
  it('probes local Python AI stack (torch, diffusers, rembg, PIL) and supports provider chain fallback', async () => {
    const local = new LocalPythonAiAdapter();
    const available = await local.isAvailable();
    expect(available).toBe(true);

    const failingAdapter: ExternalImageAdapter = {
      id: 'primary-failing',
      isAvailable: async () => true,
      generateImage: async () => {
        throw new Error('CUDA OOM simulated');
      },
    };
    const fakeFallbackPng = await sharp({
      create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 240, b: 255, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const fallbackAdapter: ExternalImageAdapter = {
      id: 'secondary-ok',
      isAvailable: async () => true,
      generateImage: async () => fakeFallbackPng,
    };

    const chain = new ProviderChainImageAdapter([failingAdapter, fallbackAdapter]);
    const out = await chain.generateImage({ prompt: 'test', width: 64, height: 64 });
    expect(out.equals(fakeFallbackPng)).toBe(true);

    const emptyChain = new ProviderChainImageAdapter([]);
    await expect(emptyChain.generateImage({ prompt: 'test', width: 64, height: 64 })).rejects.toThrow();
  });

  it('renders cinematic lighting, rim light, depthBlur, dropShadow, outerGlow and localized prompt edits', async () => {
    const root = makeTempDir('cs6-cine-');
    const ingestion = new AssetIngestionService({ storageRoot: root });
    const engine = new SharpSvgCompositionEngine(ingestion);
    const qc = new QualityGateService(engine);
    const brandKit = new BrandKitManager().create({ channelName: 'CyberCinema' });

    const charPng = await sharp({
      create: { width: 400, height: 500, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        {
          input: Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><circle cx="200" cy="140" r="90" fill="#F43F5E"/><rect x="110" y="230" width="180" height="220" rx="28" fill="#0EA5E9"/></svg>',
          ),
        },
      ])
      .png()
      .toBuffer();

    const charRef = await ingestion.ingestBuffer({
      buffer: charPng,
      kind: 'cutout',
      extension: 'png',
      originalName: 'char-cutout.png',
    });

    const now = new Date().toISOString();
    const doc: CreativeProjectDocument = creativeProjectDocumentSchema.parse({
      schemaVersion: CREATIVE_PROJECT_SCHEMA_VERSION,
      id: 'proj-cs6-1',
      title: 'CS-6 Cinematic Test',
      artType: 'thumbnail',
      width: 1280,
      height: 720,
      prompt: 'Cyberpunk 2077 character',
      brandKitId: brandKit.id,
      assetManifest: { [charRef.id]: charRef },
      layers: [
        {
          id: 'bg-1',
          type: 'background',
          name: 'Fundo',
          zIndex: 0,
          fillColor: '#070B14',
          gradientTo: '#1E1B4B',
          transform: { x: 0, y: 0, width: 1280, height: 720 },
          effects: [
            { kind: 'depthBlur', enabled: true, radius: 4 },
            { kind: 'directionalLight', enabled: true, angleDeg: 40, color: '#00F0FF', intensity: 0.45 },
          ],
        },
        {
          id: 'subj-1',
          type: 'subject',
          name: 'Personagem',
          zIndex: 1,
          assetId: charRef.id,
          removeBackground: false,
          cutoutMethod: 'rembg_semantic',
          rimLightColor: '#00F0FF',
          transform: { x: 700, y: 90, width: 460, height: 560 },
          effects: [{ kind: 'dropShadow', enabled: true, offsetX: 8, offsetY: 12, blur: 18, color: '#000000CC' }],
        },
        {
          id: 'txt-1',
          type: 'text',
          name: 'Título',
          zIndex: 2,
          text: 'CYBERWARE',
          fontSize: 96,
          color: '#FACC15',
          transform: { x: 64, y: 200, width: 600, height: 300 },
          effects: [{ kind: 'outerGlow', enabled: true, radius: 18, intensity: 0.7, color: '#FACC15' }],
        },
      ],
      createdAt: now,
      updatedAt: now,
    });

    const beforeBuf = await engine.renderDocumentToBuffer(doc, 'png');
    const beforeMeta = await sharp(beforeBuf).metadata();
    expect(beforeMeta.width).toBe(1280);
    expect(beforeMeta.height).toBe(720);

    // Apply all CS-6 localized prompt edits
    const editor = new LayeredDocumentEditor(doc);
    const r1 = editor.applyLocalizedPromptEdit('aumente o personagem');
    const r2 = editor.applyLocalizedPromptEdit('deixe o título mais impactante');
    const r3 = editor.applyLocalizedPromptEdit('adicione iluminação neon #FF006E');
    const r4 = editor.applyLocalizedPromptEdit('troque o fundo para roxo neon');

    expect(r1.applied).toBe(true);
    expect(r2.applied).toBe(true);
    expect(r3.applied).toBe(true);
    expect(r4.applied).toBe(true);

    const editedDoc = editor.getDocument();
    const subj = editedDoc.layers.find((l) => l.id === 'subj-1');
    expect(subj?.transform.scaleX).toBeGreaterThan(1);
    expect(subj?.type === 'subject' && subj.rimLightColor).toBe('#FF006E');

    const audit = await qc.auditProject(editedDoc, { brandKit });
    expect(audit.passed).toBe(true);
    expect(audit.scorecard.disclaimer).toContain('does not predict actual CTR');
  });
});

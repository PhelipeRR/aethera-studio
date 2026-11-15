import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '@neuralbridge/database';
import { AetheraCreativeStudioService } from '../src/main/creative-studio-service.js';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore transient Windows file lock
      }
    }
  }
});

describe('Aethera Creative Studio — Desktop Persistence, Undo/Redo & Reopen', () => {
  it(
    'creates art, edits via prompt, performs undo/redo, persists to SQLite, closes, reopens, and reuses Brand Kit mascot',
    async () => {
      const root = makeTempDir('aethera-cs-persist-');
      const userDataDir = join(root, 'userData');
      const dbFile = join(userDataDir, 'db', 'creative.db');
      mkdirSync(join(userDataDir, 'db'), { recursive: true });
      const migrationsFolder = join(import.meta.dirname, '../../../packages/database/migrations');

      let handle = openDatabase(dbFile, { migrationsFolder });
      try {
        let service = new AetheraCreativeStudioService({ db: handle.db, userDataDir });

        const mascotPng = await sharp({
          create: { width: 256, height: 256, channels: 4, background: { r: 0, g: 240, b: 255, alpha: 1 } },
        })
          .png()
          .toBuffer();
        const mascotAsset = await service.ingestion.ingestBuffer({
          buffer: mascotPng,
          kind: 'cutout',
          extension: 'png',
          originalName: 'persistent-mascot.png',
        });

        const kit = service.brandKits.create({
          channelName: 'NeuralBridge Lab',
          palette: {
            primary: '#00F0FF',
            secondary: '#FF006E',
            accent: '#FACC15',
            background: '#070B14',
            surface: '#111827',
            text: '#FFFFFF',
          },
        });
        const updatedKit = service.brandKits.registerIdentityAsset(kit.id, 'mascot', mascotAsset);
        expect(updatedKit.mascotAssetId).toBe(mascotAsset.id);

        const created = await service.createFromPrompt({
          artType: 'thumbnail',
          title: 'Projeto Persistente',
          headline: 'TITULO INICIAL',
          prompt: 'Thumbnail de tecnologia com alto contraste',
          brandKitId: kit.id,
          useAiGeneration: false,
        });
        const projectId = created.document.id;
        const editor = service.getOrCreateEditor(projectId);

        const editRes = editor.applyLocalizedPromptEdit('Mude o título para "NOVO TITULO"');
        expect(editRes.applied).toBe(true);
        const editedDoc = editor.getDocument();
        service.saveDocument(editedDoc);
        const textAfterEdit = editedDoc.layers.find((l) => l.type === 'text');
        expect(textAfterEdit?.type === 'text' ? textAfterEdit.text : '').toBe('NOVO TITULO');

        const undoneDoc = editor.undo();
        expect(undoneDoc).not.toBeNull();
        const textAfterUndo = undoneDoc!.layers.find((l) => l.type === 'text');
        expect(textAfterUndo?.type === 'text' ? textAfterUndo.text : '').toBe('TITULO INICIAL');

        const redoneDoc = editor.redo();
        expect(redoneDoc).not.toBeNull();
        service.saveDocument(redoneDoc!);

        handle.close();

        handle = openDatabase(dbFile, { migrationsFolder });
        service = new AetheraCreativeStudioService({ db: handle.db, userDataDir });

        const reloaded = service.loadDocument(projectId);
        expect(reloaded).not.toBeNull();
        const reloadedText = reloaded!.layers.find((l) => l.type === 'text');
        expect(reloadedText?.type === 'text' ? reloadedText.text : '').toBe('NOVO TITULO');

        const reloadedKit = service.brandKits.get(kit.id);
        expect(reloadedKit?.mascotAssetId).toBe(mascotAsset.id);

        const banner = await service.createFromPrompt({
          artType: 'banner',
          headline: 'NEURALBRIDGE LAB',
          prompt: 'Banner oficial do canal',
          brandKitId: kit.id,
          useAiGeneration: false,
        });
        const bannerSubject = banner.document.layers.find((l) => l.type === 'subject');
        expect(bannerSubject && 'assetId' in bannerSubject ? bannerSubject.assetId : null).toBe(mascotAsset.id);
      } finally {
        try {
          handle.close();
        } catch {
          // already closed
        }
      }
    },
    120_000,
  );
});

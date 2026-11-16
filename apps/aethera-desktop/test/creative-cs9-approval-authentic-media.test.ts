import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '@neuralbridge/database';
import { AetheraCreativeStudioService } from '../src/main/creative-studio-service.js';
import {
  createCinemaAuthenticMediaSource,
  isRelevantCandidate,
  type AuthenticAcquisitionLog,
} from '../src/main/creative-authentic-media.js';

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
        // transient Windows file lock
      }
    }
  }
});

/** Offline fetch: every network provider (Wikimedia, Internet Archive) answers 503, so only local sources count. */
const offlineFetch = (async () => new Response('offline', { status: 503 })) as unknown as typeof fetch;

describe('CS-9 — independent approval states persisted by the desktop service', () => {
  it('records the human aesthetic decision independently of the technical gate and persists all three states', async () => {
    const root = makeTempDir('aethera-cs9-approval-');
    const userDataDir = join(root, 'userData');
    mkdirSync(join(userDataDir, 'db'), { recursive: true });
    const migrationsFolder = join(import.meta.dirname, '../../../packages/database/migrations');
    const handle = openDatabase(join(userDataDir, 'db', 'creative.db'), { migrationsFolder });
    try {
      const service = new AetheraCreativeStudioService({ db: handle.db, userDataDir });
      const created = await service.createFromPrompt({
        artType: 'thumbnail',
        title: 'Aprovação CS-9',
        headline: 'SINAL PERDIDO',
        prompt: 'Thumbnail documental sobre radiotelescópio',
        useAiGeneration: false,
      });
      const id = created.document.id;

      const initial = service.approvalStatus(id);
      expect(initial.states.humanAesthetic.status).toBe('pending');
      expect(initial.readiness.ready).toBe(false);

      const technical = await service.evaluateTechnicalApproval(id);
      expect(['passed', 'failed']).toContain(technical.approvalStates?.technical.status);
      expect(technical.approvalStates?.humanAesthetic.status).toBe('pending');

      const decided = await service.recordAestheticDecision(id, 'approved', 'Revisor E2E', 'composição aceita');
      expect(decided.document.approvalStates?.humanAesthetic).toMatchObject({ status: 'approved', reviewer: 'Revisor E2E' });
      // The technical verdict is reported, not overwritten by the human decision.
      expect(decided.document.approvalStates?.technical.status).toBe(technical.approvalStates?.technical.status);
      // No semantic-fidelity evidence was recorded, so the piece is never release-ready on human approval alone.
      expect(decided.readiness.ready).toBe(false);
      expect(decided.readiness.blockers.join(' ')).toContain('Fidelidade semântica');

      const reloaded = service.loadDocument(id);
      expect(reloaded?.approvalStates?.humanAesthetic.status).toBe('approved');
      expect(reloaded?.approvedBy).toBe('Revisor E2E');

      const rejected = await service.recordAestheticDecision(id, 'rejected', 'Revisor E2E');
      expect(rejected.document.approvalStates?.humanAesthetic.status).toBe('rejected');
      expect(rejected.document.approvedBy).toBeUndefined();
    } finally {
      handle.close();
    }
  }, 60_000);
});

describe('CS-9 — authentic media from existing Aethera sources', () => {
  it('only accepts candidates whose metadata names the subject', () => {
    expect(isRelevantCandidate('Elden Ring Malenia', 'elden-ring-malenia-boss-fight.png')).toBe(true);
    expect(isRelevantCandidate('Elden Ring Malenia', 'cyberpunk-night-city.png')).toBe(false);
    expect(isRelevantCandidate('Hollow Knight Silksong Hornet', 'hollow knight silksong trailer')).toBe(true);
    // Real probe results (artifacts/cs9-reference-set/authentic-source-probe.json): fan works and off-subject hits.
    expect(isRelevantCandidate('Elden Ring Malenia', 'Dragon Con 2025 - Elden Ring Miquella Messmer Melina Malenia Millicent cosplay 1.jpg', 'Malenia')).toBe(false);
    expect(isRelevantCandidate('Cyberpunk 2077 Johnny Silverhand', "Cyberpunk 2077's problems went from bad to worse", 'Johnny Silverhand')).toBe(false);
    expect(isRelevantCandidate('Hollow Knight Silksong Hornet', 'FA-18 Hornet breaking sound barrier', 'Hornet')).toBe(false);
    expect(isRelevantCandidate('Elden Ring Malenia', 'PhunkRoyal - Elden Ring - Malenia, Blade of Miquella', 'Malenia')).toBe(true);
  });

  it('acquires a relevant still from the local media library with honest provenance and logs provider statuses', async () => {
    const root = makeTempDir('aethera-cs9-authentic-');
    const library = join(root, 'library');
    mkdirSync(library, { recursive: true });
    const png = await sharp({ create: { width: 320, height: 180, channels: 3, background: { r: 90, g: 20, b: 20 } } }).png().toBuffer();
    writeFileSync(join(library, 'cyberpunk-night-city.png'), png);
    writeFileSync(join(library, 'elden-ring-malenia-screenshot.png'), png);
    const logs: AuthenticAcquisitionLog[] = [];

    const source = createCinemaAuthenticMediaSource({
      mediaDir: join(root, 'media'),
      localMediaDirs: [library],
      fetchImpl: offlineFetch,
      onAttempt: (l) => logs.push(l),
    });
    const result = await source.acquire({ query: 'Elden Ring Malenia', role: 'hero_character', genre: 'games' });

    expect(result).not.toBeNull();
    expect(result?.imagePath).toContain('elden-ring-malenia-screenshot.png');
    expect(result?.provenance).toBe('licensed_reference');
    expect(result?.origin).toBe('local_library');
    expect(logs[0]?.providerStatuses.map((p) => p.provider)).toEqual(
      expect.arrayContaining(['local_library', 'wikimedia_commons', 'internet_archive']),
    );
  });

  it('returns null (never a synthetic substitute) when no existing source has relevant media', async () => {
    const root = makeTempDir('aethera-cs9-authentic-none-');
    const logs: AuthenticAcquisitionLog[] = [];
    const source = createCinemaAuthenticMediaSource({
      mediaDir: join(root, 'media'),
      localMediaDirs: [],
      fetchImpl: offlineFetch,
      onAttempt: (l) => logs.push(l),
    });
    const result = await source.acquire({ query: 'Hollow Knight Silksong Hornet', role: 'hero_character', genre: 'games' });
    expect(result).toBeNull();
    expect(logs[0]?.failure).toContain('nenhum candidato relevante');
  });
});

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { SfxEvent, TimelineDocument } from '@neuralbridge/shared';
import { sfxEventSchema } from '@neuralbridge/shared';
import { velixKitPath } from './velix.js';

export interface MotionVelixSfxAsset {
  id: string;
  path: string;
  sha256: string;
  source: 'motionvelix-kit';
  licenseEvidence: 'motionvelix-user-kit-original-synthesized';
}

export interface MotionVelixSfxManifest {
  schemaVersion: 1;
  root: string;
  source: 'MotionVelix';
  licenseEvidence: 'motionvelix-user-kit-original-synthesized';
  assets: MotionVelixSfxAsset[];
}

/** Reads only the already-installed local MotionVelix kit; it never downloads or copies an asset. */
export function discoverMotionVelixSfx(kitPath = velixKitPath()): MotionVelixSfxManifest | null {
  const root = resolve(kitPath, 'assets', 'sfx');
  if (!existsSync(root) || !statSync(root).isDirectory()) return null;
  const assets = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.wav$/iu.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const path = join(root, entry.name);
      return { id: basename(entry.name, '.wav'), path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex'), source: 'motionvelix-kit' as const, licenseEvidence: 'motionvelix-user-kit-original-synthesized' as const };
    });
  return { schemaVersion: 1, root, source: 'MotionVelix', licenseEvidence: 'motionvelix-user-kit-original-synthesized', assets };
}

const preferredSfx: Record<string, string> = { fade: 'swish_suave', slide: 'whoosh', wipe: 'whoosh_rapido', zoom: 'riser' };

/** Converts explicit timeline transitions into deterministic, frame-aligned SFX events. */
export async function motionVelixSfxEvents(input: { timeline: TimelineDocument; manifest: MotionVelixSfxManifest; probeDurationMs: (path: string) => Promise<number> }): Promise<SfxEvent[]> {
  const byId = new Map(input.manifest.assets.map((asset) => [asset.id, asset]));
  const clips = input.timeline.tracks.filter((track) => track.kind === 'video' || track.kind === 'graphics').flatMap((track) => track.items);
  const events: SfxEvent[] = [];
  for (const clip of clips) {
    const transition = clip.exit;
    if (!transition || transition.id === 'cut') continue;
    const asset = byId.get(preferredSfx[transition.id] ?? 'whoosh') ?? input.manifest.assets[0];
    if (!asset) continue;
    const atMs = Math.max(0, clip.startMs + clip.durationMs - transition.durationMs);
    const durationMs = Math.max(1, await input.probeDurationMs(asset.path));
    events.push(sfxEventSchema.parse({ id: `motionvelix:${asset.id}:${atMs}`, sfxId: asset.id, relativePath: asset.path, atMs, durationMs, frame: Math.round((atMs * input.timeline.fps) / 1_000), gainDb: -18, licenseEvidence: input.manifest.licenseEvidence }));
  }
  return events;
}

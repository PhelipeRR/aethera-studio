import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';

export interface RealAudioAssetRef {
  path: string;
  license: string;
}

export interface RealSfxAssetRef extends RealAudioAssetRef {
  id: string;
  atMs: number;
  gainDb?: number;
}

export interface RealAudioAssetsInput {
  music?: RealAudioAssetRef;
  ambience?: RealAudioAssetRef;
  sfx?: readonly RealSfxAssetRef[];
}

export interface ResolvedRealAudioAsset extends RealAudioAssetRef {
  fingerprint: string;
  sizeBytes: number;
}

export interface ResolvedRealAudioSfx extends ResolvedRealAudioAsset {
  id: string;
  atMs: number;
  gainDb: number;
}

export interface ResolvedRealAudioAssets {
  valid: boolean;
  missingRoles: Array<'music' | 'ambience' | 'sfx'>;
  diagnostics: string[];
  sources: { music: 'asset' | 'missing'; ambience: 'asset' | 'missing'; sfx: 'asset' | 'missing' };
  music?: ResolvedRealAudioAsset;
  ambience?: ResolvedRealAudioAsset;
  sfx: ResolvedRealAudioSfx[];
}

function fingerprint(path: string, sizeBytes: number, mtimeMs: number): string {
  return createHash('sha256').update(`${path}|${sizeBytes}|${mtimeMs}`).digest('hex').slice(0, 16);
}

function resolveAsset(ref: RealAudioAssetRef | undefined, role: string): { asset?: ResolvedRealAudioAsset; diagnostic?: string } {
  if (!ref) return { diagnostic: `technical_blocked: asset de áudio ausente para ${role}.` };
  if (!ref.license.trim()) return { diagnostic: `technical_blocked: licença ausente para ${role}.` };
  if (!existsSync(ref.path)) return { diagnostic: `technical_blocked: arquivo de áudio inexistente para ${role}: ${ref.path}.` };
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(ref.path);
  } catch {
    return { diagnostic: `technical_blocked: não foi possível inspecionar o arquivo de áudio para ${role}.` };
  }
  if (!stat.isFile() || stat.size < 1_024) return { diagnostic: `technical_blocked: arquivo de áudio inválido ou vazio para ${role}.` };
  return { asset: { ...ref, fingerprint: fingerprint(ref.path, stat.size, stat.mtimeMs), sizeBytes: stat.size } };
}

export async function resolveRealAudioAssets(input: RealAudioAssetsInput = {}, options: { requireRealAudio?: boolean } = {}): Promise<ResolvedRealAudioAssets> {
  const diagnostics: string[] = [];
  const missingRoles: Array<'music' | 'ambience' | 'sfx'> = [];
  const musicResult = resolveAsset(input.music, 'music');
  const ambienceResult = resolveAsset(input.ambience, 'ambience');
  if (!musicResult.asset) missingRoles.push('music');
  if (!ambienceResult.asset) missingRoles.push('ambience');
  if (musicResult.diagnostic) diagnostics.push(musicResult.diagnostic);
  if (ambienceResult.diagnostic) diagnostics.push(ambienceResult.diagnostic);

  const sfx: ResolvedRealAudioSfx[] = [];
  for (const ref of input.sfx ?? []) {
    const result = resolveAsset(ref, `sfx:${ref.id}`);
    if (!result.asset) {
      diagnostics.push(result.diagnostic ?? `technical_blocked: SFX inválido: ${ref.id}.`);
      continue;
    }
    sfx.push({ ...result.asset, id: ref.id, atMs: Math.max(0, Math.round(ref.atMs)), gainDb: Number.isFinite(ref.gainDb) ? Math.max(-48, Math.min(12, ref.gainDb ?? -10)) : -10 });
  }
  if (sfx.length === 0) {
    missingRoles.push('sfx');
    if ((input.sfx?.length ?? 0) === 0) diagnostics.push('technical_blocked: nenhum asset de SFX foi fornecido.');
  }

  const strict = options.requireRealAudio === true;
  return {
    valid: !strict || missingRoles.length === 0,
    missingRoles: [...new Set(missingRoles)],
    diagnostics,
    sources: { music: musicResult.asset ? 'asset' : 'missing', ambience: ambienceResult.asset ? 'asset' : 'missing', sfx: sfx.length > 0 ? 'asset' : 'missing' },
    ...(musicResult.asset ? { music: musicResult.asset } : {}),
    ...(ambienceResult.asset ? { ambience: ambienceResult.asset } : {}),
    sfx,
  };
}


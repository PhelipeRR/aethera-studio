import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { extractSingleThumbnail, probeRealMp4 } from '../src/qc/real-media-probe.js';
import { WaveformCache, extractWaveformData } from '../src/qc/waveform-extractor.js';
import { classifyAssetCategory } from '../../desktop-shared/src/renderer/src/features/aethera/MediaLibraryPanel.js';
import {
  resolveLivePreviewState,
  resolveMediaPlayUrl,
  resolveSelectedElementKind,
} from '../../desktop-shared/src/renderer/src/features/aethera/editor-composition.js';

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aethera-nle-int-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('NLE Editor Integration: Library, Timeline, Player & Render', () => {
  it('classifies library assets into video, image, music, sfx, vfx, motion_graphics, and template', () => {
    const base = {
      mediaId: 'm1',
      durationSec: 5,
      width: 1920,
      height: 1080,
      mediaUrl: 'media://local/x',
      thumbnailUrl: null,
      waveformPeaks: [],
    };
    expect(classifyAssetCategory({ ...base, filePath: '/a/boss_fight.mp4', name: 'boss_fight.mp4', kind: 'video' })).toBe('video');
    expect(classifyAssetCategory({ ...base, filePath: '/a/still.png', name: 'still.png', kind: 'image' })).toBe('image');
    expect(classifyAssetCategory({ ...base, filePath: '/a/epic_music_bgm.wav', name: 'epic_music_bgm.wav', kind: 'audio' })).toBe('music');
    expect(classifyAssetCategory({ ...base, filePath: '/a/whoosh_hit.wav', name: 'whoosh_hit.wav', kind: 'audio' })).toBe('sfx');
    expect(classifyAssetCategory({ ...base, filePath: '/a/vfx_sparks_alpha.mov', name: 'vfx_sparks_alpha.mov', kind: 'video' })).toBe('vfx');
    expect(classifyAssetCategory({ ...base, filePath: '/a/hud_motion_card.mp4', name: 'hud_motion_card.mp4', kind: 'video' })).toBe('motion_graphics');
    expect(classifyAssetCategory({ ...base, filePath: '/a/intro_template.mp4', name: 'intro_template.mp4', kind: 'video' })).toBe('template');
  });

  it('distinguishes live timeline, rendered MP4, rendering, and unavailable media without silent placeholders', () => {
    const clip = {
      clipId: 'shot_1',
      trackId: 'v1',
      label: 'Abertura',
      startSec: 0,
      durationSec: 5,
      speed: 1,
    };

    expect(
      resolveLivePreviewState({
        rendering: true,
        previewMode: 'timeline',
        hasRenderedMp4: false,
        activeClip: clip,
        resolvedMediaUrl: 'media://local/video.mp4',
      }).state,
    ).toBe('rendering');

    expect(
      resolveLivePreviewState({
        rendering: false,
        previewMode: 'mp4',
        hasRenderedMp4: true,
        activeClip: clip,
        resolvedMediaUrl: 'media://local/out.mp4',
      }).state,
    ).toBe('rendered_mp4');

    expect(
      resolveLivePreviewState({
        rendering: false,
        previewMode: 'timeline',
        hasRenderedMp4: false,
        activeClip: clip,
        resolvedMediaUrl: null,
      }).state,
    ).toBe('media_unavailable');

    expect(
      resolveLivePreviewState({
        rendering: false,
        previewMode: 'timeline',
        hasRenderedMp4: false,
        activeClip: clip,
        resolvedMediaUrl: resolveMediaPlayUrl('C:\\media\\shot_1.mp4'),
      }),
    ).toEqual({
      state: 'live_timeline',
      badgeLabel: 'Preview Timeline (Ao Vivo)',
      mediaUrl: 'media://local/C%3A%2Fmedia%2Fshot_1.mp4',
    });
  });

  it('resolves contextual properties kind for video, audio, image, text, and vfx elements', () => {
    const sourceMedia = {
      m_vid: { mediaId: 'm_vid', kind: 'video', uri: '/a/clip.mp4', license: 'local' },
      m_img: { mediaId: 'm_img', kind: 'image', uri: '/a/photo.png', license: 'local' },
      m_aud: { mediaId: 'm_aud', kind: 'audio', uri: '/a/nar.wav', license: 'local' },
    };

    expect(resolveSelectedElementKind({ clipId: 'c1', trackId: 'v1', label: 'Cena 1', startSec: 0, durationSec: 4, speed: 1, sourceMediaId: 'm_vid' }, sourceMedia)).toBe('video');
    expect(resolveSelectedElementKind({ clipId: 'c2', trackId: 'v1', label: 'Foto 1', startSec: 4, durationSec: 4, speed: 1, sourceMediaId: 'm_img' }, sourceMedia)).toBe('image');
    expect(resolveSelectedElementKind({ clipId: 'c3', trackId: 'a_nar', label: 'Narração', startSec: 0, durationSec: 4, speed: 1, sourceMediaId: 'm_aud' }, sourceMedia)).toBe('audio');
    expect(resolveSelectedElementKind({ clipId: 'text:1', trackId: 'sub1', label: 'Título', startSec: 1, durationSec: 2, speed: 1 }, sourceMedia)).toBe('text');
    expect(resolveSelectedElementKind({ clipId: 'c4', trackId: 'vfx1', label: 'VFX Sparks', startSec: 2, durationSec: 2, speed: 1 }, sourceMedia)).toBe('vfx');
  });

  it('extracts real thumbnails and waveforms for a full project (video, narration, music, sfx, vfx)', async () => {
    const dir = createTempDir();
    const videoPath = join(dir, 'scene_video.mp4');
    const thumbPath = join(dir, 'scene_thumb.png');
    const narPath = join(dir, 'narration.wav');
    const musPath = join(dir, 'music.wav');
    const sfxPath = join(dir, 'sfx_impact.wav');

    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x180:rate=24:duration=2',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=220:sample_rate=16000:duration=2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      videoPath,
    ]);

    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=260:sample_rate=16000:duration=2',
      narPath,
    ]);
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=110:sample_rate=16000:duration=2',
      musPath,
    ]);
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=700:sample_rate=16000:duration=0.4',
      sfxPath,
    ]);

    await extractSingleThumbnail(videoPath, thumbPath, 0.5);
    expect(existsSync(thumbPath)).toBe(true);

    const probed = await probeRealMp4(videoPath);
    expect(probed.width).toBe(320);
    expect(probed.height).toBe(180);
    expect(probed.durationSec).toBeGreaterThan(1.5);

    const cache = new WaveformCache(join(dir, 'wave-cache'));
    const [narWave, musWave, sfxWave] = await Promise.all([
      extractWaveformData({ filePath: narPath, buckets: 128, cache }),
      extractWaveformData({ filePath: musPath, buckets: 128, cache }),
      extractWaveformData({ filePath: sfxPath, buckets: 64, cache }),
    ]);

    expect(narWave.hasAudio).toBe(true);
    expect(musWave.hasAudio).toBe(true);
    expect(sfxWave.hasAudio).toBe(true);
  });
});

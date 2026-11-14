import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { analyzeAuthorizedVideo, buildCommentaryProduction, buildVelixRadar, currentRights, escapeDrawtext, extractVelixThumbnail, markEnergyPeaks, parseVelixEnergy, renderVelixClipTimeline, velixCredits } from '../src/index.js';

const exec = promisify(execFile);
const FFMPEG = process.env['FFMPEG_PATH'] ?? 'C:\\ffmpeg\\bin\\ffmpeg.exe';
const FFPROBE = process.env['FFPROBE_PATH'] ?? 'C:\\ffmpeg\\bin\\ffprobe.exe';
const tools = { ffmpeg: FFMPEG, ffprobe: FFPROBE };
const folder = () => mkdtempSync(join(tmpdir(), 'nb-velix-gaps-'));

async function video(root: string, name = 'source.mp4') {
  await exec(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=6', '-f', 'lavfi', '-i', "aevalsrc='if(lt(t,3),0.01,0.8)*sin(440*2*PI*t)':d=6", '-shortest', '-pix_fmt', 'yuv420p', join(root, name)]);
}

describe('radar', () => {
  const now = new Date('2026-11-01T12:00:00.000Z');
  const references = [{ publisher: 'A', publishedAt: '2026-10-31T00:00:00.000Z' }, { publisher: 'A', publishedAt: '2026-10-29T00:00:00.000Z' }, { publisher: 'B', publishedAt: '2026-10-20T00:00:00.000Z' }, { publisher: 'C', publishedAt: null }, { publisher: 'D', publishedAt: '2027-01-01T00:00:00.000Z' }];
  it('counts only what is dated inside the window and does not invent a trend', () => {
    expect(buildVelixRadar(references, { days: 7, now })).toMatchObject({ total: 5, undated: 2, inWindow: 2, previousWindow: 1, publishers: [{ publisher: 'A', count: 2 }] });
  });
  it('stays empty without sources', () => {
    expect(buildVelixRadar([], { days: 30, now })).toMatchObject({ total: 0, inWindow: 0, publishers: [], daily: [] });
  });
});

describe('rights history', () => {
  it('takes the last row of a reference as what holds now', () => {
    const rows = [{ referenceId: 'r', status: 'verified_allowed' }, { referenceId: 'r', status: 'blocked' }];
    expect(currentRights(rows).get('r')?.status).toBe('blocked');
  });
  it('lists only rights that require credit', () => {
    expect(velixCredits([{ referenceId: 'a', status: 'verified_allowed', credit: ' Autora ', owner: 'Dona', license: 'CC BY' }, { referenceId: 'b', status: 'verified_allowed', credit: null, owner: 'x', license: 'y' }])).toEqual(['Autora (CC BY, Dona)']);
  });
});

describe('audio energy', () => {
  it('reads the levels ffmpeg prints and treats silence as the floor', () => {
    expect(parseVelixEnergy('frame:0 pts:0 pts_time:0\nlavfi.astats.Overall.RMS_level=-20.5\nframe:1 pts:1 pts_time:1\nlavfi.astats.Overall.RMS_level=-inf\n')).toEqual([{ time: 0, rms: -20.5 }, { time: 1, rms: -90 }]);
  });
  it('averages a long file down to a drawable size', () => {
    const lines = Array.from({ length: 1000 }, (_, index) => `pts_time:${index}\nlavfi.astats.Overall.RMS_level=-10`).join('\n');
    expect(parseVelixEnergy(lines).length).toBeLessThanOrEqual(240);
  });
  it('adds the criterion only to the loud part, and never on flat audio', () => {
    const clip = (start: number, end: number) => ({ id: `${start}`, start, end, confidence: 0.5, criteria: ['x'], accepted: false });
    const energy = Array.from({ length: 8 }, (_, time) => ({ time, rms: time < 4 ? -40 : -10 }));
    const marked = markEnergyPeaks([clip(0, 4), clip(4, 8)], energy);
    expect(marked[0]?.criteria).toEqual(['x']);
    expect(marked[1]?.criteria).toContain('audio-energy-peak');
    expect(markEnergyPeaks([clip(0, 8)], energy.map((item) => ({ ...item, rms: -10 })))[0]?.criteria).toEqual(['x']);
  });
});

describe('real media', () => {
  it('measures energy, extracts a thumbnail and rejects malformed files', async () => {
    const root = folder();
    await video(root);
    const analysis = await analyzeAuthorizedVideo({ root, relativePath: 'source.mp4', rightsStatus: 'verified_allowed', ...tools });
    expect(analysis.energy.length).toBeGreaterThanOrEqual(5);
    const at = (time: number) => analysis.energy.find((item) => item.time === time)?.rms ?? -90;
    expect(at(4)).toBeGreaterThan(at(1) + 20);
    const image = await extractVelixThumbnail({ root, relativePath: 'source.mp4', time: 1, ffmpeg: FFMPEG });
    expect(image.subarray(0, 2).toString('hex')).toBe('ffd8');
    writeFileSync(join(root, 'quebrado.mp4'), 'isto não é um vídeo');
    await expect(analyzeAuthorizedVideo({ root, relativePath: 'quebrado.mp4', rightsStatus: 'verified_allowed', ...tools })).rejects.toThrow();
    writeFileSync(join(root, 'vazio.mp4'), '');
    await expect(analyzeAuthorizedVideo({ root, relativePath: 'vazio.mp4', rightsStatus: 'verified_allowed', ...tools })).rejects.toThrow();
    await expect(extractVelixThumbnail({ root, relativePath: '../fora.mp4', time: 0, ffmpeg: FFMPEG })).rejects.toThrow(/fora da raiz/);
  }, 60_000);

  it('renders fades, position cards and music into a valid file', async () => {
    const root = folder();
    await video(root);
    await exec(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=1320:duration=1', '-c:a', 'aac', join(root, 'musica.m4a')]);
    const clips = [{ start: 0, end: 2 }, { start: 3, end: 5 }];
    const plain = await renderVelixClipTimeline({ root, sourceRelativePath: 'source.mp4', outputRelativePath: 'renders/plain.mp4', clips, rightsStatus: 'verified_allowed', ...tools });
    const full = await renderVelixClipTimeline({ root, sourceRelativePath: 'source.mp4', outputRelativePath: 'renders/full.mp4', clips, rightsStatus: 'verified_allowed', transition: 'fade', positionCards: ['#2', '#1'], musicRelativePath: 'musica.m4a', musicVolume: 1, ...tools });
    expect(full).toMatchObject({ hasVideo: true, hasAudio: true });
    expect(Math.abs(full.duration - plain.duration)).toBeLessThan(0.2);
    const band = await exec(FFMPEG, ['-v', 'info', '-i', join(root, 'renders', 'full.mp4'), '-af', 'bandpass=f=1320:width_type=h:w=80,volumedetect', '-f', 'null', '-']);
    expect(Number(/mean_volume:\s*(-?[\d.]+)/.exec(band.stderr)?.[1] ?? -99)).toBeGreaterThan(-45);
    await expect(renderVelixClipTimeline({ root, sourceRelativePath: 'source.mp4', outputRelativePath: 'renders/x.mp4', clips, rightsStatus: 'verified_allowed', positionCards: ['#1'], ...tools })).rejects.toThrow(/cartão/);
  }, 60_000);

  it('cancels a running render and keeps nothing as a result', async () => {
    const root = folder();
    await video(root);
    const controller = new AbortController();
    const running = renderVelixClipTimeline({ root, sourceRelativePath: 'source.mp4', outputRelativePath: 'renders/x.mp4', clips: [{ start: 0, end: 6 }], rightsStatus: 'verified_allowed', signal: controller.signal, ...tools });
    setTimeout(() => controller.abort(), 20);
    await expect(running).rejects.toThrow();
  }, 30_000);

  it('escapes text that would break the filter', () => {
    expect(escapeDrawtext("50%: it's")).not.toMatch(/(?<!\\)[:%']/);
  });
});

describe('ranking brief', () => {
  it('states the criterion and the final positions in approved order', () => {
    const { brief } = buildCommentaryProduction({ topic: 'Top', style: 'analítico', rankingCriteria: 'maior virada', clips: [{ source: 's', start: 0, end: 1, rights: 'verified_allowed' }, { source: 's', start: 2, end: 3, rights: 'verified_allowed' }] });
    expect(brief).toContain('Ranking por: maior virada');
    expect(brief.indexOf('Posição 2')).toBeLessThan(brief.indexOf('Posição 1'));
  });
});

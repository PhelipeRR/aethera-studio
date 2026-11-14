import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/**
 * Reference scenario of the Aethera Autonomous Studio, synthetic so it can live in the repository: three fictional
 * games, each with a generated clip made of three known sections. The real scenario (three real games, real trailers
 * and gameplay) lives outside the repository, in C:/dev/aethera-reference-media, and is used from AS-04 on.
 */
export const REFERENCE_GAMES = [
  { id: 'fixture-game-a', title: 'Fixture Game A', pattern: 'testsrc2', still: 'red' },
  { id: 'fixture-game-b', title: 'Fixture Game B', pattern: 'mandelbrot', still: 'green' },
  { id: 'fixture-game-c', title: 'Fixture Game C', pattern: 'life', still: 'blue' },
] as const;

/** Section boundaries of every reference clip, in milliseconds: black, motion, still. */
export const REFERENCE_SECTIONS = { black: [0, 1_000], motion: [1_000, 3_000], still: [3_000, 5_000] } as const;

export const FFMPEG = process.env['FFMPEG_PATH'] ?? 'C:\\ffmpeg\\bin\\ffmpeg.exe';

/** Writes `<dir>/media/<game>.mp4` for each reference game (320×180, 30 fps, 5 s) and returns the relative paths. */
export async function createReferenceClips(dir: string): Promise<Record<string, string>> {
  mkdirSync(join(dir, 'media'), { recursive: true });
  const paths: Record<string, string> = {};
  for (const game of REFERENCE_GAMES) {
    const relativePath = `media/${game.id}.mp4`;
    const size = 's=320x180:r=30';
    await exec(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-t', '1', '-f', 'lavfi', '-i', `color=black:${size}`,
      '-t', '2', '-f', 'lavfi', '-i', `${game.pattern}=${size}`,
      '-t', '2', '-f', 'lavfi', '-i', `color=${game.still}:${size}`,
      '-filter_complex', '[0][1][2]concat=n=3:v=1:a=0,format=yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', join(dir, relativePath),
    ], { windowsHide: true });
    paths[game.id] = relativePath;
  }
  return paths;
}

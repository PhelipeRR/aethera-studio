import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listProjectVideos, projectVideoPreview, saveGeneratedFileTo, saveProjectFileTo, saveProjectThumbnail } from '../src/main/channel-files.js';

const project = () => {
  const root = mkdtempSync(join(tmpdir(), 'nb-channel-files-'));
  mkdirSync(join(root, 'renders'), { recursive: true }); mkdirSync(join(root, 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(root, 'renders', 'motion-a.mp4'), 'a'); writeFileSync(join(root, 'renders', 'motion-b.mp4.part.mp4'), 'p');
  writeFileSync(join(root, 'renders', 'x.motion.mp4'), 'm'); writeFileSync(join(root, 'node_modules', 'x', 'skip.mp4'), 's'); writeFileSync(join(root, 'notes.txt'), 't');
  return root;
};

describe('channel files', () => {
  it('lists finished project MP4s only', async () => {
    expect((await listProjectVideos(project())).map((video) => video.relativePath)).toEqual(['renders/motion-a.mp4']);
  });

  it('previews only MP4s inside the project', async () => {
    const root = project();
    await expect(projectVideoPreview(root, 'renders/motion-a.mp4')).resolves.toBe(`data:video/mp4;base64,${Buffer.from('a').toString('base64')}`);
    await expect(projectVideoPreview(root, '../outside.mp4')).rejects.toThrow(/not_found|forbidden/);
    await expect(projectVideoPreview(root, 'notes.txt')).rejects.toThrow(/só MP4/);
  });

  it('refuses a symlink that leaves the project', async () => {
    const root = project(); const outside = mkdtempSync(join(tmpdir(), 'nb-outside-')); writeFileSync(join(outside, 'secret.mp4'), 's');
    try { symlinkSync(join(outside, 'secret.mp4'), join(root, 'renders', 'link.mp4')); } catch { return; /* symlinks need privileges on some Windows setups */ }
    await expect(projectVideoPreview(root, 'renders/link.mp4')).rejects.toThrow(/forbidden/);
  });

  it('saves project files and generated images where the person picks, and nothing when they cancel', async () => {
    const root = project(); const out = mkdtempSync(join(tmpdir(), 'nb-save-'));
    await expect(saveProjectFileTo(root, 'renders/motion-a.mp4', async () => join(out, 'copia.mp4'))).resolves.toBe(true);
    expect(readFileSync(join(out, 'copia.mp4'), 'utf8')).toBe('a');
    await expect(saveProjectFileTo(root, 'renders/motion-a.mp4', async () => null)).resolves.toBe(false);
    let suggested = '';
    await expect(saveGeneratedFileTo('../banner.png', Buffer.from('png').toString('base64'), async (name) => { suggested = name; return join(out, name); })).resolves.toBe(true);
    expect(suggested).toBe('banner.png');
    await expect(saveGeneratedFileTo('run.exe', 'AA==', async () => join(out, 'x'))).rejects.toThrow(/PNG, SVG ou JPEG/);
  });

  it('keeps a generated thumbnail inside the project, only as a 16:9 image', async () => {
    const png = (width: number, height: number) => { const bytes = Buffer.alloc(33); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes); bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12, 'latin1'); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20); return bytes.toString('base64'); };
    const root = project();
    const path = await saveProjectThumbnail(root, 'Como ganhar dinheiro com IA!', png(1280, 720));
    expect(path).toMatch(/^channel-assets\/thumbnails\/como-ganhar-dinheiro-com-ia-[a-z0-9]+\.png$/u);
    expect(readFileSync(join(root, ...path.split('/'))).byteLength).toBe(33);
    await expect(saveProjectThumbnail(root, 'x', png(800, 800))).rejects.toThrow(/16:9/);
    await expect(saveProjectThumbnail(root, 'x', Buffer.from('<svg/>').toString('base64'))).rejects.toThrow(/PNG ou JPEG válido/);
  });
});

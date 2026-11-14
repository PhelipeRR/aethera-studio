import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildVelixImportArgs, buildVelixOverlayArgs, buildVelixRenderArgs, createVelixService, linkVelixDependencies, prepareVelixVideo, readVelixKit, velixImportError, velixKitPath, velixVideoSlug, type VelixRenderJob } from '../src/velix.js';
import { visualRenderScheduler } from '../src/aethera-visual-scheduler.js';

describe('velixImportError', () => {
  it('points to the yt-dlp update on a refused download and leaves other errors alone', () => {
    expect(velixImportError('O Velix falhou (1): ERROR: unable to download video data: HTTP Error 403: Forbidden')).toContain('yt-dlp[default]');
    expect(velixImportError('O Velix falhou (1): disco cheio')).toBe('O Velix falhou (1): disco cheio');
  });
});

describe('velixVideoSlug', () => {
  it('turns a title into a safe folder name', () => {
    expect(velixVideoSlug('  Finanças: 5 erros de iniciante! ')).toBe('financas-5-erros-de-iniciante');
    expect(velixVideoSlug('..\\..\\Windows/system32')).toBe('windows-system32');
  });

  it('avoids reserved Windows names and refuses titles with nothing usable', () => {
    expect(velixVideoSlug('CON')).toBe('video-con');
    expect(() => velixVideoSlug('!!!')).toThrow(/invalid/);
  });
});

describe('prepareVelixVideo', () => {
  it('creates the folders of each kind and keeps what is already there', () => {
    const root = mkdtempSync(join(tmpdir(), 'velix-root-'));
    expect(prepareVelixVideo(root, 'Meu App', 'projeto')).toEqual({ folder: 'meu-app' });
    expect(existsSync(join(root, 'meu-app', 'prints'))).toBe(true);
    writeFileSync(join(root, 'meu-app', 'prints', 'tela.png'), 'png');
    prepareVelixVideo(root, 'Meu App', 'projeto');
    expect(readFileSync(join(root, 'meu-app', 'prints', 'tela.png'), 'utf8')).toBe('png');

    prepareVelixVideo(root, 'Tema', 'tema');
    for (const folder of ['pesquisa', 'narracao', 'renders']) expect(existsSync(join(root, 'tema', folder))).toBe(true);
    expect(existsSync(join(root, 'tema', 'prints'))).toBe(false);
  });

  it('refuses a root that does not exist', () => {
    expect(() => prepareVelixVideo(join(tmpdir(), 'velix-sem-pasta'), 'x', 'tema')).toThrow(/invalid/);
  });
});

const fakeRender = `
import fs from 'node:fs';
const args = process.argv.slice(2);
const [, out] = args;
if (args.includes('--preview')) {
  for (const t of args[args.indexOf('--preview') + 1].split(',').map(Number)) fs.writeFileSync(out.replace(/\\.png$/, '') + '_t' + t.toFixed(2) + '.png', 'png');
  process.exit(0);
}
if (JSON.parse(fs.readFileSync(args[args.indexOf('--data') + 1], 'utf8')).fail) { console.error('cena quebrada'); process.exit(3); }
if (JSON.parse(fs.readFileSync(args[args.indexOf('--data') + 1], 'utf8')).hang) { setInterval(() => undefined, 1000); await new Promise(() => undefined); }
console.log('  5/10 frames');
fs.writeFileSync(out, 'mp4');
`;

function kit(): string {
  const path = mkdtempSync(join(tmpdir(), 'velix-kit-'));
  mkdirSync(join(path, 'engine'));
  mkdirSync(join(path, 'templates', 'exemplos'), { recursive: true });
  writeFileSync(join(path, 'engine', 'render.mjs'), fakeRender);
  writeFileSync(join(path, 'SKILL.md'), '# MotionVelix v2.7.3: motion\n');
  writeFileSync(join(path, 'templates', 'logo-reveal.html'), '<html></html>');
  writeFileSync(join(path, 'templates', 'particulas-3d.html'), '<html></html>');
  writeFileSync(join(path, 'templates', 'exemplos', 'logo.json'), '{"brand":"X"}');
  return path;
}
const root = () => mkdtempSync(join(tmpdir(), 'velix-root-'));
const finished = async (service: ReturnType<typeof createVelixService>, job: VelixRenderJob) => {
  await vi.waitFor(() => expect(service.get(job.id)?.status).not.toBe('running'), { timeout: 10_000 });
  return service.get(job.id);
};

describe('Velix kit', () => {
  it('defaults to the Claude skills folder and honours the override', () => {
    expect(velixKitPath({}, 'C:\\Users\\a')).toContain(join('.claude', 'skills', 'motionvelix'));
    expect(velixKitPath({ NB_VELIX_DIR: 'D:\\kit' }, 'C:\\Users\\a')).toBe('D:\\kit');
  });

  it('reports a missing kit without failing', () => {
    expect(readVelixKit(join(tmpdir(), 'velix-nao-existe'))).toMatchObject({ installed: false, version: null, templates: [] });
  });

  it('lists only allowlisted scenes present in the kit, with their example data', () => {
    const path = kit();
    writeFileSync(join(path, 'templates', 'desconhecido.html'), '');
    const found = readVelixKit(path);
    expect(found).toMatchObject({ installed: true, version: '2.7.3' });
    expect(found.templates.map((item) => item.id)).toEqual(['logo-reveal', 'particulas-3d', 'dossie']);
    expect(found.templates[0]?.defaultData).toBe('{"brand":"X"}');
  });
});

describe('Velix dependencies', () => {
  const home = () => {
    const path = root();
    mkdirSync(join(path, '.motionvelix', 'node_modules', 'playwright'), { recursive: true });
    return path;
  };

  it('links the installed Playwright into the kit on Windows, once', () => {
    const path = kit();
    const user = home();
    linkVelixDependencies(path, user, 'win32');
    linkVelixDependencies(path, user, 'win32');
    expect(existsSync(join(path, 'node_modules', 'playwright'))).toBe(true);
  });

  it('leaves other platforms and missing installs alone', () => {
    const path = kit();
    linkVelixDependencies(path, home(), 'linux');
    linkVelixDependencies(path, root(), 'win32');
    expect(existsSync(join(path, 'node_modules'))).toBe(false);
  });
});

describe('Velix render arguments', () => {
  it('renders a silent alpha layer and composes it over the base while keeping base audio', () => {
    const args = buildVelixOverlayArgs('base.mp4', 'layer.mov', 'final.mp4');
    expect(args).toEqual(expect.arrayContaining(['-i', 'base.mp4', '-i', 'layer.mov']));
    expect(args.find((arg) => arg.includes('[b][1:v]overlay=0:0:eof_action=pass[v]'))).toBeDefined();
    expect(args).toEqual(expect.arrayContaining(['-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']));
    expect(args).not.toEqual(expect.arrayContaining(['-map', '1:a']));
  });

  it('builds a final render with motion blur, and WebGL only for 3D scenes', () => {
    const path = kit();
    const args = buildVelixRenderArgs(path, { root: root(), template: 'particulas-3d', data: '{}', outputPath: 'renders/a.mp4' }, 'data.json');
    expect(args).toEqual(expect.arrayContaining(['--mb', '4', '--webgl', '--data', 'data.json']));
    expect(buildVelixRenderArgs(path, { root: root(), template: 'logo-reveal', data: '{}', outputPath: 'a.mp4', quality: 'draft' }, 'data.json')).not.toContain('--webgl');
  });

  it.each([
    [{ outputPath: '../fora.mp4' }, /fora da raiz/],
    [{ outputPath: 'C:\\fora\\a.mp4' }, /fora da raiz/],
    [{ outputPath: 'a.mov' }, /deve ser MP4/],
    [{ outputPath: 'a.mp4', audioPath: '../musica.mp3' }, /fora da raiz/],
    [{ outputPath: 'a.mp4', template: '../../evil' }, /desconhecido/],
  ])('refuses %j', (override, message) => {
    expect(() => buildVelixRenderArgs(kit(), { root: root(), template: 'logo-reveal', data: '{}', ...override }, 'data.json')).toThrow(message);
  });

  it('refuses an output that leaves the root through a directory link', () => {
    const base = root();
    const outside = root();
    symlinkSync(outside, join(base, 'link'), 'junction');
    expect(() => buildVelixRenderArgs(kit(), { root: base, template: 'logo-reveal', data: '{}', outputPath: 'link/a.mp4' }, 'data.json')).toThrow(/fora da raiz/);
  });
});

describe('Velix import', () => {
  const base = { url: 'https://www.youtube.com/watch?v=abc', quality: 720, confirmed: true } as const;
  const fakeDownloader = (script: string) => {
    const file = join(root(), 'yt-dlp.mjs');
    writeFileSync(file, script);
    return createVelixService({ kitPath: kit(), downloader: [process.execPath, file] });
  };
  const downloads = `
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('2026.01.01'); process.exit(0); }
const dir = args[args.indexOf('--paths') + 1];
fs.mkdirSync(dir, { recursive: true });
console.log('[download]  50.0% of 1MiB');
const file = path.join(dir, 'video-abc.mp4');
fs.writeFileSync(file, 'mp4');
console.log(file);
`;

  it('requires confirmation of the right to use the video', () => {
    expect(() => buildVelixImportArgs({ ...base, root: root(), confirmed: false })).toThrow(/confirme/);
  });

  it.each(['file:///C:/segredo.txt', 'não é link', 'javascript:alert(1)'])('refuses %s', (url) => {
    expect(() => buildVelixImportArgs({ ...base, root: root(), url })).toThrow(/link/);
  });

  it('downloads one video into the root, keeping the URL out of the options', () => {
    const folder = root();
    const args = buildVelixImportArgs({ ...base, root: folder });
    expect(args).toEqual(expect.arrayContaining(['--no-playlist', '--paths', join(realpathSync(folder), 'imports')]));
    expect(args.slice(-2)).toEqual(['--', base.url]);
    expect(args.join(' ')).toContain('[height<=?720][vcodec^=avc1]');
  });

  it('extracts audio as MP3', () => {
    expect(buildVelixImportArgs({ ...base, root: root(), quality: 'mp3' })).toEqual(expect.arrayContaining(['-x', '--audio-format', 'mp3']));
  });

  it('reports the saved file relative to the root', async () => {
    const service = fakeDownloader(downloads);
    expect(await service.kit()).toMatchObject({ downloaderVersion: '2026.01.01' });
    const job = await finished(service, service.importVideo({ ...base, root: root() }));
    expect(job).toMatchObject({ status: 'completed', progress: 1, output: join('imports', 'video-abc.mp4') });
  });

  it('fails when nothing was saved inside the root', async () => {
    const service = fakeDownloader(`console.log(${JSON.stringify(join(tmpdir(), 'fora.mp4'))});`);
    const job = await finished(service, service.importVideo({ ...base, root: root() }));
    expect(job?.status).toBe('failed');
  });

  it('reports a missing downloader without failing', async () => {
    const service = createVelixService({ kitPath: kit(), downloader: [join(tmpdir(), 'sem-yt-dlp.exe')] });
    expect(await service.kit()).toMatchObject({ installed: true, downloaderVersion: null });
  });
});

describe('Velix service', () => {
  it('renders, reports progress and returns preview stills', async () => {
    const service = createVelixService({ kitPath: kit(), node: process.execPath });
    const base = root();
    const job = await finished(service, service.start({ root: base, template: 'logo-reveal', data: '{}', outputPath: 'renders/a.mp4' }));
    expect(job).toMatchObject({ status: 'completed', progress: 1 });
    expect(readFileSync(join(base, 'renders', 'a.mp4'), 'utf8')).toBe('mp4');
    await expect(service.frames({ root: base, template: 'logo-reveal', data: '{}' }, [1])).resolves.toEqual([`data:image/png;base64,${Buffer.from('png').toString('base64')}`]);
  });

  it('rejects invalid scene data before spawning', () => {
    const service = createVelixService({ kitPath: kit(), node: process.execPath });
    expect(() => service.start({ root: root(), template: 'logo-reveal', data: '{', outputPath: 'a.mp4' })).toThrow(/JSON/);
  });

  it('surfaces the failure of a scene', async () => {
    const service = createVelixService({ kitPath: kit(), node: process.execPath });
    const job = await finished(service, service.start({ root: root(), template: 'logo-reveal', data: '{"fail":true}', outputPath: 'a.mp4' }));
    expect(job?.status).toBe('failed');
    expect(job?.error).toContain('cena quebrada');
  });

  it('allows one render at a time and cancels the running process', async () => {
    const service = createVelixService({ kitPath: kit(), node: process.execPath });
    const job = service.start({ root: root(), template: 'logo-reveal', data: '{"hang":true}', outputPath: 'a.mp4' });
    expect(() => service.start({ root: root(), template: 'logo-reveal', data: '{}', outputPath: 'b.mp4' })).toThrow(/busy/);
    service.cancel(job.id);
    expect(await finished(service, job)).toMatchObject({ status: 'cancelled' });
  });

  it('queues kit renders behind visual analysis before spawning the renderer', async () => {
    const base = root();
    let release!: () => void;
    let started!: () => void;
    const running = new Promise<void>((resolve) => { started = resolve; });
    const lock = visualRenderScheduler.run(async () => { started(); await new Promise<void>((resolve) => { release = resolve; }); });
    await running;
    const service = createVelixService({ kitPath: kit(), node: process.execPath });
    const job = service.start({ root: base, template: 'logo-reveal', data: '{}', outputPath: 'renders/queued.mp4' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(existsSync(join(base, 'renders', 'queued.mp4'))).toBe(false);
    release(); await lock;
    expect(await finished(service, job)).toMatchObject({ status: 'completed' });
  });
});

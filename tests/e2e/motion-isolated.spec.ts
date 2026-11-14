import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { _electron as electron, expect, test } from '@playwright/test';
import { mainWindowOf } from './app';

const exec = promisify(execFile);
const installed = process.env['NB_ISOLATED_APP'] ?? '';

// Runs a copy of the packaged app kept outside the repository, with no FFmpeg on the PATH and no shared browser cache.
// The download is real and starts only from the button, so this stays behind its own flag.
test.describe(() => {
  test.skip(!existsSync(join(installed, 'NeuralBridge.exe')), 'needs a packaged copy outside the repository (NB_ISOLATED_APP)');
  test.setTimeout(600_000);

  test('sem navegador recusa com aviso; o download só começa no clique; cancela; depois renderiza e passa no FFprobe', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'nb-isolated-data-'));
    for (const dir of ['claude-config', 'codex-home', 'Video']) mkdirSync(join(dataDir, dir));
    const windows = process.env['SystemRoot'] ?? 'C:\\Windows';
    const env = { SystemRoot: windows, TEMP: dataDir, TMP: dataDir, USERPROFILE: dataDir, APPDATA: join(dataDir, 'roaming'), LOCALAPPDATA: join(dataDir, 'local'), PATH: `${windows}\\System32;${windows}`, NB_DATA_DIR: dataDir, CLAUDE_CONFIG_DIR: join(dataDir, 'claude-config'), CODEX_HOME: join(dataDir, 'codex-home') };
    const app = await electron.launch({ executablePath: join(installed, 'NeuralBridge.exe'), cwd: installed, env });
    const page = await mainWindowOf(app);
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: 'Pular por agora' }).click({ timeout: 3_000 }).catch(() => undefined);
    const root = join(dataDir, 'Video');
    const project = await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
    await page.evaluate((id) => window.neuralbridge.video.saveSettings(id), project.id);
    const brief = await page.evaluate((id) => window.neuralbridge.video.productionEditorialVersion({ projectId: id, kind: 'brief', content: 'brief' }), project.id);
    await page.evaluate(({ id, versionId }) => window.neuralbridge.video.productionEditorialDecision({ projectId: id, versionId, decision: 'approved' }), { id: project.id, versionId: brief.id });
    const script = await page.evaluate(({ id, sourceVersionId }) => window.neuralbridge.video.productionEditorialVersion({ projectId: id, kind: 'script', sourceVersionId, content: 'Roteiro aprovado' }), { id: project.id, sourceVersionId: brief.id });
    await page.evaluate(({ id, versionId }) => window.neuralbridge.video.productionEditorialDecision({ projectId: id, versionId, decision: 'approved' }), { id: project.id, versionId: script.id });
    await page.evaluate((id) => window.neuralbridge.video.motionSave({ projectId: id, project: { schemaVersion: 1, templateId: 'velix-base', templateVersion: 1, width: 640, height: 360, fps: 15, captions: [], scenes: [{ id: 't', kind: 'title', text: 'Isolado', durationInFrames: 15, transition: 'cut' }] } }), project.id);

    expect(await page.evaluate(() => window.neuralbridge.video.motionRuntime())).toMatchObject({ templates: true, tools: true, browser: false, installing: false });
    const render = () => page.evaluate(({ id, version }) => window.neuralbridge.video.motionRender({ projectId: id, scriptVersionId: version }), { id: project.id, version: script.id });
    await expect(render()).rejects.toThrow(/instale o navegador/);
    expect(existsSync(join(dataDir, 'motion-runtime'))).toBe(false);

    await page.evaluate(() => { window.location.hash = '#/video'; });
    await page.getByRole('tab', { name: 'Motion' }).click();
    const region = page.getByRole('region', { name: 'Navegador de render' });
    await expect(page.getByRole('button', { name: 'Renderizar Motion' })).toBeDisabled();

    await region.getByRole('button', { name: 'Baixar navegador de render' }).click();
    await expect(region.getByRole('button', { name: 'Cancelar download' })).toBeVisible();
    await region.getByRole('button', { name: 'Cancelar download' }).click();
    await expect(region.getByRole('alert')).toContainText('Download cancelado.', { timeout: 20_000 });
    expect((await page.evaluate(() => window.neuralbridge.video.motionRuntime())).browser).toBe(false);

    await region.getByRole('button', { name: 'Baixar navegador de render' }).click();
    await expect.poll(async () => (await page.evaluate(() => window.neuralbridge.video.motionRuntime())).browser, { timeout: 300_000, intervals: [2_000] }).toBe(true);

    const job = await render();
    await expect.poll(async () => (await page.evaluate((id) => window.neuralbridge.video.motionStatus(id), job.id))?.status, { timeout: 180_000, intervals: [1_000] }).not.toBe('running');
    const final = await page.evaluate((id) => window.neuralbridge.video.motionStatus(id), job.id);
    console.log(`isolated motion: ${JSON.stringify(final)?.slice(0, 400)}`);
    expect(final?.status).toBe('completed');
    const output = join(root, final?.outputPath ?? '');
    const ffprobe = join(installed, 'resources/app.asar.unpacked/node_modules/@remotion/compositor-win32-x64-msvc/ffprobe.exe');
    const { stdout } = await exec(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'default=nw=1', output]);
    console.log(`isolated ffprobe: ${stdout.replace(/\s+/g, ' ')}`);
    expect(stdout).toContain('codec_type=video');
    expect(JSON.parse(readFileSync(output.replace('.mp4', '.json'), 'utf8'))).toMatchObject({ editorialVersionId: script.id });
    await app.close();
  });
});

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { _electron as electron, expect, test } from '@playwright/test';
import { mainWindowOf } from './app';

const exec = promisify(execFile);
const exe = resolve(import.meta.dirname, '../../dist/win-unpacked/NeuralBridge.exe');

// Renders inside the installed layout, where the worker and the bundle live outside app.asar.
test.describe(() => {
  test.skip(process.env['NB_MOTION'] !== '1' || !existsSync(exe), 'needs the packaged app (npm run dist:win) and NB_MOTION=1');
  test.setTimeout(300_000);

  test('o app empacotado renderiza Motion e passa no FFprobe', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'nb-e2e-motion-'));
    for (const dir of ['claude-config', 'codex-home', 'Video']) mkdirSync(join(dataDir, dir));
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    delete env['ELECTRON_RUN_AS_NODE'];
    const app = await electron.launch({ executablePath: exe, env: { ...env, NB_DATA_DIR: dataDir, CLAUDE_CONFIG_DIR: join(dataDir, 'claude-config'), CODEX_HOME: join(dataDir, 'codex-home') } });
    const page = await mainWindowOf(app);
    await page.waitForLoadState('domcontentloaded');
    const root = join(dataDir, 'Video');
    const project = await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
    await page.evaluate((id) => window.neuralbridge.video.saveSettings(id), project.id);
    const brief = await page.evaluate((id) => window.neuralbridge.video.productionEditorialVersion({ projectId: id, kind: 'brief', content: 'brief' }), project.id);
    await page.evaluate(({ id, versionId }) => window.neuralbridge.video.productionEditorialDecision({ projectId: id, versionId, decision: 'approved' }), { id: project.id, versionId: brief.id });
    const script = await page.evaluate(({ id, sourceVersionId }) => window.neuralbridge.video.productionEditorialVersion({ projectId: id, kind: 'script', sourceVersionId, content: 'Roteiro aprovado' }), { id: project.id, sourceVersionId: brief.id });
    await page.evaluate(({ id, versionId }) => window.neuralbridge.video.productionEditorialDecision({ projectId: id, versionId, decision: 'approved' }), { id: project.id, versionId: script.id });
    await page.evaluate((id) => window.neuralbridge.video.motionSave({ projectId: id, project: { schemaVersion: 1, templateId: 'velix-base', templateVersion: 1, width: 640, height: 360, fps: 15, captions: [], scenes: [{ id: 't', kind: 'title', text: 'Pacote', durationInFrames: 15, transition: 'cut' }] } }), project.id);
    const job = await page.evaluate(({ id, version }) => window.neuralbridge.video.motionRender({ projectId: id, scriptVersionId: version }), { id: project.id, version: script.id });
    await expect.poll(async () => (await page.evaluate((id) => window.neuralbridge.video.motionStatus(id), job.id))?.status, { timeout: 240_000, intervals: [1_000] }).not.toBe('running');
    const final = await page.evaluate((id) => window.neuralbridge.video.motionStatus(id), job.id);
    console.log(`packaged motion: ${JSON.stringify(final)?.slice(0, 500)}`);
    expect(final?.status).toBe('completed');
    const probe = await exec('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', join(root, final?.outputPath ?? '')]);
    expect(probe.stdout).toContain('video');
    await app.close();
  });
});

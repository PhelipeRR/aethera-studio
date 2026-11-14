import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { freshDataDir, launchApp } from './app';

// Real agent through the app: Codex by default, Claude only with NB_REAL_AGENT=claude; writes nothing in the client's configuration.
const agent: 'claude' | 'codex' = process.env['NB_REAL_AGENT'] === 'claude' ? 'claude' : 'codex';

test.describe('Skills com provider real', () => {
  test.skip(process.env['NB_REAL_CLI'] !== '1' || (agent === 'codex' && process.env['NB_REAL_CODEX_ONLY'] !== '1'), 'needs a logged-in agent (NB_REAL_CLI=1 with NB_REAL_CODEX_ONLY=1 or NB_REAL_AGENT=claude)');
  test.setTimeout(540_000);

  test('skill com Git e memória chega ao agente real, persiste e sobrevive ao reinício; composição Motion passa pelo TaskEngine', async () => {
    const root = join(mkdtempSync(join(tmpdir(), 'nb-skills-real-')), 'loja');
    mkdirSync(root, { recursive: true });
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root });
    writeFileSync(join(root, 'README.md'), '# Loja\n');
    git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'inicial');
    const dataDir = freshDataDir();
    const { app, page } = await launchApp(dataDir, { isolateClients: false, env: { NB_YOUTUBE_API_KEY: '', ...(process.env['NB_MOTION_BROWSER'] ? { NB_MOTION_BROWSER: process.env['NB_MOTION_BROWSER'] } : {}) } });
    const project = await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
    await page.evaluate(({ id }) => window.neuralbridge.brain.store({ title: 'Decisão do checkout', content: 'O checkout da loja usa parcelas em até 12 vezes.', type: 'decision', projectId: id }), { id: project.id });
    const skills = await page.evaluate(() => window.neuralbridge.skills.list());
    const skill = skills.find((item) => item.valid);
    if (!skill) throw new Error('nenhuma skill válida instalada');
    const refused = await page.evaluate(({ id, mode }) => window.neuralbridge.tasks.start({ prompt: 'Sem editar nada, responda só: ok', projectId: id, mode, skillIds: ['neuralbridge:motion-composition'] }), { id: project.id, mode: agent });
    await expect.poll(async () => (await page.evaluate((id) => window.neuralbridge.tasks.get(id), refused.id)).status, { timeout: 120_000, intervals: [2_000] }).toBe('completed');
    expect((await page.evaluate((id) => window.neuralbridge.tasks.get(id), refused.id)).events.map((event) => event.kind)).toContain('skills_skipped');
    await page.evaluate(async ({ skillId, who }) => { const settings = await window.neuralbridge.skills.settings(); await window.neuralbridge.skills.saveSettings({ ...settings, preferences: [...settings.preferences, { skillId, taskTypes: ['question'], agents: [who], enabled: true }] }); }, { skillId: skill.id, who: agent });
    const started = await page.evaluate(({ id, skillId, mode }) => window.neuralbridge.tasks.start({ prompt: 'Sem editar nada, responda em uma frase: em até quantas parcelas é o checkout?', projectId: id, mode, skillIds: [skillId] }), { id: project.id, skillId: skill.id, mode: agent });
    await expect.poll(async () => {
      const state = await page.evaluate((id) => window.neuralbridge.tasks.get(id), started.id);
      if (state.status === 'failed') throw new Error(`falhou: ${(state.error ?? '').slice(0, 300)}`);
      return state.status;
    }, { timeout: 240_000, intervals: [2_000] }).toBe('completed');
    const detail = await page.evaluate((id) => window.neuralbridge.tasks.get(id), started.id);
    const kinds = detail.events.map((event) => event.kind);
    console.log(`skills real: kinds=${[...new Set(kinds)].join(',')} summary=${(detail.summary ?? '').slice(0, 160)}`);
    const context = detail.events.find((event) => event.kind === 'skills_context');
    expect(context?.data).toMatchObject({ sources: { git: true, memory: true } });
    expect(detail.summary ?? '').toMatch(/12/);

    const brief = await page.evaluate((id) => window.neuralbridge.video.productionEditorialVersion({ projectId: id, kind: 'brief', content: 'brief' }), project.id);
    await page.evaluate(({ id, versionId }) => window.neuralbridge.video.productionEditorialDecision({ projectId: id, versionId, decision: 'approved' }), { id: project.id, versionId: brief.id });
    const script = await page.evaluate(({ id, sourceVersionId }) => window.neuralbridge.video.productionEditorialVersion({ projectId: id, kind: 'script', sourceVersionId, content: 'O céu é azul porque a atmosfera espalha mais a luz de onda curta.' }), { id: project.id, sourceVersionId: brief.id });
    await page.evaluate(({ id, versionId }) => window.neuralbridge.video.productionEditorialDecision({ projectId: id, versionId, decision: 'approved' }), { id: project.id, versionId: script.id });
    const suggestion = await page.evaluate(({ id, version, who }) => window.neuralbridge.video.motionSuggest({ projectId: id, scriptVersionId: version, agent: who }), { id: project.id, version: script.id, who: agent });
    console.log(`motion real: ${JSON.stringify({ agent: suggestion.agent, model: suggestion.model, executionId: suggestion.executionId, scenes: suggestion.scenes.length })}`);
    expect(suggestion).toMatchObject({ agent, executionId: expect.any(String) });
    expect(suggestion.scenes.length).toBeGreaterThan(0);
    if (process.env['NB_MOTION'] === '1') {
      await page.evaluate(({ id, scenes }) => window.neuralbridge.video.motionSave({ projectId: id, project: { schemaVersion: 2, templateId: 'velix-base', templateVersion: 1, width: 1280, height: 720, fps: 30, captions: [], scenes, style: { background: { kind: 'solid', color: '#000000' }, font: 'inter', accent: '#ff6a00' }, narration: null, licenses: [] } }), { id: project.id, scenes: suggestion.scenes });
      const job = await page.evaluate(({ id, version }) => window.neuralbridge.video.motionRender({ projectId: id, scriptVersionId: version }), { id: project.id, version: script.id });
      await expect.poll(async () => (await page.evaluate((id) => window.neuralbridge.video.motionStatus(id), job.id))?.status, { timeout: 200_000, intervals: [1_000] }).toBe('completed');
      const output = readdirSync(join(root, 'renders')).find((file) => file.endsWith('.mp4'));
      if (!output) throw new Error('render sem mp4');
      const streams = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', join(root, 'renders', output)]).toString();
      console.log(`motion render real: ${output} streams=${streams.trim().split(/\s+/).join(',')}`);
      expect(streams).toContain('video');
    }
    await app.close();

    const restarted = await launchApp(dataDir, { isolateClients: false, env: { NB_YOUTUBE_API_KEY: '', ...(process.env['NB_MOTION_BROWSER'] ? { NB_MOTION_BROWSER: process.env['NB_MOTION_BROWSER'] } : {}) } });
    const after = await restarted.page.evaluate((id) => window.neuralbridge.tasks.get(id), started.id);
    expect(after.events.map((event) => event.kind)).toContain('skills_context');
    const tasks = await restarted.page.evaluate((id) => window.neuralbridge.tasks.list({ projectId: id, limit: 20 }), project.id);
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    await restarted.app.close();
  });
});

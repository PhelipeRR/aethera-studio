import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FAKE_AGENTS, launchApp } from './app';

test('executa o plano do Agent Swarm pelo TaskEngine e consolida resultados', async () => {
  const root = join(mkdtempSync(join(tmpdir(), 'nb-e2e-swarm-')), 'workspace');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'README.md'), '# Swarm\n');
  const { app, page } = await launchApp(undefined, { env: FAKE_AGENTS });
  const project = await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
  const result = await page.evaluate(({ projectId }) => window.neuralbridge.tasks.swarmRun('Implemente uma função de soma', projectId, true), { projectId: project.id });
  expect(result.roles).toEqual(['developer']);
  expect(result.taskIds).toHaveLength(1);
  expect(result.results).toEqual([expect.objectContaining({ role: 'developer', status: 'completed' })]);
  expect(result.conflicts).toEqual([]);
  await app.close();
});

test('exige aprovação para plano sensível e executa camadas dependentes', async () => {
  const root = join(mkdtempSync(join(tmpdir(), 'nb-e2e-swarm-sec-')), 'workspace');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'README.md'), '# Swarm security\n');
  const { app, page } = await launchApp(undefined, { env: FAKE_AGENTS });
  const project = await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
  const denied = await page.evaluate(({ projectId }) => window.neuralbridge.tasks.swarmRun('Faça uma implementação complexa com revisão de segurança', projectId, false).then(() => 'started', (error: unknown) => String(error)), { projectId: project.id });
  expect(denied).toMatch(/aprovação/);
  const result = await page.evaluate(({ projectId }) => window.neuralbridge.tasks.swarmRun('Faça uma implementação complexa com revisão de segurança', projectId, true), { projectId: project.id });
  expect(result.roles).toEqual(expect.arrayContaining(['architect', 'developer', 'qa', 'security', 'reviewer']));
  expect(result.results.every((item) => item.status === 'completed')).toBe(true);
  expect(result.conflicts).toEqual([]);
  await app.close();
});

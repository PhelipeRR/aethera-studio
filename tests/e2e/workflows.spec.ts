import { expect, test } from '@playwright/test';
import { FAKE_AGENTS, launchApp } from './app';

test('cria e persiste um workflow validado, exigindo aprovação para executar', async () => {
  const { app, page } = await launchApp(undefined, { env: FAKE_AGENTS });
  await page.getByRole('link', { name: 'Workflows', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible();
  await page.getByLabel('Nome').fill('Build seguro');
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  await page.getByLabel(/Definição das etapas/).fill(JSON.stringify({ name: 'Build seguro', projectId: null, maxParallel: 1, steps: [{ id: 'build', title: 'Build', prompt: 'npm run build', agent: 'auto', mode: 'auto', dependsOn: [], requiresApproval: true }] }, null, 2));
  await page.getByRole('button', { name: 'Salvar e validar' }).click();
  await expect(page.getByText('Workflow salvo e validado.')).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'Salvos' }).click();
  await expect(page.getByRole('button', { name: /Build seguro/ })).toBeVisible();
  const id = await page.evaluate(() => window.neuralbridge.workflows.list().then((items) => items.find((item) => item.name === 'Build seguro')?.id ?? ''));
  expect(id).not.toBe('');
  const denied = await page.evaluate((workflowId) => window.neuralbridge.workflows.run(workflowId, false).then(() => 'started', (error: unknown) => String(error)), id);
  expect(denied).toMatch(/aprovação/);
  await app.close();
});

test('cria pelo canvas sem editar JSON, reabre, aprova a etapa e vê o estado real', async () => {
  const { app, page } = await launchApp(undefined, { env: FAKE_AGENTS });
  await page.getByRole('link', { name: 'Workflows', exact: true }).click();
  const canvas = page.getByRole('application', { name: 'Canvas do workflow' });
  await expect(canvas.getByText('Primeira etapa')).toBeVisible();
  await page.getByRole('button', { name: 'Adicionar Claude Code' }).click();
  await expect(canvas.getByText('Claude Code', { exact: true }).last()).toBeVisible();
  await page.getByLabel('Título').fill('Revisar');
  await page.getByRole('button', { name: 'Organizar' }).click();
  await page.getByLabel('Nome').fill('Pelo canvas');
  await page.getByRole('button', { name: 'Salvar e validar' }).click();
  await expect(page.getByText('Workflow salvo e validado.')).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'Salvos' }).click();
  await page.getByRole('button', { name: /Pelo canvas/ }).click();
  await expect(canvas.getByText('Revisar')).toBeVisible();
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  await expect(page.getByLabel(/Definição das etapas/)).toHaveValue(/Revisar/);
  await page.getByRole('button', { name: 'Editor visual' }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Executar workflow' }).click();
  const runs = page.getByRole('region', { name: 'Execuções do workflow' });
  await expect(runs).toContainText('Esperando você');
  await runs.getByRole('button', { name: 'Aprovar etapa' }).click();
  await expect(runs).toContainText('Concluída', { timeout: 15_000 });
  await expect(canvas.getByText('Concluída').first()).toBeVisible();
  await app.close();
});

test('pausa, retoma e cancela uma execução persistida pelo Electron', async () => {
  const { app, page } = await launchApp(undefined, { env: FAKE_AGENTS });
  const workflowId = await page.evaluate(() => window.neuralbridge.workflows.save(undefined, { name: 'Controle E2E', projectId: null, maxParallel: 1, steps: [{ id: 'slow', title: 'Etapa lenta', prompt: 'Explique LENTO', agent: 'claude', mode: 'claude', dependsOn: [], requiresApproval: false }] }).then((result) => result.id));
  await page.evaluate((id) => window.neuralbridge.workflows.run(id, true), workflowId);
  await page.getByRole('link', { name: 'Workflows', exact: true }).click();
  await page.getByRole('tab', { name: 'Salvos' }).click();
  await page.getByRole('button', { name: /Controle E2E/ }).click();
  const runs = page.getByRole('region', { name: 'Execuções do workflow' });
  await expect(runs).toContainText('Executando');
  await runs.getByRole('button', { name: 'Pausar' }).click();
  await expect(runs).toContainText('Pausada');
  await runs.getByRole('button', { name: 'Retomar' }).click();
  await expect(runs).toContainText('Executando');
  page.once('dialog', (dialog) => void dialog.accept());
  await runs.getByRole('button', { name: 'Cancelar' }).click();
  await expect(runs).toContainText('Cancelada');
  await app.close();
});

test('a lista de templates rola sem quebrar a tela e mantém as linhas no lugar', async () => {
  const { app, page } = await launchApp(undefined, { env: FAKE_AGENTS });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('link', { name: 'Workflows', exact: true }).click();
  await page.getByRole('tab', { name: 'Modelos' }).click();
  const list = page.getByRole('list', { name: 'Templates disponíveis' });
  await expect(list).toBeVisible();
  // Scrolling used to read event.currentTarget inside a deferred state update and crash the screen.
  for (const top of [120, 400, 99_999, 0]) await list.evaluate((element, value) => { element.scrollTop = value; element.dispatchEvent(new Event('scroll', { bubbles: true })); }, top);
  await list.hover();
  await page.mouse.wheel(0, 600);
  await expect(page.getByText('Unexpected Application Error')).toHaveCount(0);
  expect(errors).toEqual([]);
  // Rows are exactly the height the window math assumes, so a row is always under the viewport's top edge.
  const rows = await list.evaluate((element) => [...element.querySelectorAll(':scope > li:not([aria-hidden])')].map((row) => (row as HTMLElement).offsetHeight));
  expect(rows.length).toBeGreaterThan(0);
  expect(new Set(rows)).toEqual(new Set([48]));
  await app.close();
});

test('galeria de templates suporta busca, favorito, exportação, importação e layout', async () => {
  const { app, page } = await launchApp(undefined, { env: FAKE_AGENTS });
  await page.getByRole('link', { name: 'Workflows', exact: true }).click();
  await page.getByRole('tab', { name: 'Modelos' }).click();
  await expect(page.getByText('Bug Fix Pipeline')).toBeVisible();
  await page.getByLabel('Buscar templates').fill('Bug Fix');
  await expect(page.getByText('Feature Development Pipeline')).not.toBeVisible();
  const result = await page.evaluate(async () => {
    const templates = await window.neuralbridge.workflows.templates();
    const template = templates[0];
    if (!template) throw new Error('template missing');
    await window.neuralbridge.workflows.favoriteTemplate(template.id, true);
    const exported = await window.neuralbridge.workflows.exportTemplate(template.id);
    const imported = await window.neuralbridge.workflows.importTemplate(exported);
    const workflow = await window.neuralbridge.workflows.save(undefined, { schemaVersion: 2, name: 'Layout E2E', projectId: null, maxParallel: 1, inputs: [], steps: [{ id: 'start', title: 'Start', kind: 'agent', prompt: 'read', agent: 'auto', mode: 'auto', access: 'read-only', dependsOn: [], requiresApproval: false }] });
    await window.neuralbridge.workflows.saveLayout(workflow.id, JSON.stringify({ nodes: [{ id: 'start', x: 10, y: 20 }] }));
    return { imported: imported.id, exported: exported.length, workflow: workflow.id };
  });
  expect(result.exported).toBeGreaterThan(100);
  expect(result.imported).toBeTruthy();
  expect(result.workflow).toBeTruthy();
  await app.close();
});

test('etapa selecionada no canvas pode ser duplicada e excluída, e aparece no minimapa', async () => {
  const { app, page } = await launchApp(undefined, { env: FAKE_AGENTS });
  await page.getByRole('link', { name: 'Workflows', exact: true }).click();
  const canvas = page.getByRole('application', { name: 'Canvas do workflow' });
  await expect(canvas.locator('.react-flow__minimap-node')).toHaveCount(3);
  await canvas.getByText('Primeira etapa').click();
  await page.getByRole('button', { name: 'Duplicar' }).click();
  await expect(canvas.getByText('Primeira etapa (cópia)')).toBeVisible();
  await canvas.getByText('Primeira etapa (cópia)').click();
  await page.keyboard.press('Delete');
  await expect(canvas.getByText('Primeira etapa (cópia)')).toBeHidden();
  await canvas.getByText('Primeira etapa').click();
  await page.keyboard.press('Delete');
  await expect(canvas.getByText('Primeira etapa')).toBeVisible();
  await app.close();
});

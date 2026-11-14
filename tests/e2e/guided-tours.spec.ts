import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp } from './app';

const TOUR_STORAGE_KEY = 'nb.guided-tours.2026-11-01.v1';
const PAGE_TOURS = [
  { label: 'Execuções', path: '/runs', step: 'Histórico de tarefas' },
  { label: 'Memória', path: '/memory/explore', step: 'Busque contexto' },
  { label: 'Skills', path: '/skills', step: 'Capacidades instaladas' },
  { label: 'Projetos', path: '/projects', step: 'Pastas cadastradas' },
  { label: 'Git Intelligence', path: '/git-intelligence', step: 'Histórico verificável' },
  { label: 'Agentes', path: '/agents', step: 'Status dos agentes' },
  { label: 'MCPs', path: '/mcp', step: 'Estado do servidor' },
  { label: 'Analytics', path: '/analytics', step: 'Escolha o período' },
  { label: 'Workflows', path: '/workflows', step: 'Fluxos validados' },
  { label: 'Mission Control', path: '/mission-control', step: 'Fila operacional' },
  { label: 'Aethera', path: '/video', step: 'Fluxo editorial' },
  { label: 'Configurações', path: '/settings', step: 'Aparência' },
] as const;

async function skipOnboarding(page: Page) {
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ onboarding: 'skipped', tours: {} })), TOUR_STORAGE_KEY);
  await page.reload();
}

async function goTo(page: Page, path: string) {
  await page.evaluate((next) => { window.location.hash = `#${next}`; }, path);
  await page.waitForFunction((next) => window.location.hash.startsWith(`#${next}`), path);
  await expect(page.getByRole('button', { name: /Iniciar tutorial de/ }).first()).toBeVisible();
}

async function closeElectron(app: ElectronApplication) {
  try {
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0));
  } catch {
    // The process may already have exited after a failed assertion.
  }
}

test('first use can skip onboarding and start the page tutorial without executing an action', async () => {
  const { app, page } = await launchApp(undefined, { guidedTours: true });
  await expect(page.getByRole('dialog')).toContainText('Conheça o Singularity');
  await page.getByRole('button', { name: 'Pular por agora' }).click();
  await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Chat', exact: true }).click();
  await expect(page.locator('[data-tour="tour-chat-input"]')).toBeVisible();
  await expect(page.locator('[data-tour="tour-chat-submit"]')).toBeVisible();
  await expect(page.locator('[data-tour="chat-context"]')).toBeVisible();
  await page.getByRole('button', { name: /Iniciar tutorial de Trabalhe com os agentes/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Descreva o resultado');
  await page.getByRole('button', { name: /Próximo/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Envie quando estiver pronto');
  await page.getByRole('button', { name: 'Fechar tutorial' }).click();
  await expect(page.getByLabel('Mensagem', { exact: true })).toBeVisible();
  await app.close();
});

test('tutorial state survives reload and missing targets do not start real operations', async () => {
  const { app, page } = await launchApp(undefined, { guidedTours: true });
  await page.evaluate(() => localStorage.setItem('nb.guided-tours.2026-11-01.v1', JSON.stringify({ onboarding: 'skipped', tours: {} })));
  await page.reload();
  await page.getByRole('button', { name: /Iniciar tutorial de Comece pelo panorama/ }).first().click();
  await expect(page.getByRole('dialog')).toContainText('Ações rápidas');
  await app.evaluate(({ app: electronApp }) => electronApp.exit(0));
});

for (const pageTour of PAGE_TOURS) {
  test(`isolated tutorial opens on ${pageTour.label}`, async () => {
    const { app, page } = await launchApp(undefined, { guidedTours: true });
    try {
      await skipOnboarding(page);
      await goTo(page, pageTour.path);
      await page.getByRole('button', { name: /Iniciar tutorial de/ }).first().click();
      await expect(page.getByRole('dialog')).toContainText(pageTour.step);
      await page.getByRole('button', { name: 'Fechar tutorial' }).focus();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    } finally {
      await closeElectron(app);
    }
  });
}

test('route changes close an incompatible tour without leaving an orphan overlay', async () => {
  const { app, page } = await launchApp(undefined, { guidedTours: true });
  try {
    await skipOnboarding(page);
    await goTo(page, '/projects');
    await page.getByRole('button', { name: /Iniciar tutorial de/ }).first().click();
    await expect(page.getByRole('dialog')).toContainText('Pastas cadastradas');
    await page.evaluate(() => { window.location.hash = '#/projects/project-1'; });
    await page.waitForFunction(() => window.location.hash === '#/projects/project-1');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Iniciar tutorial de/ })).toHaveCount(0);
  } finally {
    await closeElectron(app);
  }
});

test('hidden workflow action is informative and can be advanced safely', async () => {
  const { app, page } = await launchApp(undefined, { guidedTours: true });
  try {
    await skipOnboarding(page);
    await goTo(page, '/workflows');
    await page.addStyleTag({ content: '[data-tour="workflows-run"] { display: none !important; }' });
    await page.getByRole('button', { name: /Iniciar tutorial de/ }).first().click();
    await expect(page.getByRole('dialog')).toContainText('Fluxos validados');
    const next = page.getByRole('button', { name: /Próximo/ });
    await next.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toContainText('não está disponível');
    const finish = page.getByRole('button', { name: 'Concluir' });
    await finish.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-tour="workflows-run"]')).toHaveCount(0);
  } finally {
    await closeElectron(app);
  }
});

test('sidebar collapse, resize and focus restoration keep the tutorial usable', async () => {
  const { app, page } = await launchApp(undefined, { guidedTours: true });
  try {
    await skipOnboarding(page);
    await goTo(page, '/settings');
    const sidebarToggle = page.getByRole('button', { name: 'Recolher menu' });
    await sidebarToggle.click();
    const tutorialButton = page.getByRole('button', { name: /Iniciar tutorial de/ }).first();
    await tutorialButton.focus();
    await tutorialButton.click();
    await page.setViewportSize({ width: 800, height: 600 });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.getByRole('dialog')).toContainText('Aparência');
    await page.keyboard.press('Escape');
    await expect(tutorialButton).toBeFocused();
  } finally {
    await closeElectron(app);
  }
});

test('safe tutorial dialog traps focus and restores it without invoking product actions', async () => {
  const { app, page } = await launchApp(undefined, { guidedTours: true });
  try {
    await skipOnboarding(page);
    await goTo(page, '/runs');
    const tutorialButton = page.getByRole('button', { name: /Iniciar tutorial de/ }).first();
    await tutorialButton.focus();
    await tutorialButton.click();

    const dialog = page.getByRole('dialog', { name: 'Histórico de tarefas' });
    await expect(dialog).toBeVisible();
    const first = dialog.getByRole('button', { name: 'Fechar tutorial' });
    const last = dialog.getByRole('button', { name: /Próximo|Concluir/ });
    await expect(first).toBeFocused();

    await page.keyboard.press('Shift+Tab');
    await expect(last).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(first).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(tutorialButton).toBeFocused();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  } finally {
    await closeElectron(app);
  }
});


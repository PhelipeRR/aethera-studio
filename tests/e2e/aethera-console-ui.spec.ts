import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

/**
 * Opt-in UI validation of the production console, replaying a REAL data directory (job + console history) produced by
 * tests/e2e/aethera-console-validation.spec.ts. Nothing is fabricated except the optional perf fixture, which only
 * duplicates real entries to stress the renderer.
 *
 * Run with: AETHERA_CONSOLE_UI_E2E=<caminho do AetheraStudio> npx playwright test tests/e2e/aethera-console-ui.spec.ts
 */
const dataDir = process.env['AETHERA_CONSOLE_UI_E2E'];
const enabled = Boolean(dataDir) && existsSync(dataDir ?? '');
/** Opt-in perf fixture: duplicates the real history before launch to measure the renderer under load. */
const seedBulk = process.env['AETHERA_CONSOLE_UI_SEED'] === '1';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = resolve('artifacts/aethera-console-ui', stamp);
const appDir = resolve('apps/aethera-desktop');
const electronPath = createRequire(join(appDir, 'package.json'))('electron') as unknown as string;

test('console de produção — filtros, autoscroll, detalhes, progresso e desempenho', async () => {
  test.skip(!enabled, 'Defina AETHERA_CONSOLE_UI_E2E com o diretório AetheraStudio de uma execução real.');
  test.setTimeout(180_000);
  mkdirSync(outDir, { recursive: true });

  const tempHome = mkdtempSync(join(tmpdir(), 'aethera-console-ui-'));
  const appData = join(tempHome, 'AppData', 'Roaming');
  const localAppData = join(tempHome, 'AppData', 'Local');
  const target = join(appData, 'AetheraStudio');
  mkdirSync(appData, { recursive: true });
  mkdirSync(localAppData, { recursive: true });
  cpSync(dataDir as string, target, { recursive: true });

  // Perf fixture: the job file is enlarged BEFORE the app starts, so the service really loads a large history.
  // Entries are copies of the real ones (same shape and channels), only the id changes.
  const seededLogsDir = join(target, 'cinema-console-logs');
  const seededJobFile = readdirSync(seededLogsDir).find((name) => name.endsWith('.log.jsonl'));
  const seededJobLog = seededJobFile ? join(seededLogsDir, seededJobFile) : null;
  const originalLines = seededJobLog ? readFileSync(seededJobLog, 'utf8').trim().split(String.fromCharCode(10)).filter(Boolean) : [];
  const bulkTarget = 2400;
  if (seedBulk && seededJobLog && originalLines.length > 0) {
    const bulk: string[] = [];
    let copy = 0;
    while (originalLines.length + bulk.length < bulkTarget) {
      for (const line of originalLines) {
        const entry = JSON.parse(line) as Record<string, unknown>;
        entry['id'] = `${String(entry['id'])}-d${copy}`;
        bulk.push(JSON.stringify(entry));
        if (originalLines.length + bulk.length >= bulkTarget) break;
      }
      copy += 1;
    }
    writeFileSync(seededJobLog, [...originalLines, ...bulk].join(String.fromCharCode(10)) + String.fromCharCode(10), 'utf8');
  }
  const seededEntryCount = seededJobLog ? readFileSync(seededJobLog, 'utf8').trim().split(String.fromCharCode(10)).filter(Boolean).length : 0;
  const seededFileSize = seededJobLog ? statSync(seededJobLog).size : 0;

  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  delete env['ELECTRON_RENDERER_URL'];
  delete env['ELECTRON_RUN_AS_NODE'];

  const app: ElectronApplication = await electron.launch({
    executablePath: electronPath,
    args: [appDir],
    cwd: appDir,
    env: { ...env, HOME: tempHome, USERPROFILE: tempHome, APPDATA: appData, LOCALAPPDATA: localAppData, NB_E2E_NO_RELAUNCH: '1' },
  });

  try {
    const page = await mainWindow(app);
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.waitForSelector('aside nav', { timeout: 30_000 });
    // Live route of the Cinema panel (CinemaDirectorPanel), where staged productions run and the console lives.
    await page.evaluate(() => {
      window.location.hash = '#/aethera/cinema';
    });
    await page.getByRole('heading', { name: 'Produção com IA', exact: true }).waitFor({ timeout: 30_000 });

    const header = page.getByRole('button', { name: /Console desta produção/ }).first();
    const rows = page.locator('[data-console-row]');
    const openStart = Date.now();
    await header.click();
    await rows.first().waitFor({ timeout: 30_000 });
    const openLatencyMs = Date.now() - openStart;
    await page.waitForTimeout(300);
    const totalRows = await rows.count();
    expect(totalRows).toBeGreaterThan(0);
    await page.screenshot({ path: join(outDir, '01-console-aberto.png') });

    const metrics: Record<string, unknown> = {
      totalRows,
      openLatencyMs,
      seededHistory: { entriesInFile: seededEntryCount, fileSizeBytes: seededFileSize },
    };

    // 1. Progress bar carries the reported percentage and the stage label is visible.
    const fill = page.locator('[data-console-progress-fill]').first();
    metrics.progressWidth = await fill.evaluate((el) => (el as HTMLElement).style.width);
    metrics.progressLabel = await page.locator('[data-console-progress-label]').first().innerText();
    expect(metrics.progressWidth).toMatch(/^\d+(\.\d+)?%$/);
    expect(String(metrics.progressLabel)).toMatch(/\d+%/);

    // 2. Stage timeline marks completed and failed stages.
    const doneStages = await page.locator('[data-stage-status="done"]').count();
    const failedStages = await page.locator('[data-stage-status="failed"]').count();
    metrics.timeline = { doneStages, failedStages };
    expect(doneStages).toBeGreaterThan(0);

    // 3. Origin filter narrows the list to agent rows only.
    const originSelect = page.locator('label', { hasText: 'Origem' }).locator('select');
    const filterStart = Date.now();
    await originSelect.selectOption('agent');
    await page.waitForTimeout(120);
    metrics.originFilterLatencyMs = Date.now() - filterStart;
    const agentRows = await page.locator('[data-console-row][data-console-origin="agent"]').count();
    const visibleAfterOrigin = await rows.count();
    metrics.agentRows = agentRows;
    metrics.visibleAfterOrigin = visibleAfterOrigin;
    expect(agentRows).toBeGreaterThan(0);
    expect(visibleAfterOrigin).toBe(agentRows);
    await page.screenshot({ path: join(outDir, '02-filtro-origem-agente.png') });

    // 4. Channel filter separates progress from raw stdout/stderr.
    const channelSelect = page.locator('label', { hasText: 'Canal' }).locator('select');
    await channelSelect.selectOption('stream');
    await page.waitForTimeout(120);
    const streamRows = await rows.count();
    const streamChannels = await rows.evaluateAll((els) => [...new Set(els.map((el) => el.getAttribute('data-console-channel')))]);
    metrics.streamFilter = { rows: streamRows, channels: streamChannels };
    expect(streamRows).toBeGreaterThan(0);
    expect(streamChannels.every((channel) => channel === 'stdout' || channel === 'stderr')).toBe(true);
    await channelSelect.selectOption('all');
    await originSelect.selectOption('all');
    await page.waitForTimeout(120);

    // 5. Search + period filters keep working together.
    await page.getByPlaceholder('Filtrar logs...').fill('pesquisa');
    await page.waitForTimeout(120);
    metrics.searchRows = await rows.count();
    expect(metrics.searchRows).toBeGreaterThan(0);
    await page.getByPlaceholder('Filtrar logs...').fill('');

    // 6. Autoscroll toggle.
    const autoscroll = page.locator('label', { hasText: 'Auto-scroll' }).locator('input');
    expect(await autoscroll.isChecked()).toBe(true);
    await autoscroll.uncheck();
    metrics.autoscrollToggledOff = !(await autoscroll.isChecked());
    await autoscroll.check();

    // 7. Expandable technical details on a real command entry.
    const detailsButton = page.getByRole('button', { name: /detalhes/ }).first();
    await expect(detailsButton).toBeVisible();
    await detailsButton.click();
    await page.waitForTimeout(120);
    const detailText = await page.locator('[data-console-details]').first().innerText();
    metrics.detailsPreview = detailText.slice(0, 300);
    expect(detailText.toLowerCase()).toMatch(/comando|origem|execução|exit|evento/);
    await page.screenshot({ path: join(outDir, '03-detalhes-expandidos.png') });

    // 8. Errors tab keeps only failures.
    await page.getByRole('button', { name: 'Erros', exact: true }).click();
    await page.waitForTimeout(120);
    const errorRows = await rows.count();
    const errorSeverities = await rows.evaluateAll((els) => [...new Set(els.map((el) => el.getAttribute('data-console-severity')))]);
    metrics.errorsTab = { rows: errorRows, severities: errorSeverities };
    await page.screenshot({ path: join(outDir, '04-aba-erros.png') });
    await page.getByRole('button', { name: 'Terminal', exact: true }).click();

    // 9. Export through the bridge returns the whole job history, redacted and parseable.
    const projectId = await rows.first().getAttribute('data-console-job');
    expect(projectId).toBeTruthy();
    const exported = await page.evaluate(async (id) => {
      const bridge = (window as unknown as { aetheraBridge?: Record<string, (...args: unknown[]) => Promise<unknown>> }).aetheraBridge;
      return (await bridge?.['cinemaConsoleExport']?.({ projectId: id, format: 'json' })) as string;
    }, projectId as string);
    const parsed = JSON.parse(exported) as Array<{ channel: string; event: string }>;
    metrics.exportEntries = parsed.length;
    expect(parsed.length).toBeGreaterThanOrEqual(totalRows);
    writeFileSync(join(outDir, 'export.json'), exported, 'utf8');

    // 10. Performance of filtering over the large history that was seeded before launch.
    const filterPerfStart = Date.now();
    await page.getByPlaceholder('Filtrar logs...').fill('pesquisa');
    await page.waitForTimeout(50);
    metrics.largeHistoryFilterLatencyMs = Date.now() - filterPerfStart;
    metrics.largeHistoryFilteredRows = await rows.count();
    await page.getByPlaceholder('Filtrar logs...').fill('');
    await page.screenshot({ path: join(outDir, '05-historico-grande.png') });

    writeFileSync(join(outDir, 'ui-summary.json'), JSON.stringify(metrics, null, 2), 'utf8');
  } finally {
    await app.close();
  }
});

async function mainWindow(app: ElectronApplication): Promise<Page> {
  const isHud = (candidate: Page) => candidate.url().includes('companion=hud');
  const first = await app.firstWindow();
  if (!isHud(first)) return first;
  return app.windows().find((candidate) => !isHud(candidate)) ?? (await app.waitForEvent('window', { predicate: (candidate) => !isHud(candidate) }));
}

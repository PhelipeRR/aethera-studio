import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

/**
 * Opt-in validation: THREE real productions running at the same time in the Electron app, each with its own console.
 * Run with: AETHERA_CONSOLE_JOBS_E2E=1 npx playwright test tests/e2e/aethera-console-jobs.spec.ts
 *
 * Real pipeline, real agent CLIs (whatever quota allows) and real FFmpeg render. One production is cancelled mid-run
 * and resumed (attempt 2) while the others keep running; the user also leaves the screen and comes back. Evidence
 * (screenshots, per-job console exports, summary.json) goes to artifacts/aethera-console-jobs/<timestamp>/.
 */
const enabled = process.env['AETHERA_CONSOLE_JOBS_E2E'] === '1';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = resolve('artifacts/aethera-console-jobs', stamp);
const appDir = resolve('apps/aethera-desktop');
const electronPath = createRequire(join(appDir, 'package.json'))('electron') as unknown as string;

interface ConsoleEntry {
  id: string;
  timestamp: string;
  projectId: string;
  jobId?: string;
  attempt?: number;
  seq?: number;
  stage: string;
  origin: string;
  channel: string;
  event: string;
  severity: string;
  source: string;
  message: string;
  pct?: number;
}

interface JobSummary {
  jobId: string;
  projectId: string;
  kind: string;
  title?: string;
  attempt: number;
  status: string;
  live: boolean;
  pct?: number;
  stage?: string;
  entries: number;
  errors: number;
  retries: number;
  agents: string[];
}

interface Production {
  key: 'A' | 'B' | 'C';
  jobId: string;
  projectId: string;
  prompt: string;
}

type Bridge = Record<string, (...args: unknown[]) => Promise<unknown>>;

const TERMINAL = new Set(['editor', 'error', 'cancelled', 'paused_pending_research', 'paused_pending_script']);

test.describe.configure({ mode: 'serial' });

test('três produções simultâneas — três consoles independentes + console geral', async () => {
  test.skip(!enabled, 'Validação real: defina AETHERA_CONSOLE_JOBS_E2E=1 para executar.');
  test.setTimeout(1_500_000);
  mkdirSync(outDir, { recursive: true });

  const tempHome = mkdtempSync(join(tmpdir(), 'aethera-console-jobs-'));
  const appData = join(tempHome, 'AppData', 'Roaming');
  const localAppData = join(tempHome, 'AppData', 'Local');
  mkdirSync(appData, { recursive: true });
  mkdirSync(localAppData, { recursive: true });
  const seedsDir = join(tempHome, 'seeds');
  mkdirSync(seedsDir, { recursive: true });
  const seeds = [0, 1, 2].map((index) => {
    const file = join(seedsDir, `seed_${index + 1}.mp4`);
    execFileSync(
      'C:/ffmpeg/bin/ffmpeg.exe',
      ['-y', '-f', 'lavfi', '-i', `testsrc=size=960x540:rate=30:duration=4`, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file],
      { stdio: 'ignore' },
    );
    return file;
  });

  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));
  delete env['ELECTRON_RENDERER_URL'];
  delete env['ELECTRON_RUN_AS_NODE'];
  // App data is always isolated (APPDATA/LOCALAPPDATA). With AETHERA_CONSOLE_JOBS_REAL_HOME=1 the agent CLIs keep the
  // user's HOME, so they use their normal sign-in instead of an API key inherited from the test shell.
  const realHome = process.env['AETHERA_CONSOLE_JOBS_REAL_HOME'] === '1';
  if (realHome) delete env['ANTHROPIC_API_KEY'];
  const app: ElectronApplication = await electron.launch({
    executablePath: electronPath,
    args: [appDir],
    cwd: appDir,
    env: {
      ...env,
      ...(realHome ? {} : { HOME: tempHome, USERPROFILE: tempHome }),
      APPDATA: appData,
      LOCALAPPDATA: localAppData,
      NB_E2E_NO_RELAUNCH: '1',
      GIT_TERMINAL_PROMPT: '0',
    },
  });

  const run = Date.now().toString(36);
  const productions: Production[] = [
    { key: 'A', jobId: `job_e2e_${run}_A`, projectId: `jobs-e2e-${run}-a`, prompt: 'Os 3 chefes mais difíceis de Elden Ring e por que eles são tão punitivos' },
    { key: 'B', jobId: `job_e2e_${run}_B`, projectId: `jobs-e2e-${run}-b`, prompt: 'A história do Mestre Chefe em Halo: das origens do Projeto SPARTAN-II até Halo Infinite' },
    { key: 'C', jobId: `job_e2e_${run}_C`, projectId: `jobs-e2e-${run}-c`, prompt: 'Por que Hollow Knight é considerado um dos melhores metroidvanias já feitos' },
  ];
  const [A, , C] = productions as [Production, Production, Production];

  try {
    const page = await mainWindow(app);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.waitForSelector('aside nav', { timeout: 30_000 });
    await goCinema(page);

    // Live lines as the renderer receives them, to prove there is one stream but three isolated consoles.
    await page.evaluate(() => {
      const w = window as unknown as { __live: Array<{ jobId?: string; projectId: string }>; aetheraBridge?: { onCinemaConsoleLog?: (l: (e: unknown) => void) => () => void } };
      w.__live = [];
      w.aetheraBridge?.onCinemaConsoleLog?.((entry) => w.__live.push(entry as { jobId?: string; projectId: string }));
    });

    // 1. Start three real productions at once, each with its own jobId.
    await page.evaluate(
      ({ list, seedFiles }) => {
        const bridge = (window as unknown as { aetheraBridge?: Record<string, (...a: unknown[]) => Promise<unknown>> }).aetheraBridge;
        for (const p of list) {
          void bridge?.['cinemaStartStagedProduction']?.({
            projectId: p.projectId,
            jobId: p.jobId,
            prompt: p.prompt,
            targetDurationSec: 10,
            humorIntensity: 20,
            renderProfile: 'draft_540p',
            useNvenc: false,
            seedMediaFiles: seedFiles,
          }).catch(() => undefined);
        }
      },
      { list: productions, seedFiles: seeds },
    );
    for (const p of productions) {
      await page.locator(`[data-production-job="${p.jobId}"]`).waitFor({ timeout: 60_000 });
    }

    // 2. Open the three individual consoles while the productions are running.
    for (const p of productions) await jobConsoleHeader(page, p.jobId).click();
    await page.waitForTimeout(8_000);
    await page.locator(`[data-production-job="${A.jobId}"]`).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(outDir, '01-tres-consoles-ao-vivo.png'), fullPage: true });
    const liveCheck = await consoleRowsByJob(page, productions);
    for (const p of productions) {
      expect(liveCheck[p.jobId]?.rows ?? -1, `console de ${p.key} vazio durante a execução`).toBeGreaterThan(0);
      expect(liveCheck[p.jobId]?.foreign ?? -1, `linhas de outro job no console de ${p.key}`).toBe(0);
    }

    // 3. Cancel C while A and B keep running, then resume it (attempt 2).
    await waitFor(async () => ((await jobState(page, C.projectId))?.progressPct ?? 0) >= 18, 240_000);
    const beforeCancel = await Promise.all(productions.map((p) => jobState(page, p.projectId)));
    await bridgeCall(page, 'cinemaCancelProduction', C.projectId);
    await page.waitForTimeout(4_000);
    const afterCancel = await Promise.all(productions.map((p) => jobState(page, p.projectId)));
    expect(afterCancel[2]?.state).toBe('cancelled');
    for (const index of [0, 1]) {
      expect(afterCancel[index]?.state, `cancelar C afetou ${productions[index]?.key}`).not.toBe('cancelled');
    }
    await page.screenshot({ path: join(outDir, '02-c-cancelada-a-b-seguem.png'), fullPage: true });
    void bridgeCall(page, 'cinemaResumeProduction', C.projectId).catch(() => undefined);

    // 4. Leave the screen and come back: executions continue, consoles reconnect from history.
    const pctBeforeLeave = await Promise.all(productions.map((p) => jobState(page, p.projectId)));
    await page.evaluate(() => {
      window.location.hash = '#/aethera';
    });
    await page.waitForTimeout(12_000);
    await goCinema(page);
    for (const p of productions) {
      await page.locator(`[data-production-job="${p.jobId}"]`).waitFor({ timeout: 60_000 });
      await jobConsoleHeader(page, p.jobId).click();
    }
    await page.waitForTimeout(2_000);
    const pctAfterReturn = await Promise.all(productions.map((p) => jobState(page, p.projectId)));
    const reconnect = await consoleRowsByJob(page, productions);
    for (const p of productions) {
      expect(reconnect[p.jobId]?.rows ?? -1, `console de ${p.key} não recarregou o histórico`).toBeGreaterThan(0);
      expect(reconnect[p.jobId]?.foreign ?? -1).toBe(0);
    }

    // 5. Run to the end (or to a real pause), resolving media pauses like a user would.
    const resolved = new Set<string>();
    await waitFor(async () => {
      const states = await Promise.all(productions.map((p) => jobState(page, p.projectId)));
      for (let i = 0; i < productions.length; i += 1) {
        const p = productions[i];
        if (!p) continue;
        const s = states[i];
        if (s?.state === 'paused_pending_media' && !resolved.has(p.jobId)) {
          resolved.add(p.jobId);
          const pending = (s.pendingMedia ?? []).map((slot) => ({ slotIndex: slot.slotIndex, allowProcedural: true }));
          if (pending.length) void bridgeCall(page, 'cinemaResolvePendingMedia', { projectId: p.projectId, resolutions: pending }).catch(() => undefined);
        }
      }
      return states.every((s) => s && (TERMINAL.has(s.state) || (s.state === 'paused_pending_media' && resolved.size >= 3)));
    }, 1_200_000, 3_000);
    await page.waitForTimeout(2_000);

    // 6. Evidence per job, read from the app's own IPC.
    const jobs = (await bridgeCall(page, 'cinemaConsoleJobs')) as JobSummary[];
    const perJob: Record<string, unknown> = {};
    for (const p of productions) {
      const list = (await bridgeCall(page, 'cinemaConsoleList', { jobId: p.jobId, limit: 5000 })) as { entries: ConsoleEntry[]; total: number };
      const foreign = list.entries.filter((e) => e.jobId !== p.jobId || e.projectId !== p.projectId);
      const exported = (await bridgeCall(page, 'cinemaConsoleExport', { jobId: p.jobId, format: 'json' })) as string;
      writeFileSync(join(outDir, `console-${p.key}.json`), exported, 'utf8');
      const summary = jobs.find((j) => j.jobId === p.jobId);
      const seqs = list.entries.map((e) => e.seq ?? 0);
      perJob[p.key] = {
        jobId: p.jobId,
        projectId: p.projectId,
        finalState: (await jobState(page, p.projectId))?.state,
        consoleStatus: summary?.status,
        attempt: summary?.attempt,
        entries: list.total,
        foreignEntries: foreign.length,
        orderedBySeq: seqs.every((value, i) => i === 0 || value > (seqs[i - 1] ?? 0)),
        agents: summary?.agents,
        stagesStarted: list.entries.filter((e) => e.event === 'stage_started' || e.event === 'stage_retry').map((e) => `${e.stage}#${e.attempt ?? 1}`),
        jobEvents: list.entries.filter((e) => e.event.startsWith('job_')).map((e) => `${e.event}#${e.attempt ?? 1}@${e.pct ?? '-'}%`),
        lastPct: [...list.entries].reverse().find((e) => e.pct !== undefined)?.pct,
        stdoutLines: list.entries.filter((e) => e.channel === 'stdout').length,
        stderrLines: list.entries.filter((e) => e.channel === 'stderr').length,
        commands: list.entries.filter((e) => e.channel === 'command').length,
      };
      expect(list.total).toBeGreaterThan(0);
      expect(foreign, `entradas estranhas no console de ${p.key}`).toHaveLength(0);
    }
    const cEntries = ((await bridgeCall(page, 'cinemaConsoleList', { jobId: C.jobId, limit: 5000 })) as { entries: ConsoleEntry[] }).entries;
    expect(cEntries.some((e) => e.event === 'job_cancelled' && (e.attempt ?? 1) === 1)).toBe(true);
    expect(cEntries.some((e) => e.event === 'job_started' && e.attempt === 2)).toBe(true);
    const live = (await page.evaluate(() => (window as unknown as { __live: Array<{ jobId?: string }> }).__live)) as Array<{ jobId?: string }>;
    const liveByJob = Object.fromEntries(productions.map((p) => [p.key, live.filter((e) => e.jobId === p.jobId).length]));

    // 7. Final screenshots: each production's own console, then the general console.
    for (const p of productions) {
      const card = page.locator(`[data-production-job="${p.jobId}"]`);
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({ path: join(outDir, `03-console-${p.key}.png`) });
    }
    const uiFinal = await consoleRowsByJob(page, productions);

    const generalHeader = page.locator('[data-console-panel="general"] > button').first();
    await generalHeader.scrollIntoViewIfNeeded();
    await generalHeader.click();
    await page.locator('[data-console-panel="general"] [data-console-job-chip]').first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(800);
    const general = page.locator('[data-console-panel="general"]');
    const chips = await general.locator('[data-console-job-chip]').evaluateAll((els) =>
      els.map((el) => ({ jobId: el.getAttribute('data-console-job-chip'), status: el.getAttribute('data-console-job-status') })),
    );
    const generalJobsInRows = await general.locator('[data-console-row]').evaluateAll((els) => [...new Set(els.map((el) => el.getAttribute('data-console-job')))]);
    await general.screenshot({ path: join(outDir, '04-console-geral.png') });
    for (const p of productions) expect(chips.map((c) => c.jobId)).toContain(p.jobId);
    // The shared window shows the newest lines of all jobs; every line in it belongs to a known production.
    expect(generalJobsInRows.length).toBeGreaterThan(0);
    expect(generalJobsInRows.every((id) => productions.some((p) => p.jobId === id))).toBe(true);

    // Selecting a production in the general console shows that production only (its history is loaded on demand).
    const filteredByJob: Record<string, { rows: number; jobs: Array<string | null> }> = {};
    for (const p of productions) {
      await general.locator(`[data-console-job-chip="${p.jobId}"]`).click();
      await page.waitForTimeout(800);
      const jobsInRows = await general.locator('[data-console-row]').evaluateAll((els) => els.map((el) => el.getAttribute('data-console-job')));
      filteredByJob[p.key] = { rows: jobsInRows.length, jobs: [...new Set(jobsInRows)] };
      if (p.key === 'B') await general.screenshot({ path: join(outDir, '05-console-geral-filtro-B.png') });
      expect(jobsInRows.length, `console geral sem linhas para ${p.key}`).toBeGreaterThan(0);
      expect([...new Set(jobsInRows)]).toEqual([p.jobId]);
      await general.locator(`[data-console-job-chip="${p.jobId}"]`).click(); // back to all jobs
    }
    const filteredJobs = filteredByJob;

    writeFileSync(
      join(outDir, 'summary.json'),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          productions: perJob,
          liveLinesByJob: liveByJob,
          uiDuringRun: liveCheck,
          uiAfterReturn: reconnect,
          uiFinal,
          cancel: { before: beforeCancel.map(slim), after: afterCancel.map(slim) },
          navigation: { beforeLeave: pctBeforeLeave.map(slim), afterReturn: pctAfterReturn.map(slim) },
          generalConsole: { chips, jobsInRows: generalJobsInRows, filteredByJob: filteredJobs },
          consoleJobs: jobs.filter((j) => productions.some((p) => p.jobId === j.jobId)),
        },
        null,
        2,
      ),
      'utf8',
    );
  } finally {
    await app.close();
  }
});

function slim(job: JobStateView | null): Pick<JobStateView, 'state' | 'progressPct'> | null {
  return job ? { state: job.state, progressPct: job.progressPct } : null;
}

interface JobStateView {
  state: string;
  progressPct: number;
  jobId?: string;
  attempt?: number;
  pendingMedia?: Array<{ slotIndex: number }>;
}

async function goCinema(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = '#/aethera/cinema';
  });
  await page.getByRole('heading', { name: 'Produção com IA', exact: true }).waitFor({ timeout: 30_000 });
}

function jobConsoleHeader(page: Page, jobId: string) {
  return page.locator(`[data-production-job="${jobId}"] [data-console-panel="job"] > button`);
}

/** Rows rendered inside each production card's console, and how many of them belong to another job. */
async function consoleRowsByJob(page: Page, productions: Production[]): Promise<Record<string, { rows: number; foreign: number }>> {
  const out: Record<string, { rows: number; foreign: number }> = {};
  for (const p of productions) {
    const jobs = await page
      .locator(`[data-production-job="${p.jobId}"] [data-console-row]`)
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-console-job')));
    out[p.jobId] = { rows: jobs.length, foreign: jobs.filter((id) => id !== p.jobId).length };
  }
  return out;
}

async function bridgeCall(page: Page, method: string, arg?: unknown): Promise<unknown> {
  return page.evaluate(
    async ({ m, a }) => {
      const bridge = (window as unknown as { aetheraBridge?: Bridge }).aetheraBridge;
      return a === undefined ? bridge?.[m]?.() : bridge?.[m]?.(a);
    },
    { m: method, a: arg },
  );
}

async function jobState(page: Page, projectId: string): Promise<JobStateView | null> {
  return (await bridgeCall(page, 'cinemaGetProductionState', projectId)) as JobStateView | null;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number, intervalMs = 1_500): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function mainWindow(app: ElectronApplication): Promise<Page> {
  const isHud = (candidate: Page) => candidate.url().includes('companion=hud');
  const first = await app.firstWindow();
  if (!isHud(first)) return first;
  return app.windows().find((candidate) => !isHud(candidate)) ?? (await app.waitForEvent('window', { predicate: (candidate) => !isHud(candidate) }));
}

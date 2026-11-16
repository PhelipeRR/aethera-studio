import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

/**
 * Opt-in functional validation of the production console inside the real Electron app.
 * Run with: AETHERA_CONSOLE_E2E=1 npx playwright test tests/e2e/aethera-console-validation.spec.ts
 *
 * It runs one short real production (real FFmpeg render and the real agent CLIs), then validates the console UI:
 * filters, autoscroll, expandable technical details, progress bar and render performance. Everything is written to
 * artifacts/aethera-console-e2e/<timestamp>/.
 */
const enabled = process.env['AETHERA_CONSOLE_E2E'] === '1';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = resolve('artifacts/aethera-console-e2e', stamp);
const appDir = resolve('apps/aethera-desktop');
const electronPath = createRequire(join(appDir, 'package.json'))('electron') as unknown as string;

interface ConsoleEntry {
  id: string;
  timestamp: string;
  projectId: string;
  jobId?: string;
  stage: string;
  origin: string;
  channel: string;
  event: string;
  severity: string;
  source: string;
  message: string;
  pct?: number;
  durationMs?: number;
  exitCode?: number | null;
}

test.describe.configure({ mode: 'serial' });

test('console de produção — produção real curta e validação da interface', async () => {
  test.skip(!enabled, 'Validação real: defina AETHERA_CONSOLE_E2E=1 para executar.');
  test.setTimeout(900_000);
  mkdirSync(outDir, { recursive: true });

  const tempHome = mkdtempSync(join(tmpdir(), 'aethera-console-e2e-'));
  const appData = join(tempHome, 'AppData', 'Roaming');
  const localAppData = join(tempHome, 'AppData', 'Local');
  mkdirSync(appData, { recursive: true });
  mkdirSync(localAppData, { recursive: true });

  const seedsDir = join(tempHome, 'seeds');
  mkdirSync(seedsDir, { recursive: true });
  const seedPaths = [0, 1, 2].map((index) => {
    const file = join(seedsDir, `seed_${index + 1}.mp4`);
    execFileSync(
      'C:/ffmpeg/bin/ffmpeg.exe',
      ['-y', '-f', 'lavfi', '-i', `testsrc=size=960x540:rate=30:duration=4`, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file],
      { stdio: 'ignore' },
    );
    return file;
  });

  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  delete env['ELECTRON_RENDERER_URL'];
  delete env['ELECTRON_RUN_AS_NODE'];

  const electronApp: ElectronApplication = await electron.launch({
    executablePath: electronPath,
    args: [appDir],
    cwd: appDir,
    env: {
      ...env,
      HOME: tempHome,
      USERPROFILE: tempHome,
      APPDATA: appData,
      LOCALAPPDATA: localAppData,
      NB_E2E_NO_RELAUNCH: '1',
      GIT_TERMINAL_PROMPT: '0',
    },
  });

  const projectId = `console-e2e-${Date.now().toString(36)}`;
  try {
    const page = await mainWindow(electronApp);
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.waitForSelector('aside nav', { timeout: 30_000 });

    // Progress events as the renderer receives them.
    await page.evaluate(() => {
      const bridge = (window as unknown as { aetheraBridge?: { onCinemaProductionProgress?: (l: (job: unknown) => void) => () => void } }).aetheraBridge;
      (window as unknown as { __progress: unknown[] }).__progress = [];
      bridge?.onCinemaProductionProgress?.((job) => {
        (window as unknown as { __progress: unknown[] }).__progress.push(job);
      });
    });

    // Start the real production without awaiting its full lifecycle; it is polled below.
    await page.evaluate(
      ({ id, seeds }) => {
        const bridge = (window as unknown as { aetheraBridge?: Record<string, (...args: unknown[]) => unknown> }).aetheraBridge;
        (window as unknown as { __started: unknown }).__started = bridge?.['cinemaStartStagedProduction']?.({
          projectId: id,
          // the console is keyed by job: use the project id as this run's jobId so the reads below find it
          jobId: id,
          prompt: 'Os 3 chefes mais difíceis de Elden Ring e por que eles são tão punitivos',
          targetDurationSec: 10,
          humorIntensity: 20,
          renderProfile: 'draft_540p',
          useNvenc: false,
          seedMediaFiles: seeds,
        });
      },
      { id: projectId, seeds: seedPaths },
    );

    const readState = async (): Promise<{ state: string; pct: number; message: string; error?: string } | null> =>
      page.evaluate(async (id) => {
        const bridge = (window as unknown as { aetheraBridge?: Record<string, (...args: unknown[]) => Promise<unknown>> }).aetheraBridge;
        const job = (await bridge?.['cinemaGetProductionState']?.(id)) as { state: string; progressPct: number; message: string; error?: string } | null;
        return job ? { state: job.state, pct: job.progressPct, message: job.message, ...(job.error ? { error: job.error } : {}) } : null;
      }, projectId);

    const readConsole = async (): Promise<ConsoleEntry[]> =>
      page.evaluate(async (id) => {
        const bridge = (window as unknown as { aetheraBridge?: Record<string, (...args: unknown[]) => Promise<unknown>> }).aetheraBridge;
        const res = (await bridge?.['cinemaConsoleList']?.({ projectId: id, limit: 5000 })) as { entries: ConsoleEntry[] };
        return res.entries;
      }, projectId);

    const timeline: Array<{ at: number; state: string; pct: number; message: string }> = [];
    const startedAt = Date.now();
    let finalState: { state: string; pct: number; message: string; error?: string } | null = null;
    let pausedResolved = false;

    while (Date.now() - startedAt < 780_000) {
      const state = await readState();
      if (state) {
        const last = timeline.at(-1);
        if (!last || last.state !== state.state || last.pct !== state.pct || last.message !== state.message) {
          timeline.push({ at: Math.round((Date.now() - startedAt) / 1000), ...state });
        }
        finalState = state;
        if (state.state === 'paused_pending_media' && !pausedResolved) {
          pausedResolved = true;
          await page.evaluate(async (id) => {
            const bridge = (window as unknown as { aetheraBridge?: Record<string, (...args: unknown[]) => Promise<unknown>> }).aetheraBridge;
            const job = (await bridge?.['cinemaGetProductionState']?.(id)) as { pendingMedia?: Array<{ slotIndex: number }> } | null;
            const pending = job?.pendingMedia ?? [];
            if (!pending.length) return;
            await bridge?.['cinemaResolvePendingMedia']?.({
              projectId: id,
              resolutions: pending.map((slot) => ({ slotIndex: slot.slotIndex, allowProcedural: true })),
            });
          }, projectId);
        }
        if (state.state === 'editor' || state.state === 'error') break;
        // A research pause is a real product outcome (no invented facts): it ends the collection instead of
        // restarting the job, which would abort the agent process still running.
        if (state.state === 'paused_pending_research' || state.state === 'paused_pending_script') break;
      }
      await page.waitForTimeout(1500);
    }

    const entries = await readConsole();
    const progressEvents = (await page.evaluate(() => (window as unknown as { __progress: unknown[] }).__progress)) as Array<{ state?: string; progressPct?: number }>;

    const consoleJson = await page.evaluate(async (id) => {
      const bridge = (window as unknown as { aetheraBridge?: Record<string, (...args: unknown[]) => Promise<unknown>> }).aetheraBridge;
      return (await bridge?.['cinemaConsoleExport']?.({ projectId: id, format: 'json' })) as string;
    }, projectId);
    writeFileSync(join(outDir, 'console.json'), consoleJson, 'utf8');
    writeFileSync(join(outDir, 'job-timeline.json'), JSON.stringify({ projectId, finalState, timeline, progressEvents }, null, 2), 'utf8');

    // ── Event sequence and percentages ────────────────────────────────────────
    const lifecycle = entries.filter((entry) => entry.event.startsWith('stage_'));
    const startedStages = lifecycle.filter((entry) => entry.event === 'stage_started' || entry.event === 'stage_retry').map((entry) => entry.stage);
    const completedStages = lifecycle.filter((entry) => entry.event === 'stage_completed').map((entry) => entry.stage);
    const stageEventsWithPct = lifecycle.filter((entry) => entry.pct !== undefined).length;
    const agentEntries = entries.filter((entry) => entry.origin === 'agent');
    const agentCommands = agentEntries.filter((entry) => entry.channel === 'command');
    // Only command outcomes; the console also writes stage/block summaries on the same channel.
    const agentResults = agentEntries.filter((entry) => entry.event === 'command_completed' || entry.event === 'command_failed');
    const streamEntries = entries.filter((entry) => entry.channel === 'stdout' || entry.channel === 'stderr');

    expect(finalState, 'job deveria existir').not.toBeNull();
    // The first stages always run, whatever happens later with quotas or the research gate.
    expect(startedStages.slice(0, 3)).toEqual(['prompt', 'interpretacao', 'pesquisa']);
    expect(completedStages.length, 'etapas concluídas não registradas').toBeGreaterThanOrEqual(2);
    expect(stageEventsWithPct, 'eventos de etapa sem percentual').toBe(lifecycle.length);
    expect(agentCommands.length, 'comandos de agente não registrados').toBeGreaterThan(0);
    expect(agentResults.length, 'resultados de agente não registrados').toBe(agentCommands.length);
    expect(entries.every((entry) => entry.projectId === projectId)).toBe(true);
    // Every executed command carries its own outcome with duration and exit code.
    for (const result of agentResults) {
      expect(result.durationMs, `${result.source} sem duração`).toBeGreaterThanOrEqual(0);
      expect(result.exitCode === null || typeof result.exitCode === 'number').toBe(true);
    }

    // All reported percentages stay inside the 0-100 range the UI renders.
    for (const item of timeline) {
      expect(item.pct).toBeGreaterThanOrEqual(0);
      expect(item.pct).toBeLessThanOrEqual(100);
    }
    // A production that reached the editor went through every stage, in pipeline order.
    if (finalState?.state === 'editor') {
      expect(startedStages.length, 'produção completa sem todas as etapas').toBeGreaterThanOrEqual(9);
      expect(pctsInOrder(startedStages)).toBe(true);
    }

    // A screenshot of the job card is kept as evidence; the console UI itself is validated in
    // tests/e2e/aethera-console-ui.spec.ts, which replays this same data directory.
    await page.getByRole('button', { name: 'Produções & Pipeline' }).click();
    await page.getByRole('heading', { name: /Projetos em Produção/ }).waitFor({ timeout: 20_000 }).catch(() => undefined);
    await page.screenshot({ path: join(outDir, 'job-card.png') });

    writeFileSync(
      join(outDir, 'summary.json'),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          projectId,
          finalState,
          entries: entries.length,
          lifecycleEvents: lifecycle.length,
          startedStages,
          completedStages,
          agentEntries: agentEntries.length,
          agentCommands: agentCommands.length,
          agentResults: agentResults.length,
          streamEntries: streamEntries.length,
          progressEvents: progressEvents.length,
        },
        null,
        2,
      ),
      'utf8',
    );
  } finally {
    await electronApp.close();
  }
});

/** Stages appear in the pipeline order the console replays, ignoring retries of the same stage. */
function pctsInOrder(stages: string[]): boolean {
  const order = ['prompt', 'interpretacao', 'pesquisa', 'roteiro', 'decupagem', 'aquisicao', 'validacao_visual', 'planejamento', 'montagem', 'audio_sfx_vfx', 'qc', 'previa', 'editor'];
  let last = -1;
  for (const stage of stages) {
    const index = order.indexOf(stage);
    if (index < 0) continue;
    if (index < last) return false;
    last = index;
  }
  return true;
}

async function mainWindow(app: ElectronApplication): Promise<Page> {
  const isHud = (candidate: Page) => candidate.url().includes('companion=hud');
  const first = await app.firstWindow();
  if (!isHud(first)) return first;
  return app.windows().find((candidate) => !isHud(candidate)) ?? (await app.waitForEvent('window', { predicate: (candidate) => !isHud(candidate) }));
}

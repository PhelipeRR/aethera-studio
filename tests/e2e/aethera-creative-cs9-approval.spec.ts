import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { FAKE_AGENTS, mainWindowOf } from './app';

/**
 * CS-9 E2E (built Aethera app): technical approval, semantic fidelity and human aesthetic approval are shown and
 * stored as independent states. A human approval does not hide the technical verdict and does not make the piece
 * release-ready without semantic-fidelity evidence.
 */
test('Aethera Creative Studio — independent technical / semantic / human-aesthetic approval states', async () => {
  test.setTimeout(150_000);
  const appDir = resolve('apps/aethera-desktop');
  const tempHome = mkdtempSync(join(tmpdir(), 'aethera-cs9-e2e-'));
  const appData = join(tempHome, 'AppData', 'Roaming');
  const localAppData = join(tempHome, 'AppData', 'Local');
  mkdirSync(appData, { recursive: true });
  mkdirSync(localAppData, { recursive: true });

  const electronPath = createRequire(join(appDir, 'package.json'))('electron') as unknown as string;
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));
  delete env['ELECTRON_RENDERER_URL'];
  delete env['ELECTRON_RUN_AS_NODE'];

  const electronApp = await electron.launch({
    executablePath: electronPath,
    args: [appDir],
    cwd: appDir,
    env: {
      ...env,
      HOME: tempHome,
      USERPROFILE: tempHome,
      APPDATA: appData,
      LOCALAPPDATA: localAppData,
      NB_E2E_FAKE_AGENTS: JSON.stringify(FAKE_AGENTS),
      NB_E2E_NO_RELAUNCH: '1',
    },
  });

  try {
    const win = await mainWindowOf(electronApp);
    await win.setViewportSize({ width: 1440, height: 900 });
    await win.waitForSelector('aside nav', { timeout: 20_000 });

    // The Creative Studio panel is not mounted in the shipped renderer routes (main.tsx), so the real app is
    // exercised through the preload bridge it exposes (window.aetheraBridge → ipcMain creative:*).
    const result = await win.evaluate(async () => {
      type Status = {
        states: {
          technical: { status: string; criticalCodes: string[] };
          semanticFidelity: { status: string };
          humanAesthetic: { status: string; reviewer?: string };
        };
        readiness: { ready: boolean; blockers: string[] };
      };
      const bridge = (window as unknown as {
        aetheraBridge: {
          creativeCreateFromPrompt: (i: Record<string, unknown>) => Promise<{ document: { id: string }; audit: { passed: boolean } }>;
          creativeApprovalStatus: (id: string) => Promise<Status>;
          creativeEvaluateTechnical: (id: string) => Promise<Status>;
          creativeAestheticDecision: (i: { projectId: string; decision: 'approved' | 'rejected'; reviewer: string }) => Promise<{
            document: { id: string; approvedBy?: string };
            readiness: Status['readiness'];
          }>;
        };
      }).aetheraBridge;
      const created = await bridge.creativeCreateFromPrompt({
        artType: 'thumbnail',
        title: 'Aprovação CS-9 E2E',
        headline: 'SINAL PERDIDO',
        prompt: 'Thumbnail documental sobre um radiotelescópio captando um sinal',
        useAiGeneration: false,
      });
      const id = created.document.id;
      const initial = await bridge.creativeApprovalStatus(id);
      const technical = await bridge.creativeEvaluateTechnical(id);
      const approved = await bridge.creativeAestheticDecision({ projectId: id, decision: 'approved', reviewer: 'Revisor E2E' });
      const afterApproval = await bridge.creativeApprovalStatus(id);
      const rejected = await bridge.creativeAestheticDecision({ projectId: id, decision: 'rejected', reviewer: 'Revisor E2E' });
      const afterRejection = await bridge.creativeApprovalStatus(id);
      return { auditPassed: created.audit.passed, initial, technical, approved, afterApproval, rejected, afterRejection };
    });

    expect(result.initial.states.technical.status).toBe('not_evaluated');
    expect(result.initial.states.humanAesthetic.status).toBe('pending');
    expect(result.technical.states.technical.status).toBe(result.auditPassed ? 'passed' : 'failed');
    expect(result.technical.states.humanAesthetic.status).toBe('pending');

    // Human approval recorded regardless of the technical verdict, which stays visible and unchanged.
    expect(result.afterApproval.states.humanAesthetic).toMatchObject({ status: 'approved', reviewer: 'Revisor E2E' });
    expect(result.afterApproval.states.technical.status).toBe(result.technical.states.technical.status);
    expect(result.afterApproval.states.semanticFidelity.status).toBe('not_evaluated');
    expect(result.approved.document.approvedBy).toBe('Revisor E2E');
    expect(result.afterApproval.readiness.ready).toBe(false);
    expect(result.afterApproval.readiness.blockers.join(' ')).toContain('Fidelidade semântica');

    expect(result.afterRejection.states.humanAesthetic.status).toBe('rejected');
    expect(result.rejected.document.approvedBy).toBeUndefined();
  } finally {
    await electronApp.close();
    rmSync(tempHome, { recursive: true, force: true });
  }
});

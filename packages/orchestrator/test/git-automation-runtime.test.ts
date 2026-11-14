import { describe, expect, it } from 'vitest';
import { createGitAutomationRuntime } from '../src/git-automation-runtime.js';
describe('git automation runtime', () => {
  it('does not overlap polls and deduplicates commit events', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const dispatched: string[] = [];
    const runtime = createGitAutomationRuntime({ read: async () => { await gate; return [{ ref: 'main', hash: 'abc', paths: ['src/a.ts'] }]; }, dispatch: async (event) => { dispatched.push(event.commitHash ?? ''); } });
    const first = runtime.poll({ automationId: 'a', ref: 'main', pathGlobs: ['src/**/*.ts'] });
    await runtime.poll({ automationId: 'a', ref: 'main', pathGlobs: ['src/**/*.ts'] });
    expect(runtime.isPolling()).toBe(true);
    release(); await first; await runtime.poll({ automationId: 'a', ref: 'main', pathGlobs: ['src/**/*.ts'] });
    expect(dispatched).toEqual(['abc']);
  });
});

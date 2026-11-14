import { describe, expect, it } from 'vitest';
import { guardMainWindow, recoveryPage, type GuardedWindowLike } from '../src/main/startup-guard.js';

type Listener = (...args: never[]) => void;

function fakeWindow() {
  const listeners = new Map<string, Listener>();
  const state = { visible: false, destroyed: false, loaded: [] as string[], shows: 0 };
  const window: GuardedWindowLike = {
    isDestroyed: () => state.destroyed,
    isVisible: () => state.visible,
    show: () => { state.visible = true; state.shows += 1; },
    loadURL: async (url) => { state.loaded.push(url); },
    webContents: { on: (event: string, listener: Listener) => { listeners.set(event, listener); } } as GuardedWindowLike['webContents'],
  };
  const emit = (event: string, ...args: unknown[]) => (listeners.get(event) as ((...values: unknown[]) => void) | undefined)?.(...args);
  return { window, state, emit };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('main window startup guard', () => {
  it('replaces a failed main-frame load with the recovery page, shows it and reloads on retry', async () => {
    const { window, state, emit } = fakeWindow();
    let reloads = 0;
    const timers: Array<() => void> = [];
    guardMainWindow(window, { dataDir: 'C:\\dados', log: () => undefined, askRetry: async () => true, reload: () => { reloads += 1; }, setTimer: (fn) => timers.push(fn) });
    emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'file:///app/index.html', true);
    await settle(); await settle(); await settle();
    expect(state.loaded).toHaveLength(1);
    expect(decodeURIComponent(state.loaded[0] ?? '')).toContain('ERR_FILE_NOT_FOUND');
    expect(state.visible).toBe(true);
    expect(reloads).toBe(1);
  });

  it('ignores aborted navigations, sub-frames and the recovery page itself', async () => {
    const { window, state, emit } = fakeWindow();
    guardMainWindow(window, { dataDir: 'x', log: () => undefined, setTimer: () => undefined });
    emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'file:///app/index.html', true);
    emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'file:///app/frame.html', false);
    emit('did-fail-load', {}, -6, 'ERR_INVALID_URL', 'data:text/html,x', true);
    await settle();
    expect(state.loaded).toEqual([]);
  });

  it('recovers from a crashed renderer but not from a clean exit', async () => {
    const { window, state, emit } = fakeWindow();
    guardMainWindow(window, { dataDir: 'x', log: () => undefined, setTimer: () => undefined });
    emit('render-process-gone', {}, { reason: 'clean-exit' });
    await settle();
    expect(state.loaded).toEqual([]);
    emit('render-process-gone', {}, { reason: 'crashed' });
    await settle(); await settle();
    expect(decodeURIComponent(state.loaded[0] ?? '')).toContain('crashed');
  });

  it('shows a window whose renderer never became ready, unless it starts hidden', () => {
    const visible = fakeWindow();
    const timers: Array<() => void> = [];
    guardMainWindow(visible.window, { dataDir: 'x', log: () => undefined, setTimer: (fn) => timers.push(fn) });
    timers.forEach((fn) => fn());
    expect(visible.state.shows).toBe(1);
    const hidden = fakeWindow();
    const hiddenTimers: Array<() => void> = [];
    guardMainWindow(hidden.window, { dataDir: 'x', startHidden: true, log: () => undefined, setTimer: (fn) => hiddenTimers.push(fn) });
    expect(hiddenTimers).toHaveLength(0);
  });

  it('escapes the reason and data folder in the static page', () => {
    const page = decodeURIComponent(recoveryPage('<script>x</script>', 'C:\\a"b'));
    expect(page).not.toContain('<script>x');
    expect(page).toContain('&lt;script&gt;');
    expect(page).toContain('&quot;');
    expect(page).toContain("default-src 'none'");
  });
});

import { join } from 'node:path';
import { BrowserWindow, screen, systemPreferences } from 'electron';
import { IpcEvent } from '@neuralbridge/shared';
import type { CompanionHudDragPhase, CompanionHudLayout, CompanionHudMode, CompanionHudState } from '@neuralbridge/shared/companion';
import type { AppLocation } from './security/navigation.js';
import { anchorForDrop, defaultAnchor, HUD_SIZES, hudStage, shouldCollapseOnBlur, snapToArea, workAreaFor, type HudSide, type HudStage, type Point, type Rect } from './companion-hud-layout.js';
import { readPreferences, showCompanionHudOnLaunch, writePreferences, type Preferences } from './preferences.js';

const HUD_QUERY = 'companion=hud';
const SETTLE_FRAMES = 8;
const SETTLE_FRAME_MS = 16;

export function isCompanionHudUrl(url: string): boolean { return url.includes(HUD_QUERY); }

/**
 * Owns the floating window: its position, mode and visibility. Preferences hold what must survive a restart.
 * The window is free to close (Alt+F4, session end): blocking 'close' would hold up logoff, so it is recreated on demand.
 */
/** Often enough for the eyes to follow, rare enough to cost nothing; only while the HUD is on screen. */
const CURSOR_POLL_MS = 100;

export class CompanionHudController {
  private cursorTimer: NodeJS.Timeout | undefined;
  window: BrowserWindow | null = null;
  private drag: { grip: Point; align: HudSide } | null = null;
  private settling: NodeJS.Timeout | undefined;
  private inMeeting = false;
  private readonly onDisplaysChanged = (): void => this.applyBounds();

  constructor(private readonly location: AppLocation, private readonly preferencesFile: string, private readonly onShownChanged: (shown: boolean) => void = () => undefined, private extensionEnabled: () => boolean = () => true) {
    for (const change of ['display-added', 'display-removed', 'display-metrics-changed'] as const) screen.on(change as 'display-added', this.onDisplaysChanged);
    if (this.extensionEnabled()) this.create();
  }

  private create(): BrowserWindow {
    const loaded = readPreferences(this.preferencesFile);
    const preferences = showCompanionHudOnLaunch(loaded);
    if (!loaded.companionHud.visible) writePreferences(this.preferencesFile, preferences);
    const { companionHud } = preferences;
    const window = new BrowserWindow({
      title: 'Singularity Companion', ...this.stage().bounds,
      show: false, frame: false, transparent: true, hasShadow: false, thickFrame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false, movable: true, skipTaskbar: true,
      // Taking focus only in the panel, the one mode with something to type or tab through, keeps a click on the mascot from pulling focus out of the user's editor.
      focusable: companionHud.mode === 'expanded', alwaysOnTop: companionHud.alwaysOnTop, backgroundColor: '#00000000',
      webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
    });
    window.setAlwaysOnTop(companionHud.alwaysOnTop, 'floating');
    window.setIgnoreMouseEvents(true, { forward: true });
    window.setContentProtection(this.inMeeting);
    window.once('ready-to-show', () => window.showInactive());
    window.on('show', () => { this.onShownChanged(true); this.followCursor(window); });
    window.on('hide', () => { this.onShownChanged(false); this.stopCursor(); });
    window.webContents.on('render-process-gone', () => this.onShownChanged(false));
    window.on('blur', () => {
      if (shouldCollapseOnBlur(this.modeNow())) this.setMode('mascot');
    });
    window.once('closed', () => { this.stopCursor(); this.window = null; this.drag = null; this.onShownChanged(false); });
    // In the URL, so the first frame already has the mascot in place instead of waiting for an IPC round trip.
    const search = `${HUD_QUERY}&mode=${companionHud.mode}&layout=${encodeURIComponent(JSON.stringify(this.layout()))}`;
    if (this.location.devServerUrl) void window.loadURL(`${this.location.devServerUrl}?${search}`);
    else void window.loadFile(this.location.indexFile, { search });
    this.window = window;
    return window;
  }

  /** Sends only a change, as a point relative to the window, so the renderer never learns the screen layout. */
  private followCursor(window: BrowserWindow): void {
    if (this.cursorTimer) return;
    let last = '';
    this.cursorTimer = setInterval(() => {
      if (window.isDestroyed()) return this.stopCursor();
      const cursor = screen.getCursorScreenPoint();
      const bounds = window.getContentBounds();
      const point = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
      const key = `${point.x},${point.y}`;
      if (key === last) return;
      last = key;
      window.webContents.send(IpcEvent.companionCursor, point);
    }, CURSOR_POLL_MS);
    this.cursorTimer.unref();
  }

  private stopCursor(): void {
    clearInterval(this.cursorTimer);
    this.cursorTimer = undefined;
  }

  private update(changes: Partial<Preferences['companionHud']>): void {
    const current = readPreferences(this.preferencesFile);
    writePreferences(this.preferencesFile, { ...current, companionHud: { ...current.companionHud, ...changes } });
  }

  private areas(): { all: Rect[]; primary: Rect } {
    return { all: screen.getAllDisplays().map((display) => display.workArea), primary: screen.getPrimaryDisplay().workArea };
  }

  private stage(): HudStage {
    const { x, y } = readPreferences(this.preferencesFile).companionHud;
    const { all, primary } = this.areas();
    return hudStage(x === null || y === null ? null : { x, y }, all, primary, this.align());
  }

  /** The default corner is on the right. A drag keeps this same value, so its first move lands on the stage already there. */
  private align(): HudSide {
    const { x, y, align } = readPreferences(this.preferencesFile).companionHud;
    return x === null || y === null ? 'right' : align;
  }

  private layout(): CompanionHudLayout {
    const { bounds, layout } = this.stage();
    return { origin: { x: bounds.x, y: bounds.y }, ...layout };
  }

  private applyBounds(): void {
    if (!this.window || this.drag) return;
    clearInterval(this.settling);
    this.window.setBounds(this.stage().bounds);
    this.publish();
  }

  /** A closed window reads as hidden for this session, without changing what the next launch does. */
  state(): CompanionHudState {
    const { visible, mode, alwaysOnTop } = readPreferences(this.preferencesFile).companionHud;
    return { visible: this.extensionEnabled() && visible && this.window !== null, mode, alwaysOnTop, layout: this.layout() };
  }

  setExtensionEnabled(enabled: boolean): void {
    this.extensionEnabled = () => enabled;
    if (!enabled) {
      this.window?.destroy();
      return;
    }
    if (!this.window) this.create();
  }

  /** Runs from other windows' 'closed' listeners, which can fire before this window's own has cleared the reference. */
  isShowing(): boolean { return this.window !== null && !this.window.isDestroyed() && this.window.isVisible(); }

  private publish(layout = this.layout()): void {
    this.window?.webContents.send(IpcEvent.companionHudChanged, { ...this.state(), layout });
  }

  setMode(mode: CompanionHudMode): void {
    this.update({ mode });
    const window = this.window;
    window?.setFocusable(mode === 'expanded');
    // Expanded mode must own focus once so a subsequent click outside the click-through stage emits `blur`.
    if (mode === 'expanded' && window && !window.isDestroyed()) window.focus();
    this.publish();
  }

  setVisible(visible: boolean): void {
    if (!this.extensionEnabled()) throw new Error('extension_disabled: Companion está desativado.');
    this.update({ visible });
    if (!this.window) { if (visible) this.create(); return; }
    if (visible) this.window.showInactive(); else this.window.hide();
    this.publish();
  }

  /** During a meeting the HUD stays out of screen shares and captures: a suggestion is for the user, not for the audience. */
  setPrivate(inMeeting: boolean): void {
    if (inMeeting === this.inMeeting) return;
    this.inMeeting = inMeeting;
    this.window?.setContentProtection(inMeeting);
  }

  setPinned(alwaysOnTop: boolean): void {
    this.update({ alwaysOnTop });
    this.window?.setAlwaysOnTop(alwaysOnTop, 'floating');
  }

  resetPosition(): void {
    const { primary } = this.areas();
    this.update({ ...defaultAnchor(primary), align: 'right' });
    this.applyBounds();
  }

  /** Opened on request from Settings, which is how a keyboard reaches a window that otherwise never takes focus. */
  openPanel(): void {
    if (!this.extensionEnabled()) throw new Error('extension_disabled: Companion está desativado.');
    this.update({ visible: true });
    this.setMode('expanded');
    const window = this.window ?? this.create();
    window.show();
    window.focus();
    this.publish();
  }

  setInteractive(interactive: boolean): void {
    if (interactive) this.window?.setIgnoreMouseEvents(false);
    else this.window?.setIgnoreMouseEvents(true, { forward: true });
  }

  handleDrag(phase: CompanionHudDragPhase): void {
    const { window } = this;
    if (!window) return;
    const cursor = screen.getCursorScreenPoint();
    if (phase === 'start') {
      clearInterval(this.settling);
      const { bounds, layout } = this.stage();
      const held = this.modeNow() === 'expanded' ? bounds : { x: bounds.x + layout.mascot.x, y: bounds.y + layout.mascot.y };
      this.drag = { grip: { x: cursor.x - held.x, y: cursor.y - held.y }, align: this.align() };
      return;
    }
    if (!this.drag) return;
    const { grip, align } = this.drag;
    const { all, primary } = this.areas();
    const mode = this.modeNow();
    const held = { x: cursor.x - grip.x, y: cursor.y - grip.y };
    // The panel fills the stage and moves with it. The other shapes move inside it, so the window only has to keep up in
    // small steps: moving a window and repainting it are not atomic, and a large step left for the drop would show.
    const stage = hudStage(held, all, primary, align);
    const panel = { ...held, ...HUD_SIZES.expanded };
    // Bounds, not position: Windows rescales the size of a window that crosses monitors with different DPI.
    if (phase === 'move') {
      window.setBounds(mode === 'expanded' ? panel : stage.bounds);
      if (mode !== 'expanded') this.publish({ origin: { x: stage.bounds.x, y: stage.bounds.y }, ...stage.layout });
      return;
    }
    this.drag = null;
    if (mode === 'expanded') {
      this.update({ ...anchorForDrop(snapToArea(held, HUD_SIZES.expanded, workAreaFor(panel, all)), align), align });
    } else {
      const offset = mode === 'compact' ? stage.layout.compact : stage.layout.mascot;
      const shown = { x: stage.bounds.x + offset.x, y: stage.bounds.y + offset.y };
      const snapped = snapToArea(shown, HUD_SIZES[mode], workAreaFor({ ...shown, ...HUD_SIZES[mode] }, all));
      this.update({ x: held.x + snapped.x - shown.x, y: held.y + snapped.y - shown.y, align });
    }
    this.publish();
    this.settle(this.stage().bounds);
  }

  /** The last few pixels to a snapped edge. Under reduced motion the window just goes there. */
  private settle(target: Rect): void {
    const { window } = this;
    if (!window) return;
    const from = window.getBounds();
    if (systemPreferences.getAnimationSettings().prefersReducedMotion) { window.setBounds(target); return; }
    let frame = 0;
    clearInterval(this.settling);
    this.settling = setInterval(() => {
      frame += 1;
      const t = frame / SETTLE_FRAMES; const eased = 1 - (1 - t) ** 3;
      if (window.isDestroyed()) { clearInterval(this.settling); return; }
      window.setBounds(frame >= SETTLE_FRAMES ? target : { ...target, x: Math.round(from.x + (target.x - from.x) * eased), y: Math.round(from.y + (target.y - from.y) * eased) });
      if (frame >= SETTLE_FRAMES) clearInterval(this.settling);
    }, SETTLE_FRAME_MS);
  }

  private modeNow(): CompanionHudMode { return readPreferences(this.preferencesFile).companionHud.mode; }
}

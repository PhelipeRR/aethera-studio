/**
 * Keeps the main window from ever staying blank or invisible: a renderer that fails to load or crashes
 * is replaced by a static recovery page, and a window that never signals ready-to-show is shown anyway.
 * Electron-free so it can be tested with a fake window.
 */

export interface GuardedWindowLike {
  isDestroyed(): boolean;
  isVisible(): boolean;
  show(): void;
  loadURL(url: string): Promise<void>;
  webContents: {
    on(event: 'did-fail-load', listener: (event: unknown, errorCode: number, errorDescription: string, url: string, isMainFrame: boolean) => void): void;
    on(event: 'render-process-gone', listener: (event: unknown, details: { reason: string }) => void): void;
  };
}

export interface StartupGuardOptions {
  /** Shows the window even if the renderer never becomes ready (ms). Skipped when the window starts hidden. */
  showTimeoutMs?: number;
  startHidden?: boolean;
  dataDir: string;
  log?: (message: string) => void;
  /** Offers "try again" / "close"; resolves true to reload the app. */
  askRetry?: (reason: string) => Promise<boolean>;
  reload?: () => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
}

const ABORTED = -3; // ERR_ABORTED: a navigation replaced by another one, not a failure.

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

/** A self-contained page (no scripts, no IPC) explaining what happened and what to do next. */
export function recoveryPage(reason: string, dataDir: string): string {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Singularity</title>
<style>body{font-family:Segoe UI,system-ui,sans-serif;background:#0b0b0b;color:#f2f2f2;margin:0;display:grid;place-items:center;min-height:100vh}main{max-width:560px;padding:32px}h1{font-size:22px;margin:0 0 12px}p{color:#c8c8c8;line-height:1.55}code{display:block;background:#1b1b1b;padding:10px;border-radius:6px;word-break:break-all;color:#e6e6e6}</style></head>
<body><main role="alert"><h1>A interface do Singularity não carregou</h1>
<p>Motivo: ${escapeHtml(reason)}.</p>
<p>Seus dados não foram alterados. Use <strong>Tentar novamente</strong> na janela de aviso, ou feche e abra o aplicativo. Se continuar, exporte os diagnósticos com <code>npm run diagnostics:export</code> e envie ao suporte.</p>
<p>Pasta de dados:</p><code>${escapeHtml(dataDir)}</code></main></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export function guardMainWindow(window: GuardedWindowLike, options: StartupGuardOptions): void {
  const log = options.log ?? console.error;
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms).unref?.());
  let recovering = false;

  const recover = (reason: string): void => {
    if (recovering || window.isDestroyed()) return;
    recovering = true;
    log(`[startup] renderer unavailable: ${reason}`);
    void window.loadURL(recoveryPage(reason, options.dataDir)).catch(() => undefined).then(() => {
      if (!window.isDestroyed() && !window.isVisible()) window.show();
      return options.askRetry?.(reason);
    }).then((retry) => {
      recovering = false;
      if (retry && !window.isDestroyed()) options.reload?.();
    });
  };

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, url, isMainFrame) => {
    if (!isMainFrame || errorCode === ABORTED || url.startsWith('data:')) return;
    recover(`falha ao carregar (${errorDescription || errorCode})`);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return;
    recover(`o processo da interface foi encerrado (${details.reason})`);
  });
  if (!options.startHidden) {
    setTimer(() => {
      if (!window.isDestroyed() && !window.isVisible()) {
        log('[startup] ready-to-show did not arrive in time; showing the window anyway');
        window.show();
      }
    }, options.showTimeoutMs ?? 15_000);
  }
}

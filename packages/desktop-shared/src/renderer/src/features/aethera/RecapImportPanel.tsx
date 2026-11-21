import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FileText,
  Link as LinkIcon,
  LoaderCircle,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type SourceMode = 'local' | 'url';

interface ImportJobItem {
  id: string;
  url?: string;
  filePath?: string;
  fileName?: string;
  status: 'pending' | 'analyzing' | 'downloading' | 'packing_cbz' | 'completed' | 'failed' | 'cancelled' | 'skipped_existing';
  pagesDone: number;
  pagesTotal: number;
  error?: string;
  chapterNumber?: string;
}

interface ImportJob {
  id: string;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  items: ImportJobItem[];
  completedChapters: number;
  totalChapters: number;
  createdAtIso: string;
  updatedAtIso: string;
  error?: string;
}

interface RecapImportPanelProps {
  /** Called when user confirms import to start production pipeline. */
  onStartProduction?: (jobId: string, mode: 'single' | 'per-chapter') => void;
  className?: string;
}

/** IPC bridge — injected by Electron preload or mocked in tests. */
const ipc = typeof window !== 'undefined' && (window as unknown as { electronAPI?: Record<string, (...args: unknown[]) => Promise<unknown>> }).electronAPI;

async function invokeIpc<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!ipc) throw new Error('IPC não disponível fora do Electron.');
  const fn = ipc[channel];
  if (typeof fn !== 'function') throw new Error(`Canal IPC não encontrado: ${channel}`);
  return fn(...args) as Promise<T>;
}

export function RecapImportPanel({ onStartProduction, className }: RecapImportPanelProps) {
  const [mode, setMode] = useState<SourceMode>('url');
  const [urlInput, setUrlInput] = useState('');
  const [urls, setUrls] = useState<string[]>([]);
  const [localFiles, setLocalFiles] = useState<Array<{ path: string; name: string }>>([]);
  const [activeJob, setActiveJob] = useState<ImportJob | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [productionMode, setProductionMode] = useState<'single' | 'per-chapter'>('single');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Subscribe to job updates via IPC event
  useEffect(() => {
    if (!ipc || !activeJob) return;
    const handler = (_event: unknown, job: ImportJob) => {
      if (job.id === activeJob.id) {
        setActiveJob(job);
      }
    };
    // In real Electron, this would be: window.electronAPI.onRecapImportJobChanged(handler)
    // For now, we rely on polling or the initial response
    return () => {
      void handler;
    };
  }, [activeJob]);

  const handleAddUrls = useCallback(() => {
    const lines = urlInput
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && (line.startsWith('http://') || line.startsWith('https://')));
    if (lines.length === 0) return;
    setUrls((prev) => [...new Set([...prev, ...lines])]);
    setUrlInput('');
  }, [urlInput]);

  const handleRemoveUrl = useCallback((urlToRemove: string) => {
    setUrls((prev) => prev.filter((u) => u !== urlToRemove));
  }, []);

  const handleSelectLocalFiles = useCallback(async () => {
    try {
      const result = await invokeIpc<{ filePaths: string[]; canceled: boolean }>('recapImportSelectLocalFiles');
      if (result.canceled || result.filePaths.length === 0) return;
      setLocalFiles((prev) => {
        const existingPaths = new Set(prev.map((f) => f.path));
        const newFiles = result.filePaths
          .filter((p) => !existingPaths.has(p))
          .map((p) => ({ path: p, name: p.split(/[/\\]/).pop() ?? p }));
        return [...prev, ...newFiles];
      });
    } catch (err) {
      console.error('Failed to select files:', err);
    }
  }, []);

  const handleRemoveFile = useCallback((pathToRemove: string) => {
    setLocalFiles((prev) => prev.filter((f) => f.path !== pathToRemove));
  }, []);

  const handleStartImport = useCallback(async () => {
    const sources = mode === 'url' ? urls : localFiles.map((f) => f.path);
    if (sources.length === 0) return;

    setIsStarting(true);
    try {
      const job = await invokeIpc<ImportJob>('recapImportCreateJob', {
        urls: sources,
        forceReimport: false,
      });
      setActiveJob(job);
    } catch (err) {
      console.error('Failed to create import job:', err);
    } finally {
      setIsStarting(false);
    }
  }, [mode, urls, localFiles]);

  const handleCancelJob = useCallback(async () => {
    if (!activeJob) return;
    try {
      const updated = await invokeIpc<ImportJob>('recapImportCancelJob', { jobId: activeJob.id });
      setActiveJob(updated);
    } catch (err) {
      console.error('Failed to cancel job:', err);
    }
  }, [activeJob]);

  const handleStartProduction = useCallback(() => {
    if (!activeJob || !onStartProduction) return;
    onStartProduction(activeJob.id, productionMode);
  }, [activeJob, productionMode, onStartProduction]);

  const hasEntries = mode === 'url' ? urls.length > 0 : localFiles.length > 0;
  const isJobTerminal = activeJob?.status === 'completed' || activeJob?.status === 'failed' || activeJob?.status === 'cancelled';
  const canStart = hasEntries && !activeJob && !isStarting;
  const progressPercent = activeJob && activeJob.totalChapters > 0
    ? Math.round((activeJob.completedChapters / activeJob.totalChapters) * 100)
    : 0;

  return (
    <section className={cn('rounded-[28px] bg-card p-6', className)}>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          Importar capítulos
        </h2>
        {activeJob && !isJobTerminal && (
          <span className="rounded-full bg-secondary px-3.5 py-1.5 text-sm font-medium text-foreground">
            {activeJob.completedChapters}/{activeJob.totalChapters}
          </span>
        )}
      </div>

      {/* Mode Selector — replaces tabs with a clean two-option toggle */}
      {!activeJob && (
        <div className="mb-6 flex gap-2 rounded-xl bg-secondary/50 p-1">
          <button
            type="button"
            onClick={() => setMode('url')}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors',
              mode === 'url'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <LinkIcon className="size-4" />
            Link
          </button>
          <button
            type="button"
            onClick={() => setMode('local')}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors',
              mode === 'local'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <FileText className="size-4" />
            CBZ / PDF
          </button>
        </div>
      )}

      {/* URL Input Mode */}
      {mode === 'url' && !activeJob && (
        <div className="space-y-4">
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleAddUrls();
                }
              }}
              placeholder="Cole um ou mais links de capítulo, um por linha"
              className="min-h-[120px] w-full resize-y rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="button"
              onClick={handleAddUrls}
              disabled={!urlInput.trim()}
              className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity disabled:opacity-40"
            >
              <Plus className="size-3.5" />
              Adicionar
            </button>
          </div>

          {urls.length > 0 && (
            <div className="max-h-[200px] space-y-1.5 overflow-y-auto rounded-xl border border-border bg-background p-3">
              {urls.map((url) => (
                <div key={url} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-foreground hover:bg-secondary/50">
                  <LinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{url}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveUrl(url)}
                    className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Local File Mode */}
      {mode === 'local' && !activeJob && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={handleSelectLocalFiles}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background py-8 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
          >
            <Upload className="size-5" />
            Selecionar arquivos CBZ ou PDF
          </button>

          {localFiles.length > 0 && (
            <div className="max-h-[200px] space-y-1.5 overflow-y-auto rounded-xl border border-border bg-background p-3">
              {localFiles.map((file) => (
                <div key={file.path} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-foreground hover:bg-secondary/50">
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveFile(file.path)}
                    className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Active Job Progress */}
      {activeJob && (
        <div className="space-y-4">
          {/* Progress bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-foreground">
                {activeJob.status === 'completed' ? 'Importação concluída' :
                 activeJob.status === 'failed' ? 'Falha na importação' :
                 activeJob.status === 'cancelled' ? 'Cancelado' :
                 activeJob.status === 'paused' ? 'Pausado' :
                 'Importando capítulos'}
              </span>
              <span className="text-muted-foreground">{progressPercent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-300',
                  activeJob.status === 'failed' ? 'bg-destructive' :
                  activeJob.status === 'cancelled' ? 'bg-muted-foreground' :
                  'bg-primary',
                )}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Per-item status list */}
          <div className="max-h-[240px] space-y-1 overflow-y-auto rounded-xl border border-border bg-background p-3">
            {activeJob.items.map((item, idx) => (
              <div key={`${item.url ?? item.filePath}-${idx}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm">
                {item.status === 'completed' || item.status === 'skipped_existing' ? (
                  <span className="size-2 shrink-0 rounded-full bg-success" />
                ) : item.status === 'failed' ? (
                  <span className="size-2 shrink-0 rounded-full bg-destructive" />
                ) : item.status === 'cancelled' ? (
                  <span className="size-2 shrink-0 rounded-full bg-muted-foreground" />
                ) : (
                  <LoaderCircle className="size-3.5 shrink-0 animate-spin text-primary" />
                )}
                <span className={cn(
                  'truncate',
                  item.status === 'failed' ? 'text-destructive' : 'text-foreground',
                )}>
                  {item.chapterNumber ? `Cap. ${item.chapterNumber}` : item.url ?? item.filePath ?? 'Desconhecido'}
                </span>
                {item.pagesTotal > 0 && (
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {item.pagesDone}/{item.pagesTotal}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Error message */}
          {activeJob.error && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {activeJob.error}
            </div>
          )}

          {/* Item-level errors */}
          {activeJob.items.some((i) => i.error) && (
            <details className="rounded-xl border border-border bg-background">
              <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
                Ver erros individuais
              </summary>
              <div className="space-y-1 border-t border-border p-3">
                {activeJob.items.filter((i) => i.error).map((item, idx) => (
                  <div key={idx} className="text-xs text-destructive">
                    <span className="font-medium">{item.chapterNumber ?? item.url}:</span> {item.error}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div className="mt-6 flex items-center gap-3">
        {!activeJob && (
          <button
            type="button"
            onClick={handleStartImport}
            disabled={!canStart}
            className={cn(
              'flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium transition-all',
              canStart
                ? 'bg-primary text-primary-foreground hover:opacity-90'
                : 'cursor-not-allowed bg-secondary text-muted-foreground',
            )}
          >
            {isStarting ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Iniciar importação
          </button>
        )}

        {activeJob && !isJobTerminal && (
          <button
            type="button"
            onClick={handleCancelJob}
            className="flex items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
          >
            <Trash2 className="size-4" />
            Cancelar
          </button>
        )}

        {activeJob?.status === 'completed' && onStartProduction && (
          <>
            <div className="flex items-center gap-2 rounded-xl bg-secondary/50 p-1">
              <button
                type="button"
                onClick={() => setProductionMode('single')}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                  productionMode === 'single'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Recap único
              </button>
              <button
                type="button"
                onClick={() => setProductionMode('per-chapter')}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                  productionMode === 'per-chapter'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Por capítulo
              </button>
            </div>
            <button
              type="button"
              onClick={handleStartProduction}
              className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Iniciar produção Recap
            </button>
          </>
        )}

        {activeJob?.status === 'failed' && (
          <button
            type="button"
            onClick={() => {
              setActiveJob(null);
              if (mode === 'url') setUrls([]);
              else setLocalFiles([]);
            }}
            className="flex items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
          >
            Tentar novamente
          </button>
        )}
      </div>
    </section>
  );
}
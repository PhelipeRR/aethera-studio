import { Trash2, X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';

/** Max characters of prompt text ever shown in a delete confirmation. */
export const PROMPT_DELETE_LABEL_MAX_CHARS = 100;

export const PROMPT_DELETE_CONFIRM_MESSAGE =
  'Tem certeza de que deseja excluir este prompt? Esta ação não poderá ser desfeita.';

export interface PromptDeleteLabelSource {
  title?: string | null;
  prompt?: string | null;
  fallback?: string | null;
}

function clip(text: string, max: number): string {
  // Iterate code points so an emoji/surrogate pair is never split in half.
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars.slice(0, max).join('').trimEnd()}…`;
}

/**
 * Short, single-line label identifying a prompt in a confirmation UI.
 * Uses the title when present, otherwise the first 100 characters of the prompt
 * followed by an ellipsis. The full prompt is never returned.
 */
export function promptDeleteLabel(source: PromptDeleteLabelSource): string {
  const normalize = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
  const title = normalize(source.title);
  if (title) return clip(title, PROMPT_DELETE_LABEL_MAX_CHARS);
  const prompt = normalize(source.prompt);
  if (prompt) return clip(prompt, PROMPT_DELETE_LABEL_MAX_CHARS);
  return clip(normalize(source.fallback) || 'Prompt sem título', PROMPT_DELETE_LABEL_MAX_CHARS);
}

export interface DeletePromptDialogProps {
  /** Already-shortened label (use `promptDeleteLabel`). Clipped again defensively. */
  label: string;
  pending?: boolean;
  /** Optional compact details (e.g. what will be removed). Scrolls inside a fixed area. */
  details?: string[] | undefined;
  footnote?: string | undefined;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeletePromptDialog({ label, pending = false, details, footnote, onCancel, onConfirm }: DeletePromptDialogProps) {
  const titleId = useId();
  const descId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const safeLabel = clip(label, PROMPT_DELETE_LABEL_MAX_CHARS);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, pending]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        data-testid="delete-prompt-dialog"
        className="flex max-h-[min(22rem,calc(100vh-2rem))] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-[#0d0d17] shadow-2xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5">
          <h2 id={titleId} className="text-sm font-semibold text-foreground">
            Excluir prompt
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-lg border border-border p-1 text-muted-foreground hover:text-foreground"
            aria-label="Fechar"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-2">
          <p id={descId} className="text-xs text-muted-foreground">
            {PROMPT_DELETE_CONFIRM_MESSAGE}
          </p>
          <p
            className="mt-2 truncate rounded-lg border border-border/70 bg-background/60 px-2.5 py-1.5 text-xs font-medium text-foreground"
            title={safeLabel}
            data-testid="delete-prompt-label"
          >
            {safeLabel}
          </p>
          {details && details.length > 0 && (
            <div className="mt-3 space-y-1.5 rounded-xl border border-border/70 bg-background/60 p-3 text-[11px]">
              <p className="font-medium text-rose-300">Dados exclusivos que serão removidos:</p>
              <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                {details.map((item) => (
                  <li key={item} className="break-words">{item}</li>
                ))}
              </ul>
              {footnote && <p className="pt-1 text-[10px] text-emerald-300/90">{footnote}</p>}
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-border/60 px-5 py-4 text-xs">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-lg border border-border px-3 py-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            data-variant="destructive"
            className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-1.5 font-semibold text-white hover:bg-rose-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400 disabled:opacity-50"
          >
            <Trash2 className="size-3.5" />
            {pending ? 'Excluindo...' : 'Excluir'}
          </button>
        </div>
      </div>
    </div>
  );
}

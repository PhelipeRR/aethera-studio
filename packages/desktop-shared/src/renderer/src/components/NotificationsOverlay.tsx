import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

export type NotificationType = 'success' | 'info' | 'warning' | 'error';

export interface AppNotificationInput {
  title: string;
  message?: string;
  type?: NotificationType;
  durationMs?: number;
  native?: boolean;
}

export interface AppNotification extends Required<Pick<AppNotificationInput, 'title' | 'type'>> {
  id: string;
  message?: string;
  createdAt: number;
}

type Listener = (items: AppNotification[]) => void;
const listeners = new Set<Listener>();
let queue: AppNotification[] = [];

function emit() {
  for (const listener of listeners) listener(queue);
}

export function dismissNotification(id: string): void {
  queue = queue.filter((item) => item.id !== id);
  emit();
}

export function notify(input: AppNotificationInput): string {
  const id = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const item: AppNotification = {
    id,
    title: input.title,
    type: input.type ?? 'info',
    createdAt: Date.now(),
    ...(input.message ? { message: input.message } : {}),
  };
  queue = [item, ...queue].slice(0, 5);
  emit();

  const duration = input.durationMs ?? 4500;
  if (duration > 0) {
    setTimeout(() => dismissNotification(id), duration);
  }

  if (input.native && typeof window !== 'undefined' && 'Notification' in window) {
    try {
      if (window.Notification.permission === 'granted') {
        new window.Notification(input.title, input.message ? { body: input.message } : undefined);
      } else if (window.Notification.permission === 'default') {
        void window.Notification.requestPermission().then((perm) => {
          if (perm === 'granted') {
            new window.Notification(input.title, input.message ? { body: input.message } : undefined);
          }
        });
      }
    } catch {
      // ignore if OS notifications are unavailable
    }
  }

  return id;
}

const STYLES: Record<NotificationType, { border: string; bg: string; text: string }> = {
  success: {
    border: 'border-emerald-500/45',
    bg: 'bg-[#0c1a16]/95',
    text: 'text-emerald-300',
  },
  info: {
    border: 'border-purple-500/45',
    bg: 'bg-[#131024]/95',
    text: 'text-purple-200',
  },
  warning: {
    border: 'border-amber-500/45',
    bg: 'bg-[#1c160c]/95',
    text: 'text-amber-200',
  },
  error: {
    border: 'border-destructive/50',
    bg: 'bg-[#1f0e13]/95',
    text: 'text-red-300',
  },
};

export function NotificationsOverlay() {
  const [items, setItems] = useState<AppNotification[]>(queue);

  useEffect(() => {
    listeners.add(setItems);
    return () => {
      listeners.delete(setItems);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      {items.map((item) => {
        const s = STYLES[item.type];
        const Icon =
          item.type === 'success'
            ? CheckCircle2
            : item.type === 'warning'
              ? AlertTriangle
              : item.type === 'error'
                ? XCircle
                : Info;
        return (
          <div
            key={item.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border ${s.border} ${s.bg} p-3 shadow-2xl backdrop-blur-md`}
          >
            <Icon className={`mt-0.5 size-4 shrink-0 ${s.text}`} />
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className={`text-xs font-semibold ${s.text}`}>{item.title}</p>
              {item.message && (
                <p className="text-[11px] leading-snug text-muted-foreground">{item.message}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismissNotification(item.id)}
              aria-label="Fechar notificação"
              className="rounded p-0.5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

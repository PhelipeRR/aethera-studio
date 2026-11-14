import { Link } from 'react-router';
import { cn } from '@/lib/utils';
import { StatusDot } from '@/components/ui/glass';
import { timelineModel, type TimelineEvent } from './timeline-model';

/*
 * Day timeline (lote 50.03, D-5): a golden rail with the real events of the day and a "now" marker. It only draws
 * what it receives; with no events it says so. Keyboard users get an ordered list of links.
 */
/** Keeps markers and their labels inside the rail at the very start or end of the day. */
function clampLeft(position: number): string {
  return `clamp(56px, ${(position * 100).toFixed(3)}%, calc(100% - 56px))`;
}

export function Timeline({ events, now = new Date(), title = 'Linha do tempo de hoje', className }: { events: readonly TimelineEvent[]; now?: Date; title?: string; className?: string }) {
  const model = timelineModel(events, now);
  return (
    <section aria-label={title} className={cn('relative px-6 pt-3 pb-2', className)}>
      <div className="relative h-[78px]">
        <div className="absolute top-[26px] right-0 left-0 h-px bg-[linear-gradient(90deg,transparent,var(--glass-border-strong)_8%,var(--glass-border-strong)_92%,transparent)]" aria-hidden="true" />
        {model.now !== null && (
          <div className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: clampLeft(model.now) }}>
            {/* "Agora" sits above the rail, events below it, so the two never collide. */}
            <span className="sg-label text-[10px] leading-[14px] text-primary">Agora {model.nowLabel}</span>
            <span className="mt-1 size-3 rounded-full bg-primary shadow-[var(--glow-strong)] ring-2 ring-[var(--glass-border-strong)] ring-offset-2 ring-offset-transparent" aria-hidden="true" />
          </div>
        )}
        <ol className="absolute inset-0">
          {model.events.map((event) => {
            const body = (
              <>
                <span className="mt-[23px] block size-1.5 rounded-full bg-primary/80 shadow-[var(--glow-soft)] transition-transform duration-[var(--motion-base)] group-hover:scale-150" aria-hidden="true" />
                <span className={cn('mt-2 flex max-w-32 flex-col items-center text-center', event.compact && 'sr-only')}>
                  <span className="text-[11px] text-foreground tabular-nums">{event.time}</span>
                  <span className="line-clamp-1 text-[11px] text-muted-foreground">{event.label}</span>
                </span>
                {event.tone && <StatusDot tone={event.tone} className="sr-only" />}
              </>
            );
            return (
              <li key={event.id} className="absolute top-0 -translate-x-1/2" style={{ left: clampLeft(event.position) }}>
                {event.href ? (
                  <Link to={event.href} className="group flex flex-col items-center rounded-md px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring" title={event.detail ? `${event.label} · ${event.detail}` : event.label}>
                    {body}
                  </Link>
                ) : (
                  <span className="group flex flex-col items-center px-1" title={event.label}>{body}</span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      {model.events.length === 0 && <p className="text-center text-xs text-muted-foreground">Nenhum evento registrado hoje.</p>}
    </section>
  );
}

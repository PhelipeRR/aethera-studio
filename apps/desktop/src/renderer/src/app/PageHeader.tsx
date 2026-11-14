import type { ReactNode } from 'react';
import { useLocation } from 'react-router';
import { GuidedTourButton } from './guided-tours';
import { ROUTES } from './routes';

/** Navigation group of the current page ("Trabalho", "Conhecimento"…), shown as the eyebrow above the title. */
function groupOf(pathname: string): string | null {
  const route = [...ROUTES].sort((a, b) => b.path.length - a.path.length).find((candidate) => candidate.path === '/' ? pathname === '/' : pathname === candidate.path || pathname.startsWith(`${candidate.path}/`));
  return route?.group ?? null;
}

/** Page header in the Singularity voice (lote 50.05): spaced upper-case eyebrow, light title, quiet description. */
export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  const { pathname } = useLocation();
  const group = groupOf(pathname);
  return (
    <header data-tour="page-header" className="flex items-start justify-between gap-6 border-b border-[var(--glass-border)] px-8 pt-6 pb-5">
      <div className="max-w-[68ch]">
        {group && <p className="sg-label mb-1.5 text-[10px]" aria-hidden="true">· {group}</p>}
        <h1 className="text-[26px] leading-tight font-light tracking-[0.005em] text-foreground">{title}</h1>
        <p className="mt-1.5 text-muted-foreground">{description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">{actions}<GuidedTourButton /></div>
    </header>
  );
}

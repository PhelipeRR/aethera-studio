import { PageHeader } from '@/app/PageHeader';
import type { AppRoute } from '@/app/routes';

/** Honest placeholder for a page whose feature lands in a later phase: no sample data. */
export function PlannedPage({ route }: { route: AppRoute & { planned: NonNullable<AppRoute['planned']> } }) {
  const Icon = route.icon;
  return (
    <>
      <PageHeader title={route.label} description={route.description} />
      <section aria-label={`${route.label}: ainda não disponível`} className="flex justify-center px-8 py-20">
        <div className="flex max-w-md flex-col items-center text-center">
          <div className="mb-5 grid size-12 place-items-center rounded-full border border-dashed border-input text-muted-foreground">
            <Icon className="size-5" aria-hidden="true" />
          </div>
          <h2 className="text-base font-medium">Ainda não disponível</h2>
          <p className="mt-1.5 text-muted-foreground">{route.planned.summary}</p>
        </div>
      </section>
    </>
  );
}

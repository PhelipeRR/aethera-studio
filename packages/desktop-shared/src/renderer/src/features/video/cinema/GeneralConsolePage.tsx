import { PageHeader } from '@/app/PageHeader';
import { ProductionConsoleAccordion } from '../ProductionConsoleAccordion';

/**
 * Console Geral: independent area of the main navigation. It aggregates every production (videos and thumbnails)
 * with filters by job, status, agent and stage. Each production keeps its own console in "Produção com IA".
 */
export function GeneralConsolePage() {
  return (
    <>
      <PageHeader
        title="Console Geral"
        description="Eventos de todas as produções e serviços ao mesmo tempo. O console de cada projeto fica na Produção com IA."
      />
      <div className="flex flex-col gap-4 p-6 xl:p-8">
        <ProductionConsoleAccordion scope="all" defaultOpen title="Console Geral de Produções" />
      </div>
    </>
  );
}

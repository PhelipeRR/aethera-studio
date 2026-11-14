import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { MeterBar, SectionLabel, StatusDot } from '@/components/ui/glass';
import { share } from '@/features/monitoring/format';
import { useMonitoring } from '@/features/monitoring/monitoring-store';
import { systemStatus } from './shell-model';

const quiet = { staleTime: 60_000, retry: false, refetchOnWindowFocus: false } as const;

/**
 * Sidebar "Status do sistema" (lote 50.03). Only checks the app already runs elsewhere: agent CLIs, MCP client
 * registration, the database and the memory count. Hardware meters arrive with real collection in lote 50.08.
 */
export function SystemStatus() {
  const agents = useQuery({ queryKey: ['shell-status', 'agents'], queryFn: () => window.neuralbridge.agents.status(false), ...quiet });
  const mcp = useQuery({ queryKey: ['shell-status', 'mcp'], queryFn: () => window.neuralbridge.mcp.status(), ...quiet });
  const app = useQuery({ queryKey: ['shell-status', 'app'], queryFn: () => window.neuralbridge.app.status(), ...quiet });
  const brain = useQuery({ queryKey: ['shell-status', 'brain'], queryFn: () => window.neuralbridge.brain.overview(), ...quiet, enabled: app.data?.database.ok === true });

  // Lote 50.08: real compact meters from the shared monitoring loop; "indisponível" until the first reading.
  const monitoring = useMonitoring();
  const last = monitoring.samples.at(-1);
  // Before the first reading the collector is starting, not missing: say so.
  const missing = monitoring.state === 'unavailable' || monitoring.state === 'error' ? 'indisponível' : 'iniciando';
  const items = systemStatus({
    agents: agents.data ?? null,
    mcpClients: mcp.data?.clients ?? null,
    databaseOk: app.data ? app.data.database.ok : app.isError ? false : null,
    memories: brain.data?.total ?? null,
  });

  return (
    <section aria-labelledby="shell-system-status" className="sg-enter">
      <SectionLabel as="h2" id="shell-system-status" className="mb-2 px-2.5 text-[10px]">Status do sistema</SectionLabel>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.id}>
            <Link to={item.href} className="flex min-h-7 items-center gap-2.5 rounded-md px-2.5 text-xs text-foreground/90 transition-colors duration-[var(--motion-base)] hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${item.label}: ${item.value}`}>
              <StatusDot tone={item.tone} />
              <span className="flex-1 truncate">{item.label}</span>
              <span data-live-metric className={item.tone === 'error' ? 'text-destructive' : 'text-muted-foreground tabular-nums'}>{item.value}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link to="/monitoring" aria-label="Abrir monitoramento" data-live-metric className="mt-2 block space-y-2 rounded-md px-2.5 py-1.5 transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring">
        <MeterBar label="CPU" value={last?.cpu.utilization ?? null} missingLabel={missing} />
        <MeterBar label="Memória" value={last ? share(last.memory.usedBytes, last.memory.totalBytes) : null} missingLabel={missing} />
        <MeterBar label="Disco" value={last?.disk.busy ?? null} missingLabel={missing} />
      </Link>
    </section>
  );
}

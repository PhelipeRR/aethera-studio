// Pure logic of the Singularity shell (lote 50.03): top context tabs and the sidebar system status.
import type { StatusTone } from '../components/ui/glass-model';

export interface ContextTab {
  id: 'orchestrator' | 'agents' | 'mcp' | 'rag' | 'memories' | 'projects';
  label: string;
  /** Existing route the tab opens. The tabs are shortcuts, never a second navigation system. */
  to: string;
  /** Path prefixes that make the tab current. */
  match: readonly string[];
  /** Prefixes that belong to another tab even though they share `match`. */
  except?: readonly string[];
}

export const CONTEXT_TABS: readonly ContextTab[] = [
  { id: 'orchestrator', label: 'Orquestrador', to: '/chat', match: ['/chat', '/runs', '/mission-control', '/workflows'] },
  { id: 'agents', label: 'Agentes', to: '/agents', match: ['/agents'] },
  { id: 'mcp', label: 'MCP', to: '/mcp', match: ['/mcp'] },
  { id: 'rag', label: 'RAG', to: '/memory/explore', match: ['/memory/explore'] },
  { id: 'memories', label: 'Memórias', to: '/memory', match: ['/memory'], except: ['/memory/explore'] },
  { id: 'projects', label: 'Projetos', to: '/projects', match: ['/projects'] },
];

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function activeContextTab(pathname: string): ContextTab['id'] | null {
  const tab = CONTEXT_TABS.find((candidate) => candidate.match.some((prefix) => under(pathname, prefix)) && !candidate.except?.some((prefix) => under(pathname, prefix)));
  return tab?.id ?? null;
}

/**
 * Accessible name of a top tab. It contains the visible label (WCAG 2.5.3) but differs from the sidebar link of the
 * same page, so "Projetos" in the sidebar and "Ir para Projetos" on top stay distinguishable for assistive tech.
 */
export function contextTabName(tab: ContextTab): string {
  return `Ir para ${tab.label}`;
}

export interface StatusItem {
  id: 'agents' | 'mcp' | 'database' | 'memories';
  label: string;
  tone: StatusTone;
  /** Real value as text, or a plain word when there is nothing to count. Never an estimate. */
  value: string;
  href: string;
}

interface AgentLike { installed: boolean; authenticated: boolean | null }
interface McpClientLike { installed: boolean; registered: boolean; matches: boolean; error: string | null }

/** null input means "not loaded yet" or "the check failed": the item says so instead of showing a number. */
export function systemStatus(input: {
  agents: readonly AgentLike[] | null;
  mcpClients: readonly McpClientLike[] | null;
  databaseOk: boolean | null;
  memories: number | null;
}): StatusItem[] {
  const items: StatusItem[] = [];

  if (input.agents === null) items.push({ id: 'agents', label: 'Agentes', tone: 'unknown', value: 'verificando', href: '/agents' });
  else {
    const ready = input.agents.filter((agent) => agent.installed && agent.authenticated !== false).length;
    const tone: StatusTone = ready === 0 ? 'error' : ready < input.agents.length ? 'warning' : 'ok';
    items.push({ id: 'agents', label: 'Agentes', tone, value: `${ready} / ${input.agents.length}`, href: '/agents' });
  }

  if (input.mcpClients === null) items.push({ id: 'mcp', label: 'MCP', tone: 'unknown', value: 'verificando', href: '/mcp' });
  else {
    const installed = input.mcpClients.filter((client) => client.installed);
    const connected = installed.filter((client) => client.registered && client.matches && !client.error).length;
    // Not registered yet is pending setup, not a failure; a client error is a failure.
    const tone: StatusTone = installed.length === 0 ? 'unknown' : installed.some((client) => client.error) ? 'error' : connected === installed.length ? 'ok' : 'warning';
    items.push({ id: 'mcp', label: 'MCP', tone, value: installed.length === 0 ? 'sem clientes' : `${connected} / ${installed.length}`, href: '/mcp' });
  }

  items.push(
    input.databaseOk === null
      ? { id: 'database', label: 'Banco', tone: 'unknown', value: 'verificando', href: '/settings' }
      : { id: 'database', label: 'Banco', tone: input.databaseOk ? 'ok' : 'error', value: input.databaseOk ? 'ok' : 'falha', href: '/settings' },
  );

  items.push(
    input.memories === null
      ? { id: 'memories', label: 'Memórias', tone: 'unknown', value: '—', href: '/memory' }
      : { id: 'memories', label: 'Memórias', tone: 'ok', value: new Intl.NumberFormat('pt-BR').format(input.memories), href: '/memory' },
  );

  return items;
}

import {
  Activity,
  BarChart3,
  Blocks,
  Bot,
  Brain,
  FolderGit2,
  GitBranch,
  Cloud,
  LayoutDashboard,
  MessageSquare,
  Plug,
  Settings,
  Workflow,
  ListChecks,
  Gauge,
  Sparkles,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { AetheraNavIcon } from './aethera-nav-icon';

export type RouteIcon = ComponentType<SVGProps<SVGSVGElement>>;

export type RouteGroup = 'Trabalho' | 'Conhecimento' | 'Integrações' | 'Configurações';

export interface AppRoute {
  path: string;
  label: string;
  /** Lucide icons, or our own (e.g. the Aethera mark) with the same contract: className + aria-hidden, currentColor. */
  icon: RouteIcon;
  group: RouteGroup;
  description: string;
  /** Set while the page is still a placeholder: which plan phase delivers it and what it will show. */
  planned?: { phase: number; summary: string };
  extensionId?: 'neura' | 'velix' | 'personal-agent';
}

export const ROUTES: readonly AppRoute[] = [
  {
    path: '/',
    label: 'Dashboard',
    icon: LayoutDashboard,
    group: 'Trabalho',
    description: 'Estado dos agentes, do servidor MCP e das tarefas em andamento.',
  },
  {
    path: '/chat',
    label: 'Chat',
    icon: MessageSquare,
    group: 'Trabalho',
    description: 'Descreva uma tarefa em linguagem natural; o Singularity escolhe o agente.',
  },
  {
    path: '/runs',
    label: 'Execuções',
    icon: Activity,
    group: 'Trabalho',
    description: 'Histórico de tarefas com etapas, arquivos alterados, testes e erros.',
  },
  {
    path: '/memory',
    label: 'Memória',
    icon: Brain,
    group: 'Conhecimento',
    description: 'O Neural Brain: memórias compartilhadas entre Claude, Codex e outros clientes MCP.',
  },
  {
    path: '/skills',
    label: 'Skills',
    icon: Blocks,
    group: 'Conhecimento',
    description: 'Skills instaladas no Claude Code e no Codex e a quais tarefas elas se aplicam.',
  },
  {
    path: '/projects',
    label: 'Projetos',
    icon: FolderGit2,
    group: 'Trabalho',
    description: 'Pastas locais que os agentes podem usar, com stack, Git e regras por projeto.',
  },
  {
    path: '/git-intelligence',
    label: 'Git Intelligence',
    icon: GitBranch,
    group: 'Integrações',
    description: 'Grafo visual, commits, diffs e relações verificáveis do histórico Git.',
  },
  {
    path: '/azure-devops',
    label: 'Azure / TFS',
    icon: Cloud,
    group: 'Integrações',
    description: 'PRs, Boards, tasks e sprints do TFS corporativo em modo somente leitura.',
  },
  {
    path: '/agents',
    label: 'Agentes',
    icon: Bot,
    group: 'Integrações',
    description: 'Claude Code e Codex CLI: instalação, versão, login e recursos.',
  },
  {
    path: '/mcp',
    label: 'MCPs',
    icon: Plug,
    group: 'Integrações',
    description: 'O servidor MCP do Singularity e como conectá-lo a cada cliente.',
  },
  {
    path: '/analytics',
    label: 'Analytics',
    icon: BarChart3,
    group: 'Conhecimento',
    description: 'Tokens informados pelos provedores e estimativas, sempre identificadas como tal.',
    planned: { phase: 14, summary: 'Sem dados confiáveis, cada métrica aparece como indisponível em vez de um número inventado.' },
  },
  {
    path: '/workflows',
    label: 'Workflows',
    icon: Workflow,
    group: 'Trabalho',
    description: 'Fluxos validados executados pelo TaskEngine existente.',
  },
  {
    path: '/monitoring',
    label: 'Monitoramento',
    icon: Gauge,
    group: 'Trabalho',
    description: 'CPU, memória, GPU, disco e rede em tempo real, com dados reais do Windows.',
  },
  {
    path: '/mission-control',
    label: 'Mission Control',
    icon: ListChecks,
    group: 'Trabalho',
    description: 'Acompanhe tarefas, aprovações, falhas e cancelamentos.',
  },
  { path: '/video', label: 'Aethera Studio', icon: AetheraNavIcon, group: 'Trabalho', description: 'AI Cinematic Studio: produza, edite e componha vídeos com os agentes.', extensionId: 'velix' },
  {
    path: '/extensions', label: 'Extensões', icon: Blocks, group: 'Configurações', description: 'Instale, habilite, atualize e reverta extensões do workspace.',
  },
  { path: '/personal-agent', label: 'Void Pessoal', icon: Sparkles, group: 'Trabalho', description: 'Gmail, Google Agenda, automações e aprovações pessoais.', extensionId: 'personal-agent' },
  {
    path: '/settings',
    label: 'Configurações',
    icon: Settings,
    group: 'Configurações',
    description: 'Aparência e informações do aplicativo.',
  },
];

export function visibleRoutes(installed: readonly { manifest: { id: string }; state: string }[]): readonly AppRoute[] {
  const enabled = new Set(installed.filter((item) => item.state === 'enabled').map((item) => item.manifest.id));
  return ROUTES.filter((route) => !route.extensionId || enabled.has(route.extensionId));
}

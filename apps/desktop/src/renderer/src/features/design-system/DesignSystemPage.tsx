import * as React from 'react';
import { Boxes, RotateCcw, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/FeedbackState';
import { ActivityList, Chip, DonutChart, GlassPanel, MeterBar, SectionLabel, StatCard, StatusDot } from '@/components/ui/glass';
import { formatCount, STATUS_TONE_TEXT } from '@/components/ui/glass-model';
import { Timeline } from '@/components/shell/Timeline';
import { taskEvents } from '@/components/shell/timeline-model';
import { ShellAside, ShellTimeline } from '@/app/shell-slots';
import { TYPE_LABEL } from '@/features/brain/labels';
import { formatWhen } from '@/features/brain/format';
import { contrastGrade, contrastRatio, isHexColor } from '@/lib/contrast';
import { SingularityMark } from '@/app/BrandMark';
import { NeuralBridgeMascot } from '@/features/companion/NeuralBridgeMascot';
import type { MascotState } from '@/features/companion/companion-state';

/** The reference sheet's expressions, mapped to the Companion's real states. */
const VOID_STATES: [MascotState, string][] = [
  ['idle', 'Neutro'], ['success', 'Feliz / Concluído'], ['running', 'Trabalhando'], ['thinking', 'Pensando'], ['waiting', 'Surpreso'],
  ['voiceListening', 'Ouvindo você'], ['speaking', 'Falando'], ['listening', 'Animado (música)'], ['error', 'Alerta'], ['resting', 'Dormindo'],
  ['degraded', 'Conexão degradada'], ['disconnected', 'Desconectado'],
];
import { cn } from '@/lib/utils';

/*
 * Lote 50.02 — Singularity design system preview. A review surface for the tokens and foundations, reached at
 * #/design-system and not listed in the navigation. Lote 50.03 replaced the sketches with the shared components and
 * real data from the local database; nothing on this page is sample data.
 */

const SURFACES = ['background', 'sidebar', 'card', 'popover', 'secondary', 'accent'];
const TEXT = ['foreground', 'muted-foreground', 'accent-foreground'];
const SIGNAL = ['primary', 'ring', 'destructive', 'warning', 'success', 'info', 'input'];
/** Decorative hairlines: WCAG asks 3:1 only of lines that identify a control, which is --input's job. */
const DECORATIVE = ['border'];
const IDENTITY = ['agent-claude', 'agent-codex', 'type-decision', 'type-code_pattern', 'type-project_context', 'type-bug_fix', 'type-learning', 'type-preference', 'type-documentation', 'type-execution_summary'];

function useTokens(names: string[]): Record<string, string> {
  const read = React.useCallback(() => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(`--${name}`).trim()]));
  }, [names]);
  const [values, setValues] = React.useState(read);
  React.useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const update = () => setValues(read());
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [read]);
  return values;
}

function Section({ label, title, children, description }: { label: string; title: string; description?: string; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className="space-y-4">
      <div>
        <p className="sg-label">{label}</p>
        <h2 id={id} className="sg-title mt-1 text-lg">{title}</h2>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Swatches({ names, against, decorative = false }: { names: string[]; against: string; decorative?: boolean }) {
  const values = useTokens(React.useMemo(() => [...names, against], [names, against]));
  const base = values[against] ?? '';
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
      {names.map((name) => {
        const value = values[name] ?? '';
        const ratio = isHexColor(value) && isHexColor(base) ? contrastRatio(value, base) : null;
        return (
          <li key={name} className="sg-glass overflow-hidden">
            <div className="h-12 border-b border-[var(--glass-border)]" style={{ background: `var(--${name})` }} aria-hidden="true" />
            <div className="space-y-0.5 p-2.5 text-xs">
              <p className="font-medium text-foreground">--{name}</p>
              <p className="font-mono text-muted-foreground">{value}</p>
              {decorative && <p className="text-muted-foreground">Linha decorativa, sem exigência de contraste</p>}
              {!decorative && ratio !== null && name !== against && (
                <p className="text-muted-foreground">
                  {ratio.toFixed(2)}:1 sobre {against} · <span className={cn(contrastGrade(ratio) === 'falha' ? 'text-destructive' : 'text-foreground')}>{contrastGrade(ratio)}</span>
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const TRACKING_OPTIONS = [
  { tracking: '0.18em', weight: 400, note: 'Compacto: mais legível em tamanhos pequenos, menos cinematográfico.' },
  { tracking: '0.32em', weight: 300, note: 'Recomendado: o espaçamento da referência, fino e elegante.' },
  { tracking: '0.46em', weight: 200, note: 'Amplo: dramático, só para a tela de abertura.' },
];

export function DesignSystemPage() {
  const [replay, setReplay] = React.useState(0);
  const overview = useQuery({ queryKey: ['design-system', 'brain-overview'], queryFn: () => window.neuralbridge.brain.overview(), retry: false });
  const tasks = useQuery({ queryKey: ['design-system', 'tasks-today'], queryFn: () => window.neuralbridge.tasks.list({ limit: 200 }), retry: false });
  const events = React.useMemo(() => taskEvents(tasks.data ?? []), [tasks.data]);
  const typeSegments = React.useMemo(() => (overview.data?.byType ?? []).map((entry) => ({ id: entry.type, label: TYPE_LABEL[entry.type], value: entry.count, color: `var(--type-${entry.type})` })), [overview.data]);

  return (
    <div className="sg-atmosphere min-h-full">
      <div className="mx-auto max-w-6xl space-y-12 px-6 py-8">
        <header className="flex flex-wrap items-center gap-5">
          <SingularityMark className="h-16 w-20" label="Singularity" />
          <div>
            <h1 className="sr-only">Design system Singularity</h1>
            <p className="sg-display text-3xl text-foreground" aria-hidden="true">Singularity</p>
            <p className="sg-display mt-1 text-[11px] text-muted-foreground" style={{ letterSpacing: '0.38em' }}>AI Orchestrator</p>
          </div>
          <div className="ml-auto max-w-sm text-sm text-muted-foreground">
            Design system Singularity (lotes 50.02 e 50.03). Troque o tema em Configurações para ver o claro e o
            "sistema". Todo número desta página vem do banco local.
          </div>
        </header>

        <hr className="sg-hairline" />

        <Section label="Identidade" title="Tipografia de marca" description="Inter é a fonte da interface. A voz Singularity é a própria Inter, fina, em caixa alta e com espaçamento largo, só em palavras curtas: logo, rótulos de seção e números de destaque.">
          <div className="grid gap-3 md:grid-cols-3">
            {TRACKING_OPTIONS.map((option) => (
              <div key={option.tracking} className={cn('sg-glass overflow-hidden p-5', option.tracking === '0.32em' && 'sg-glass--active')}>
                <p className="text-[clamp(1rem,1.55vw,1.5rem)] whitespace-nowrap uppercase text-foreground" style={{ letterSpacing: option.tracking, fontWeight: option.weight }}>Singularity</p>
                <p className="mt-3 font-mono text-xs text-muted-foreground">peso {option.weight} · tracking {option.tracking}</p>
                <p className="mt-1 text-xs text-muted-foreground">{option.note}</p>
              </div>
            ))}
          </div>
          <div className="sg-glass space-y-3 p-6">
            <p className="sg-label">Memórias</p>
            <p className="text-[32px] leading-tight font-light text-foreground">Galáxia de Memórias</p>
            <p className="text-2xl font-normal text-foreground">Título de página · 24/400</p>
            <p className="text-lg font-medium text-foreground">Título de seção · 18/500</p>
            <p className="text-sm text-foreground">Corpo · 14/400. Seu conhecimento em um universo vivo. Cada estrela é uma memória, organizada por contexto, projeto e relevância.</p>
            <p className="text-xs text-muted-foreground">Apoio · 12/400 · há 12 min</p>
            <p className="text-[40px] font-extralight tracking-tight text-foreground tabular-nums">0123456789</p>
            <p className="font-mono text-xs text-muted-foreground">IBM Plex Mono · código e IDs</p>
          </div>
        </Section>

        <Section label="Cores" title="Superfícies, texto e sinal" description="Contraste calculado ao vivo contra o fundo do tema atual. Texto precisa de 4,5:1; bordas, foco e marcas precisam de 3:1.">
          <h3 className="sg-label">Superfícies</h3>
          <Swatches names={SURFACES} against="foreground" />
          <h3 className="sg-label">Texto</h3>
          <Swatches names={TEXT} against="background" />
          <h3 className="sg-label">Sinal e linhas</h3>
          <Swatches names={SIGNAL} against="background" />
          <Swatches names={DECORATIVE} against="background" decorative />
          <h3 className="sg-label">Identidade de agentes e tipos de memória</h3>
          <Swatches names={IDENTITY} against="card" />
        </Section>

        <Section label="Profundidade" title="Vidro preto, borda fina e luz dourada" description="Três níveis: painel, painel forte e painel ativo. A luz fica sob o conteúdo e nunca atrás de texto corrido.">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="sg-glass sg-glass--interactive p-5">
              <p className="sg-label">Painel</p>
              <p className="mt-2 text-sm">Vidro translúcido, borda dourada a 16% e realce superior. Passe o mouse.</p>
            </div>
            <div className="sg-glass sg-glass--strong p-5">
              <p className="sg-label">Painel forte</p>
              <p className="mt-2 text-sm">Para popovers e cards sobre a Galáxia.</p>
            </div>
            <div className="sg-glass sg-glass--active p-5">
              <p className="sg-label">Ativo</p>
              <p className="mt-2 text-sm">Seleção e foco de contexto, com brilho médio.</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {[1, 2, 3].map((level) => (
              <div key={level} className="rounded-lg bg-card p-4 text-sm" style={{ boxShadow: `var(--elevation-${level})` }}>
                Elevação {level}
              </div>
            ))}
          </div>
        </Section>

        <Section label="Componentes" title="Componentes compartilhados com dados reais" description="Componentes do lote 50.03 em components/ui/glass.tsx, alimentados pelo banco local. O painel à direita e a linha do tempo abaixo usam os slots do shell. Sem medição real, o componente diz que o dado está indisponível.">
          <div className="grid gap-4 lg:grid-cols-2">
            <GlassPanel className="space-y-4 p-5">
              <SectionLabel>Botões e campos atuais</SectionLabel>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nome do projeto" htmlFor="ds-name"><Input id="ds-name" placeholder="Ex.: Portal de Profissionais" /></Field>
                <Field label="Agente" htmlFor="ds-agent" hint="Campo nativo com os tokens novos."><Select id="ds-agent" defaultValue="claude"><option value="claude">Claude Code</option><option value="codex">Codex CLI</option></Select></Field>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button>Primário</Button>
                <Button variant="secondary">Secundário</Button>
                <Button variant="outline">Contorno</Button>
                <Button variant="ghost">Fantasma</Button>
                <Button variant="link">Link</Button>
                <Button variant="destructive">Remover</Button>
                <Button disabled>Desativado</Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Chip selected>Selecionado</Chip>
                <Chip>Projeto</Chip>
                <Chip>Tag</Chip>
              </div>
            </GlassPanel>
            <GlassPanel className="space-y-4 p-5">
              <SectionLabel>Medidores de hardware</SectionLabel>
              <p className="text-sm text-muted-foreground">A coleta real de CPU, memória e disco chega no lote 50.08. Até lá o medidor mostra o estado indisponível, sem número.</p>
              <MeterBar label="CPU" value={null} />
              <MeterBar label="Memória" value={null} />
              <MeterBar label="Disco (RAG)" value={null} />
              <SectionLabel className="pt-2">Estados de status</SectionLabel>
              <ul className="grid grid-cols-2 gap-2 text-sm">
                {(['ok', 'warning', 'error', 'unknown'] as const).map((tone) => (
                  <li key={tone} className="flex items-center gap-2"><StatusDot tone={tone} />{STATUS_TONE_TEXT[tone]}</li>
                ))}
              </ul>
            </GlassPanel>
          </div>
          <GlassPanel className="p-5">
            <SectionLabel>Distribuição por tipo de memória</SectionLabel>
            <div className="mt-3">
              {overview.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : overview.isError ? <p className="text-sm text-muted-foreground">Banco indisponível: sem dados para distribuir.</p> : (
                <DonutChart title="Memórias por tipo" centerLabel={formatCount(overview.data?.total ?? null, 'compact')} centerCaption="memórias" segments={typeSegments} />
              )}
            </div>
          </GlassPanel>
        </Section>

        <ShellAside title="Painel de memórias">
          <StatCard label="Memórias no banco local" value={overview.data?.total ?? null} caption={overview.data ? `${formatCount(overview.data.embeddings.indexed)} com embedding` : undefined} unavailableReason={overview.isError ? 'banco indisponível' : 'carregando'} icon={<Boxes />} />
          <GlassPanel className="p-4">
            <p className="text-sm text-foreground">Atividade recente</p>
            <ActivityList className="mt-3" empty="Nenhuma memória registrada ainda." items={(overview.data?.recent ?? []).slice(0, 5).map((memory) => ({ id: memory.id, label: memory.title, when: formatWhen(memory.updatedAt), icon: <Sparkles /> }))} />
          </GlassPanel>
          <GlassPanel asChild interactive>
            <Link to="/memory/new" className="flex w-full items-center justify-center gap-2 px-4 py-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              <Sparkles className="size-4 text-primary" aria-hidden="true" />Adicionar memória
            </Link>
          </GlassPanel>
        </ShellAside>
        <ShellTimeline>
          <Timeline events={events} title="Tarefas de hoje" />
        </ShellTimeline>

        <Section label="Mascote" title="Void, o companion do Singularity" description="Um pequeno buraco negro com disco de acreção dourado e rosto luminoso. Cada expressão corresponde a um estado real do Companion HUD.">
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
            {VOID_STATES.map(([state, label]) => (
              <li key={state} className="sg-glass flex flex-col items-center gap-2 p-3">
                <div className="h-24 w-28"><NeuralBridgeMascot state={state} active={false} /></div>
                <span className="text-xs text-foreground">{label}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section label="Estados" title="Vazio, carregando e erro" description="Componentes de feedback existentes, agora com os tokens Singularity.">
          <div className="grid gap-4 md:grid-cols-3">
            <EmptyState title="Nenhuma memória ainda" description="As memórias aparecem aqui quando os agentes aprendem algo." />
            <LoadingState title="Indexando documentos" description="Isso pode levar alguns minutos." />
            <ErrorState title="RAG indisponível" description="O índice não respondeu. Tente de novo." action={{ label: 'Tentar de novo', onClick: () => undefined, variant: 'outline' }} />
          </div>
        </Section>

        <Section label="Movimento" title="Fluido e discreto" description="Entradas de 420 ms com desaceleração suave e hover de 220 ms. Sem quique e sem brilho pulsante. Com movimento reduzido, tudo é instantâneo.">
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="outline" onClick={() => setReplay((value) => value + 1)}><RotateCcw />Repetir entrada</Button>
            <div className="flex gap-3" key={replay}>
              {[0, 1, 2].map((index) => (
                <div key={index} className="sg-glass sg-enter size-20" style={{ animationDelay: `${index * 70}ms` }} aria-hidden="true" />
              ))}
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

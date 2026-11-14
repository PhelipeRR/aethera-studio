import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Aperture, Box, Cpu, FileText, Film, Folder, Import, Info, Lightbulb, MonitorPlay, Pencil, Plus, Search } from 'lucide-react';
import { AetheraFlow } from './AetheraFlow';
import { AetheraStart } from './AetheraStart';
import { AetheraSignature } from '@/app/AetheraMark';
import eclipseHorizon from '@/assets/aethera/eclipse-horizon.webp';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';
import { useStartTask } from '@/features/tasks/api';
import { CapturePanel } from './CapturePanel';
import { limitsKey, VelixLimits } from './VelixLimits';
import { VelixStudio } from './VelixStudio';
import { VelixDiscovery } from './VelixDiscovery';
import { VelixIdeas } from './VelixIdeas';
import { VelixMotion } from './VelixMotion';
import { VelixChannel } from './VelixChannel';
import { AetheraChannelCalendar } from './AetheraChannelCalendar';
import { VelixProduction } from './VelixProduction';
import { StyleGallery, useVideoStyles } from './StyleGallery';
import { DEFAULT_STYLE_CHOICE } from '@neuralbridge/shared/video-styles';
import { EXTRAS, NARRATION_EXTRA, NICHES, OPTIONS, VIDEO_KINDS, velixBrief, velixPrompt, velixSeconds, type Field, type VideoKind } from './brief';

const REFERENCE_KINDS = { texto: 'Texto', dado: 'Dado', imagem: 'Imagem', fonte: 'Fonte tipográfica' } as const;
const LABELS: Record<Field, string> = { caminho: 'O que vamos fazer?', formato: 'Formato', vibe: 'Estilo', duracao: 'Duração' };
const INPUT = 'mt-1.5 w-full rounded-md border bg-background px-3 py-2 text-sm font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const chip = (active: boolean) => `relative cursor-pointer rounded-full border px-4 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-within:ring-2 focus-within:ring-ring ${active ? 'border-primary/80 bg-primary/10 text-foreground' : 'border-[var(--glass-border-strong)] text-foreground/85 hover:bg-accent hover:text-foreground'}`;
// R6: the two kinds of video as large choices with an icon, as in the reference.
const KIND_ICON = { tema: FileText, projeto: Folder } as const;

function ChoiceGroup({ field, value, onChange }: { field: Field; value: string; onChange: (value: string) => void }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{LABELS[field]}</legend>
      <div className="flex flex-wrap gap-2">
        {OPTIONS[field].map((option) => (
          <label key={option} className={chip(value === option)}>
            <input type="radio" className="sr-only" name={field} value={option} checked={value === option} onChange={() => onChange(option)} />
            {option}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function FormGroup({ title, hideTitle = false, children }: { title: string; hideTitle?: boolean; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-4 border-t border-[var(--glass-border)] pt-5 first:border-t-0 first:pt-0">
      <h3 className={hideTitle ? 'sr-only' : 'text-base font-medium'}>{title}</h3>
      {children}
    </section>
  );
}

function Missing({ items }: { items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="text-sm">
      <p className="font-medium">Para continuar:</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </div>
  );
}

type VideoSettings = { projectId: string | null; rootPath: string | null };

function VideoProject({ settings }: { settings: VideoSettings | undefined }) {
  const client = useQueryClient();
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => window.neuralbridge.projects.list() });
  const save = useMutation({ mutationFn: (projectId: string) => window.neuralbridge.video.saveSettings(projectId || null), onSuccess: (next) => client.setQueryData(['video-settings'], next) });
  return (
    <section aria-label="Projeto Video" className="sg-panel w-full min-w-0 rounded-xl p-2.5 sm:w-64">
      <label className="block text-sm font-medium">
        Projeto Video
        <select aria-label="Projeto Video" className={INPUT} value={settings?.projectId ?? ''} onChange={(event) => save.mutate(event.target.value)}>
          <option value="">Escolha um projeto</option>
          {projects.data?.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </label>
      <p className="mt-1.5 truncate text-xs text-muted-foreground" title={settings?.rootPath ?? undefined}>
        {settings?.rootPath ?? <>Guarda os materiais e os renders. Se ainda não existe, crie em <Link to="/projects" className="underline underline-offset-4">Projetos</Link>.</>}
      </p>
      {save.isError && <p role="alert" className="mt-2 text-sm text-destructive">{errorMessage(save.error)}</p>}
    </section>
  );
}

function ChatBrief({ instruction, settings, blocked, onCreated }: { instruction: string; settings: VideoSettings | undefined; blocked: string | null; onCreated: (video: string) => void }) {
  const navigate = useNavigate();
  const start = useStartTask();
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => window.neuralbridge.projects.list() });
  const skills = useQuery({ queryKey: ['skills'], queryFn: () => window.neuralbridge.skills.list() });
  const [choices, setChoices] = useState<Record<Field, string>>({ caminho: OPTIONS.caminho[1], formato: OPTIONS.formato[0], vibe: 'Me surpreenda', duracao: 'Você decide' });
  const [idea, setIdea] = useState(instruction);
  const [audience, setAudience] = useState('');
  const [extras, setExtras] = useState<string[]>([]);
  const [cta, setCta] = useState('');
  const [kind, setKind] = useState<VideoKind>('tema');
  const [name, setName] = useState('');
  const nameInput = useRef<HTMLInputElement>(null);
  const [targetId, setTargetId] = useState('');
  const [niche, setNiche] = useState('');
  const [approved, setApproved] = useState<string[]>([]);
  const [printCount, setPrintCount] = useState(0);
  const [printsReviewed, setPrintsReviewed] = useState(false);
  const research = useMutation({ mutationFn: () => window.neuralbridge.video.research([niche.trim(), idea.trim()].filter(Boolean).join(': ')), onSuccess: () => setApproved([]) });
  const topics = useMutation({ mutationFn: () => window.neuralbridge.video.topics(niche.trim()) });
  const [problem, setProblem] = useState<string | null>(null);
  const styles = useVideoStyles();
  const [styleId, setStyleId] = useState(DEFAULT_STYLE_CHOICE.styleId);
  const style = styles.data?.find((item) => item.id === styleId);
  const [compactSheet, setCompactSheet] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(true);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 895px)');
    const update = () => {
      const compact = media.matches;
      setCompactSheet(compact);
      setSheetOpen(!compact);
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const targets = projects.data?.filter((project) => project.id !== settings?.projectId) ?? [];
  const target = kind === 'projeto' ? targets.find((project) => project.id === targetId) : undefined;
  const videoName = name.trim() || target?.name || '';
  const chosenNiche = kind === 'tema' ? niche.trim() : '';
  const changeNiche = (value: string) => { setNiche(value); topics.reset(); };
  const pickTopic = (topic: string) => { setIdea(topic); setName((current) => current || topic); };
  const missing = [
    !settings?.rootPath && 'Escolha o projeto Video',
    kind === 'projeto' && !target && 'Escolha o projeto do vídeo',
    !videoName && 'Dê um nome ao vídeo',
    !idea.trim() && 'Conte sua ideia',
    blocked,
    kind === 'projeto' && printCount > 0 && !printsReviewed && 'Revise os prints capturados',
  ].filter((item) => typeof item === 'string');

  const fromScratch = choices.caminho === OPTIONS.caminho[1];
  const generate = useMutation({
    mutationFn: async () => {
      const items = research.data?.filter((item) => approved.includes(item.url)) ?? [];
      if (items.length > 0) await window.neuralbridge.video.saveResearch({ name: videoName, kind, items });
      const brief = velixBrief({ choices, idea, audience, extras, cta, ...(chosenNiche ? { niche: chosenNiche } : {}), ...(target ? { target: { name: target.name, rootPath: target.rootPath } } : {}) });
      const state = await window.neuralbridge.video.studioGenerate({ name: videoName, kind, brief, seconds: velixSeconds(choices.duracao) });
      // The style travels with the new video: the Estúdio previews and renders it from the start.
      if (settings?.projectId && style) await window.neuralbridge.video.styleSave({ projectId: settings.projectId, video: state.folder, choice: { ...DEFAULT_STYLE_CHOICE, styleId: style.id, styleVersion: style.version } });
      return state;
    },
    onSuccess: (state) => onCreated(state.folder),
  });

  const begin = async () => {
    setProblem(null);
    if (!settings?.projectId) return;
    if (fromScratch) return void generate.mutate();
    const skill = skills.data?.find((item) => item.valid && item.name.toLocaleLowerCase() === 'motionvelix');
    if (!skill) return setProblem('A skill motionvelix não foi encontrada. Confira a instalação em Skills.');
    const preference = (await window.neuralbridge.skills.settings()).preferences.find((item) => item.skillId === skill.id);
    if (!preference?.enabled) return setProblem('A skill motionvelix está desabilitada. Habilite-a em Skills antes de continuar.');
    const items = research.data?.filter((item) => approved.includes(item.url)) ?? [];
    const { folder } = items.length > 0 ? await window.neuralbridge.video.saveResearch({ name: videoName, kind, items }) : await window.neuralbridge.video.prepare({ name: videoName, kind });
    const { id } = await start.mutateAsync({ prompt: velixPrompt({ choices, idea, audience, extras, cta, folder, ...(target ? { target: { name: target.name, rootPath: target.rootPath } } : {}), ...(chosenNiche ? { niche: chosenNiche } : {}), ...(items.length > 0 ? { references: true } : {}) }), projectId: settings.projectId, mode: 'claude', model: null, skillIds: [skill.id] });
    void navigate(`/chat?thread=${id}`);
  };

  const sheet: Array<[string, string]> = [
    ['Tipo', VIDEO_KINDS.find((item) => item.id === kind)?.label ?? ''],
    ...(target ? [['Projeto', target.name] as [string, string]] : []),
    ...(chosenNiche ? [['Nicho', chosenNiche] as [string, string]] : []),
    ['Formato', fromScratch ? (style?.label ?? 'Dossiê com dados') : choices.formato],
    ['Estilo', choices.vibe],
    ['Duração', choices.duracao],
    ['Extras', extras.length > 0 ? extras.join(', ') : 'Nenhum'],
    ['Referências', String(approved.length)],
  ];

  return (
    <div className="@container">
    <div className="grid items-start gap-6 @4xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section aria-label="Novo vídeo com o Aethera" className="sg-panel min-w-0 space-y-6 rounded-2xl p-5 sm:p-7">
        <h2 className="flex items-center gap-3 text-lg font-medium"><Film className="size-5 text-primary" strokeWidth={1.6} aria-hidden="true" />Novo vídeo</h2>
        <FormGroup title="Sobre o vídeo" hideTitle>
          <fieldset className="space-y-2.5">
            <legend className="mb-2.5 text-sm font-medium">Tipo de vídeo</legend>
            <div className="flex flex-wrap gap-3">
              {VIDEO_KINDS.map((item) => {
                const KindIcon = KIND_ICON[item.id];
                const active = kind === item.id;
                return (
                  <label key={item.id} className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-5 py-2.5 text-sm transition-colors focus-within:ring-2 focus-within:ring-ring ${active ? 'border-primary/80 bg-primary/10 font-medium text-foreground shadow-[var(--glow-soft)]' : 'border-[var(--glass-border-strong)] text-foreground/85 hover:bg-accent'}`}>
                    <input type="radio" className="sr-only" name="tipo" value={item.id} checked={active} onChange={() => setKind(item.id)} />
                    <KindIcon className="size-4 text-primary" strokeWidth={1.6} aria-hidden="true" />
                    {item.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
          {kind === 'projeto' && (
            <label className="block text-sm font-medium">
              Projeto do vídeo
              <select aria-label="Projeto do vídeo" className={INPUT} value={targetId} onChange={(event) => setTargetId(event.target.value)}>
                <option value="">Escolha um projeto</option>
                {targets.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
              <span className="mt-1.5 block text-xs font-normal text-muted-foreground">O projeto escolhido não é alterado.</span>
            </label>
          )}
          {kind === 'tema' && (
            <div className="space-y-3">
              <label className="block text-sm font-medium">
                Nicho
                <span className="relative mt-1.5 block">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <input aria-label="Nicho" className={`${INPUT} mt-0 rounded-lg py-2.5 pl-10`} value={niche} onChange={(event) => changeNiche(event.target.value)} placeholder="Escreva o seu ou escolha abaixo..." />
                </span>
              </label>
              <div className="flex flex-wrap gap-2.5">
                {NICHES.map((item) => <button key={item} type="button" aria-pressed={niche === item} className={chip(niche === item)} onClick={() => changeNiche(item)}>{item}</button>)}
                <button type="button" className={`${chip(false)} inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50`} onClick={() => topics.mutate()} disabled={!settings?.rootPath || !niche.trim() || topics.isPending || !!blocked}><Plus className="size-4" aria-hidden="true" />{topics.isPending ? 'Sugerindo temas…' : 'Sugerir temas'}</button>
              </div>
              {!settings?.rootPath && <p className="text-sm text-muted-foreground">Escolha o projeto Video no topo da página para sugerir temas.</p>}
              {topics.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(topics.error)}</p>}
              {topics.data && (
                <ul aria-label="Temas sugeridos" className="space-y-1.5">
                  {topics.data.map((topic) => <li key={topic}><button type="button" aria-pressed={idea === topic} className={`${chip(idea === topic)} w-full text-left`} onClick={() => pickTopic(topic)}>{topic}</button></li>)}
                </ul>
              )}
            </div>
          )}
          <label className="block text-sm font-medium">
            Nome do vídeo
            <input ref={nameInput} aria-label="Nome do vídeo" className={INPUT} value={name} onChange={(event) => setName(event.target.value)} placeholder={target?.name ?? 'Ex.: 5 erros de quem começa a investir'} />
          </label>
          {target && videoName && <CapturePanel blocked={!!blocked} targetId={target.id} videoName={videoName} reviewed={printsReviewed} onReviewed={setPrintsReviewed} onPrints={setPrintCount} />}
          <label className="block text-sm font-medium">
            Sua ideia
            <textarea aria-label="Sua ideia" className={`${INPUT} min-h-28`} value={idea} onChange={(event) => setIdea(event.target.value)} placeholder="Ex.: um anúncio de 30 s do meu app, com estes 3 prints" />
          </label>
          <div className="space-y-3">
            <Button variant="outline" onClick={() => research.mutate()} disabled={!settings?.rootPath || !idea.trim() || research.isPending || !!blocked}>{research.isPending ? 'Pesquisando na web…' : 'Pesquisar referências'}</Button>
            {!settings?.rootPath && <p className="text-sm text-muted-foreground">Escolha o projeto Video no topo da página para pesquisar.</p>}
            <p className="text-xs text-muted-foreground">O Claude busca textos, dados, imagens e fontes, sem acesso aos seus arquivos. Só o que você marcar vai para o vídeo. Confira as licenças antes de publicar.</p>
            {research.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(research.error)}</p>}
            {research.data && (
              <ul aria-label="Referências encontradas" className="divide-y rounded-md border">
                {research.data.map((item) => (
                  <li key={item.url}>
                    <label className="flex cursor-pointer items-start gap-3 p-3 text-sm hover:bg-accent">
                      <input type="checkbox" className="mt-0.5" checked={approved.includes(item.url)} onChange={(event) => setApproved((current) => event.target.checked ? [...current, item.url] : current.filter((url) => url !== item.url))} />
                      <span className="min-w-0">
                        <span className="block font-medium">{item.title}</span>
                        {item.note && <span className="block text-muted-foreground">{item.note}</span>}
                        <span className="mt-1 block break-all text-xs text-muted-foreground">{REFERENCE_KINDS[item.kind]}. Licença: {item.license}. {item.url}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </FormGroup>
        {fromScratch && styles.data && <FormGroup title="Estilo do vídeo">
          <StyleGallery styles={styles.data} value={styleId} onChange={setStyleId} recommendText={[chosenNiche, idea].join(' ')} />
          <p className="text-xs text-muted-foreground">Dá para trocar depois no Estúdio, sem refazer o roteiro.</p>
        </FormGroup>}
        <FormGroup title="Direção">
          {(Object.keys(OPTIONS) as Field[]).filter((field) => field !== 'formato' || !fromScratch).map((field) => <ChoiceGroup key={field} field={field} value={choices[field]} onChange={(value) => setChoices((current) => ({ ...current, [field]: value }))} />)}
        </FormGroup>
        <FormGroup title="Detalhes opcionais">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium">
              Para quem é
              <input aria-label="Para quem é" className={INPUT} value={audience} onChange={(event) => setAudience(event.target.value)} placeholder="Ex.: quem está começando a investir" />
            </label>
            <label className="block text-sm font-medium">
              Como termina
              <input aria-label="Como termina" className={INPUT} value={cta} onChange={(event) => setCta(event.target.value)} placeholder="Ex.: comenta GUIA" />
            </label>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Extras</legend>
            <div className="flex flex-wrap gap-2">
              {EXTRAS.map((extra) => (
                <label key={extra} className={chip(extras.includes(extra))}>
                  <input type="checkbox" className="sr-only" checked={extras.includes(extra)} onChange={(event) => setExtras((current) => event.target.checked ? [...current, extra] : current.filter((item) => item !== extra))} />
                  {extra}
                </label>
              ))}
            </div>
          </fieldset>
        </FormGroup>
      </section>
      <button type="button" aria-label={sheetOpen ? 'Ocultar ficha do vídeo' : 'Mostrar ficha do vídeo'} aria-expanded={compactSheet ? sheetOpen : true} className="flex items-center justify-between rounded-xl border border-[var(--glass-border-strong)] px-4 py-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring @4xl:hidden" onClick={() => setSheetOpen((open) => !open)}>
        <span className="flex items-center gap-2.5"><Info className="size-4 text-primary" strokeWidth={1.6} aria-hidden="true" />Ficha do vídeo</span>
        <span aria-hidden="true" className="text-primary">{sheetOpen ? '−' : '+'}</span>
      </button>
      <aside aria-label="Ficha do vídeo" className={`${compactSheet && !sheetOpen ? 'hidden' : ''} space-y-5 sg-panel rounded-2xl p-5 sm:p-6 @4xl:sticky @4xl:top-6`}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2.5 text-[15px] font-medium"><Info className="size-5 text-primary" strokeWidth={1.6} aria-hidden="true" />Ficha do vídeo</h3>
          <button type="button" aria-label="Editar nome do vídeo" title="Editar nome do vídeo" className="grid size-8 place-items-center rounded-md text-primary transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { nameInput.current?.focus(); nameInput.current?.scrollIntoView({ block: 'center' }); }}><Pencil className="size-4" aria-hidden="true" /></button>
        </div>
        <dl className="space-y-3 text-sm">
          {[['Nome', videoName || 'Sem nome'] as [string, string], ...sheet].map(([label, value]) => <div key={label} className="flex justify-between gap-4"><dt className="shrink-0 text-muted-foreground">{label}</dt><dd className="min-w-0 break-words text-right font-medium text-foreground">{value}</dd></div>)}
        </dl>
        {extras.includes(NARRATION_EXTRA) && <p className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">O Aethera prepara o texto em <code>narracao/elevenlabs.txt</code> e para. Gere o áudio no ElevenLabs, salve como <code>narracao/voz.mp3</code> na pasta do vídeo e avise no Chat.</p>}
        <Missing items={missing} />
        <Button className="w-full" onClick={() => void begin().catch((error: unknown) => setProblem(errorMessage(error)))} disabled={missing.length > 0 || start.isPending || generate.isPending}>{generate.isPending ? 'Escrevendo o roteiro…' : start.isPending ? 'Iniciando…' : fromScratch ? 'Gerar roteiro' : 'Começar com o Aethera'}</Button>
        {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
        {generate.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(generate.error)}</p>}
        <p className="text-xs text-muted-foreground">{fromScratch ? 'O roteiro e as cenas abrem no Estúdio, aqui nesta página.' : 'A edição dos seus takes continua no Chat.'} O Aethera roda node, python e ffmpeg: libere esses comandos no acesso do projeto Video em <Link to="/projects" className="underline underline-offset-4">Projetos</Link>, com a skill motionvelix habilitada em <Link to="/skills" className="underline underline-offset-4">Skills</Link>.</p>
      </aside>
    </div>
    </div>
  );
}

const QUALITIES = [['1080', '1080p'], ['720', '720p'], ['480', '480p'], ['360', '360p'], ['mp3', 'Só áudio (MP3)']] as const;

function ImportVideo({ root, version }: { root: string; version: string | null }) {
  const [url, setUrl] = useState('');
  const [quality, setQuality] = useState('1080');
  const [confirmed, setConfirmed] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const start = useMutation({ mutationFn: () => window.neuralbridge.video.importVideo({ root, url: url.trim(), quality: quality === 'mp3' ? 'mp3' : Number(quality) as 1080 | 720 | 480 | 360, confirmed: true }), onSuccess: (job) => { setJobId(job.id); setConfirmed(false); } });
  const status = useQuery({ queryKey: ['velix-import', jobId], queryFn: () => window.neuralbridge.video.renderStatus(jobId ?? ''), enabled: !!jobId, refetchInterval: (query) => query.state.data?.status === 'running' ? 500 : false });
  const cancel = useMutation({ mutationFn: () => window.neuralbridge.video.renderCancel(jobId ?? ''), onSuccess: () => void status.refetch() });
  const running = status.data?.status === 'running';
  const missing = [
    !root.trim() && 'Escolha o projeto Video no topo da página',
    !url.trim() && 'Cole o link do vídeo',
    !confirmed && 'Confirme que você pode usar este vídeo',
  ].filter((item) => typeof item === 'string');

  if (!version) {
    return (
      <section aria-label="Importar vídeo" className="max-w-3xl rounded-lg border border-warning/40 bg-card p-5 text-sm">
        <h2 className="text-lg font-medium">O yt-dlp não foi encontrado</h2>
        <p className="mt-2 text-muted-foreground">Instale com <code>python -m pip install --user "yt-dlp[default]"</code> e reabra esta página. Se os downloads começarem a falhar, atualize com <code>-U</code>.</p>
      </section>
    );
  }
  return (
    <section aria-label="Importar vídeo" className="max-w-3xl space-y-4">
      <p className="text-sm text-muted-foreground">Baixa um vídeo para a pasta <code>imports</code> do projeto Video, pronto para editar. yt-dlp {version}.</p>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
        <label className="block text-sm font-medium">Link do vídeo<input aria-label="Link do vídeo" type="url" className={INPUT} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" /></label>
        <label className="block text-sm font-medium">Qualidade do download<select aria-label="Qualidade do download" className={INPUT} value={quality} onChange={(event) => setQuality(event.target.value)}>{QUALITIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        <span>Este vídeo é meu, tem licença livre ou tenho autorização do autor. O uso é de minha responsabilidade, e os termos do YouTube restringem downloads fora do app oficial.</span>
      </label>
      <Missing items={missing} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => start.mutate()} disabled={missing.length > 0 || running || start.isPending}>Importar</Button>
        {running && <Button variant="outline" onClick={() => cancel.mutate()}>Cancelar importação</Button>}
      </div>
      {start.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(start.error)}</p>}
      {status.data && <p className="rounded-md border p-3 text-sm">Importação: {status.data.status}{status.data.progress !== null && running ? ` · ${Math.round(status.data.progress * 100)}%` : ''}{status.data.status === 'completed' && status.data.output ? ` · ${status.data.output}` : ''}{status.data.error ? ` · ${status.data.error}` : ''}</p>}
    </section>
  );
}

function DirectRender({ origin, agent, root }: { origin: 'studio' | 'chat'; agent: 'auto' | 'claude' | 'codex'; root: string }) {
  const kit = useQuery({ queryKey: ['velix-kit'], queryFn: () => window.neuralbridge.video.kit() });
  const templates = kit.data?.templates ?? [];
  const [chosen, setChosen] = useState<string | null>(null);
  const [edited, setEdited] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState('renders/velix.mp4');
  const [audioPath, setAudioPath] = useState('');
  const [quality, setQuality] = useState<'draft' | 'final'>('final');
  const [renderId, setRenderId] = useState<string | null>(null);

  const current = templates.find((item) => item.id === chosen) ?? templates[0];
  const templateId = current?.id ?? '';
  const data = edited ?? current?.defaultData ?? '{}';
  const select = (id: string) => { setChosen(id); setEdited(null); };

  const frames = useMutation({ mutationFn: () => window.neuralbridge.video.frames(root, templateId, data) });
  const render = useMutation({ mutationFn: () => window.neuralbridge.video.render({ root, outputPath, template: templateId, data, quality, origin, agent, ...(audioPath.trim() ? { audioPath: audioPath.trim() } : {}) }), onSuccess: (job) => setRenderId(job.id) });
  const status = useQuery({ queryKey: ['velix-render', renderId], queryFn: () => window.neuralbridge.video.renderStatus(renderId ?? ''), enabled: !!renderId, refetchInterval: (query) => query.state.data?.status === 'running' ? 500 : false });
  const video = useQuery({ queryKey: ['velix-output', renderId], queryFn: () => window.neuralbridge.video.preview(root, outputPath), enabled: status.data?.status === 'completed', retry: false });
  const cancel = useMutation({ mutationFn: () => window.neuralbridge.video.renderCancel(renderId ?? ''), onSuccess: () => void status.refetch() });
  const jobs = useQuery({ queryKey: ['velix-jobs', status.data?.status], queryFn: () => window.neuralbridge.video.renderJobs() });

  if (kit.data && !kit.data.installed) {
    return (
      <section aria-label="MotionVelix não instalado" className="max-w-3xl rounded-lg border border-warning/40 bg-card p-5 text-sm">
        <h2 className="text-lg font-medium">MotionVelix não instalado</h2>
        <p className="mt-2 text-muted-foreground">Copie a pasta motionvelix do kit para <code>{kit.data.path}</code> e rode <code>scripts/setup.py</code>. O kit fica fora do Singularity: cada pessoa instala o seu.</p>
      </section>
    );
  }

  const ready = !!root.trim() && !!templateId;
  const running = status.data?.status === 'running';
  return (
    <section aria-label="Render direto" className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        <p className="text-sm text-muted-foreground">Motion a partir de um modelo, sem agente. {kit.data?.version && `MotionVelix v${kit.data.version}.`}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">Modelo<select aria-label="Modelo" className={INPUT} value={templateId} onChange={(event) => select(event.target.value)}>{templates.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label className="block text-sm font-medium">Qualidade<select aria-label="Qualidade" className={INPUT} value={quality} onChange={(event) => setQuality(event.target.value as 'draft' | 'final')}><option value="final">Final, com motion blur</option><option value="draft">Rascunho rápido</option></select></label>
          <label className="block text-sm font-medium">Arquivo de saída<input aria-label="Arquivo de saída" className={INPUT} value={outputPath} onChange={(event) => setOutputPath(event.target.value)} /></label>
          <label className="block text-sm font-medium">Trilha ou narração (opcional)<input aria-label="Trilha ou narração" className={INPUT} value={audioPath} onChange={(event) => setAudioPath(event.target.value)} placeholder="audio/trilha.mp3" /></label>
        </div>
        <label className="block text-sm font-medium">Dados da cena (JSON)<textarea aria-label="Dados da cena" className={`${INPUT} min-h-72 font-mono text-xs`} value={data} onChange={(event) => setEdited(event.target.value)} /></label>
        {frames.data && <div data-testid="velix-frames" className="grid grid-cols-3 gap-2">{frames.data.map((frame, index) => <img key={index} src={frame} alt={`Prévia ${index + 1} da cena`} className="w-full rounded-md border bg-black" />)}</div>}
        {video.data && <video data-testid="velix-output" className="mx-auto max-h-[480px] rounded-md border bg-black" controls src={video.data} />}
      </div>
      <aside aria-label="Saída do render" className="space-y-4 sg-panel rounded-lg p-5 lg:sticky lg:top-6">
        {!root.trim() && <Missing items={['Escolha o projeto Video no topo da página']} />}
        <div className="flex flex-col gap-2">
          <Button onClick={() => render.mutate()} disabled={!ready || running || render.isPending}>Renderizar MP4</Button>
          <Button variant="outline" onClick={() => frames.mutate()} disabled={!ready || frames.isPending}>{frames.isPending ? 'Gerando prévia…' : 'Gerar prévia'}</Button>
          {running && <Button variant="outline" onClick={() => cancel.mutate()}>Cancelar renderização</Button>}
        </div>
        {frames.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(frames.error)}</p>}
        {render.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(render.error)}</p>}
        {status.data && <p className="rounded-md border p-3 text-sm">Renderização: {status.data.status}{status.data.progress !== null && running ? ` · ${Math.round(status.data.progress * 100)}%` : ''} · origem {status.data.origin} · agente {status.data.agent ?? 'auto'}{status.data.error ? ` · ${status.data.error}` : ''}</p>}
        <section aria-label="Jobs de renderização" className="space-y-1 border-t pt-4">
          <h3 className="text-sm font-medium">Renderizações</h3>
          {(jobs.data ?? []).map((job) => <p key={job.id} className="text-xs text-muted-foreground">{job.status} · {job.origin}{job.error ? ` · ${job.error}` : ''}</p>)}
          {jobs.data?.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma renderização ainda.</p>}
        </section>
      </aside>
    </section>
  );
}

// R4: the eight areas of the reference, with icons. "Novo vídeo" left the tab list: it is the main action of the
// "Comece uma produção" card, and its form ('criar') is still the page's default view (the Chat shortcut lands there).
const TABS = [
  { id: 'descobrir', label: 'Descobrir', Icon: Search },
  { id: 'ideias', label: 'Ideias', Icon: Lightbulb },
  { id: 'produzir', label: 'Produzir', Icon: Box },
  { id: 'estudio', label: 'Estúdio', Icon: Aperture },
  { id: 'motion', label: 'Motion', Icon: Film },
  { id: 'canal', label: 'Canal', Icon: MonitorPlay },
  { id: 'render', label: 'Render direto', Icon: Cpu },
  { id: 'importar', label: 'Importar vídeo', Icon: Import },
] as const;
type TabId = (typeof TABS)[number]['id'] | 'criar';

export function VelixPage() {
  const [params] = useSearchParams();
  const instruction = params.get('instruction') ?? '';
  const origin = params.get('origin') === 'chat' ? 'chat' : 'studio';
  const agent = params.get('agent') === 'claude' ? 'claude' : params.get('agent') === 'codex' ? 'codex' : 'auto';
  const settings = useQuery({ queryKey: ['video-settings'], queryFn: () => window.neuralbridge.video.settings() });
  const kit = useQuery({ queryKey: ['velix-kit'], queryFn: () => window.neuralbridge.video.kit() });
  // Claude's usage gates the steps that always use Claude (topics, research, capture, script); the card shows the selected agent's.
  const limits = useQuery({ queryKey: limitsKey('claude'), queryFn: () => window.neuralbridge.video.limits(false, 'claude'), staleTime: 60_000 });
  const [tab, setTab] = useState<TabId>('criar');
  const [video, setVideo] = useState('');
  const tabs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});
  const root = settings.data?.rootPath ?? '';
  const nav = useNavigate();
  const autoProduce = useMutation({
    mutationFn: (prompt: string) => {
      const projectId = settings.data?.projectId ?? 'default';
      return window.neuralbridge.video.aetheraAutoProduce({ projectId, prompt: prompt.trim() });
    },
    onSuccess: (next) => { void nav(`/aethera/productions/${next.run.id}`); },
  });

  // Opening a view from a card moves focus to it, so keyboard and screen-reader users land where the content changed.
  const open = (next: TabId) => {
    setTab(next);
    requestAnimationFrame(() => document.getElementById(`velix-panel-${next}`)?.focus({ preventScroll: false }));
  };

  const moveTab = (event: KeyboardEvent, index: number) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = TABS[(index + step + TABS.length) % TABS.length];
    if (!next) return;
    setTab(next.id);
    tabs.current[next.id]?.focus();
  };

  return (
    <main className="relative isolate min-h-full overflow-x-clip bg-background p-4 text-foreground sm:p-6">
      {/* R2: the reference's sky — a star field and the eclipsing planet on the right, behind the header and the flow. */}
      <div aria-hidden="true" className="aethera-sky pointer-events-none absolute inset-x-0 top-0 -z-10 h-64">
        <img src={eclipseHorizon} alt="" className="aethera-horizon absolute right-0 top-0 h-44 w-[min(80%,960px)] object-cover object-right" />
      </div>
      <div className="mx-auto max-w-[1440px]">
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-5 pt-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-3">
            <AetheraSignature />
            <p className="max-w-[17rem] text-[15px] leading-relaxed text-foreground/90 [text-shadow:0_1px_10px_rgb(1_3_4/0.9)] lg:border-l lg:border-[var(--glass-border-strong)] lg:pl-6">Produção audiovisual com inteligência artificial, do roteiro ao render final.</p>
          </div>
          <VideoProject settings={settings.data} />
        </header>
        <AetheraFlow projectId={settings.data?.projectId ?? null} tab={tab} onOpen={open} />
        <div className="@container mt-7">
          <div className="grid gap-5 @4xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <AetheraStart onNewVideo={() => open('criar')} onTemplate={() => open('motion')} onAutoProduce={(prompt) => autoProduce.mutate(prompt)} autoPending={autoProduce.isPending} />
            <VelixLimits />
          </div>
        </div>
        <div data-tour="velix-tabs" role="tablist" aria-label="Áreas do Aethera" className="mt-6 flex flex-wrap gap-1 sg-panel rounded-xl p-1.5">
          {TABS.map((item, index) => {
            const selected = tab === item.id;
            // With the new-video form open no tab is selected; the first one still takes the keyboard focus.
            const focusable = selected || (tab === 'criar' && index === 0);
            return (
              <button key={item.id} data-tour={item.id === 'produzir' ? 'velix-editorial' : item.id === 'render' ? 'velix-render' : undefined} ref={(element) => { tabs.current[item.id] = element; }} type="button" role="tab" id={`velix-tab-${item.id}`} aria-selected={selected} aria-controls={`velix-panel-${item.id}`} tabIndex={focusable ? 0 : -1} onClick={() => setTab(item.id)} onKeyDown={(event) => moveTab(event, index)} className={`flex shrink-0 items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'border-primary/70 bg-primary/10 font-medium text-foreground' : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'}`}>
                <item.Icon className={`size-4 ${selected ? 'text-primary' : ''}`} strokeWidth={1.6} aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
        </div>
        <section id="velix-panel-criar" aria-label="Criar novo vídeo" tabIndex={-1} hidden={tab !== 'criar'} className="mt-6 focus-visible:outline-none">
          {instruction && <p className="mb-5 max-w-3xl rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">Instrução recebida do Chat: <strong>{instruction}</strong></p>}
          <ChatBrief instruction={instruction} settings={settings.data} blocked={limits.data?.blocked ? limits.data.reason : null} onCreated={(name) => { setVideo(name); setTab('estudio'); }} />
        </section>
        <div role="tabpanel" id="velix-panel-descobrir" aria-labelledby="velix-tab-descobrir" hidden={tab !== 'descobrir'} className="mt-6">
          <VelixDiscovery projectId={settings.data?.projectId ?? null} />
        </div>
        <div role="tabpanel" id="velix-panel-motion" aria-labelledby="velix-tab-motion" tabIndex={-1} hidden={tab !== 'motion'} className="mt-6 focus-visible:outline-none">
          {tab === 'motion' && <VelixMotion projectId={settings.data?.projectId ?? null} />}
        </div>
        <div role="tabpanel" id="velix-panel-canal" aria-labelledby="velix-tab-canal" hidden={tab !== 'canal'} className="mt-6 space-y-6">
          {tab === 'canal' && (
            <>
              <AetheraChannelCalendar projectId={settings.data?.projectId ?? null} />
              <VelixChannel projectId={settings.data?.projectId ?? null} />
            </>
          )}
        </div>
        <div role="tabpanel" id="velix-panel-ideias" aria-labelledby="velix-tab-ideias" hidden={tab !== 'ideias'} className="mt-6">
          <VelixIdeas projectId={settings.data?.projectId ?? null} />
        </div>
        <div role="tabpanel" id="velix-panel-produzir" aria-labelledby="velix-tab-produzir" hidden={tab !== 'produzir'} className="mt-6">
          <VelixProduction projectId={settings.data?.projectId ?? null} />
        </div>
        <div role="tabpanel" id="velix-panel-estudio" aria-labelledby="velix-tab-estudio" hidden={tab !== 'estudio'} className="mt-6">
          <VelixStudio video={video} onVideo={setVideo} projectId={settings.data?.projectId ?? null} />
        </div>
        <div role="tabpanel" id="velix-panel-render" aria-labelledby="velix-tab-render" hidden={tab !== 'render'} className="mt-6">
          <DirectRender origin={origin} agent={agent} root={root} />
        </div>
        <div role="tabpanel" id="velix-panel-importar" aria-labelledby="velix-tab-importar" hidden={tab !== 'importar'} className="mt-6">
          {kit.data && <ImportVideo root={root} version={kit.data.downloaderVersion} />}
        </div>
      </div>
    </main>
  );
}

import { useState, type FormEvent } from 'react';
import { ArrowLeft, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { ALLOWED_COMMAND, ALLOWED_COMMANDS_MAX, PERMISSION_LEVELS, STACK_LABEL, type ChangeStatus, type PermissionLevel, type PreferredAgent, type ProjectDetail } from '@neuralbridge/shared/projects';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { errorMessage, formatWhen } from '@/features/brain/format';
import { DiffView } from '@/components/DiffView';
import { cn } from '@/lib/utils';
import { GitHistorySection } from './GitHistorySection';
import { ProfileSection } from './ProfileSection';
import { SubprojectsSection } from './SubprojectsSection';
import { useDiff, useProject, useProjectFile, useRefreshProject, useRemoveProject, useUpdateProject } from './api';

const CHANGE_LABEL: Record<ChangeStatus, string> = {
  modified: 'modificado',
  added: 'adicionado',
  deleted: 'removido',
  renamed: 'renomeado',
  untracked: 'novo, não rastreado',
  conflict: 'em conflito',
};

const AGENT_LABEL: Record<PreferredAgent, string> = { auto: 'Automático (o roteador decide)', claude: 'Claude Code', codex: 'Codex CLI' };

const PERMISSION: Record<PermissionLevel, { label: string; hint: string }> = {
  standard: { label: 'Padrão', hint: 'editam arquivos e rodam os testes, o build e o git de leitura mais comuns. Sem rede no Codex.' },
  commands: { label: 'Comandos liberados', hint: 'também os comandos da sua lista no Claude Code, e rede na sandbox do Codex.' },
  full: { label: 'Acesso total', hint: 'rodam sem checagem de permissões no Claude Code e sem sandbox no Codex. Use só em projetos em que você confia.' },
};

/** One command prefix per line; the lines that would be refused are reported, not dropped silently. */
function parseCommandLines(text: string): { commands: string[]; invalid: string[] } {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return { commands: [...new Set(lines.filter((line) => ALLOWED_COMMAND.test(line)))], invalid: lines.filter((line) => !ALLOWED_COMMAND.test(line)) };
}

function GitSection({ project }: { project: ProjectDetail }) {
  const [path, setPath] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const git = project.git;
  const diff = useDiff(project.id, path, Boolean(git?.isRepo) && (showAll || path !== null));
  if (!git) return null;
  if (!git.isRepo) return <p className="text-muted-foreground">Esta pasta não é um repositório Git.</p>;
  const untracked = git.changes.find((change) => change.path === path)?.status === 'untracked';

  return (
    <div className="space-y-3">
      <p>
        Branch <span className="font-mono text-[13px]">{git.branch ?? '—'}</span>
        {git.lastCommit && (
          <span className="text-muted-foreground">
            {' '}
            · último commit <span className="font-mono text-[13px]">{git.lastCommit.hash}</span> “{git.lastCommit.subject}”, {formatWhen(git.lastCommit.date)}
          </span>
        )}
      </p>
      {git.changes.length === 0 ? (
        <p className="text-muted-foreground">Nenhuma alteração pendente.</p>
      ) : (
        <>
          <ul aria-label="Arquivos alterados" className="space-y-0.5 text-[13px]">
            {git.changes.map((change) => (
              <li key={change.path}>
                <button
                  type="button"
                  aria-pressed={path === change.path}
                  onClick={() => {
                    setShowAll(false);
                    setPath(path === change.path ? null : change.path);
                  }}
                  className={cn('flex w-full gap-3 rounded px-2 py-1 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring', path === change.path && 'bg-accent')}
                >
                  <span className="min-w-0 flex-1 font-mono break-all">{change.path}</span>
                  <span className="shrink-0 text-muted-foreground">{CHANGE_LABEL[change.status]}</span>
                </button>
              </li>
            ))}
          </ul>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setPath(null);
              setShowAll(true);
            }}
          >
            Ver todas as diferenças
          </Button>
        </>
      )}
      {untracked ? (
        <p className="text-muted-foreground">Arquivo novo, ainda não rastreado pelo Git: não há diferença para mostrar.</p>
      ) : (
        (path !== null || showAll) && (diff.data ? <DiffView {...diff.data} /> : <p className="text-muted-foreground">Carregando…</p>)
      )}
    </div>
  );
}

function FilesSection({ project }: { project: ProjectDetail }) {
  const [selected, setSelected] = useState<string | null>(null);
  const file = useProjectFile(project.id, selected);
  if (project.files.length === 0) return <p className="text-muted-foreground">Nenhum arquivo de descrição encontrado.</p>;
  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-1.5 text-[13px]">
        {project.files.map((name) => (
          <li key={name}>
            <button
              type="button"
              aria-pressed={selected === name}
              onClick={() => setSelected(selected === name ? null : name)}
              className={cn('rounded border px-2 py-1 font-mono text-[12.5px] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring', selected === name && 'bg-accent')}
            >
              {name}
            </button>
          </li>
        ))}
      </ul>
      {selected &&
        (file.data?.ok ? (
          <pre aria-label={`Conteúdo de ${selected}`} className="max-h-96 overflow-auto rounded-md border bg-background px-3 py-2 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap break-words">
            {file.data.content}
          </pre>
        ) : file.data ? (
          <p className="text-muted-foreground">{file.data.reason}</p>
        ) : (
          <p className="text-muted-foreground">Carregando…</p>
        ))}
    </div>
  );
}

function SettingsForm({ project }: { project: ProjectDetail }) {
  const update = useUpdateProject(project.id);
  const [name, setName] = useState(project.name);
  const [agent, setAgent] = useState<PreferredAgent>(project.preferredAgent);
  const [isPrivate, setPrivate] = useState(project.isPrivate);
  const [rules, setRules] = useState(project.rules);
  const [level, setLevel] = useState<PermissionLevel>(project.permissionLevel);
  const [commandText, setCommandText] = useState(project.allowedCommands.join('\n'));
  const [confirmFull, setConfirmFull] = useState(false);
  const [saved, setSaved] = useState(false);
  const { commands, invalid } = parseCommandLines(commandText);
  const tooMany = commands.length > ALLOWED_COMMANDS_MAX;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (invalid.length || tooMany) return;
    setSaved(false);
    update.mutate({ name: name.trim(), preferredAgent: agent, isPrivate, rules, permissionLevel: level, allowedCommands: commands }, { onSuccess: () => setSaved(true) });
  };

  return (
    <form onSubmit={submit} aria-label="Configurações do projeto" className="space-y-4">
      <Field label="Nome" htmlFor="project-name">
        <Input id="project-name" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label="Agente preferido" htmlFor="project-agent" hint="Usado quando você pedir uma tarefa no modo automático.">
        <Select id="project-agent" value={agent} onChange={(event) => setAgent(event.target.value as PreferredAgent)}>
          {(Object.keys(AGENT_LABEL) as PreferredAgent[]).map((value) => (
            <option key={value} value={value}>
              {AGENT_LABEL[value]}
            </option>
          ))}
        </Select>
      </Field>
      <label className="flex items-start gap-2 text-[13px]">
        <input type="checkbox" checked={isPrivate} onChange={(event) => setPrivate(event.target.checked)} className="mt-0.5 accent-[var(--primary)]" />
        <span>
          Projeto privado
          <span className="block text-xs text-muted-foreground">As memórias dele só aparecem para agentes abertos nesta pasta.</span>
        </span>
      </label>
      <Field label="Regras do projeto (Markdown)" htmlFor="project-rules" hint="Enviadas aos agentes em toda tarefa deste projeto.">
        <Textarea id="project-rules" rows={8} value={rules} onChange={(event) => setRules(event.target.value)} className="font-mono text-[13px]" placeholder="Ex.: rodar `dotnet test` antes de concluir." />
      </Field>
      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium">Permissões dos agentes</legend>
        <p className="text-xs text-muted-foreground">Valem quando os agentes alteram este projeto. Análises e revisões continuam somente leitura.</p>
        <RadioGroup
          aria-label="Permissões dos agentes"
          value={level}
          // Full access is never one click away: it waits for the confirmation below.
          onValueChange={(next) => (next === 'full' ? setConfirmFull(true) : setLevel(next as PermissionLevel))}
          className="gap-2"
        >
          {PERMISSION_LEVELS.map((value) => (
            <label key={value} className="flex cursor-pointer items-baseline gap-2.5 text-[13px]">
              <RadioGroupItem value={value} className="translate-y-0.5" />
              <span>
                {PERMISSION[value].label} <span className="text-muted-foreground">— os agentes {PERMISSION[value].hint}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
        {level === 'full' && (
          <p role="note" className="flex items-start gap-2 rounded-md border border-warning/50 px-3 py-2 text-[13px] text-warning">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Acesso total: as tarefas que alteram este projeto rodam comandos sem perguntar e sem isolamento, inclusive fora da pasta e com rede.
          </p>
        )}
        {level === 'commands' && (
          <Field
            label="Comandos liberados para o Claude Code"
            htmlFor="project-commands"
            hint={`Um por linha, como início de comando (ex.: “npm run e2e” libera também “npm run e2e -- --headed”). Sem &&, |, ; ou curingas. Até ${ALLOWED_COMMANDS_MAX}. A alteração vale para novas execuções.`}
          >
            <Textarea
              id="project-commands"
              rows={5}
              value={commandText}
              onChange={(event) => setCommandText(event.target.value)}
              aria-invalid={invalid.length > 0 || tooMany}
              className="font-mono text-[13px]"
              placeholder={'npm run e2e\ngit status\ngit diff'}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  const safeGitReads = ['git status', 'git diff', 'git log', 'git branch'];
                  setCommandText((current) => [...new Set([...current.split(/\r?\n/).map((line) => line.trim()).filter(Boolean), ...safeGitReads])].join('\n'));
                }}
              >
                Liberar Git somente leitura
              </Button>
              <p className="self-center text-xs text-muted-foreground">Depois de salvar, execute a tarefa novamente. A tarefa já negada não pode receber permissões dinamicamente.</p>
            </div>
          </Field>
        )}
        {level === 'commands' && invalid.length > 0 && (
          <p role="alert" className="text-[13px] text-destructive">
            Não dá para liberar: {invalid.map((line) => `“${line}”`).join(', ')}. Use só o início de um comando, sem encadear outros.
          </p>
        )}
        {level === 'commands' && tooMany && (
          <p role="alert" className="text-[13px] text-destructive">
            No máximo {ALLOWED_COMMANDS_MAX} comandos.
          </p>
        )}
      </fieldset>
      <ConfirmDialog
        open={confirmFull}
        onOpenChange={setConfirmFull}
        title="Dar acesso total aos agentes neste projeto?"
        confirmLabel="Dar acesso total"
        destructive
        onConfirm={() => {
          setConfirmFull(false);
          setLevel('full');
        }}
      >
        <p>Quando uma tarefa alterar “{project.name}”, o Claude Code roda sem checar permissões e o Codex roda sem sandbox: qualquer comando, sem perguntar, com acesso à rede e a outras pastas do computador.</p>
        <p>Um arquivo do projeto com instruções maliciosas poderia ser seguido sem que você veja. Vale só depois de salvar, e você pode voltar ao padrão quando quiser.</p>
      </ConfirmDialog>
      {update.error && (
        <p role="alert" className="text-destructive">
          {errorMessage(update.error)}
        </p>
      )}
      {saved && !update.isPending && (
        <p role="status" className="text-[13px] text-primary">
          Configurações salvas.
        </p>
      )}
      <Button type="submit" disabled={update.isPending || (level === 'commands' && (invalid.length > 0 || tooMany))}>
        {update.isPending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
        Salvar configurações
      </Button>
    </form>
  );
}

function Detail({ project }: { project: ProjectDetail }) {
  const navigate = useNavigate();
  const refresh = useRefreshProject(project.id);
  const remove = useRemoveProject();
  /** Memories that removing would delete, counted when the user asks to remove; null = dialog closed. */
  const [confirming, setConfirming] = useState<number | null>(null);
  const stack = project.stack;

  return (
    <div className="grid gap-10 px-8 py-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-8">
        <div>
          <Link to="/projects" className="mb-4 inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" aria-hidden="true" /> Projetos
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <h2 className="min-w-0 text-lg font-semibold tracking-tight break-words">{project.name}</h2>
            <Button variant="outline" size="sm" disabled={refresh.isPending || !project.exists} onClick={() => refresh.mutate()}>
              {refresh.isPending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
              Detectar novamente
            </Button>
          </div>
          <p className="mt-1 font-mono text-[13px] break-all text-muted-foreground">{project.rootPath}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {project.memoryCount === 1 ? '1 memória' : `${project.memoryCount} memórias`} · id <span className="font-mono">{project.id}</span>
          </p>
          {!project.exists && (
            <p role="alert" className="mt-3 flex items-center gap-2 text-warning">
              <TriangleAlert className="size-4" aria-hidden="true" /> A pasta não existe mais neste caminho. Remova o projeto ou restaure a pasta.
            </p>
          )}
        </div>

        <SubprojectsSection project={project} />

        <section aria-labelledby="stack-heading">
          <h3 id="stack-heading" className="mb-2 text-base font-medium">
            Tecnologias
          </h3>
          {stack && stack.stacks.length > 0 ? (
            <>
              <ul className="flex flex-wrap gap-1.5 text-[13px]">
                {stack.stacks.map((id) => (
                  <li key={id} className="rounded bg-muted px-2 py-0.5" title={stack.evidence[id] ? `Detectado em ${stack.evidence[id]}` : undefined}>
                    {STACK_LABEL[id]}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                {stack.packageManager && `Gerenciador de pacotes: ${stack.packageManager}. `}
                {project.detectedAt && `Detectado em ${formatWhen(project.detectedAt)}.`}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">Nenhuma tecnologia reconhecida.</p>
          )}
        </section>

        <section aria-labelledby="profile-heading">
          <h3 id="profile-heading" className="mb-2 text-base font-medium">
            Perfil técnico
          </h3>
          <ProfileSection projectId={project.id} exists={project.exists} />
        </section>

        <section aria-labelledby="git-heading">
          <h3 id="git-heading" className="mb-2 text-base font-medium">
            Git
          </h3>
          <GitSection project={project} />
        </section>

        <section aria-labelledby="git-history-heading">
          <h3 id="git-history-heading" className="mb-2 text-base font-medium">
            Histórico Git
          </h3>
          <GitHistorySection projectId={project.id} exists={project.exists} />
        </section>

        <section aria-labelledby="files-heading">
          <h3 id="files-heading" className="mb-2 text-base font-medium">
            Arquivos de referência
          </h3>
          <FilesSection project={project} />
        </section>
      </div>

      <aside className="space-y-8 lg:border-l lg:pl-6">
        <SettingsForm key={project.id} project={project} />
        <section aria-labelledby="danger-heading" className="space-y-2">
          <h3 id="danger-heading" className="text-[13px] font-medium">
            Remover projeto
          </h3>
          <p className="text-xs text-muted-foreground">Tira o projeto do Singularity e apaga as memórias dele. A pasta não é alterada.</p>
          <Button
            variant="outline"
            size="sm"
            // Count right now: agents may have added memories since this page loaded, and the dialog must not understate the loss.
            onClick={() => window.neuralbridge.projects.impact(project.id).then(({ memories }) => setConfirming(memories), () => setConfirming(project.memoryCount))}
          >
            Remover projeto
          </Button>
        </section>
      </aside>

      {confirming !== null && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirming(null)}
          title={`Remover "${project.name}"?`}
          confirmLabel={confirming ? `Remover e apagar ${confirming === 1 ? '1 memória' : `${confirming} memórias`}` : 'Remover'}
          destructive
          onConfirm={() => remove.mutate(project.id, { onSuccess: () => navigate('/projects', { replace: true }) })}
        >
          <p>
            {confirming
              ? `${confirming === 1 ? 'A memória' : `As ${confirming} memórias`} deste projeto ${confirming === 1 ? 'será apagada' : 'serão apagadas'} definitivamente, com o histórico de versões.`
              : 'Este projeto não tem memórias.'}
          </p>
          <p>Nenhum arquivo da pasta é alterado ou apagado.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

export function ProjectPage() {
  const { id = '' } = useParams();
  const project = useProject(id);
  if (project.isError) {
    return (
      <div className="px-8 py-7">
        <p role="alert" className="text-destructive">
          {errorMessage(project.error)}
        </p>
        <Link to="/projects" className="mt-2 inline-block text-primary underline-offset-4 hover:underline">
          Voltar para Projetos
        </Link>
      </div>
    );
  }
  if (!project.data) return <p className="px-8 py-7 text-muted-foreground">Carregando…</p>;
  return <Detail key={project.data.id} project={project.data} />;
}

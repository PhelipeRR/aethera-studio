import { useState, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Link } from 'react-router';
import { DEFAULT_BRAIN_SETTINGS, LEARNING_MODES, type BackupInfo, type BrainSettings, type LearningMode } from '@neuralbridge/shared/brain-settings';
import type { MemoryType } from '@neuralbridge/shared/domain';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { setMemoryVisualization, useMemoryVisualization, type MemoryVisualization } from '@/features/galaxy/memory-visualization';
import { useApplyRetention, useBackups, useBrainSettings, useCreateBackup, useExportBrain, useHistorySyncSettings, useHistorySyncStatus, useImportBrain, useRestoreBackup, useRunHistorySync, useSaveBrainSettings, useSaveHistorySyncSettings } from './admin-api';
import type { HistorySyncSettings } from '@neuralbridge/shared/channels';
import { errorMessage, formatWhen } from './format';
import { MEMORY_TYPES, TYPE_LABEL } from './labels';

const MODE: Record<LearningMode, { label: string; hint: string }> = {
  manual: { label: 'Manual', hint: 'Só você cria memórias; as propostas dos agentes são ignoradas.' },
  confirm: { label: 'Automático com confirmação', hint: 'Os agentes propõem ao terminar uma tarefa e você aprova cada item em Aprendizados.' },
  categories: { label: 'Automático para categorias autorizadas', hint: 'As categorias marcadas são salvas sozinhas; as outras esperam sua aprovação.' },
};

const INTERVALS = [
  { hours: 0, label: 'Desligado' },
  { hours: 6, label: 'A cada 6 horas' },
  { hours: 12, label: 'A cada 12 horas' },
  { hours: 24, label: 'Uma vez por dia' },
  { hours: 168, label: 'Uma vez por semana' },
];

const BACKUP_KIND: Record<BackupInfo['kind'], string> = { auto: 'automático', manual: 'manual', 'before-restore': 'antes de restaurar' };

function size(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function Section({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-4">
      <div>
        <h2 id={`${id}-heading`} className="text-base font-medium">
          {title}
        </h2>
        <p className="mt-1 max-w-[68ch] text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Feedback({ error, done }: { error: unknown; done: string | null }) {
  if (error) {
    return (
      <p role="alert" className="text-[13px] text-destructive">
        {errorMessage(error)}
      </p>
    );
  }
  return done ? (
    <p role="status" className="text-[13px] text-primary">
      {done}
    </p>
  ) : null;
}

/** Learning mode, automatic backups and retention: edited together, saved with one button. */
function SettingsForm({ initial }: { initial: BrainSettings }) {
  const save = useSaveBrainSettings();
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(value) !== JSON.stringify(initial);
  const update = (next: BrainSettings) => {
    setSaved(false);
    setValue(next);
  };
  const toggleCategory = (type: MemoryType, on: boolean) =>
    update({
      ...value,
      learning: { ...value.learning, categories: on ? [...value.learning.categories, type] : value.learning.categories.filter((item) => item !== type) },
    });
  const days = (raw: string) => Math.min(3650, Math.max(0, Math.trunc(Number(raw) || 0)));

  return (
    <form
      className="space-y-10"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(value, { onSuccess: () => setSaved(true) });
      }}
    >
      <Section id="learning" title="Aprendizado" description="Ao terminar uma tarefa, os agentes podem propor o que vale lembrar. Nada que pareça uma credencial é salvo, em nenhum modo.">
        <RadioGroup value={value.learning.mode} onValueChange={(mode) => update({ ...value, learning: { ...value.learning, mode: mode as LearningMode } })} className="gap-2">
          {LEARNING_MODES.map((mode) => (
            <label key={mode} className="flex cursor-pointer items-baseline gap-2.5">
              <RadioGroupItem value={mode} className="translate-y-0.5" />
              <span>
                {MODE[mode].label} <span className="text-muted-foreground">— {MODE[mode].hint}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
        {value.learning.mode === 'categories' && (
          <fieldset className="rounded-md border px-4 py-3">
            <legend className="px-1 text-[13px] font-medium">Categorias salvas sem confirmação</legend>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {MEMORY_TYPES.filter((type) => type !== 'execution_summary').map((type) => (
                <label key={type} className="flex items-center gap-2 text-[13.5px]">
                  <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={value.learning.categories.includes(type)} onChange={(event) => toggleCategory(type, event.target.checked)} />
                  {TYPE_LABEL[type]}
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Mesmo autorizadas, propostas parecidas com uma memória existente esperam você decidir se junta as duas.</p>
          </fieldset>
        )}
      </Section>

      <Section id="auto-backup" title="Backup automático" description="Cópias completas do cérebro (memórias, links, projetos e tarefas) na pasta de dados do Singularity.">
        <div className="grid max-w-xl gap-4 sm:grid-cols-2">
          <Field label="Frequência" htmlFor="backup-interval">
            <Select
              id="backup-interval"
              value={value.backup.intervalHours}
              onChange={(event) => update({ ...value, backup: { ...value.backup, intervalHours: Number(event.target.value) } })}
            >
              {INTERVALS.map((option) => (
                <option key={option.hours} value={option.hours}>
                  {option.label}
                </option>
              ))}
              {!INTERVALS.some((option) => option.hours === value.backup.intervalHours) && <option value={value.backup.intervalHours}>A cada {value.backup.intervalHours} horas</option>}
            </Select>
          </Field>
          <Field label="Backups automáticos guardados" htmlFor="backup-keep" hint="Os mais antigos são apagados; os manuais ficam.">
            <Input
              id="backup-keep"
              type="number"
              min={1}
              max={100}
              value={value.backup.keep}
              onChange={(event) => update({ ...value, backup: { ...value.backup, keep: Math.min(100, Math.max(1, Math.trunc(Number(event.target.value) || 1))) } })}
            />
          </Field>
        </div>
      </Section>

      <Section id="retention" title="Retenção" description="Quanto tempo guardar o que já não está em uso. 0 guarda para sempre.">
        <div className="grid max-w-xl gap-4 sm:grid-cols-2">
          <Field label="Memórias excluídas (dias)" htmlFor="retention-trash" hint="Depois disso, são apagadas de vez.">
            <Input id="retention-trash" type="number" min={0} max={3650} value={value.retention.trashDays} onChange={(event) => update({ ...value, retention: { ...value.retention, trashDays: days(event.target.value) } })} />
          </Field>
          <Field label="Histórico de tarefas (dias)" htmlFor="retention-tasks" hint="Tarefas terminadas, com etapas e registros.">
            <Input id="retention-tasks" type="number" min={0} max={3650} value={value.retention.taskDays} onChange={(event) => update({ ...value, retention: { ...value.retention, taskDays: days(event.target.value) } })} />
          </Field>
        </div>
      </Section>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!dirty || save.isPending}>
          Salvar configurações
        </Button>
        {dirty && (
          <Button type="button" variant="ghost" onClick={() => update(initial)}>
            Desfazer alterações
          </Button>
        )}
        <Feedback error={save.error} done={saved && !dirty ? 'Configurações salvas.' : null} />
      </div>
    </form>
  );
}

function BackupsSection() {
  const backups = useBackups();
  const create = useCreateBackup();
  const restore = useRestoreBackup();
  const retention = useApplyRetention();
  const [confirm, setConfirm] = useState<BackupInfo | null>(null);
  const [confirmRetention, setConfirmRetention] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  return (
    <Section id="backups" title="Backups e restauração" description="Restaurar troca todo o conteúdo atual pelo do backup. Antes, o Singularity guarda uma cópia do estado atual, para você poder voltar.">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={create.isPending} onClick={() => create.mutate(undefined, { onSuccess: () => setDone('Backup criado.') })}>
          {create.isPending && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
          Fazer backup agora
        </Button>
        <Button
          variant="outline"
          disabled={retention.isPending}
          onClick={() => setConfirmRetention(true)}
        >
          Aplicar retenção agora
        </Button>
      </div>
      <Feedback error={create.error ?? restore.error ?? retention.error ?? backups.error} done={done} />
      {backups.data?.length === 0 && <p className="text-muted-foreground">Nenhum backup ainda.</p>}
      {backups.data && backups.data.length > 0 && (
        <ul aria-label="Backups" className="max-w-2xl divide-y sg-panel rounded-lg">
          {backups.data.map((backup) => (
            <li key={backup.name} className="flex items-center gap-4 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                {formatWhen(backup.createdAt)} <span className="text-[13px] text-muted-foreground">· {BACKUP_KIND[backup.kind]} · {size(backup.sizeBytes)}</span>
              </span>
              <Button size="sm" variant="outline" disabled={restore.isPending} onClick={() => setConfirm(backup)}>
                Restaurar
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={confirmRetention}
        onOpenChange={setConfirmRetention}
        title="Aplicar retenção agora?"
        confirmLabel="Aplicar retenção"
        destructive
        onConfirm={() => {
          setConfirmRetention(false);
          retention.mutate(undefined, {
            onSuccess: (result) => setDone(`Retenção aplicada: ${result.memoriesErased} memórias e ${result.tasksErased} tarefas apagadas de vez.`),
          });
        }}
      >
        <p>Memórias excluídas e tarefas antigas que ultrapassaram os prazos serão apagadas definitivamente.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Restaurar este backup?"
        confirmLabel="Restaurar"
        destructive
        onConfirm={() => {
          if (!confirm) return;
          const chosen = confirm;
          setConfirm(null);
          restore.mutate(chosen.name, { onSuccess: () => setDone(`Backup de ${formatWhen(chosen.createdAt)} restaurado. O estado anterior ficou salvo como backup “antes de restaurar”.`) });
        }}
      >
        <p>As memórias, projetos e tarefas atuais serão trocados pelos de {confirm ? formatWhen(confirm.createdAt) : ''}.</p>
        <p>Uma cópia do estado atual é feita antes, para você poder desfazer.</p>
      </ConfirmDialog>
    </Section>
  );
}

function PortabilitySection() {
  const exporter = useExportBrain();
  const importer = useImportBrain();
  const [done, setDone] = useState<string | null>(null);
  const exportAs = (format: 'json' | 'markdown') =>
    exporter.mutate(format, { onSuccess: (result) => setDone(result ? `${result.count} memórias exportadas para ${result.path}` : null) });

  return (
    <Section id="portability" title="Exportar e importar" description="JSON guarda tudo para importar em outro computador. Markdown cria um arquivo legível por memória, com os metadados no início.">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={exporter.isPending} onClick={() => exportAs('json')}>
          Exportar JSON
        </Button>
        <Button variant="outline" disabled={exporter.isPending} onClick={() => exportAs('markdown')}>
          Exportar Markdown
        </Button>
        <Button
          variant="outline"
          disabled={importer.isPending}
          onClick={() =>
            importer.mutate(undefined, {
              onSuccess: (result) =>
                setDone(result ? `${result.imported} memórias importadas${result.skipped.length ? `; ${result.skipped.length} ignoradas (já existiam ou sem projeto aqui)` : ''}.` : null),
            })
          }
        >
          Importar JSON
        </Button>
      </div>
      <Feedback error={exporter.error ?? importer.error} done={done} />
      {importer.data && importer.data.skipped.length > 0 && (
        <ul aria-label="Memórias ignoradas" className="max-w-2xl list-disc pl-5 text-[13px] text-muted-foreground">
          {importer.data.skipped.slice(0, 20).map((item, i) => (
            <li key={i}>
              {item.title}: {item.reason}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function HistorySyncSection() {
  const query = useHistorySyncSettings();
  const status = useHistorySyncStatus();
  const save = useSaveHistorySyncSettings();
  const run = useRunHistorySync();
  const initial = query.data;
  const [value, setValue] = useState<HistorySyncSettings | null>(null);
  const current = value ?? initial;
  if (!current) return <Section id="history-sync" title="Sincronização de históricos" description="Carregando configurações...">{null}</Section>;
  const update = (next: Partial<HistorySyncSettings>) => setValue({ ...current, ...next });
  const list = (key: 'projectRoots' | 'excludedProjects' | 'excludedSessions', text: string) => update({ [key]: text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) });
  return <Section id="history-sync" title="Históricos do Claude Code e Codex" description="Leia sessões locais como dados não confiáveis para propor aprendizados. Nada é enviado a provedores externos.">
    <div className="space-y-4 rounded-lg border p-4">
      {!current.enabled && <p className="text-sm text-muted-foreground">A primeira ativação é um consentimento explícito para ler os históricos locais.</p>}
      <label className="flex items-center gap-2"><input type="checkbox" checked={current.enabled} onChange={(e) => update({ enabled: e.target.checked, paused: !e.target.checked })} /> Eu autorizo o Singularity a ler meus históricos locais.</label>
      <label className="flex items-center gap-2"><input type="checkbox" disabled={!current.enabled} checked={current.paused} onChange={(e) => update({ paused: e.target.checked })} /> Pausar sincronização</label>
      <Field label="Intervalo (ms)" htmlFor="history-poll"><Input id="history-poll" type="number" min={5000} value={current.pollIntervalMs} onChange={(e) => update({ pollIntervalMs: Math.max(5000, Number(e.target.value) || 30000) })} /></Field>
      <Field label="Projetos permitidos (um caminho por linha)" htmlFor="history-projects"><textarea id="history-projects" className="min-h-20 w-full rounded-md border bg-background p-2 text-sm" value={current.projectRoots.join('\n')} onChange={(e) => list('projectRoots', e.target.value)} /></Field>
      <Field label="Projetos excluídos (um caminho por linha)" htmlFor="history-excluded"><textarea id="history-excluded" className="min-h-20 w-full rounded-md border bg-background p-2 text-sm" value={current.excludedProjects.join('\n')} onChange={(e) => list('excludedProjects', e.target.value)} /></Field>
      <Field label="Sessões excluídas (um ID por linha)" htmlFor="history-sessions"><textarea id="history-sessions" className="min-h-20 w-full rounded-md border bg-background p-2 text-sm" value={current.excludedSessions.join('\n')} onChange={(e) => list('excludedSessions', e.target.value)} /></Field>
      <div className="flex flex-wrap gap-2"><Button disabled={!current.enabled || save.isPending} onClick={() => save.mutate(current)}>Salvar sincronização</Button><Button variant="outline" disabled={!current.enabled || current.paused || run.isPending} onClick={() => run.mutate()}>Sincronizar agora</Button></div>
      {status.data && <p className="text-sm text-muted-foreground">Última execução: {status.data.lastRun ?? 'nunca'} · sessões: {status.data.sessions} · propostas: {status.data.proposals} · erros: {status.data.errors}</p>}
      <Feedback error={query.error ?? save.error ?? run.error} done={save.isSuccess ? 'Configurações de sincronização salvas.' : run.isSuccess ? 'Sincronização concluída.' : null} />
    </div>
  </Section>;
}

/** Brain Settings (spec section 8): learning, backups, retention, export, plus where the other settings live. */
export function BrainSettingsPage() {
  const settings = useBrainSettings();
  const visualization = useMemoryVisualization();
  return (
    <div className="max-w-3xl space-y-12 px-8 py-7">
      {settings.error && <p role="alert" className="text-destructive">{errorMessage(settings.error)}</p>}
      <SettingsForm initial={settings.data ?? DEFAULT_BRAIN_SETTINGS} />
      <Section id="visualization" title="Visualização 3D" description="A Galáxia de Memórias substitui o cérebro 3D. O cérebro anterior continua disponível como alternativa; a troca vale na hora, sem reiniciar.">
        <RadioGroup value={visualization} onValueChange={(next) => setMemoryVisualization(next as MemoryVisualization)} aria-label="Visualização 3D da memória" className="gap-2">
          <label className="flex cursor-pointer items-baseline gap-2.5">
            <RadioGroupItem value="galaxy" className="translate-y-0.5" />
            <span>Galáxia de Memórias <span className="text-muted-foreground">— cada estrela é uma memória, organizada por tipo, projeto ou significado.</span></span>
          </label>
          <label className="flex cursor-pointer items-baseline gap-2.5">
            <RadioGroupItem value="brain3d" className="translate-y-0.5" />
            <span>Cérebro 3D anterior <span className="text-muted-foreground">— a visualização da Fase 19.</span></span>
          </label>
        </RadioGroup>
      </Section>
      <HistorySyncSection />
      <BackupsSection />
      <PortabilitySection />
      <Section id="elsewhere" title="Outras configurações do cérebro" description="Ficam junto do que controlam.">
        <ul className="space-y-1.5 text-[13.5px]">
          <li>
            Modelo de embeddings e busca semântica: em{' '}
            <Link to="/settings" className="text-primary underline underline-offset-4">
              Configurações
            </Link>
            .
          </li>
          <li>
            Conexão MCP com Claude Code e Codex: em{' '}
            <Link to="/mcp" className="text-primary underline underline-offset-4">
              MCPs
            </Link>
            .
          </li>
          <li>
            Permissões por projeto (projetos privados): em{' '}
            <Link to="/projects" className="text-primary underline underline-offset-4">
              Projetos
            </Link>
            .
          </li>
          <li className="text-muted-foreground">Limites de contexto por tarefa são controlados pelo Token Optimizer.</li>
        </ul>
      </Section>
    </div>
  );
}

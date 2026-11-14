import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Check, LoaderCircle, Search, ShieldCheck, TriangleAlert } from 'lucide-react';
import { PageHeader } from '@/app/PageHeader';
import { SkillStudioPanel } from '@/features/skills/SkillStudioPanel';

export function SkillsPage({ description }: { description: string }) {
  const [recommendTask, setRecommendTask] = useState('');
  const [recommendProject, setRecommendProject] = useState('');
  const projects = useQuery({ queryKey: ['projects', 'list'], queryFn: () => window.neuralbridge.projects.list(), staleTime: 60_000 });
  const recommend = useMutation({ mutationFn: (taskDescription: string) => window.neuralbridge.skills.recommend({ taskDescription, ...(recommendProject ? { projectId: recommendProject } : {}) }) });
  const usage = useQuery({ queryKey: ['skills-usage'], queryFn: () => window.neuralbridge.skills.usage() });
  const skills = useQuery({ queryKey: ['skills'], queryFn: () => window.neuralbridge.skills.list(), staleTime: 30_000 });
  const settings = useQuery({ queryKey: ['skill-settings'], queryFn: () => window.neuralbridge.skills.settings() });
  const [host, setHost] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [remoteSource, setRemoteSource] = useState('');
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const taskTypes = ['question', 'planning', 'implementation', 'refactor', 'tests', 'ui'];
  const visibleSkills = useMemo(() => (skills.data ?? []).filter((skill) => `${skill.name} ${skill.description} ${skill.path}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [query, skills.data]);
  const save = async (skillId: string, enabled: boolean) => {
    if (!settings.data) return;
    const current = settings.data.preferences.find((item) => item.skillId === skillId) ?? { skillId, taskTypes: [], agents: [] as Array<'claude' | 'codex'>, enabled: false };
    await window.neuralbridge.skills.saveSettings({ ...settings.data, preferences: [...settings.data.preferences.filter((item) => item.skillId !== skillId), { ...current, enabled }] });
    await settings.refetch();
    setMessage('Preferências salvas.');
  };
  const updatePreference = async (skillId: string, changes: Partial<{ agents: Array<'claude' | 'codex'>; taskTypes: string[] }>) => {
    if (!settings.data) return;
    const current = settings.data.preferences.find((item) => item.skillId === skillId) ?? { skillId, taskTypes: [], agents: [] as Array<'claude' | 'codex'>, enabled: false };
    await window.neuralbridge.skills.saveSettings({ ...settings.data, preferences: [...settings.data.preferences.filter((item) => item.skillId !== skillId), { ...current, ...changes }] });
    await settings.refetch(); setMessage('Preferências salvas.');
  };
  const transactRemoteSkill = async () => {
    const source = remoteSource.trim();
    let skillId = source;
    try { skillId = new URL(source).pathname.split('/').filter(Boolean).at(-1)?.replace(/\.git$/iu, '') ?? source; } catch { /* main validates the URL */ }
    setRemoteBusy(true); setTransactionId(null);
    try {
      const prepared = await window.neuralbridge.skills.prepareInstall({ skillId, source, scope: 'global' });
      const riskText = prepared.preview.blockedBy.length ? `Bloqueios: ${prepared.preview.blockedBy.join(', ')}` : prepared.preview.warnings.length ? `Avisos: ${prepared.preview.warnings.join(', ')}` : 'Nenhum bloqueio crítico identificado.';
      if (!window.confirm(`Prévia da operação ${prepared.state}\nArquivos: ${prepared.preview.files.length}\nTamanho: ${prepared.preview.totalBytes} bytes\n${riskText}\n\nConfirmar instalação transacional?`)) {
        await window.neuralbridge.skills.cancelInstall(prepared.operationId); setMessage('Instalação cancelada antes do commit.'); return;
      }
      setTransactionId(prepared.operationId);
      const result = await window.neuralbridge.skills.confirmInstall(prepared.operationId);
      setMessage(result.state === 'completed' ? 'Skill instalada/atualizada com backup transacional.' : `Operação terminou em ${result.state}.`);
      await skills.refetch();
    } catch (error: unknown) { setMessage(error instanceof Error ? error.message : 'Falha na operação transacional.'); }
    finally { setRemoteBusy(false); }
  };
  return <>
    <PageHeader title="Skills" description={description} />
    <main className="w-full min-w-0 max-w-none space-y-6 px-6 py-7 sm:px-8">
        <section data-tour="skills-settings" aria-labelledby="skill-settings" className="min-w-0 space-y-3 sg-panel rounded-xl p-5">
        <h2 id="skill-settings" className="font-medium">Configurações</h2>
        <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); const value = host.trim().toLowerCase(); if (!value || !/^[a-z0-9.-]+$/.test(value)) return; void window.neuralbridge.skills.saveSettings({ ...(settings.data ?? { preferences: [] }), allowlistedHosts: [...new Set([...(settings.data?.allowlistedHosts ?? []), value])] }).then(() => { setHost(''); setMessage('Fonte autorizada salva.'); void settings.refetch(); }); }}>
          <input aria-label="Host HTTPS autorizado" className="min-w-0 flex-1 rounded border px-2 py-1 text-sm" value={host} onChange={(event) => setHost(event.target.value)} placeholder="skills.example" />
          <button type="submit" className="rounded border px-3 py-1 text-sm">Autorizar host</button>
        </form>
        <ul aria-label="Hosts autorizados" className="text-sm text-muted-foreground">{(settings.data?.allowlistedHosts ?? []).map((item) => <li key={item}>{item}</li>)}</ul>
        {message && <p role="status" className="text-sm text-primary">{message}</p>}
        <div className="min-w-0 flex flex-wrap gap-2">
          <input aria-label="Repositório HTTPS da skill" className="min-w-0 flex-1 rounded border px-2 py-1 text-sm" value={remoteSource} onChange={(event) => setRemoteSource(event.target.value)} placeholder="https://host/skill.git" />
          <button type="button" disabled={remoteBusy || !remoteSource} className="rounded border px-3 py-1 text-sm" onClick={() => void transactRemoteSkill()}>{remoteBusy ? 'Processando…' : 'Preparar instalação'}</button>
          {transactionId && <span className="min-w-0 break-words text-xs text-muted-foreground" role="status">Operação {transactionId.slice(0, 8)} em acompanhamento</span>}
        </div>
      </section>
      <SkillStudioPanel existingSkills={skills.data ?? []} onRefresh={() => void skills.refetch()} />
      <section aria-label="Recomendar skills" className="rounded-xl border p-4"><h2 className="font-medium">Recomendar para uma tarefa</h2><p className="mt-1 text-xs text-muted-foreground">É uma sugestão por regras, enriquecida pelo Git e pela memória do projeto: não instala, não habilita e não seleciona nada.</p><form className="mt-2 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); if (recommendTask.trim()) recommend.mutate(recommendTask.trim()); }}><input aria-label="Tarefa para recomendar skills" className="min-w-0 flex-1 rounded border px-2 py-1 text-sm" value={recommendTask} onChange={(event) => setRecommendTask(event.target.value)} placeholder="Descreva a tarefa" /><select aria-label="Projeto para enriquecer recomendação" className="min-w-48 rounded border bg-background px-2 py-1 text-sm" value={recommendProject} onChange={(event) => setRecommendProject(event.target.value)}><option value="">Sem projeto</option>{projects.data?.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><button type="submit" disabled={!recommendTask.trim() || recommend.isPending} className="rounded border px-3 py-1 text-sm">Recomendar</button></form>{recommend.isError && <p role="alert" className="mt-2 text-xs text-destructive">Não foi possível recomendar agora.</p>}{recommend.data && (recommend.data.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Nenhuma skill instalada combina com esta tarefa.</p> : <ol aria-label="Skills recomendadas" className="mt-2 space-y-1 text-sm">{recommend.data.map((item) => <li key={item.skillId}><span className="font-medium">{item.name}</span>{item.reasons.length > 0 ? `: ${item.reasons.join('; ')}` : ''}</li>)}</ol>)}</section>
      <section aria-label="Uso de skills" className="rounded-xl border p-4"><h2 className="font-medium">Uso registrado</h2><p className="mt-1 text-xs text-muted-foreground">Conta só o que as execuções registraram; não mede benefício.</p>{(usage.data ?? []).length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Nenhum uso registrado ainda.</p> : <ul className="mt-2 space-y-1 text-sm">{usage.data?.map((row) => <li key={row.skillId}>{row.skillId}: {row.used} uso(s), {row.loaded} leitura(s), {row.injected} contexto(s), {row.failed} falha(s) · {row.lastAt}</li>)}</ul>}</section>
      {skills.isPending && <p className="flex items-center gap-2 text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Verificando skills…</p>}
      {skills.isError && <p role="alert" className="text-destructive">Não foi possível carregar as skills.</p>}
      {skills.data?.length === 0 && <section aria-label="Skills vazias" className="rounded-xl border border-dashed p-10 text-center"><ShieldCheck className="mx-auto size-6 text-muted-foreground" aria-hidden="true" /><h2 className="mt-3 font-medium">Nenhuma skill instalada</h2><p className="mt-1 text-sm text-muted-foreground">Autorize uma fonte e instale uma skill remota para disponibilizá-la aos agentes.</p></section>}
        {skills.data && skills.data.length > 0 && <>
        <section data-tour="skills-list" aria-label="Ferramentas de skills" className="flex min-w-0 items-center gap-3 sg-panel rounded-xl p-3"><Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><input aria-label="Buscar skills" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome, descrição ou origem" className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" /><span className="shrink-0 text-xs text-muted-foreground">{visibleSkills.length} de {skills.data.length}</span></section>
        {visibleSkills.length ? <ul aria-label="Skills instaladas" className="grid min-w-0 gap-3 lg:grid-cols-2">
          {visibleSkills.map((skill) => <li key={skill.id} className="min-w-0 space-y-3 sg-panel rounded-xl p-4">
          <div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="max-w-full truncate">{skill.name}</strong><span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"><Check className="size-3" aria-hidden="true" /> local</span>{skill.conflict && <span className="inline-flex shrink-0 items-center gap-1 text-xs text-destructive"><TriangleAlert className="size-3" aria-hidden="true" /> conflito</span>}{!skill.valid && <span className="shrink-0 text-xs text-warning">manifesto inválido</span>}</div>
          <p className="break-words text-sm text-muted-foreground">{skill.description || 'Sem descrição válida.'}</p>
          </div><label className="flex shrink-0 items-center gap-2 text-sm"><input type="checkbox" checked={settings.data?.preferences.find((item) => item.skillId === skill.id)?.enabled ?? false} onChange={(event) => void save(skill.id, event.target.checked)} /> Habilitada</label></div>
          <p className="wrap-anywhere font-mono text-xs text-muted-foreground">{skill.path}</p>
          {skill.scripts.length > 0 && <p className="wrap-anywhere text-xs text-warning">Scripts detectados como dados, não executados: {skill.scripts.join(', ')}</p>}
          <div className="flex min-w-0 flex-wrap items-start gap-3 border-t pt-3 text-xs">
            {(['claude', 'codex'] as const).map((agent) => <label key={agent} className="flex shrink-0 items-center gap-1"><input type="checkbox" checked={settings.data?.preferences.find((item) => item.skillId === skill.id)?.agents.includes(agent) ?? false} onChange={(event) => { const current = settings.data?.preferences.find((item) => item.skillId === skill.id)?.agents ?? []; void updatePreference(skill.id, { agents: event.target.checked ? [...new Set([...current, agent])] : current.filter((item) => item !== agent) }); }} /> {agent}</label>)}
            <select aria-label={`Tipos de tarefa de ${skill.name}`} multiple className="max-w-full rounded border" value={settings.data?.preferences.find((item) => item.skillId === skill.id)?.taskTypes ?? []} onChange={(event) => void updatePreference(skill.id, { taskTypes: [...event.target.selectedOptions].map((option) => option.value) })}>{taskTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select>
          </div>
        </li>)}
        </ul> : <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhuma skill corresponde à busca.</p>}
      </>}
    </main>
  </>;
}

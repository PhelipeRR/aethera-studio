import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import type { ProjectSummary } from '@neuralbridge/shared/projects';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';

const TECHNOLOGIES = [['node', 'Node.js / TypeScript'], ['dotnet', '.NET'], ['python', 'Python'], ['java', 'Java / Kotlin'], ['rust', 'Rust'], ['go', 'Go'], ['other', 'Outra']] as const;
type Technology = (typeof TECHNOLOGIES)[number][0];

/** Creates a project with its repository, or clones one. Existing folders go through "Adicionar" or discovery. */
export function NewProjectPanel({ projects, onClose }: { projects: ProjectSummary[]; onClose: () => void }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'create' | 'clone'>('create');
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [technology, setTechnology] = useState<Technology>('node');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const field = 'mt-1 h-9 w-full rounded border bg-background px-2 text-sm';
  const chosen = projects.find((project) => project.id === workspace);
  const folder = parent || chosen?.rootPath || '';

  const finish = async (id: string) => {
    await client.invalidateQueries({ queryKey: ['projects'] });
    void navigate(`/projects/${id}`);
  };
  const submit = async () => {
    setBusy(true);
    setProblem(null);
    const parentProjectId = workspace || null;
    try {
      if (mode === 'clone') {
        await finish((await window.neuralbridge.projects.clone({ url: url.trim(), parent: folder, name: name.trim(), parentProjectId })).id);
        return;
      }
      const create = (allowNested: boolean) => window.neuralbridge.projects.create({ name: name.trim(), parent: folder, technology, parentProjectId, allowNested });
      try {
        await finish((await create(false)).id);
      } catch (error) {
        const message = errorMessage(error);
        if (!/repositório aninhado/.test(message) || !window.confirm(`${message} Criar mesmo assim?`)) throw error;
        await finish((await create(true)).id);
      }
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Novo projeto" className="space-y-3 rounded-lg border p-4">
      <h2 className="font-medium">Novo projeto</h2>
      <div className="flex gap-2"><Button size="sm" variant={mode === 'create' ? 'default' : 'outline'} onClick={() => setMode('create')}>Criar projeto</Button><Button size="sm" variant={mode === 'clone' ? 'default' : 'outline'} onClick={() => setMode('clone')}>Clonar repositório</Button></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">Nome da pasta<input aria-label="Nome da pasta" className={field} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="block text-sm">Workspace (opcional)<select aria-label="Workspace" className={field} value={workspace} onChange={(event) => setWorkspace(event.target.value)}><option value="">Nenhum</option>{projects.filter((project) => project.kind === 'workspace').map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <label className="block text-sm sm:col-span-2">Pasta onde criar
          <span className="flex gap-2"><input aria-label="Pasta onde criar" className={field} value={folder} onChange={(event) => setParent(event.target.value)} /><Button type="button" variant="outline" className="mt-1" onClick={() => void window.neuralbridge.projects.pick().then((path) => { if (path) setParent(path); })}>Escolher</Button></span>
        </label>
        {mode === 'create' ? (
          <label className="block text-sm">Tecnologia<select aria-label="Tecnologia" className={field} value={technology} onChange={(event) => setTechnology(event.target.value as Technology)}>{TECHNOLOGIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        ) : (
          <label className="block text-sm sm:col-span-2">Endereço do repositório<input aria-label="Endereço do repositório" className={field} placeholder="https://… ou git@…" value={url} onChange={(event) => setUrl(event.target.value)} /></label>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{mode === 'create' ? 'Cria a pasta, README, .gitignore e o repositório Git.' : 'Usa as credenciais que o Git do seu computador já tem. Submódulos não são baixados.'}</p>
      {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
      <div className="flex gap-2"><Button onClick={() => void submit()} disabled={busy || !name.trim() || !folder || (mode === 'clone' && !url.trim())}>{mode === 'create' ? 'Criar' : 'Clonar'}</Button><Button variant="ghost" onClick={onClose}>Fechar</Button></div>
    </section>
  );
}

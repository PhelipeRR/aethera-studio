import { useState } from 'react';
import { FolderSearch, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import type { ProjectDetail } from '@neuralbridge/shared/projects';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';
import { useProjectList } from './api';
import { DiscoveryPreview } from './DiscoveryPreview';

/** Projects registered inside this one, and the way to find the ones that are not yet. */
export function SubprojectsSection({ project }: { project: ProjectDetail }) {
  const list = useProjectList();
  const [detecting, setDetecting] = useState(false);
  const children = (list.data ?? []).filter((item) => item.parentProjectId === project.id);

  return (
    <section aria-labelledby="subprojects-heading">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h3 id="subprojects-heading" className="text-base font-medium">
          Subprojetos
        </h3>
        <Button variant="outline" size="sm" disabled={!project.exists || detecting} onClick={() => setDetecting(true)}>
          <FolderSearch aria-hidden="true" />
          Detectar subprojetos
        </Button>
      </div>
      {list.isError && (
        <p role="alert" className="text-destructive">
          {errorMessage(list.error)}
        </p>
      )}
      {list.data && children.length === 0 && <p className="text-muted-foreground">Nenhum subprojeto cadastrado. A detecção procura repositórios e projetos dentro desta pasta.</p>}
      {children.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {children.map((child) => (
            <li key={child.id}>
              <Link to={`/projects/${child.id}`} className="block rounded-lg px-3 py-2 outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring">
                <span className="font-medium break-words">{child.name}</span>
                <span className="block font-mono text-[12.5px] break-all text-muted-foreground">{child.rootPath}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {project.permissionLevel === 'full' && (
        <p className="mt-2 flex items-start gap-1.5 text-[13px] text-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> Este projeto está em Acesso total: como workspace, tarefas iniciadas nele alcançam todos os subprojetos.
        </p>
      )}
      {detecting && (
        <div className="mt-3">
          <DiscoveryPreview key={project.rootPath} path={project.rootPath} onClose={() => setDetecting(false)} />
        </div>
      )}
    </section>
  );
}

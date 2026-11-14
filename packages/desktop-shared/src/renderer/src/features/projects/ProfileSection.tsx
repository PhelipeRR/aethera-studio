import { LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import type { ProfileMemoryRef, ProjectProfile } from '@neuralbridge/shared/projects';
import { Button } from '@/components/ui/button';
import { errorMessage, formatWhen } from '@/features/brain/format';
import { CONFIDENCE_LABEL } from '@/features/brain/labels';
import { useProjectProfile, useRefreshProfile } from './api';

/** Phase 21: what NeuralBridge knows about the project, each entry with where it comes from. */

function MemoryLink({ memory }: { memory: ProfileMemoryRef }) {
  return (
    <>
      <Link to={`/memory/${memory.id}`} className="underline-offset-2 hover:underline">
        {memory.title}
      </Link>{' '}
      <span className="text-xs text-muted-foreground">({CONFIDENCE_LABEL[memory.confidence].toLowerCase()})</span>
    </>
  );
}

function Changes({ changes }: { changes: NonNullable<ProjectProfile['changes']> }) {
  const parts = [
    changes.modulesAdded.length ? `módulos novos: ${changes.modulesAdded.join(', ')}` : null,
    changes.modulesRemoved.length ? `módulos que sumiram: ${changes.modulesRemoved.join(', ')}` : null,
    changes.dependenciesAdded.length ? `dependências novas: ${changes.dependenciesAdded.join(', ')}` : null,
    changes.dependenciesRemoved.length ? `dependências removidas: ${changes.dependenciesRemoved.join(', ')}` : null,
  ].filter(Boolean);
  return <p data-testid="profile-changes">{parts.length ? `Desde o perfil anterior — ${parts.join('; ')}.` : 'Nada mudou em módulos e dependências desde o perfil anterior.'}</p>;
}

function Profile({ profile }: { profile: ProjectProfile }) {
  const { index } = profile;
  const runtime = profile.dependencies.filter((dependency) => dependency.kind === 'runtime');
  const dev = profile.dependencies.filter((dependency) => dependency.kind === 'dev');
  return (
    <div className="space-y-4 text-[13px]">
      <div className="space-y-1 text-muted-foreground">
        <p data-testid="profile-index">
          {index.files === 1 ? '1 arquivo no índice' : `${index.files} arquivos no índice`}: {index.indexed} lidos agora, {index.skipped} sem mudança, {index.removed} removidos
          {index.tooLarge ? `, ${index.tooLarge} grandes demais (ficaram de fora)` : ''}. Gerado {formatWhen(profile.generatedAt)}.
        </p>
        {index.limited && (
          <p role="note" className="flex items-center gap-1.5 text-warning">
            <TriangleAlert className="size-3.5" aria-hidden="true" /> O projeto passa do limite de arquivos indexados: parte dele não entrou no perfil.
          </p>
        )}
        {profile.changes && <Changes changes={profile.changes} />}
      </div>

      <div>
        <h4 className="mb-1 font-medium">Módulos</h4>
        {profile.modules.length === 0 ? (
          <p className="text-muted-foreground">Nenhum arquivo de código ou documentação indexado.</p>
        ) : (
          <ul aria-label="Módulos" className="space-y-1">
            {profile.modules.map((module) => (
              <li key={module.path}>
                <span className="font-mono">{module.path}</span> <span className="text-muted-foreground">— {module.files === 1 ? '1 arquivo' : `${module.files} arquivos`}</span>
                {module.symbols.length > 0 && (
                  <span className="block truncate font-mono text-[11.5px] text-muted-foreground" title={module.symbols.join(', ')}>
                    {module.symbols.join(', ')}
                    {module.symbolCount > module.symbols.length ? ` e mais ${module.symbolCount - module.symbols.length}` : ''}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className="mb-1 font-medium">Dependências</h4>
        {profile.dependencies.length === 0 ? (
          <p className="text-muted-foreground">Nenhuma encontrada em package.json ou .csproj.</p>
        ) : (
          <ul aria-label="Dependências" className="flex flex-wrap gap-1.5">
            {[...runtime, ...dev].map((dependency) => (
              <li key={`${dependency.source}:${dependency.name}`} title={`Declarada em ${dependency.source}`} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11.5px]">
                {dependency.name}
                {dependency.version ? <span className="text-muted-foreground">@{dependency.version}</span> : null}
                {dependency.kind === 'dev' ? <span className="text-muted-foreground"> (dev)</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className="mb-1 font-medium">Decisões</h4>
        {profile.decisions.length === 0 ? (
          <p className="text-muted-foreground">Nenhuma memória de decisão neste projeto.</p>
        ) : (
          <ul aria-label="Decisões" className="space-y-0.5">
            {profile.decisions.map((decision) => (
              <li key={decision.id}>
                <MemoryLink memory={decision} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className="mb-1 font-medium">Problemas recorrentes</h4>
        {profile.problems.length === 0 ? (
          <p className="text-muted-foreground">Nenhuma tag repetida em correções de bug.</p>
        ) : (
          <ul aria-label="Problemas recorrentes" className="space-y-1">
            {profile.problems.map((problem) => (
              <li key={problem.tag}>
                <span className="font-medium">#{problem.tag}</span> <span className="text-muted-foreground">— {problem.occurrences} correções:</span>{' '}
                {problem.memories.map((memory, index) => (
                  <span key={memory.id}>
                    {index > 0 && ', '}
                    <MemoryLink memory={memory} />
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function ProfileSection({ projectId, exists }: { projectId: string; exists: boolean }) {
  const profile = useProjectProfile(projectId);
  const refresh = useRefreshProfile(projectId);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted-foreground">Usado como contexto nas tarefas deste projeto. Lê só o que mudou desde a última vez; arquivos sensíveis ficam de fora.</p>
        <Button variant="outline" size="sm" disabled={refresh.isPending || !exists} onClick={() => refresh.mutate()}>
          {refresh.isPending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
          {profile.data ? 'Atualizar perfil' : 'Gerar perfil'}
        </Button>
      </div>
      {refresh.error && (
        <p role="alert" className="text-[13px] text-destructive">
          {errorMessage(refresh.error)}
        </p>
      )}
      {profile.isPending ? (
        <p className="text-[13px] text-muted-foreground">Carregando…</p>
      ) : profile.data ? (
        <Profile profile={profile.data} />
      ) : (
        <p className="text-[13px] text-muted-foreground">Ainda não gerado. Gere o perfil para que os agentes recebam um resumo de módulos, dependências e decisões deste projeto.</p>
      )}
    </div>
  );
}

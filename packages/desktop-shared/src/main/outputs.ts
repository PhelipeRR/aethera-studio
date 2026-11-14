import { existsSync } from 'node:fs';
import { win32 } from 'node:path';
import { canOpenOutput } from '@neuralbridge/shared';
import { isInsideProject } from '@neuralbridge/workspace';

/**
 * The file a run produced, to open with its default app or show in Explorer: only inside the task's
 * project, only if it still exists, and never opened when Windows would run it instead of showing it.
 */
export function resolveOutputPath(root: string, path: string, action: 'open' | 'reveal'): string {
  if (!isInsideProject(root, path)) throw new Error('forbidden: O arquivo está fora do projeto da tarefa.');
  const absolute = win32.isAbsolute(path) ? win32.resolve(path) : win32.resolve(root, path);
  if (!existsSync(absolute)) throw new Error('not_found: O arquivo não existe mais.');
  if (action === 'open' && !canOpenOutput(absolute)) throw new Error('forbidden: Este tipo de arquivo seria executado; use Mostrar na pasta.');
  return absolute;
}

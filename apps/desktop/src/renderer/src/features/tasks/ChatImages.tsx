import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ImageOff, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import type { ImageUpload, TaskImage } from '@neuralbridge/shared/tasks';
import { errorMessage } from '@/features/brain/format';
import { cn } from '@/lib/utils';
import { formatBytes, triageImages } from './chat-images';

/** An image waiting in the composer: its bytes go to the main process, the preview stays here. */
export interface DraftImage {
  id: string;
  name: string;
  size: number;
  data: Uint8Array;
  preview: string;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

/** Images picked, pasted or dropped into the composer before sending. */
export function useImageDraft() {
  const [drafts, setDrafts] = useState<DraftImage[]>([]);
  const [problems, setProblems] = useState<string[]>([]);

  const add = useCallback(
    async (files: readonly File[]) => {
      const { accepted, problems: found } = triageImages(drafts.length, files);
      const read: DraftImage[] = [];
      for (const file of accepted) {
        try {
          read.push({ id: crypto.randomUUID(), name: file.name || 'imagem colada', size: file.size, data: new Uint8Array(await file.arrayBuffer()), preview: await readAsDataUrl(file) });
        } catch {
          found.push(`Não foi possível ler “${file.name}”.`);
        }
      }
      setProblems(found);
      if (read.length) setDrafts((current) => [...current, ...read]);
    },
    [drafts.length],
  );

  const remove = (id: string) => {
    setDrafts((current) => current.filter((draft) => draft.id !== id));
    setProblems([]);
  };
  const clear = () => {
    setDrafts([]);
    setProblems([]);
  };
  const uploads = (): ImageUpload[] => drafts.map(({ name, data }) => ({ name, data }));

  return { drafts, problems, add, remove, clear, uploads };
}

/** Thumbnails in the composer, each with a remove button. */
export function DraftImages({ drafts, onRemove }: { drafts: DraftImage[]; onRemove: (id: string) => void }) {
  if (!drafts.length) return null;
  return (
    <ul aria-label="Imagens anexadas" className="flex flex-wrap gap-2 px-3 pt-3">
      {drafts.map((draft) => (
        <li key={draft.id} className="group relative" title={`${draft.name} · ${formatBytes(draft.size)}`}>
          <img src={draft.preview} alt={draft.name} className="size-16 rounded-lg border border-border object-cover" />
          <button
            type="button"
            aria-label={`Remover ${draft.name}`}
            onClick={() => onRemove(draft.id)}
            className="absolute -top-1.5 -right-1.5 inline-flex size-5 items-center justify-center rounded-full border border-border bg-popover text-foreground shadow-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function TaskImageThumb({ taskId, index, image, onOpen }: { taskId: string; index: number; image: TaskImage; onOpen: (src: string, image: TaskImage) => void }) {
  const query = useQuery({ queryKey: ['tasks', 'image', taskId, index], queryFn: () => window.neuralbridge.tasks.image(taskId, index), staleTime: Infinity });
  if (query.error) {
    return (
      <span title={errorMessage(query.error)} className="inline-flex size-20 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground">
        <ImageOff className="size-4" aria-label={`${image.name} indisponível`} />
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label={`Ampliar ${image.name}`}
      disabled={!query.data}
      onClick={() => query.data && onOpen(query.data, image)}
      className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {query.data ? (
        <img src={query.data} alt={image.name} className="size-20 rounded-lg border border-border object-cover" />
      ) : (
        <span className="block size-20 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
      )}
    </button>
  );
}

/** The images sent with a request, in the conversation; click to see one full size. */
export function TaskImages({ taskId, images, className }: { taskId: string; images: TaskImage[]; className?: string }) {
  const [open, setOpen] = useState<{ src: string; image: TaskImage } | null>(null);
  if (!images.length) return null;
  return (
    <>
      <ul aria-label="Imagens enviadas" className={cn('flex flex-wrap justify-end gap-2', className)}>
        {images.map((image, index) => (
          <li key={`${index}-${image.name}`}>
            <TaskImageThumb taskId={taskId} index={index} image={image} onOpen={(src, chosen) => setOpen({ src, image: chosen })} />
          </li>
        ))}
      </ul>
      <Dialog.Root open={open !== null} onOpenChange={(value) => !value && setOpen(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70" />
          <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[min(64rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-2 rounded-lg border bg-popover p-3 shadow-xl focus:outline-none">
            <div className="flex items-center gap-2">
              <Dialog.Title className="min-w-0 flex-1 truncate text-[13px] font-medium">{open?.image.name}</Dialog.Title>
              <Dialog.Description className="text-xs text-muted-foreground">{open ? formatBytes(open.image.size) : ''}</Dialog.Description>
              <Dialog.Close aria-label="Fechar" className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                <X className="size-4" aria-hidden="true" />
              </Dialog.Close>
            </div>
            {open && <img src={open.src} alt={open.image.name} className="min-h-0 flex-1 rounded object-contain" />}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

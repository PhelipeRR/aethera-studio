import { IMAGE_MAX_BYTES, IMAGE_TYPES, IMAGES_PER_MESSAGE } from '@neuralbridge/shared/tasks';

// First check of images picked, pasted or dropped in the composer, for quick feedback. The main process
// checks again from the real bytes; this only filters by the declared type and the size.

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}

export function triageImages(already: number, files: readonly File[]): { accepted: File[]; problems: string[] } {
  const accepted: File[] = [];
  const problems: string[] = [];
  for (const file of files) {
    if (!(file.type in IMAGE_TYPES)) problems.push(`“${file.name}” não é PNG, JPEG, GIF ou WebP.`);
    else if (file.size > IMAGE_MAX_BYTES) problems.push(`“${file.name}” passa de ${formatBytes(IMAGE_MAX_BYTES).replace(',0', '')}.`);
    else if (already + accepted.length >= IMAGES_PER_MESSAGE) problems.push(`No máximo ${IMAGES_PER_MESSAGE} imagens por mensagem: “${file.name}” ficou de fora.`);
    else accepted.push(file);
  }
  return { accepted, problems };
}

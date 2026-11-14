import type { BrandIdentity } from '@neuralbridge/shared/velix-channel';
import { BRAND_PIECES, renderBrandPiece, type BrandPieceKind } from '@neuralbridge/shared/velix-brand-pieces';

const toBase64 = (text: string) => { const bytes = new TextEncoder().encode(text); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); };

/** Rasterizes a piece at its exact YouTube size; YouTube takes PNG/JPEG, not SVG. */
export async function piecePng(svg: string, width: number, height: number, format: 'png' | 'jpeg' = 'png'): Promise<string> {
  const image = new Image();
  image.decoding = 'async';
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('unavailable: o navegador do app não conseguiu gerar o PNG.');
  context.drawImage(image, 0, 0, width, height);
  // JPEG for full-bleed art: the grain texture does not compress in PNG and would pass YouTube's size limits.
  const url = format === 'png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.92);
  return url.slice(url.indexOf(',') + 1);
}

/** Opens the save dialog for one identity piece. Resolves false when the person cancels. */
export async function savePiece(identity: BrandIdentity, kind: BrandPieceKind, format: 'png' | 'svg', options: { title?: string } = {}): Promise<boolean> {
  const piece = BRAND_PIECES.find((item) => item.kind === kind);
  if (!piece) throw new Error('invalid: peça desconhecida.');
  const svg = renderBrandPiece(identity, kind, options);
  const dataBase64 = format === 'svg' ? toBase64(svg) : await piecePng(svg, piece.width, piece.height);
  const result = await window.neuralbridge.video.saveGeneratedFile({ fileName: `${kind}-${piece.width}x${piece.height}.${format}`, dataBase64 });
  return result.saved;
}

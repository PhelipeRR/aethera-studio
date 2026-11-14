import { z } from 'zod';

export const aetheraMediaProxySchema = z.strictObject({
  schemaVersion: z.literal(1), assetId: z.string().min(1), originalHash: z.string().min(1), relativePath: z.string().min(1), width: z.number().int().positive(), height: z.number().int().positive(), fps: z.number().positive(), codec: z.string().min(1), createdAt: z.string().datetime(),
});
export type AetheraMediaProxy = z.infer<typeof aetheraMediaProxySchema>;

export function aetheraMediaProxyId(assetId: string, originalHash: string): string {
  return `proxy:${assetId}:${originalHash.slice(0, 24)}`;
}

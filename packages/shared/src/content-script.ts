import { z } from 'zod';

export const contentScriptSchema = z.strictObject({
  hook: z.string().default(''),
  outline: z.string().default(''),
  narration: z.string().default(''),
  status: z.enum(['draft', 'approved']).default('draft'),
});
export type ContentScript = z.infer<typeof contentScriptSchema>;

import { z } from 'zod';

export const contentBriefSchema = z.strictObject({
  topic: z.string().trim().min(1).max(500), audience: z.string().trim().min(1).max(300), promise: z.string().trim().min(1).max(500), format: z.enum(['youtube-long', 'youtube-short', 'instagram-reels', 'tiktok', 'square']), durationSeconds: z.number().positive().max(86_400), tone: z.string().trim().min(1).max(100), callToAction: z.string().trim().max(300).default(''),
});
export type ContentBrief = z.infer<typeof contentBriefSchema>;

export const publicationDraftInputSchema = z.strictObject({ brief: contentBriefSchema, title: z.string().trim().min(1).max(100), description: z.string().max(5_000), tags: z.array(z.string().trim().min(1).max(100)).max(500), chapters: z.array(z.strictObject({ time: z.number().nonnegative(), title: z.string().trim().min(1).max(200) })).max(200) });
export type PublicationDraftInput = z.infer<typeof publicationDraftInputSchema>;

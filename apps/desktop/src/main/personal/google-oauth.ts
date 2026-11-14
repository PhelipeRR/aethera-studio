import { z } from 'zod';
import type { OAuthTokens } from '../oauth/loopback.js';

export const PERSONAL_GOOGLE_SCOPES = {
  readOnly: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/calendar.readonly'],
  gmailSend: 'https://www.googleapis.com/auth/gmail.send',
  calendarWrite: 'https://www.googleapis.com/auth/calendar.events',
} as const;
const normalizedTokenSchema = z.strictObject({ accessToken: z.string().min(1), refreshToken: z.string().min(1), expiresAt: z.number(), scopes: z.array(z.string().min(1)) });

export class GooglePersonalOAuth {
  scopes(options: { gmailSend: boolean; calendarWrite: boolean }): string[] {
    return [...PERSONAL_GOOGLE_SCOPES.readOnly, ...(options.gmailSend ? [PERSONAL_GOOGLE_SCOPES.gmailSend] : []), ...(options.calendarWrite ? [PERSONAL_GOOGLE_SCOPES.calendarWrite] : [])];
  }

  normalizeTokens(tokens: OAuthTokens, nowMs = Date.now()): { accessToken: string; refreshToken: string; expiresAt: number; scopes: string[] } {
    return normalizedTokenSchema.parse({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: nowMs + tokens.expires_in * 1000 + 1_000, scopes: (tokens.scope ?? '').split(' ').filter(Boolean).map((scope) => scope.split('/').at(-1) ?? scope) });
  }
}

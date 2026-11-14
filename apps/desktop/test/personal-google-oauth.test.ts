import { describe, expect, it } from 'vitest';
import { PERSONAL_GOOGLE_SCOPES, GooglePersonalOAuth } from '../src/main/personal/google-oauth.js';

describe('GooglePersonalOAuth', () => {
  it('starts with read-only scopes and adds write scopes only explicitly', () => {
    expect(PERSONAL_GOOGLE_SCOPES.readOnly).toEqual(['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/calendar.readonly']);
    expect(new GooglePersonalOAuth().scopes({ gmailSend: false, calendarWrite: false })).toEqual(PERSONAL_GOOGLE_SCOPES.readOnly);
    expect(new GooglePersonalOAuth().scopes({ gmailSend: true, calendarWrite: true })).toEqual(expect.arrayContaining(['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/calendar.events']));
  });

  it('normalizes exchanged tokens without exposing client credentials', () => {
    const result = new GooglePersonalOAuth().normalizeTokens({ access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 'gmail.readonly' }, 1_000);
    expect(result).toEqual({ accessToken: 'a', refreshToken: 'r', expiresAt: 3_602_000, scopes: ['gmail.readonly'] });
    expect(JSON.stringify(result)).not.toContain('client_secret');
  });
});

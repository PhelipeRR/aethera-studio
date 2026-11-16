import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearVoiceStudioVoiceCache, resolveVoiceStudioVoiceId } from '../src/render/real-renderer.js';

const BASE = 'http://voicestudio.test:3900';

function voicesResponse(voices: Array<Record<string, string>>): Response {
  return new Response(JSON.stringify({ voices }), { status: 200, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  clearVoiceStudioVoiceCache();
  vi.unstubAllGlobals();
});

describe('resolveVoiceStudioVoiceId', () => {
  it('looks up the voice list once per baseUrl for every narration paragraph', async () => {
    const fetchMock = vi.fn(async () => voicesResponse([{ voice_id: 'p1', type: 'profile', name: 'Narrador PT-BR' }]));
    vi.stubGlobal('fetch', fetchMock);
    const ids = await Promise.all([1, 2, 3].map(() => resolveVoiceStudioVoiceId(BASE)));
    ids.push(await resolveVoiceStudioVoiceId(BASE));
    expect(ids).toEqual(['p1', 'p1', 'p1', 'p1']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('prefers the narrator profile and keeps base URLs apart', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith(BASE)
        ? voicesResponse([{ voice_id: 'alloy', type: 'openai_alias' }, { voice_id: '9190edfa', name: 'Narrador YouTube PT-BR' }])
        : voicesResponse([{ voice_id: 'other', type: 'profile', name: 'Outro' }]),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await resolveVoiceStudioVoiceId(BASE)).toBe('9190edfa');
    expect(await resolveVoiceStudioVoiceId('http://other.test:3900')).toBe('other');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('matches the narrator profile by name when its id differs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      voicesResponse([{ voice_id: 'pt-generic', type: 'profile', name: 'PT Brasil' }, { voice_id: 'n2', type: 'profile', name: 'Narrador  YouTube PT-BR v2' }]),
    ));
    expect(await resolveVoiceStudioVoiceId(BASE)).toBe('n2');
  });

  it('expires the cached voice after the TTL', async () => {
    const fetchMock = vi.fn(async () => voicesResponse([{ voice_id: 'p1', type: 'profile' }]));
    vi.stubGlobal('fetch', fetchMock);
    let now = 1_000;
    await resolveVoiceStudioVoiceId(BASE, () => now);
    now += 4 * 60_000;
    await resolveVoiceStudioVoiceId(BASE, () => now);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now += 2 * 60_000;
    await resolveVoiceStudioVoiceId(BASE, () => now);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache failed lookups', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('down', { status: 503 }))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(voicesResponse([{ voice_id: 'p1', type: 'profile' }]));
    vi.stubGlobal('fetch', fetchMock);
    expect(await resolveVoiceStudioVoiceId(BASE)).toBe('9190edfa');
    await expect(resolveVoiceStudioVoiceId(BASE)).rejects.toThrow('timeout');
    expect(await resolveVoiceStudioVoiceId(BASE)).toBe('p1');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

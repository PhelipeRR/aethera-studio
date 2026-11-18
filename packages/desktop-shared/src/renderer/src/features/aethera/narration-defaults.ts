export type NarrationDefaultProvider = 'voicestudio' | 'elevenlabs';

export interface NarrationDefaults {
  provider: NarrationDefaultProvider;
  voiceStudioVoiceId: string;
  voiceStudioVoiceName?: string;
  elevenLabsVoiceId: string;
  elevenLabsVoiceName?: string;
}

const STORAGE_KEY = 'aethera:narration-defaults:v1';

const DEFAULT_PREFS: NarrationDefaults = {
  provider: 'voicestudio',
  voiceStudioVoiceId: '9190edfa',
  elevenLabsVoiceId: '',
};

export function loadNarrationDefaults(): NarrationDefaults {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_PREFS };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<NarrationDefaults>;
    return {
      provider: parsed.provider === 'elevenlabs' ? 'elevenlabs' : 'voicestudio',
      voiceStudioVoiceId:
        typeof parsed.voiceStudioVoiceId === 'string' && parsed.voiceStudioVoiceId.trim()
          ? parsed.voiceStudioVoiceId.trim()
          : DEFAULT_PREFS.voiceStudioVoiceId,
      ...(typeof parsed.voiceStudioVoiceName === 'string' && parsed.voiceStudioVoiceName.trim()
        ? { voiceStudioVoiceName: parsed.voiceStudioVoiceName.trim() }
        : {}),
      elevenLabsVoiceId: typeof parsed.elevenLabsVoiceId === 'string' ? parsed.elevenLabsVoiceId.trim() : '',
      ...(typeof parsed.elevenLabsVoiceName === 'string' && parsed.elevenLabsVoiceName.trim()
        ? { elevenLabsVoiceName: parsed.elevenLabsVoiceName.trim() }
        : {}),
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveNarrationDefaults(patch: Partial<NarrationDefaults>): NarrationDefaults {
  const current = loadNarrationDefaults();
  const next: NarrationDefaults = {
    ...current,
    ...patch,
  };
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // storage quota or unavailable in non-browser environment
  }
  return next;
}

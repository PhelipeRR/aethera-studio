import { describe, expect, it } from 'vitest';
import { resolveVoiceStudioExecutable, voiceStudioLaunchPlan } from '../src/main/voice-studio-launch.js';

describe('VoiceStudio startup', () => {
  it('prefers an explicitly configured executable and otherwise finds the per-user install', () => {
    const exists = (path: string): boolean => path.endsWith('VoiceStudio.exe');
    expect(resolveVoiceStudioExecutable({ platform: 'win32', env: { NB_VOICESTUDIO_EXE: 'D:\\Apps\\VoiceStudio.exe' }, exists })).toBe('D:\\Apps\\VoiceStudio.exe');
    expect(resolveVoiceStudioExecutable({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\Pheli' }, exists })).toBe('C:\\Users\\Pheli\\Programs\\VoiceStudio\\VoiceStudio.exe');
  });

  it('starts VoiceStudio detached and schedules it to the tray', () => {
    expect(voiceStudioLaunchPlan('C:\\Apps\\VoiceStudio.exe')).toEqual({ executable: 'C:\\Apps\\VoiceStudio.exe', hideWindow: true });
  });
});

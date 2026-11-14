import { IpcChannel, neuraSettingsSchema, type NeuraSettings, type NeuraSettingsPatch } from '@neuralbridge/shared';
import type { NeuraOrchestrator } from '@neuralbridge/orchestrator';
import { registerIpcHandler, type IpcMainLike } from './ipc/handle.js';
import type { NeuraSpeechOutput } from './neura-speech.js';

export interface NeuraSettingsStore { read(): NeuraSettings; write(settings: NeuraSettings): void; }
export interface VoiceCapture { accept?(wav: Buffer): void; acceptPcm?(pcm: Buffer): void; diagnostic?(input: { deviceLabel: string; peak: number; lastFrameAt: number }): void; captureFailed?(detail: string): void; }

/** Every handler checks the sender and validates both directions through `registerIpcHandler`. */
export function registerNeuraIpc(ipc: IpcMainLike, neura: NeuraOrchestrator, store: NeuraSettingsStore, isTrustedSender: (url: string) => boolean, speech?: NeuraSpeechOutput, voice?: VoiceCapture, copyText: (text: string) => void = () => undefined, meetingAudio?: { accept(pcm: Buffer): void; captureFailed(): void }): void {
  // IPC invocations can arrive from more than one renderer window. Serialize
  // writes in the main process as a second line of defense, and merge patches
  // against the latest persisted settings inside the queue.
  let settingsUpdateQueue = Promise.resolve();
  const ok = { ok: true as const };
  registerIpcHandler(ipc, IpcChannel.neuraState, async () => neura.state(), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.neuraVoiceStart, (input) => neura.startVoice(input), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.neuraVoiceStop, async ({ sessionId }) => { await neura.stopVoice(sessionId); return ok; }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.neuraMeetingStart, (input) => neura.startMeeting(input), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.neuraMeetingStop, async ({ sessionId }) => { await neura.stopMeeting(sessionId); return ok; }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.neuraMeetingTranscript, async (input) => { neura.addMeetingTranscript(input); return ok; }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.neuraSuggestionDecide, async (input) => neura.decideSuggestion(input), isTrustedSender);
  // Here and not in the renderer: the browser clipboard needs a focused window, and the bubble must leave focus where it is.
  registerIpcHandler(ipc, IpcChannel.neuraSuggestionCopy, async ({ suggestionId }) => {
    const suggestion = neura.state().suggestions.find((item) => item.suggestionId === suggestionId);
    if (!suggestion) throw new Error('neura_not_found');
    copyText(suggestion.text);
    return neura.decideSuggestion({ suggestionId, decision: 'copy' });
  }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.neuraInput, ({ text }) => neura.handleTranscript({ text, voice: false }), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.neuraActionDecide, (input) => neura.decideAction(input), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.neuraPauseAll, () => neura.pauseAll(), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.neuraResume, async () => neura.resume(), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.neuraSpeechFinished, async () => { neura.finishedSpeaking(); return ok; }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.neuraSpeak, async (input) => {
    if (!speech) throw new Error('VoiceStudio não está configurado.');
    return speech.speak(input);
  }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.neuraVoiceAudio, async (input) => {
    if ('pcmBase64' in input) voice?.acceptPcm?.(Buffer.from(input.pcmBase64, 'base64'));
    else if ('wavBase64' in input) voice?.accept?.(Buffer.from(input.wavBase64, 'base64'));
    else if ('diagnostic' in input) neura.reportVoiceSignal(input.diagnostic);
    else voice?.captureFailed?.('não consegui acessar o microfone.');
    return ok;
  }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.neuraMeetingAudio, async (input) => {
    if ('pcmBase64' in input) meetingAudio?.accept(Buffer.from(input.pcmBase64, 'base64'));
    else meetingAudio?.captureFailed();
    return ok;
  }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.neuraSettings, async () => store.read(), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.neuraSettingsUpdate, async (changes: NeuraSettingsPatch) => {
    const update = settingsUpdateQueue.then(async () => {
      const next = neuraSettingsSchema.parse({ ...store.read(), ...changes });
      store.write(next);
      // Consent can be taken back mid-session; anything it covered ends here.
      await neura.applySettings();
      return next;
    });
    settingsUpdateQueue = update.then(() => undefined, () => undefined);
    return update;
  }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.neuraClearHistory, async () => neura.clearHistory(), isTrustedSender);
}

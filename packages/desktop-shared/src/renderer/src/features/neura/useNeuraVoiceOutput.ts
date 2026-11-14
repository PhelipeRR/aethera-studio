import * as React from 'react';
import type { NeuraState } from '@neuralbridge/shared/neura-state';
import { speak, stopSpeech } from './useNeura';
import { replyBubbleMs } from './neura-state';
import { playWakeBeep } from './wake-beep';

/**
 * What the user hears. It lives with the HUD and not the panel: being called by voice is exactly when the panel is closed,
 * and nothing else tells the user the wake word landed or what came of the request. Returns whether a spoken answer is
 * still being generated: the text is ready, but nothing can be heard yet.
 */
export interface NeuraSilentReply { id: string; text: string; }

export function useNeuraVoiceOutput(state: NeuraState | null): { preparingVoice: boolean; silentReply: NeuraSilentReply | null; dismissReply: () => void } {
  const { neura } = window.neuralbridge;

  // Each spoken answer is said once, and the gateway hears when it ends so the wake word gate can reopen.
  const said = React.useRef<string | null>(null);
  const [preparing, setPreparing] = React.useState(false);
  const [silentReply, setSilentReply] = React.useState<NeuraSilentReply | null>(null);
  // A call stops the voice and takes the silent bubble down before the beep, so the next answer starts from nothing.
  React.useEffect(() => neura.onWake(() => { stopSpeech(); setSilentReply(null); setPreparing(false); playWakeBeep(); }), [neura]);
  const response = state?.lastResponse;
  React.useEffect(() => {
    if (!response?.speak || said.current === response.correlationId) return;
    said.current = response.correlationId;
    const { correlationId, message, at } = response;
    setPreparing(true);
    void neura.settings().then((settings) => settings, () => null).then((settings) => {
      if (said.current !== correlationId) return;
      if (settings?.silentReplies) {
        // Nothing is said, so the wake word gate reopens at once.
        setPreparing(false);
        setSilentReply({ id: correlationId, text: message });
        void neura.speechFinished();
        return;
      }
      const language = settings?.preferredLanguage ?? 'pt-BR';
      void speak(message, language, () => { setPreparing(false); void neura.speechFinished(); }, () => { setPreparing(false); console.info('neura.voice.first_audio_ms', Date.now() - Date.parse(at)); });
    });
  }, [response, neura]);
  React.useEffect(() => {
    if (!silentReply) return;
    const timer = setTimeout(() => setSilentReply((current) => current === silentReply ? null : current), replyBubbleMs(silentReply.text));
    return () => clearTimeout(timer);
  }, [silentReply]);
  const dismissReply = React.useCallback(() => setSilentReply(null), []);
  return { preparingVoice: preparing, silentReply, dismissReply };
}

import { useCallback, useEffect, useRef, useState } from 'react';

interface TtsProviderInfo {
 id: string;
 displayName: string;
 configured: boolean;
}

interface TtsVoice {
 id: string;
 name: string;
 language?: string;
 previewUrl?: string;
 labels?: Record<string, string>;
}

interface TtsCapabilities {
 supportsPreview: boolean;
 supportsLanguageSelection: boolean;
 requiresCredits: boolean;
 maxCharactersPerRequest?: number;
}

interface TtsBridge {
 ttsListProviders?: () => Promise<TtsProviderInfo[]>;
 ttsListVoices?: (providerId: string) => Promise<TtsVoice[]>;
 ttsGetPreviewUrl?: (input: { providerId: string; voiceId: string }) => Promise<string | null>;
 ttsGetCapabilities?: (providerId: string) => Promise<TtsCapabilities>;
 ttsHealthCheck?: (providerId: string) => Promise<{ ok: boolean; message?: string }>;
 ttsElevenLabsSaveCredentials?: (credentials: { apiKey: string; modelId?: string }) => Promise<unknown>;
 ttsElevenLabsClearCredentials?: () => Promise<unknown>;
}

function getBridge(): TtsBridge | undefined {
 return (window as unknown as { aetheraBridge?: TtsBridge }).aetheraBridge;
}

interface TtsProviderSelectorProps {
 selectedProviderId?: string;
 selectedVoiceId?: string;
 onProviderChange?: (providerId: string) => void;
 onVoiceChange?: (voiceId: string) => void;
 disabled?: boolean;
 /** Hide the provider dropdown when the host already chose the provider. */
 hideProviderSelect?: boolean;
}

export function TtsProviderSelector({
 selectedProviderId,
 selectedVoiceId,
 onProviderChange,
 onVoiceChange,
 disabled,
 hideProviderSelect,
}: TtsProviderSelectorProps) {
 const [providers, setProviders] = useState<TtsProviderInfo[]>([]);
 const [voices, setVoices] = useState<TtsVoice[]>([]);
 const [capabilities, setCapabilities] = useState<TtsCapabilities | null>(null);
 const [loadingVoices, setLoadingVoices] = useState(false);
 const [previewPlaying, setPreviewPlaying] = useState(false);
 const [previewError, setPreviewError] = useState<string | null>(null);
 const [apiKeyDraft, setApiKeyDraft] = useState('');
 const [editingKey, setEditingKey] = useState(false);
 const [credentialBusy, setCredentialBusy] = useState(false);
 const [credentialStatus, setCredentialStatus] = useState<{ ok: boolean; text: string } | null>(null);
 const audioRef = useRef<HTMLAudioElement | null>(null);
 const fetchSeqRef = useRef(0);
 const selectedVoiceRef = useRef(selectedVoiceId);
 selectedVoiceRef.current = selectedVoiceId;
 const onVoiceChangeRef = useRef(onVoiceChange);
 onVoiceChangeRef.current = onVoiceChange;

 const refreshProviders = useCallback(async () => {
 const bridge = getBridge();
 if (!bridge?.ttsListProviders) return;
 try {
 setProviders(await bridge.ttsListProviders());
 } catch {
 // provider list stays as-is
 }
 }, []);

 // Load providers on mount
 useEffect(() => {
 void refreshProviders();
 }, [refreshProviders]);

 // Load voices when provider changes
 const loadVoices = useCallback(async (providerId: string) => {
 const bridge = getBridge();
 if (!bridge?.ttsListVoices || !bridge?.ttsGetCapabilities) return;
 const seq = ++fetchSeqRef.current;
 setLoadingVoices(true);
 setPreviewError(null);
 try {
 const [voiceList, caps] = await Promise.all([
 bridge.ttsListVoices(providerId),
 bridge.ttsGetCapabilities(providerId),
 ]);
 // Prevent stale async responses from overwriting newer selection
 if (seq !== fetchSeqRef.current) return;
 setVoices(voiceList);
 setCapabilities(caps);
 // Keep the host in sync with the voice the dropdown actually shows.
 const first = voiceList[0];
 if (first && !voiceList.some((v) => v.id === selectedVoiceRef.current)) {
 onVoiceChangeRef.current?.(first.id);
 }
 } catch (err) {
 if (seq !== fetchSeqRef.current) return;
 setVoices([]);
 setCapabilities(null);
 setPreviewError(err instanceof Error ? err.message : String(err));
 } finally {
 if (seq === fetchSeqRef.current) setLoadingVoices(false);
 }
 }, []);

 useEffect(() => {
 if (selectedProviderId) {
 void loadVoices(selectedProviderId);
 }
 }, [selectedProviderId, loadVoices]);

 // Stop preview audio on unmount or provider/voice change
 useEffect(() => {
 return () => {
 if (audioRef.current) {
 audioRef.current.pause();
 audioRef.current.src = '';
 }
 };
 }, [selectedProviderId, selectedVoiceId]);

 const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
 const id = e.target.value;
 onProviderChange?.(id);
 // Voice will be reset by parent; stop any playing preview
 if (audioRef.current) {
 audioRef.current.pause();
 setPreviewPlaying(false);
 }
 };

 const handleVoiceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
 onVoiceChange?.(e.target.value);
 if (audioRef.current) {
 audioRef.current.pause();
 setPreviewPlaying(false);
 }
 };

 const handlePreview = async () => {
 if (!selectedProviderId || !selectedVoiceId) return;
 const bridge = getBridge();

 // If already playing, pause
 if (previewPlaying && audioRef.current) {
 audioRef.current.pause();
 setPreviewPlaying(false);
 return;
 }

 setPreviewError(null);
 try {
 let url: string | null = null;
 if (bridge?.ttsGetPreviewUrl) {
 url = await bridge.ttsGetPreviewUrl({ providerId: selectedProviderId, voiceId: selectedVoiceId });
 }
 if (!url) {
 // Fallback: use previewUrl from loaded voices
 const voice = voices.find((v) => v.id === selectedVoiceId);
 url = voice?.previewUrl ?? null;
 }
 if (!url) {
 setPreviewError('Prévia não disponível para esta voz.');
 return;
 }
 if (audioRef.current) {
 audioRef.current.src = url;
 await audioRef.current.play();
 setPreviewPlaying(true);
 audioRef.current.onended = () => setPreviewPlaying(false);
 audioRef.current.onerror = () => {
 setPreviewPlaying(false);
 setPreviewError('Erro ao reproduzir prévia.');
 };
 }
 } catch (err) {
 setPreviewError(err instanceof Error ? err.message : String(err));
 }
 };

 const handleSaveApiKey = async () => {
 const bridge = getBridge();
 const apiKey = apiKeyDraft.trim();
 if (!bridge?.ttsElevenLabsSaveCredentials || !apiKey) return;
 setCredentialBusy(true);
 setCredentialStatus(null);
 try {
 await bridge.ttsElevenLabsSaveCredentials({ apiKey });
 setApiKeyDraft('');
 const health = await bridge.ttsHealthCheck?.('elevenlabs');
 if (health && !health.ok) {
 setCredentialStatus({ ok: false, text: `Chave salva, mas a verificação falhou: ${health.message ?? 'erro desconhecido'}` });
 } else {
 setCredentialStatus({ ok: true, text: 'Chave salva e verificada.' });
 setEditingKey(false);
 }
 await refreshProviders();
 if (selectedProviderId) await loadVoices(selectedProviderId);
 } catch (err) {
 setCredentialStatus({ ok: false, text: err instanceof Error ? err.message : String(err) });
 } finally {
 setCredentialBusy(false);
 }
 };

 const handleClearApiKey = async () => {
 const bridge = getBridge();
 if (!bridge?.ttsElevenLabsClearCredentials) return;
 setCredentialBusy(true);
 setCredentialStatus(null);
 try {
 await bridge.ttsElevenLabsClearCredentials();
 setCredentialStatus({ ok: true, text: 'Chave removida.' });
 await refreshProviders();
 setVoices([]);
 } catch (err) {
 setCredentialStatus({ ok: false, text: err instanceof Error ? err.message : String(err) });
 } finally {
 setCredentialBusy(false);
 }
 };

 const activeProvider = providers.find((p) => p.id === selectedProviderId);
 const isElevenLabs = selectedProviderId === 'elevenlabs';
 const showKeyForm = isElevenLabs && (editingKey || (activeProvider ? !activeProvider.configured : false));
 const showPreviewBtn = capabilities?.supportsPreview && selectedVoiceId;
 const requiresCredits = capabilities?.requiresCredits ?? false;

 const fieldClass = 'rounded-xl border border-border bg-background px-3 py-1.5 text-xs text-foreground disabled:opacity-50';
 const buttonClass =
 'rounded-xl border border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:border-primary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap';
 const visibleError = previewError && !(isElevenLabs && previewError.includes('unconfigured:')) ? previewError : null;

 return (
 <div className="flex flex-col gap-2">
 <div className="flex flex-wrap items-center gap-2">
 {!hideProviderSelect && (
 <select
 aria-label="Provedor de voz"
 value={selectedProviderId ?? ''}
 onChange={handleProviderChange}
 disabled={disabled || providers.length === 0}
 className={fieldClass}
 >
 {providers.map((p) => (
 <option key={p.id} value={p.id}>
 {p.displayName}{!p.configured ? ' (não configurado)' : ''}
 </option>
 ))}
 </select>
 )}
 <select
 aria-label={`Voz${requiresCredits ? ' (consome créditos)' : ''}`}
 value={selectedVoiceId ?? ''}
 onChange={handleVoiceChange}
 disabled={disabled || loadingVoices || voices.length === 0}
 className={`${fieldClass} min-w-[220px]`}
 >
 {loadingVoices && <option>Carregando vozes...</option>}
 {!loadingVoices && voices.length === 0 && (
 <option>{isElevenLabs && !activeProvider?.configured ? 'Configure a API Key para listar vozes' : 'Nenhuma voz disponível'}</option>
 )}
 {voices.map((v) => (
 <option key={v.id} value={v.id}>
 Voz: {v.name}{v.language ? ` (${v.language})` : ''}
 </option>
 ))}
 </select>
 {showPreviewBtn && (
 <button type="button" onClick={() => void handlePreview()} disabled={disabled} className={buttonClass}>
 {previewPlaying ? '⏹ Parar' : '▶ Ouvir prévia'}
 </button>
 )}
 {isElevenLabs && activeProvider?.configured && !editingKey && (
 <>
 <span className="text-[11px] text-emerald-300">API Key configurada</span>
 <button type="button" onClick={() => setEditingKey(true)} disabled={disabled || credentialBusy} className={buttonClass}>
 Trocar chave
 </button>
 <button type="button" onClick={() => void handleClearApiKey()} disabled={disabled || credentialBusy} className={buttonClass}>
 Remover
 </button>
 </>
 )}
 </div>

 {showKeyForm && (
 <form
 onSubmit={(e) => {
 e.preventDefault();
 void handleSaveApiKey();
 }}
 className="flex flex-col gap-1.5 rounded-xl border border-border bg-background/60 p-3"
 >
 <label htmlFor="elevenlabs-api-key" className="text-[11px] font-semibold text-foreground">
 API Key do ElevenLabs
 </label>
 <div className="flex flex-wrap gap-2">
 <input
 id="elevenlabs-api-key"
 type="password"
 autoComplete="off"
 spellCheck={false}
 value={apiKeyDraft}
 onChange={(e) => setApiKeyDraft(e.target.value)}
 placeholder="Cole a chave (xi-api-key)"
 disabled={disabled || credentialBusy}
 className={`${fieldClass} min-w-[260px] flex-1`}
 />
 <button type="submit" disabled={disabled || credentialBusy || !apiKeyDraft.trim()} className={buttonClass}>
 {credentialBusy ? 'Verificando...' : 'Salvar e testar'}
 </button>
 {editingKey && (
 <button type="button" onClick={() => setEditingKey(false)} disabled={credentialBusy} className={buttonClass}>
 Cancelar
 </button>
 )}
 </div>
 <p className="text-[11px] text-muted-foreground">
 A chave fica criptografada pelo sistema operacional neste computador e não é exibida de volta.
 </p>
 </form>
 )}

 {credentialStatus && (
 <div role="status" className={`text-[11px] ${credentialStatus.ok ? 'text-emerald-300' : 'text-red-400'}`}>
 {credentialStatus.text}
 </div>
 )}
 {visibleError && <div className="text-[11px] text-red-400">{visibleError}</div>}
 {activeProvider && !activeProvider.configured && !isElevenLabs && (
 <div className="text-[11px] text-amber-300">Este provedor ainda não está configurado.</div>
 )}
 {requiresCredits && activeProvider?.configured && (
 <div className="text-[11px] text-amber-300">
 Este provedor consome créditos por caractere. A prévia usa o áudio oficial gratuito quando disponível.
 </div>
 )}

 {/* Hidden audio element for preview playback */}
 <audio ref={audioRef} preload="none" />
 </div>
 );
}

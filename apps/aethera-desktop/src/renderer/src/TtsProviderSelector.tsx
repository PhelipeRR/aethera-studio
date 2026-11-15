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
}

export function TtsProviderSelector({
 selectedProviderId,
 selectedVoiceId,
 onProviderChange,
 onVoiceChange,
 disabled,
}: TtsProviderSelectorProps) {
 const [providers, setProviders] = useState<TtsProviderInfo[]>([]);
 const [voices, setVoices] = useState<TtsVoice[]>([]);
 const [capabilities, setCapabilities] = useState<TtsCapabilities | null>(null);
 const [loadingVoices, setLoadingVoices] = useState(false);
 const [previewPlaying, setPreviewPlaying] = useState(false);
 const [previewError, setPreviewError] = useState<string | null>(null);
 const audioRef = useRef<HTMLAudioElement | null>(null);
 const fetchSeqRef = useRef(0);

 // Load providers on mount
 useEffect(() => {
 const bridge = getBridge();
 if (!bridge?.ttsListProviders) return;
 void bridge.ttsListProviders().then(setProviders).catch(() => {});
 }, []);

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

 const activeProvider = providers.find((p) => p.id === selectedProviderId);
 const showPreviewBtn = capabilities?.supportsPreview && selectedVoiceId;
 const requiresCredits = capabilities?.requiresCredits ?? false;

 return (
 <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
 {/* Provider selector */}
 <div>
 <label style={{ fontSize: 12, color: '#99f6e4', marginBottom: 4, display: 'block' }}>
 Provedor de voz
 </label>
 <select
 value={selectedProviderId ?? ''}
 onChange={handleProviderChange}
 disabled={disabled || providers.length === 0}
 style={{
 width: '100%',
 padding: '6px 10px',
 borderRadius: 6,
 border: '1px solid #115e59',
 background: '#071110',
 color: '#ecfdf5',
 fontSize: 13,
 }}
 >
 {providers.map((p) => (
 <option key={p.id} value={p.id}>
 {p.displayName}{!p.configured ? ' (não configurado)' : ''}
 </option>
 ))}
 </select>
 </div>

 {/* Voice selector */}
 <div>
 <label style={{ fontSize: 12, color: '#99f6e4', marginBottom: 4, display: 'block' }}>
 Voz{requiresCredits ? ' ⚡ (requer créditos)' : ''}
 </label>
 <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
 <select
 value={selectedVoiceId ?? ''}
 onChange={handleVoiceChange}
 disabled={disabled || loadingVoices || voices.length === 0}
 style={{
 flex: 1,
 padding: '6px 10px',
 borderRadius: 6,
 border: '1px solid #115e59',
 background: '#071110',
 color: '#ecfdf5',
 fontSize: 13,
 }}
 >
 {loadingVoices && <option>Carregando vozes...</option>}
 {!loadingVoices && voices.length === 0 && <option>Nenhuma voz disponível</option>}
 {voices.map((v) => (
 <option key={v.id} value={v.id}>
 {v.name}{v.language ? ` (${v.language})` : ''}
 </option>
 ))}
 </select>
 {showPreviewBtn && (
 <button
 type="button"
 onClick={() => void handlePreview()}
 disabled={disabled}
 style={{
 padding: '6px 12px',
 borderRadius: 6,
 border: '1px solid #115e59',
 background: previewPlaying ? '#b91c1c' : '#0f3d3a',
 color: previewPlaying ? '#fecaca' : '#99f6e4',
 cursor: disabled ? 'not-allowed' : 'pointer',
 fontSize: 12,
 whiteSpace: 'nowrap',
 }}
 >
 {previewPlaying ? '⏹ Parar' : '▶ Ouvir prévia'}
 </button>
 )}
 </div>
 </div>

 {/* Status messages */}
 {previewError && (
 <div style={{ fontSize: 11, color: '#f87171' }}>{previewError}</div>
 )}
 {activeProvider && !activeProvider.configured && (
 <div style={{ fontSize: 11, color: '#fbbf24' }}>
 Configure as credenciais deste provedor em Configurações → Provedores de voz.
 </div>
 )}
 {requiresCredits && (
 <div style={{ fontSize: 11, color: '#fbbf24' }}>
 Este provedor consome créditos por caractere. A prévia usa áudio oficial gratuito quando disponível.
 </div>
 )}

 {/* Hidden audio element for preview playback */}
 {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
 <audio ref={audioRef} preload="none" />
 </div>
 );
}
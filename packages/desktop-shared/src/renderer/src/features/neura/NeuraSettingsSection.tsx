import { useEffect, useMemo, useRef, useState } from 'react';
import type { NeuraSettings, NeuraSettingsPatch, NeuraState } from '@neuralbridge/shared/neura-state';
import { useNeura } from './useNeura';
import { createSerializedNeuraSettingsUpdater } from './neura-settings-update';

interface ProjectOption { id: string; name: string; }

/** Off until the user turns it on, with one consent for each thing that observes them. */
export function NeuraSettingsSection() {
  const { neura, projects } = window.neuralbridge;
  const [settings, setSettings] = useState<NeuraSettings | null>(null);
  const desiredSettings = useRef<NeuraSettings | null>(null);
  const [options, setOptions] = useState<ProjectOption[]>([]);
  const [cleared, setCleared] = useState<number | null>(null);
  const updateSettings = useMemo(() => createSerializedNeuraSettingsUpdater<NeuraSettingsPatch, NeuraSettings>((changes) => neura.updateSettings(changes)), [neura]);
  const state: NeuraState | null = useNeura();
  useEffect(() => {
    void neura.settings().then((next) => { desiredSettings.current = next; setSettings(next); }).catch(() => undefined);
    void projects.list().then((items) => setOptions(items.map(({ id, name }) => ({ id, name })))).catch(() => undefined);
  }, [neura, projects]);
  if (!settings) return null;
  const update = (changes: NeuraSettingsPatch) => {
    const next = { ...(desiredSettings.current ?? settings), ...changes } as NeuraSettings;
    desiredSettings.current = next;
    setSettings(next);
    // Keep the optimistic local merge authoritative while queued patches are still in flight.
    // Applying an older full snapshot here would visually undo another checkbox just clicked.
    // Send only the changed fields. The main process merges each patch against
    // the latest persisted snapshot, so simultaneous controls cannot overwrite
    // one another with an older full object.
    void updateSettings(changes).catch(() => {
      desiredSettings.current = null;
      void neura.settings().then((latest) => { desiredSettings.current = latest; setSettings(latest); }).catch(() => undefined);
    });
  };
  const check = (key: 'enabled' | 'voiceConsent' | 'meetingConsent' | 'meetingAudioConsent' | 'screenConsent' | 'locationConsent' | 'translationEnabled' | 'retainSuggestions' | 'globalMemoryEnabled' | 'silentReplies', label: string, hint?: string) => (
    <label className="flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 hover:bg-accent">
      <input type="checkbox" className="mt-1" checked={settings[key]} onChange={(event) => update({ [key]: event.target.checked } as NeuraSettingsPatch)} />
      <span><span className="font-medium">{label}</span>{hint && <span className="block text-muted-foreground">{hint}</span>}</span>
    </label>
  );

  return (
    <section aria-labelledby="neura-heading">
      <h2 id="neura-heading" className="text-base font-medium">Void</h2>
      <p className="mt-1 text-muted-foreground">Assistente por voz e texto no Companion. Nada é observado até você ativar, e o painel do Companion mostra sempre o que está ligado.</p>
      <div className="mt-4 space-y-1">
        {check('enabled', 'Ativar o Void')}
        {settings.enabled && <>
          {check('voiceConsent', 'Permitir ouvir o microfone', 'O reconhecimento roda no VoiceStudio, neste computador, e só reage depois da palavra de ativação configurada. Nenhum áudio é salvo.')}
          {check('meetingConsent', 'Permitir sugestões em reuniões', 'O texto que você colar vai para o agente escolhido, que pode processá-lo fora deste computador. Avise os participantes quando for adequado.')}
          {check('meetingAudioConsent', 'Permitir ouvir o áudio das calls', 'Ao tocar em Ouvir a call, tudo o que este computador reproduz é transcrito no VoiceStudio, neste computador, e nenhum áudio é salvo. O texto pode sair daqui para o agente escolhido. Avise os participantes e siga as regras da sua empresa.')}
          {check('screenConsent', 'Permitir visualizar a tela', 'O Void captura uma imagem somente quando você perguntar o que está na tela. A imagem é temporária e pode ser enviada ao agente para descrição.')}
          {check('locationConsent', 'Permitir localização para consultar o clima', 'A localização só é solicitada quando você perguntar sobre o tempo e não é salva.')}
          <label className="block px-3 pt-1" htmlFor="neura-weather-location"><span className="font-medium">Cidade alternativa para o clima</span><input id="neura-weather-location" className="mt-1 w-full rounded-md border bg-transparent px-2 py-1.5" value={settings.weatherLocation ?? ''} placeholder="Ex.: São Paulo" onChange={(event) => setSettings({ ...settings, weatherLocation: event.target.value || null })} onBlur={(event) => update({ weatherLocation: event.target.value.trim() || null })} /><span className="block text-muted-foreground">Usada somente se a localização do Windows não estiver disponível.</span></label>
          {check('translationEnabled', 'Mostrar tradução das sugestões')}
          {check('retainSuggestions', 'Guardar o histórico de sugestões', 'Desligado, as sugestões ficam só na memória até fechar o app.')}
          {check('silentReplies', 'Modo silencioso', 'O Void responde num balão ao lado do mascote em vez de falar. O som de chamada e o toque de cada balão continuam.')}
          {check('globalMemoryEnabled', 'Usar memórias globais na conversa', 'Desligado, o Void deixa de consultar as memórias globais. Elas continuam no Brain, onde podem ser apagadas, e o histórico de sugestões não muda. Memórias de projeto só entram com aquele projeto selecionado.')}
          <div className="grid gap-3 px-3 pt-2 sm:grid-cols-2">
            <label htmlFor="void-wake-word" className="font-medium">Palavra de ativação<input id="void-wake-word" className="mt-1 w-full rounded-md border bg-transparent px-2 py-1.5" value={settings.wakeWord} onChange={(event) => setSettings({ ...settings, wakeWord: event.target.value })} onBlur={(event) => update({ wakeWord: event.target.value.trim() || 'Void' })} /><span className="block text-muted-foreground">Padrão: Void.</span></label>
            <label htmlFor="void-wake-aliases" className="font-medium">Aliases temporários<input id="void-wake-aliases" className="mt-1 w-full rounded-md border bg-transparent px-2 py-1.5" value={settings.wakeWordAliases.join(', ')} onChange={(event) => setSettings({ ...settings, wakeWordAliases: event.target.value.split(',').map((alias) => alias.trim()).filter(Boolean) })} onBlur={(event) => update({ wakeWordAliases: event.target.value.split(',').map((alias) => alias.trim()).filter(Boolean) })} /><span className="block text-muted-foreground">Separados por vírgula; Neura fica preservado até você remover.</span></label>
          </div>
          <div className="grid gap-3 px-3 pt-2 sm:grid-cols-3">
            <div>
              <label htmlFor="neura-project" className="font-medium">Projeto do agente (opcional)</label>
              <select id="neura-project" className="mt-1 w-full rounded-md border bg-transparent px-2 py-1.5" value={settings.projectId ?? ''} onChange={(event) => update({ projectId: event.target.value || null })}>
                <option value="">Nenhum</option>
                {options.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="neura-agent" className="font-medium">Agente</label>
              <select id="neura-agent" className="mt-1 w-full rounded-md border bg-transparent px-2 py-1.5" value={settings.agent} onChange={(event) => update({ agent: event.target.value as NeuraSettings['agent'] })}>
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
              </select>
            </div>
            <div>
              <label htmlFor="neura-language" className="font-medium">Seu idioma</label>
              <select id="neura-language" className="mt-1 w-full rounded-md border bg-transparent px-2 py-1.5" value={settings.preferredLanguage} onChange={(event) => update({ preferredLanguage: event.target.value })}>
                <option value="pt-BR">Português</option>
                <option value="en-US">English</option>
                <option value="es-ES">Español</option>
              </select>
            </div>
          </div>
          {state && <ul className="space-y-1 px-3 pt-3 text-muted-foreground" aria-label="Estado dos provedores">
            <li>Voz: {state.providers.voice.detail}</li>
            <li>Agente: {state.providers.model.detail}</li>
            <li>Worker: {state.providers.worker.detail}</li>
          </ul>}
          <div className="flex items-center gap-3 px-3 pt-2">
            <button type="button" className="rounded-md border px-3 py-1.5 hover:bg-accent" onClick={() => void neura.clearHistory().then(({ removed }) => setCleared(removed)).catch(() => undefined)}>Apagar histórico de sugestões</button>
            {cleared !== null && <span role="status" className="text-muted-foreground">{cleared === 1 ? '1 sugestão apagada.' : `${cleared} sugestões apagadas.`}</span>}
          </div>
        </>}
      </div>
    </section>
  );
}

import { useState } from 'react';
import type { VideoStudioState } from '@neuralbridge/shared/channels';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';
import { DEFAULT_STYLE_CHOICE, stylesForVideo, type ProductionStyleChoice } from '@neuralbridge/shared/video-styles';
import { StyleGallery, useAllVideoStyles } from './StyleGallery';
import { ProgressBar } from './ProgressBar';

const INPUT = 'mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const BLOCK_LABELS: Record<string, string> = { lead: 'Título', texto: 'Texto', grande: 'Palavra grande', tarja: 'Tarja', foto: 'Foto', cards: 'Cards', pontos: 'Grade de pontos', barras: 'Barras', contador: 'Contador', nota: 'Nota', citacao: 'Citação', grafico: 'Gráfico', balanca: 'Balança' };
const HIDDEN = new Set(['tipo', 'at', 'frase']);

type Block = Record<string, unknown> & { tipo?: string; at?: number };
type Scene = { at?: number; capitulo?: { n?: number; titulo?: string; cor?: string }; fonte?: string; blocos?: Block[] };
type Video = { serie?: string; rodape?: string; duracao?: number; cenas?: Scene[] };

function BlockFields({ block, onChange }: { block: Block; onChange: (next: Block) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {Object.entries(block).filter(([key]) => !HIDDEN.has(key)).map(([key, value]) => {
        const label = key[0]?.toUpperCase() + key.slice(1);
        if (typeof value === 'object' && value !== null) {
          return <label key={key} className="block text-xs font-medium sm:col-span-2">{label}<textarea aria-label={label} className={`${INPUT} min-h-20 font-mono text-xs`} defaultValue={JSON.stringify(value, null, 1)} onBlur={(event) => { try { onChange({ ...block, [key]: JSON.parse(event.target.value) as unknown }); } catch { event.target.setCustomValidity('JSON inválido'); event.target.reportValidity(); } }} /></label>;
        }
        return <label key={key} className="block text-xs font-medium">{label}<input aria-label={label} className={INPUT} value={String(value ?? '')} onChange={(event) => onChange({ ...block, [key]: typeof value === 'number' ? Number(event.target.value) : event.target.value })} /></label>;
      })}
    </div>
  );
}

function VoiceStudioNarration({ video, text, onGenerated }: { video: string; text: string; onGenerated: () => void }) {
  const [modelId, setModelId] = useState('');
  const [voiceId, setVoiceId] = useState('');
  const [format, setFormat] = useState<'mp3' | 'wav'>('mp3');
  const [confirmed, setConfirmed] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const status = useQuery({ queryKey: ['velix-voicestudio', video], queryFn: () => window.neuralbridge.video.narrationStatus(video), enabled: !!video });
  const models = status.data?.models.filter((item) => item.installed) ?? [];
  const voices = status.data?.voices ?? [];
  const selectedModel = modelId || models[0]?.id || '';
  const selectedVoice = voiceId || voices[0]?.id || '';
  const generate = useMutation({ mutationFn: () => window.neuralbridge.video.narrationGenerate({ name: video, text, modelId: selectedModel, voiceId: selectedVoice, format, license: { provider: 'reviewed', model: 'reviewed', voice: 'reviewed', output: 'reviewed', userConfirmed: confirmed } }), onSuccess: () => { setPreview(null); void status.refetch(); onGenerated(); } });
  const listen = useMutation({ mutationFn: () => window.neuralbridge.video.narrationPreview({ name: video, ...(status.data?.asset ? { assetId: status.data.asset.id } : {}) }), onSuccess: setPreview });
  return <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4" aria-label="VoiceStudio local">
    <div><h4 className="font-medium">VoiceStudio local</h4><p className="text-xs text-muted-foreground">Conecta somente ao VoiceStudio local em localhost:3900. O aplicativo, o modelo, a voz e o áudio têm licenças independentes.</p></div>
    {status.isLoading && <p role="status" className="text-xs text-muted-foreground">Verificando o VoiceStudio…</p>}
    {!status.isLoading && !status.data?.available && <p role="status" className="text-xs text-muted-foreground">VoiceStudio indisponível. O fluxo manual com ElevenLabs continua disponível.</p>}
    {status.data?.available && !status.data.compatible && <p role="alert" className="text-xs text-destructive">{status.data.error ?? 'A versão local do VoiceStudio não é compatível.'}</p>}
    {status.data?.compatible && <>
      <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs font-medium">Modelo<select aria-label="Modelo VoiceStudio" className={INPUT} value={selectedModel} onChange={(event) => setModelId(event.target.value)}>{models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label className="block text-xs font-medium">Voz<select aria-label="Voz VoiceStudio" className={INPUT} value={selectedVoice} onChange={(event) => setVoiceId(event.target.value)}>{voices.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div>
      <label className="block text-xs font-medium">Formato<select aria-label="Formato da narração" className={INPUT} value={format} onChange={(event) => setFormat(event.target.value as 'mp3' | 'wav')}><option value="mp3">MP3</option><option value="wav">WAV</option></select></label>
      {models.find((item) => item.id === selectedModel)?.licenseNote && <p role="note" className="text-xs text-muted-foreground">Licença declarada do modelo: {models.find((item) => item.id === selectedModel)?.licenseNote}</p>}
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>Revisei e aceito as licenças do VoiceStudio, modelo, voz e saída; tenho autorização para usar este áudio.</span></label>
      <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => generate.mutate()} disabled={!selectedModel || !selectedVoice || !confirmed || !text.trim() || generate.isPending}>{generate.isPending ? 'Gerando áudio…' : 'Gerar narração local'}</Button>{status.data.asset && <Button size="sm" variant="outline" onClick={() => listen.mutate()} disabled={listen.isPending}>{listen.isPending ? 'Abrindo áudio…' : 'Ouvir áudio salvo'}</Button>}</div>
      {status.data.asset && <p role="status" className="text-xs text-muted-foreground">Asset persistido: {status.data.asset.relativePath} · {Math.round(status.data.asset.durationMs / 100) / 10}s · {status.data.timeline?.syncStatus ?? 'não sincronizado'}.</p>}
      {preview && <audio aria-label="Prévia da narração VoiceStudio" controls src={preview} className="w-full" />}
    </>}
    {generate.isError && <p role="alert" className="text-xs text-destructive">{errorMessage(generate.error)}</p>}
  </div>;
}

function EditorialCollage({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState(5);
  const [job, setJob] = useState<{ id: string; status: string; estimatedCostUsd: number; approvalText: string; stillPath?: string | null; clipPath?: string | null } | null>(null);
  const key = useQuery({ queryKey: ['velix-collage-key'], queryFn: () => window.neuralbridge.video.collageKeyStatus() });
  const saveKey = useMutation({ mutationFn: (apiKey: string) => window.neuralbridge.video.collageKeySave(apiKey), onSuccess: () => void client.invalidateQueries({ queryKey: ['velix-collage-key'] }) });
  const [apiKey, setApiKey] = useState('');
  const create = useMutation({ mutationFn: () => window.neuralbridge.video.collageCreate({ projectId, prompt: prompt.trim(), durationSeconds: duration, aspectRatio: '16:9' }), onSuccess: setJob });
  const approveMetaphor = useMutation({ mutationFn: () => window.neuralbridge.video.collageApproveMetaphor(job?.id ?? ''), onSuccess: (next) => setJob((current) => current ? { ...current, ...next } : current) });
  const approveStill = useMutation({ mutationFn: () => window.neuralbridge.video.collageApproveStill(job?.id ?? ''), onSuccess: (next) => setJob((current) => current ? { ...current, ...next } : current) });
  const generate = useMutation({ mutationFn: () => window.neuralbridge.video.collageGenerate(job?.id ?? ''), onSuccess: (next) => setJob((current) => current ? { ...current, ...next } : current) });
  const busy = create.isPending || approveMetaphor.isPending || approveStill.isPending || generate.isPending;
  return <details className="sg-panel rounded-lg p-4" aria-label="Colagem editorial com IA"><summary className="cursor-pointer text-sm font-medium">Colagem editorial com IA</summary><div className="mt-3 space-y-3"><p className="text-xs text-muted-foreground">Recurso opcional: configure uma chave Gemini para criar um B-roll entre cenas. Cada etapa pede aprovação separada.</p>{!key.data?.configured ? <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"><input aria-label="Chave Gemini" type="password" className={INPUT} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Chave Gemini" /><Button size="sm" onClick={() => saveKey.mutate(apiKey.trim())} disabled={!apiKey.trim() || saveKey.isPending}>Configurar chave</Button></div> : <p role="status" className="text-xs text-success">Chave Gemini configurada neste computador.</p>}{key.data?.configured && !job && <><textarea aria-label="Metáfora da colagem" className={`${INPUT} min-h-20`} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ex.: uma ponte de papel ligando uma ideia à próxima" /><div className="flex flex-wrap items-end gap-2"><label className="text-xs font-medium">Duração (s)<input aria-label="Duração da colagem" type="number" min={2} max={30} className={INPUT} value={duration} onChange={(event) => setDuration(Number(event.target.value))} /></label><Button size="sm" onClick={() => create.mutate()} disabled={!prompt.trim() || busy}>Propor metáfora</Button></div></>}{job && <div className="space-y-2 rounded border p-3 text-sm"><p><span className="font-medium">Proposta:</span> {job.approvalText}</p>{job.status === 'draft' && <Button size="sm" onClick={() => approveMetaphor.mutate()} disabled={busy}>Aprovar metáfora e gerar quadro</Button>}{job.stillPath && <p className="text-xs text-muted-foreground">Quadro salvo em <code>{job.stillPath}</code>.</p>}{job.status === 'metaphor_approved' && <Button size="sm" onClick={() => approveStill.mutate()} disabled={busy}>Aprovar quadro parado</Button>}{job.status === 'still_approved' && <Button size="sm" onClick={() => generate.mutate()} disabled={busy}>Gerar B-roll (US$ {job.estimatedCostUsd.toFixed(2)})</Button>}{job.status === 'completed' && <p role="status" className="text-xs text-success">B-roll aprovado: <code>{job.clipPath}</code>. Ele será inserido na próxima mistura.</p>}</div>}{[saveKey, create, approveMetaphor, approveStill, generate].some((mutation) => mutation.isError) && <p role="alert" className="text-xs text-destructive">{errorMessage([saveKey, create, approveMetaphor, approveStill, generate].find((mutation) => mutation.isError)?.error)}</p>}</div></details>;
}

function StudioStyle({ projectId, video, data, duration, hasNarration }: { projectId: string; video: string; data: string; duration: number; hasNarration: boolean }) {
  const client = useQueryClient();
  const styles = useAllVideoStyles();
  const stored = useQuery({ queryKey: ['velix-video-style', projectId, video], queryFn: () => window.neuralbridge.video.styleLoad({ projectId, video }) });
  const bases = useQuery({ queryKey: ['velix-overlay-bases', projectId], queryFn: () => window.neuralbridge.video.overlayBases(projectId) });
  const choice = stored.data?.choice ?? DEFAULT_STYLE_CHOICE;
  const baseVideo = typeof choice.options['baseVideo'] === 'string' ? choice.options['baseVideo'] : '';
  const refresh = () => void client.invalidateQueries({ queryKey: ['velix-video-style', projectId, video] });
  const save = useMutation({
    mutationFn: (next: { styleId?: string; baseVideo?: string; scenes?: ProductionStyleChoice['scenes'] }) => {
      const styleId = next.styleId ?? choice.styleId;
      const style = styles.data?.find((item) => item.id === styleId);
      const base = next.baseVideo ?? baseVideo;
      // A layer without a base video cannot render: dropping the base also drops the layer back to the Dossiê.
      const keep = style?.kind !== 'overlay' || !!base;
      const options = { ...choice.options, ...(base ? { baseVideo: base } : {}) };
      if (!base) delete options['baseVideo'];
      return window.neuralbridge.video.styleSave({ projectId, video, choice: { ...DEFAULT_STYLE_CHOICE, styleId: keep ? styleId : DEFAULT_STYLE_CHOICE.styleId, styleVersion: keep ? style?.version ?? 1 : 1, options, ...(next.scenes ? { scenes: next.scenes } : choice.scenes ? { scenes: choice.scenes } : {}) } });
    },
    onSuccess: refresh,
  });
  const transcribe = useMutation({ mutationFn: () => window.neuralbridge.video.overlayTranscribe({ projectId, video }) });
  const visible = styles.data ? stylesForVideo(styles.data, !!baseVideo) : [];
  const current = choice.styleId;
  const label = styles.data?.find((item) => item.id === current)?.label ?? 'Dossiê com dados';
  const sceneCount = (() => { try { const parsed = JSON.parse(data) as { cenas?: unknown }; return Array.isArray(parsed.cenas) ? parsed.cenas.length : 0; } catch { return 0; } })();
  const timelineScenes = (() => { try { const parsed = JSON.parse(data) as { cenas?: Array<{ at?: number }> }; const items = parsed.cenas ?? []; return items.map((scene, index) => ({ index, start: scene.at ?? (index ? duration / items.length * index : 0), end: items[index + 1]?.at ?? duration })); } catch { return []; } })();
  const times = [0.15, 0.5, 0.85].map((part) => Math.round(duration * part * 10) / 10);
  return (
    <details className="sg-panel rounded-lg p-4" aria-label="Estilo do vídeo">
      <summary className="cursor-pointer text-sm font-medium">Estilo do vídeo: {label}</summary>
      <div className="mt-3 space-y-3">
        <div className="grid gap-2 rounded border p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="block font-medium">Vídeo gravado (opcional)<select aria-label="Vídeo base" className={INPUT} value={baseVideo} onChange={(event) => save.mutate({ baseVideo: event.target.value })}><option value="">Nenhum: o vídeo é todo animado</option>{bases.data?.map((item) => <option key={item.relativePath} value={item.relativePath}>{item.title}</option>)}</select></label>
          {baseVideo && <Button size="sm" variant="outline" onClick={() => transcribe.mutate()} disabled={transcribe.isPending}>Transcrever a fala do vídeo</Button>}
          <p className="text-xs text-muted-foreground sm:col-span-2">{bases.data?.length ? 'Com um vídeo gravado, as camadas (legendas, manchetes, cortes de podcast) entram por cima dele, com a voz original.' : 'Só aparecem vídeos do projeto com direitos verificados no Rights Manager.'}</p>
          {transcribe.isPending && <div className="sm:col-span-2"><ProgressBar label="Transcrevendo a fala do vídeo base" /></div>}
          {transcribe.data && <p role="status" className="text-xs sm:col-span-2">{transcribe.data.words} palavras transcritas · {transcribe.data.duration.toFixed(1)} s de fala.</p>}
          {transcribe.isError && <p role="alert" className="text-xs text-destructive sm:col-span-2">{errorMessage(transcribe.error)}</p>}
        </div>
        {styles.data && <StyleGallery styles={visible} value={current} onChange={(styleId) => save.mutate({ styleId })} preview={(styleId) => window.neuralbridge.video.stylePreview({ video, styleId, data, times })} missing={{ narration: !hasNarration, footage: !baseVideo, faceVideo: !baseVideo }} />}
        {styles.data && sceneCount > 0 && <div className="space-y-2 rounded border p-3" aria-label="Mistura por cena"><h4 className="text-sm font-medium">Mistura por cena</h4><p className="text-xs text-muted-foreground">Cada cena herda o estilo do vídeo; escolha uma exceção e, quando compatível, um tratamento.</p><div aria-label="Linha do tempo da mistura" className="flex h-10 overflow-hidden rounded border bg-muted" role="list">{timelineScenes.map(({ index, start, end }) => { const sceneId = `cena-${index + 1}`; const selected = choice.scenes?.[sceneId]?.styleId ?? current; const style = styles.data?.find((item) => item.id === selected); const width = `${Math.max(4, ((end - start) / Math.max(duration, 0.1)) * 100)}%`; return <div key={sceneId} role="listitem" title={`${sceneId}: ${style?.label ?? selected} · ${start.toFixed(1)}–${end.toFixed(1)} s`} className="flex min-w-0 items-center justify-center border-r px-1 text-[10px] font-medium last:border-r-0" style={{ width }}>{style?.label ?? selected}</div>; })}</div>{Array.from({ length: sceneCount }, (_, index) => { const sceneId = `cena-${index + 1}`; const selected = choice.scenes?.[sceneId]?.styleId ?? current; const selectedStyle = styles.data?.find((item) => item.id === selected); const treatment = choice.scenes?.[sceneId]?.treatmentId ?? choice.treatmentId ?? null; const scenes = { ...(choice.scenes ?? {}), [sceneId]: { ...(choice.scenes?.[sceneId] ?? {}), ...(selected === current ? { styleId: undefined } : { styleId: selected }), treatmentId: treatment } }; return <div key={sceneId} className="grid gap-2 sm:grid-cols-3"><label className="block text-xs font-medium">Cena {index + 1}<select aria-label={`Estilo da cena ${index + 1}`} className={INPUT} value={selected} onChange={(event) => save.mutate({ scenes: { ...scenes, [sceneId]: { ...scenes[sceneId], ...(event.target.value === current ? { styleId: undefined } : { styleId: event.target.value }) } } })}>{visible.map((style) => <option key={style.id} value={style.id}>{style.label}</option>)}</select></label><label className="block text-xs font-medium sm:col-span-2">Tratamento<select aria-label={`Tratamento da cena ${index + 1}`} className={INPUT} value={treatment ?? ''} onChange={(event) => save.mutate({ scenes: { ...scenes, [sceneId]: { ...scenes[sceneId], treatmentId: event.target.value || null } } })}><option value="">Nenhum</option>{selectedStyle?.treatments.map((treatmentId) => <option key={treatmentId} value={treatmentId}>{treatmentId === 'colagem-jornal' ? 'Colagem de jornal' : treatmentId}</option>)}</select></label></div>; })}</div>}
        {projectId && <EditorialCollage projectId={projectId} />}
        <p className="text-xs text-muted-foreground">O roteiro e as cenas continuam os mesmos; muda só a forma como o vídeo é desenhado. A troca vale para a prévia e para o próximo render.</p>
        {save.isPending && <ProgressBar label="Salvando o estilo do vídeo" />}
        {save.isError && <p role="alert" className="text-xs text-destructive">{errorMessage(save.error)}</p>}
      </div>
    </details>
  );
}

function StudioEditor({ video, state, onSynced, projectId }: { video: string; state: VideoStudioState; onSynced: () => void; projectId: string | null }) {
  const client = useQueryClient();
  const [narration, setNarration] = useState(state.narration);
  const [data, setData] = useState<Video>(() => (state.data ? JSON.parse(state.data) as Video : {}));
  const [time, setTime] = useState(0);
  const [quality, setQuality] = useState<'draft' | 'final'>('final');
  const [renderId, setRenderId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const json = JSON.stringify(data, null, 2);
  const duration = data.duracao ?? 60;
  const reload = () => client.invalidateQueries({ queryKey: ['velix-video', video] });
  const save = useMutation({ mutationFn: () => window.neuralbridge.video.studioSave({ name: video, narration, data: json }) });
  const sync = useMutation({ mutationFn: async () => { await save.mutateAsync(); return window.neuralbridge.video.studioSync(video); }, onSuccess: async () => { await reload(); onSynced(); } });
  const preview = useMutation({ mutationFn: () => window.neuralbridge.video.studioPreview({ name: video, data: json, time }) });
  const render = useMutation({ mutationFn: async () => { await save.mutateAsync(); return window.neuralbridge.video.studioRender({ name: video, data: json, quality }); }, onSuccess: (job) => setRenderId(job.id) });
  const status = useQuery({ queryKey: ['velix-render', renderId], queryFn: () => window.neuralbridge.video.renderStatus(renderId ?? ''), enabled: !!renderId, refetchInterval: (query) => query.state.data?.status === 'running' ? 500 : false });
  const output = useQuery({ queryKey: ['velix-output', renderId], queryFn: () => window.neuralbridge.video.studioOutput(video), enabled: status.data?.status === 'completed', retry: false });
  const cancel = useMutation({ mutationFn: () => window.neuralbridge.video.renderCancel(renderId ?? ''), onSuccess: () => void status.refetch() });

  const running = status.data?.status === 'running';
  const words = narration.trim() ? narration.trim().split(/\s+/).length : 0;
  const updateScene = (index: number, next: Scene) => setData((current) => ({ ...current, cenas: (current.cenas ?? []).map((item, position) => position === index ? next : item) }));
  const scenes = data.cenas ?? [];

  return (
      <div className="space-y-6">
        {projectId && <StudioStyle projectId={projectId} video={video} data={json} duration={duration} hasNarration={!!state.audio} />}
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-8">
            <section aria-label="Narração" className="space-y-3">
              <h3 className="text-base font-medium">Narração</h3>
              <textarea aria-label="Texto da narração" className={`${INPUT} min-h-44`} value={narration} onChange={(event) => setNarration(event.target.value)} />
              <p className="text-xs text-muted-foreground">{words} palavras, cerca de {Math.round(words / 2.5)} s de fala.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => { void navigator.clipboard.writeText(narration); setCopied(true); }}>{copied ? 'Texto copiado' : 'Copiar para o ElevenLabs'}</Button>
                <Button variant="outline" onClick={() => void reload()}>Procurar áudio</Button>
                <Button onClick={() => sync.mutate()} disabled={!state.audio || sync.isPending}>{sync.isPending ? 'Transcrevendo a voz…' : 'Sincronizar cenas com a voz'}</Button>
              </div>
              <p role="status" className="text-sm text-muted-foreground">
                {state.audio ? `Áudio encontrado: ${state.audio}.${state.synced ? ' As cenas já foram sincronizadas.' : ''}` : `Gere o áudio no ElevenLabs e salve em ${state.folder}/narracao/voz.mp3.`}
              </p>
              <VoiceStudioNarration video={video} text={narration} onGenerated={() => { void reload(); onSynced(); }} />
              {sync.data && sync.data.missed > 0 && <p role="status" className="text-sm text-muted-foreground">{sync.data.missed} trechos não foram achados na fala: confira o tempo deles nas cenas.</p>}
              {sync.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(sync.error)}</p>}
            </section>
            <section aria-label="Cenas" className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium">Nome da série<input aria-label="Nome da série" className={INPUT} value={data.serie ?? ''} onChange={(event) => setData({ ...data, serie: event.target.value })} /></label>
                <label className="block text-sm font-medium">Rodapé<input aria-label="Rodapé" className={INPUT} value={data.rodape ?? ''} onChange={(event) => setData({ ...data, rodape: event.target.value })} /></label>
              </div>
              <h3 className="text-base font-medium">Cenas</h3>
              {scenes.map((scene, index) => (
                <article key={index} aria-label={`Cena ${index + 1}`} className="space-y-3 rounded-lg border p-4">
                  <div className="grid gap-2 sm:grid-cols-[1fr_110px]">
                    <label className="block text-xs font-medium">{scene.capitulo ? `Capítulo ${scene.capitulo.n ?? ''}` : 'Título da cena'}<input aria-label={`Título da cena ${index + 1}`} className={INPUT} disabled={!scene.capitulo} value={scene.capitulo?.titulo ?? 'Sem capítulo'} onChange={(event) => updateScene(index, { ...scene, capitulo: { ...scene.capitulo, titulo: event.target.value } })} /></label>
                    <label className="block text-xs font-medium">Início (s)<input aria-label={`Início da cena ${index + 1}`} type="number" step="0.1" className={INPUT} value={scene.at ?? 0} onChange={(event) => updateScene(index, { ...scene, at: Number(event.target.value) })} /></label>
                  </div>
                  <label className="block text-xs font-medium">Fonte na tela<input aria-label={`Fonte da cena ${index + 1}`} className={INPUT} value={scene.fonte ?? ''} onChange={(event) => updateScene(index, { ...scene, fonte: event.target.value })} /></label>
                  {(scene.blocos ?? []).map((block, position) => (
                    <div key={position} className="space-y-2 border-t pt-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium">{BLOCK_LABELS[block.tipo ?? ''] ?? block.tipo}</span>
                        <span className="flex items-center gap-2">
                          <input aria-label={`Tempo do bloco ${position + 1} da cena ${index + 1}`} type="number" step="0.1" className="w-20 rounded-md border bg-background px-2 py-1 text-xs" value={block.at ?? 0} onChange={(event) => updateScene(index, { ...scene, blocos: (scene.blocos ?? []).map((item, n) => n === position ? { ...item, at: Number(event.target.value) } : item) })} />
                          <Button variant="outline" size="sm" onClick={() => { setTime((block.at ?? 0) + 1); }}>Ver aqui</Button>
                          <Button variant="outline" size="sm" aria-label={`Remover bloco ${position + 1} da cena ${index + 1}`} onClick={() => updateScene(index, { ...scene, blocos: (scene.blocos ?? []).filter((_, n) => n !== position) })}>Remover</Button>
                        </span>
                      </div>
                      <BlockFields block={block} onChange={(next) => updateScene(index, { ...scene, blocos: (scene.blocos ?? []).map((item, n) => n === position ? next : item) })} />
                    </div>
                  ))}
                </article>
              ))}
            </section>
          </div>
          <aside aria-label="Prévia e exportação" className="space-y-4 sg-panel rounded-lg p-4 lg:sticky lg:top-6">
            <div className="grid aspect-[9/16] w-full place-items-center overflow-hidden rounded-md border bg-black text-center text-xs text-muted-foreground">
              {preview.data ? <img src={preview.data} alt={`Prévia em ${time} s`} className="h-full w-full object-contain" /> : <span className="p-4">Escolha um momento e gere a prévia.</span>}
            </div>
            <label className="block text-sm font-medium">Momento: {time.toFixed(1)} s<input aria-label="Momento da prévia" type="range" min={0} max={duration} step={0.1} value={time} className="mt-1 w-full" onChange={(event) => setTime(Number(event.target.value))} /></label>
            <Button variant="outline" className="w-full" onClick={() => preview.mutate()} disabled={preview.isPending}>{preview.isPending ? 'Gerando prévia…' : 'Gerar prévia'}</Button>
            {preview.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(preview.error)}</p>}
            <div className="space-y-2 border-t pt-4">
              <Button variant="outline" className="w-full" onClick={() => save.mutate()} disabled={save.isPending}>{save.isSuccess && !save.isPending ? 'Salvo' : 'Salvar alterações'}</Button>
              <label className="block text-sm font-medium">Qualidade<select aria-label="Qualidade do estúdio" className={INPUT} value={quality} onChange={(event) => setQuality(event.target.value as 'draft' | 'final')}><option value="final">Final</option><option value="draft">Rascunho rápido</option></select></label>
              <Button className="w-full" onClick={() => render.mutate()} disabled={running || render.isPending}>Renderizar vídeo</Button>
              {running && <Button variant="outline" className="w-full" onClick={() => cancel.mutate()}>Cancelar renderização</Button>}
              {!state.audio && <p className="text-xs text-muted-foreground">Sem áudio, o vídeo sai só com os efeitos sonoros.</p>}
            </div>
            {(save.isError || render.isError) && <p role="alert" className="text-sm text-destructive">{errorMessage(save.error ?? render.error)}</p>}
            {status.data && <p role="status" className="rounded-md border p-3 text-sm">Renderização: {status.data.status}{status.data.progress !== null && running ? ` · ${Math.round(status.data.progress * 100)}%` : ''}{status.data.error ? ` · ${status.data.error}` : ''}</p>}
            {output.data && <video data-testid="velix-studio-output" className="w-full rounded-md border bg-black" controls src={output.data} />}
          </aside>
        </div>
      </div>
  );
}

export function VelixStudio({ video, onVideo, projectId }: { video: string; onVideo: (name: string) => void; projectId: string | null }) {
  const videos = useQuery({ queryKey: ['velix-videos', video], queryFn: () => window.neuralbridge.video.studioList() });
  const state = useQuery({ queryKey: ['velix-video', video], queryFn: () => window.neuralbridge.video.studioLoad(video), enabled: !!video });
  const [revision, setRevision] = useState(0);
  return (
    <section aria-label="Estúdio" className="space-y-5">
      <label className="block max-w-md text-sm font-medium">
        Vídeo
        <select aria-label="Vídeo" className={INPUT} value={video} onChange={(event) => onVideo(event.target.value)}>
          <option value="">Escolha um vídeo</option>
          {videos.data?.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      {!video && <p className="text-sm text-muted-foreground">Crie um vídeo em Novo vídeo ou escolha um já iniciado.</p>}
      {state.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(state.error)}</p>}
      {video && state.data && <StudioEditor key={`${video}:${revision}`} video={video} state={state.data} projectId={projectId} onSynced={() => setRevision((current) => current + 1)} />}
    </section>
  );
}

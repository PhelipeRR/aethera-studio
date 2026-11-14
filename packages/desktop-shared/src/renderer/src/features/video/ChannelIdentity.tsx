import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';
import { applyBrandTemplate, BRAND_TEMPLATE_IDS, BRAND_TEMPLATES, brandContrastRatio, generateBrandDirections, type BrandIdentity, type BrandTemplateId } from '@neuralbridge/shared/velix-channel';
import { BANNER_DESKTOP_BAND, BANNER_SAFE_AREA, BRAND_PIECES, brandPieceDataUrl, type BrandPieceKind } from '@neuralbridge/shared/velix-brand-pieces';
import { savePiece } from './save-piece';
import { ChannelApply } from './ChannelApply';

const INPUT = 'mt-1 w-full rounded border bg-background px-2 py-1 text-sm';
const FONTS: Array<{ id: BrandIdentity['fonts']['title']; label: string }> = [{ id: 'inter', label: 'Inter Black' }, { id: 'grotesk', label: 'Space Grotesk' }, { id: 'archivo-black', label: 'Archivo Black' }, { id: 'anton', label: 'Anton (condensada)' }, { id: 'bebas', label: 'Bebas Neue (condensada)' }, { id: 'serif', label: 'Instrument Serif' }, { id: 'fredoka', label: 'Fredoka (arredondada)' }, { id: 'mono', label: 'JetBrains Mono' }, { id: 'ibm-plex-sans', label: 'IBM Plex Sans' }, { id: 'ibm-plex-mono', label: 'IBM Plex Mono' }];
const SYMBOLS: Array<{ id: BrandIdentity['symbol']['style']; label: string }> = [{ id: 'monograma', label: 'Monograma' }, { id: 'ponto', label: 'Círculo' }, { id: 'seta', label: 'Seta' }];
const box = (area: { x: number; y: number; width: number; height: number }) => ({ left: `${(area.x / 2560) * 100}%`, top: `${(area.y / 1440) * 100}%`, width: `${(area.width / 2560) * 100}%`, height: `${(area.height / 1440) * 100}%` });

function SaveButtons({ identity, kind, label, title }: { identity: BrandIdentity; kind: BrandPieceKind; label: string; title?: string }) {
  const [state, setState] = useState<string | null>(null);
  const run = async (format: 'png' | 'svg') => {
    setState(`Gerando ${format.toUpperCase()}…`);
    try { setState((await savePiece(identity, kind, format, title === undefined ? {} : { title })) ? `${format.toUpperCase()} salvo.` : null); } catch (error) { setState(errorMessage(error)); }
  };
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Button size="sm" variant="outline" aria-label={`Salvar ${label} em PNG no PC`} onClick={() => void run('png')}>Salvar PNG</Button>
      <Button size="sm" variant="ghost" aria-label={`Salvar ${label} em SVG no PC`} onClick={() => void run('svg')}>SVG</Button>
      {state && <span role="status" className="text-xs text-muted-foreground">{state}</span>}
    </span>
  );
}

function Pieces({ identity, thumbnailTitle, guides }: { identity: BrandIdentity; thumbnailTitle: string; guides: boolean }) {
  const caption = (kind: BrandPieceKind, text: string, title?: string) => <figcaption className="flex flex-wrap items-center justify-between gap-1 text-xs text-muted-foreground"><span>{text}</span><SaveButtons identity={identity} kind={kind} label={BRAND_PIECES.find((piece) => piece.kind === kind)?.label ?? kind} {...(title === undefined ? {} : { title })} /></figcaption>;
  return (
    <div className="space-y-4">
      <figure className="space-y-1">
        <div className="relative overflow-hidden rounded border">
          <img alt="Prévia do banner 2560×1440" src={brandPieceDataUrl(identity, 'banner')} className="block w-full" />
          {guides && <>
            <div aria-hidden className="pointer-events-none absolute border-2 border-dashed border-info/80" style={box(BANNER_DESKTOP_BAND)} />
            <div aria-hidden className="pointer-events-none absolute border-2 border-warning" style={box(BANNER_SAFE_AREA)} />
          </>}
        </div>
        {caption('banner', `Banner 2560×1440${guides ? ' · amarelo: área visível em todos os aparelhos (1546×423) · azul: faixa do computador' : ''}`)}
      </figure>
      <div className="grid gap-4 sm:grid-cols-2">
        <figure className="space-y-1"><img alt="Prévia da foto de perfil" src={brandPieceDataUrl(identity, 'avatar')} className="mx-auto aspect-square w-40 rounded-full border" />{caption('avatar', 'Foto de perfil 800×800')}</figure>
        <figure className="space-y-1"><img alt="Prévia da marca d'água" src={brandPieceDataUrl(identity, 'watermark')} className="mx-auto aspect-square w-20 rounded border" />{caption('watermark', "Marca d'água 150×150")}</figure>
        <figure className="space-y-1 sm:col-span-2"><img alt="Prévia do logo para fundo claro" src={brandPieceDataUrl(identity, 'logo-inverse')} className="w-full rounded border bg-white" />{caption('logo-inverse', 'Logo 1800×600 para fundo claro, transparente')}</figure>
        <figure className="space-y-1 sm:col-span-2"><img alt="Prévia do logo" src={brandPieceDataUrl(identity, 'logo')} className="w-full rounded border bg-neutral-900" />{caption('logo', 'Logo 1800×600 para fundo escuro, transparente')}</figure>
      </div>
      <figure className="space-y-1 sm:w-2/3"><img alt="Prévia da thumbnail base" src={brandPieceDataUrl(identity, 'thumbnail', { title: thumbnailTitle })} className="w-full rounded border" />{caption('thumbnail', 'Thumbnail base 1280×720', thumbnailTitle)}</figure>
    </div>
  );
}

export function ChannelIdentity({ projectId, channelTitle, saved, onSaved, niche, onNicheChange, connected, canWrite, branding, onOpenSettings }: { projectId: string | null; channelTitle: string | null; saved: BrandIdentity | null | undefined; onSaved: () => void; niche: string; onNicheChange: (value: string) => void; connected: boolean; canWrite: boolean; branding: unknown; onOpenSettings: () => void }) {
  const [directions, setDirections] = useState<BrandIdentity[]>([]);
  const [draft, setDraft] = useState<BrandIdentity | null>(null);
  const [guides, setGuides] = useState(true);
  const [thumbnailTitle, setThumbnailTitle] = useState('Título do vídeo aqui');
  const save = useMutation({ mutationFn: (identity: BrandIdentity) => window.neuralbridge.video.channelIdentitySave({ projectId: projectId ?? '', identity }), onSuccess: () => { setDraft(null); setDirections([]); onSaved(); } });
  const pick = (identity: BrandIdentity) => setDraft({ ...identity, name: identity.name && identity.approvedAt ? identity.name : channelTitle ?? identity.name ?? '', approvedAt: null, pieces: [] });
  const update = (change: (current: BrandIdentity) => BrandIdentity) => setDraft((current) => (current ? change(current) : current));
  const color = (key: 'background' | 'foreground' | 'accent', value: string) => update((current) => { const tokens: Record<string, string> = { ...current.tokens, [key]: value, ...(key === 'background' ? { background2: value } : {}) }; return { ...current, tokens, palette: [tokens['foreground'] ?? value, tokens['accent'] ?? value, tokens['background'] ?? value] }; });
  const contrast = draft ? brandContrastRatio(draft.tokens['foreground'] ?? '#000000', draft.tokens['background'] ?? '#ffffff') : 0;

  return (
    <div role="region" aria-label="Identidade visual" className="space-y-3 rounded border p-3">
      <div><h3 className="font-medium">Identidade visual</h3><p className="text-xs text-muted-foreground">Gere três direções pelo nicho, escolha uma, ajuste e confira as peças antes de salvar.</p></div>

      {saved && !draft && <div className="space-y-3 rounded border p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">Identidade aprovada: {saved.name || saved.direction}</p><p className="text-xs text-muted-foreground">Aprovada em {new Date(saved.approvedAt ?? '').toLocaleString('pt-BR')}</p></div><Button size="sm" variant="outline" onClick={() => pick(saved)}>Editar identidade</Button></div>
        <Pieces identity={saved} thumbnailTitle={thumbnailTitle} guides={false} />
        {saved.pieces.length > 0 && <div className="text-xs text-muted-foreground"><p className="font-medium text-foreground">Arquivos na pasta do projeto</p><ul className="mt-1 space-y-0.5">{saved.pieces.map((piece) => <li key={piece.path}><code>{piece.path}</code> · {piece.width}×{piece.height}</li>)}</ul><p className="mt-1">Foto de perfil e nome do canal só mudam pelo YouTube Studio; a API não permite.</p></div>}
      {saved && !draft && projectId && <ChannelApply projectId={projectId} identity={saved} niche={niche} connected={connected} canWrite={canWrite} branding={branding} onOpenSettings={onOpenSettings} />}
      </div>}

      <div className="flex gap-2"><input aria-label="Nicho da identidade" className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-sm" value={niche} onChange={(event) => onNicheChange(event.target.value)} placeholder="Ex.: ciência e tecnologia" /><Button variant="outline" onClick={() => { try { setDirections(generateBrandDirections(niche, channelTitle ?? undefined)); setDraft(null); } catch (error) { window.alert(errorMessage(error)); } }} disabled={!niche.trim()}>Gerar direções</Button></div>
      {directions.length > 0 && <div className="grid gap-2 md:grid-cols-3">{directions.map((direction) => {
        const selected = draft?.direction === direction.direction;
        return <button type="button" key={direction.direction} aria-pressed={selected} className={`space-y-2 rounded border p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'ring-2 ring-ring' : ''}`} onClick={() => pick(direction)}>
          <img alt="" src={brandPieceDataUrl({ ...direction, name: channelTitle ?? direction.name ?? '' }, 'banner')} className="block w-full rounded" />
          <span className="block font-medium">{direction.direction}</span>{direction.template && <span className="block text-xs text-muted-foreground">{BRAND_TEMPLATES[direction.template].description}</span>}
          <span className="flex gap-1">{direction.palette.map((value) => <i key={value} aria-label={value} className="h-4 w-4 rounded-full border" style={{ backgroundColor: value }} />)}</span>
        </button>;
      })}</div>}

      {draft && <div className="space-y-3 rounded border p-3">
        <h4 className="text-sm font-medium">Ajustar {draft.direction}</h4>
        <label className="block text-xs font-medium">Estilo<select aria-label="Estilo da identidade" className={INPUT} value={draft.template ?? ''} onChange={(event) => { const id = event.target.value as BrandTemplateId; setDraft((current) => current ? { ...applyBrandTemplate(id, { name: current.name ?? '', tagline: current.tagline, initials: current.symbol.initials }) } : current); }}>{!draft.template && <option value="">Personalizado</option>}{BRAND_TEMPLATE_IDS.map((id) => <option key={id} value={id}>{BRAND_TEMPLATES[id].label} — {BRAND_TEMPLATES[id].description}</option>)}</select></label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs font-medium">Nome no banner<input aria-label="Nome do canal na identidade" className={INPUT} maxLength={100} value={draft.name ?? ''} onChange={(event) => update((current) => ({ ...current, name: event.target.value }))} /></label>
          <label className="text-xs font-medium">Frase (tagline)<input aria-label="Tagline da identidade" className={INPUT} maxLength={200} value={draft.tagline} onChange={(event) => update((current) => ({ ...current, tagline: event.target.value }))} /></label>
          <label className="text-xs font-medium">Iniciais do símbolo<input aria-label="Iniciais do símbolo" className={INPUT} maxLength={3} value={draft.symbol.initials} onChange={(event) => update((current) => ({ ...current, symbol: { ...current.symbol, initials: event.target.value.toUpperCase() } }))} /></label>
          <label className="text-xs font-medium">Símbolo<select aria-label="Estilo do símbolo" className={INPUT} value={draft.symbol.style} onChange={(event) => update((current) => ({ ...current, symbol: { ...current.symbol, style: event.target.value as BrandIdentity['symbol']['style'] } }))}>{SYMBOLS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label className="text-xs font-medium">Fonte do nome<select aria-label="Fonte do nome" className={INPUT} value={draft.fonts.title} onChange={(event) => update((current) => ({ ...current, fonts: { ...current.fonts, title: event.target.value as BrandIdentity['fonts']['title'] } }))}>{FONTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label className="text-xs font-medium">Fonte da frase<select aria-label="Fonte da frase" className={INPUT} value={draft.fonts.accent} onChange={(event) => update((current) => ({ ...current, fonts: { ...current.fonts, accent: event.target.value as BrandIdentity['fonts']['accent'] } }))}>{FONTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        </div>
        <div className="flex flex-wrap gap-4 text-xs">
          <label className="font-medium">Destaque<input aria-label="Cor de destaque da identidade" type="color" className="ml-2 h-8 w-12 rounded border bg-background align-middle" value={draft.tokens['accent'] ?? '#000000'} onChange={(event) => color('accent', event.target.value)} /></label>
          <label className="font-medium">Fundo<input aria-label="Cor de fundo da identidade" type="color" className="ml-2 h-8 w-12 rounded border bg-background align-middle" value={draft.tokens['background'] ?? '#000000'} onChange={(event) => color('background', event.target.value)} /></label>
          <label className="font-medium">Texto<input aria-label="Cor do texto da identidade" type="color" className="ml-2 h-8 w-12 rounded border bg-background align-middle" value={draft.tokens['foreground'] ?? '#ffffff'} onChange={(event) => color('foreground', event.target.value)} /></label>
          <span className={contrast >= 4.5 ? 'self-center text-muted-foreground' : 'self-center text-destructive'} role={contrast >= 4.5 ? undefined : 'alert'}>Contraste texto/fundo {contrast.toFixed(1)}:1{contrast >= 4.5 ? '' : ' — abaixo do mínimo 4,5:1'}</span>
        </div>
        <div className="flex flex-wrap items-end gap-3 text-xs">
          <label className="flex items-center gap-1"><input type="checkbox" checked={guides} onChange={(event) => setGuides(event.target.checked)} />Mostrar áreas seguras do banner</label>
          <label className="font-medium">Título de exemplo da thumbnail<input aria-label="Título de exemplo da thumbnail" className={INPUT} maxLength={80} value={thumbnailTitle} onChange={(event) => setThumbnailTitle(event.target.value)} /></label>
        </div>
        <Pieces identity={draft} thumbnailTitle={thumbnailTitle} guides={guides} />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => save.mutate(draft)} disabled={!projectId || save.isPending || contrast < 4.5 || !draft.symbol.initials.trim()}>{save.isPending ? 'Salvando…' : 'Aprovar e salvar identidade'}</Button>
          <Button variant="ghost" onClick={() => setDraft(null)}>Cancelar</Button>
        </div>
        <p className="text-xs text-muted-foreground">Ao salvar, as peças viram arquivos SVG em <code>channel-assets/</code> no projeto.</p>
        {save.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(save.error)}</p>}
      </div>}
    </div>
  );
}

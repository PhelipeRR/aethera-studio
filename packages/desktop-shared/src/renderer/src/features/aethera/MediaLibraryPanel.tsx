import React, { useEffect, useMemo, useState } from 'react';
import {
  Film,
  Grid,
  Image as ImageIcon,
  Layers,
  List,
  Music,
  Play,
  Plus,
  Search,
  Sparkles,
  Volume2,
  Wand2,
} from 'lucide-react';
import { WaveformCanvas, type WaveformDataView } from './WaveformCanvas';

export type MediaAssetCategory =
  | 'video'
  | 'image'
  | 'music'
  | 'sfx'
  | 'vfx'
  | 'motion_graphics'
  | 'template';

export interface LibraryMediaAsset {
  mediaId: string;
  filePath: string;
  name: string;
  kind: 'video' | 'image' | 'audio';
  category?: MediaAssetCategory;
  format?: string;
  origin?: string;
  durationSec: number;
  width: number;
  height: number;
  mediaUrl: string;
  thumbnailUrl: string | null;
  waveformPeaks: number[];
}

export function classifyAssetCategory(asset: LibraryMediaAsset): MediaAssetCategory {
  if (asset.category) return asset.category;
  const lower = `${asset.name} ${asset.filePath}`.toLowerCase();
  if (/template|preset/.test(lower)) return 'template';
  if (/motion|mogrt|hud|lower_third/.test(lower)) return 'motion_graphics';
  if (/vfx|overlay|alpha|matte|particle/.test(lower)) return 'vfx';
  if (asset.kind === 'audio' && /music|bgm|soundtrack|beat|lofi|ost/.test(lower)) return 'music';
  if (asset.kind === 'audio') return 'sfx';
  if (asset.kind === 'image') return 'image';
  return 'video';
}

const CATEGORY_LABELS: Record<'all' | MediaAssetCategory, string> = {
  all: 'Todos',
  video: 'Vídeos',
  image: 'Imagens',
  music: 'Músicas',
  sfx: 'SFX',
  vfx: 'VFX',
  motion_graphics: 'Motion',
  template: 'Templates',
};

interface MediaLibraryPanelProps {
  assets: LibraryMediaAsset[];
  waveformMap: Record<string, { loading: boolean; data: WaveformDataView | null; error: string | null }>;
  onInsertAsset: (asset: LibraryMediaAsset) => void;
  onRequestWaveform: (filePath: string) => void;
  onRequestThumbnail: (asset: LibraryMediaAsset) => void;
}

export const MediaLibraryPanel: React.FC<MediaLibraryPanelProps> = ({
  assets,
  waveformMap,
  onInsertAsset,
  onRequestWaveform,
  onRequestThumbnail,
}) => {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | MediaAssetCategory>('all');
  const [sortBy, setSortBy] = useState<'name' | 'duration' | 'category'>('name');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [groupByProject, setGroupByProject] = useState(false);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);

  const normalizedAssets = useMemo(() => {
    return assets.map((a) => {
      const cat = classifyAssetCategory(a);
      const extMatch = a.filePath.match(/\.([a-z0-9]+)$/i);
      return {
        ...a,
        category: cat,
        format: a.format ?? (extMatch?.[1] ?? a.kind).toUpperCase(),
        origin: a.origin ?? 'local',
      };
    });
  }, [assets]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = normalizedAssets.filter((a) => {
      if (categoryFilter !== 'all' && a.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        a.origin.toLowerCase().includes(q) ||
        a.format.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q)
      );
    });

    list.sort((a, b) => {
      if (sortBy === 'duration') return b.durationSec - a.durationSec;
      if (sortBy === 'category') return a.category.localeCompare(b.category);
      return a.name.localeCompare(b.name);
    });

    return list;
  }, [normalizedAssets, categoryFilter, search, sortBy]);

  const visibleItems = useMemo(() => filtered.slice(0, 80), [filtered]);

  // Lazy-fetch missing video thumbnails for visible grid items
  useEffect(() => {
    for (const item of visibleItems.slice(0, 18)) {
      if (item.kind === 'video' && !item.thumbnailUrl) {
        onRequestThumbnail(item);
      }
    }
  }, [visibleItems, onRequestThumbnail]);

  const previewAsset = useMemo(
    () => normalizedAssets.find((a) => a.mediaId === previewAssetId) ?? null,
    [normalizedAssets, previewAssetId],
  );

  useEffect(() => {
    if (previewAsset && (previewAsset.kind === 'audio' || previewAsset.kind === 'video')) {
      onRequestWaveform(previewAsset.filePath);
    }
  }, [previewAsset, onRequestWaveform]);

  const grouped = useMemo(() => {
    if (!groupByProject) return [['Todos os itens', visibleItems] as const];
    const map = new Map<string, typeof visibleItems>();
    for (const item of visibleItems) {
      const groupKey = item.origin || 'local';
      const arr = map.get(groupKey) ?? [];
      arr.push(item);
      map.set(groupKey, arr);
    }
    return Array.from(map.entries());
  }, [visibleItems, groupByProject]);

  const renderCategoryIcon = (cat: MediaAssetCategory) => {
    if (cat === 'video') return <Film className="size-3 text-violet-300" />;
    if (cat === 'image') return <ImageIcon className="size-3 text-sky-300" />;
    if (cat === 'music') return <Music className="size-3 text-cyan-300" />;
    if (cat === 'sfx') return <Volume2 className="size-3 text-amber-300" />;
    if (cat === 'vfx') return <Sparkles className="size-3 text-fuchsia-300" />;
    if (cat === 'motion_graphics') return <Wand2 className="size-3 text-emerald-300" />;
    return <Layers className="size-3 text-slate-300" />;
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 text-xs">
      {/* Search & Controls */}
      <div className="space-y-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2 size-3.5 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Buscar na biblioteca (${assets.length})...`}
            className="w-full rounded-lg border border-border/60 bg-[#0d0d17] py-1.5 pl-7 pr-2 text-[11px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap gap-1">
          {(Object.keys(CATEGORY_LABELS) as Array<'all' | MediaAssetCategory>).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium transition ${
                categoryFilter === cat
                  ? 'bg-primary/30 text-purple-100 border border-purple-400/50'
                  : 'bg-[#0d0d17] text-muted-foreground hover:text-foreground border border-border/40'
              }`}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-1 text-[10px]">
          <select
            aria-label="Ordenar biblioteca"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'name' | 'duration' | 'category')}
            className="rounded border border-border/50 bg-[#0d0d17] px-1.5 py-0.5 text-[10px] text-slate-200"
          >
            <option value="name">Ordenar: Nome</option>
            <option value="duration">Ordenar: Duração</option>
            <option value="category">Ordenar: Tipo</option>
          </select>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setGroupByProject((v) => !v)}
              className={`rounded border px-1.5 py-0.5 text-[10px] ${
                groupByProject
                  ? 'border-purple-400/50 bg-purple-500/20 text-purple-100'
                  : 'border-border/50 bg-[#0d0d17] text-muted-foreground'
              }`}
              title="Agrupar por projeto/pasta"
            >
              Agrupar
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              aria-label="Visualização em grade"
              className={`rounded border p-1 ${
                viewMode === 'grid'
                  ? 'border-purple-400/50 bg-purple-500/20 text-white'
                  : 'border-border/50 bg-[#0d0d17] text-muted-foreground'
              }`}
            >
              <Grid className="size-3" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              aria-label="Visualização em lista"
              className={`rounded border p-1 ${
                viewMode === 'list'
                  ? 'border-purple-400/50 bg-purple-500/20 text-white'
                  : 'border-border/50 bg-[#0d0d17] text-muted-foreground'
              }`}
            >
              <List className="size-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Inline Media Previewer */}
      {previewAsset && (
        <div className="rounded-xl border border-purple-500/40 bg-[#0d0d17] p-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <span className="truncate text-[11px] font-semibold text-white" title={previewAsset.name}>
              {previewAsset.name}
            </span>
            <button
              type="button"
              onClick={() => setPreviewAssetId(null)}
              className="shrink-0 text-[10px] text-muted-foreground hover:text-white"
            >
              Fechar
            </button>
          </div>

          {previewAsset.kind === 'video' && (
            <div
              className="overflow-hidden rounded-lg border border-border/60"
              style={
                previewAsset.category === 'vfx'
                  ? {
                      backgroundImage:
                        'repeating-conic-gradient(#1f1b2e 0% 25%, #120f1c 0% 50%)',
                      backgroundSize: '12px 12px',
                    }
                  : { backgroundColor: '#000' }
              }
            >
              <video
                src={previewAsset.mediaUrl}
                controls
                className="max-h-32 w-full object-contain"
              />
            </div>
          )}

          {previewAsset.kind === 'image' && (
            <div
              className="overflow-hidden rounded-lg border border-border/60"
              style={
                previewAsset.category === 'vfx'
                  ? {
                      backgroundImage:
                        'repeating-conic-gradient(#1f1b2e 0% 25%, #120f1c 0% 50%)',
                      backgroundSize: '12px 12px',
                    }
                  : { backgroundColor: '#000' }
              }
            >
              <img
                src={previewAsset.mediaUrl}
                alt={previewAsset.name}
                className="max-h-32 w-full object-contain"
              />
            </div>
          )}

          {previewAsset.kind === 'audio' && (
            <div className="space-y-1.5">
              <WaveformCanvas
                data={waveformMap[previewAsset.filePath]?.data ?? null}
                loading={Boolean(waveformMap[previewAsset.filePath]?.loading)}
                error={waveformMap[previewAsset.filePath]?.error ?? null}
                widthPx={220}
                heightPx={36}
                role={previewAsset.category === 'music' ? 'music' : 'sfx'}
                timelineDurationSec={previewAsset.durationSec}
                label={previewAsset.name}
              />
              <audio src={previewAsset.mediaUrl} controls className="h-7 w-full" />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] text-muted-foreground">
            <span>
              {previewAsset.format} · {previewAsset.durationSec}s
              {previewAsset.width > 0 ? ` · ${previewAsset.width}x${previewAsset.height}` : ''}
            </span>
            <span className="truncate max-w-[110px]" title={previewAsset.origin}>
              Origem: {previewAsset.origin}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onInsertAsset(previewAsset)}
            className="inline-flex w-full items-center justify-center gap-1 rounded-lg bg-primary/30 py-1 text-[11px] font-medium text-purple-100 hover:bg-primary/45"
          >
            <Plus className="size-3" /> Inserir na Timeline
          </button>
        </div>
      )}

      {/* Asset List / Grid */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2">
        {grouped.map(([groupName, items]) => (
          <div key={groupName} className="space-y-1.5">
            {groupByProject && (
              <div className="sticky top-0 z-10 bg-[#12121e] py-0.5 text-[10px] font-semibold uppercase tracking-wider text-purple-300">
                {groupName} ({items.length})
              </div>
            )}

            <div className={viewMode === 'grid' ? 'grid grid-cols-2 gap-1.5' : 'space-y-1.5'}>
              {items.map((asset) => {
                const wave = waveformMap[asset.filePath];
                return viewMode === 'grid' ? (
                  <div
                    key={asset.mediaId}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/aethera-asset', JSON.stringify(asset));
                    }}
                    className="group cursor-grab rounded-xl border border-border/70 bg-[#0d0d17] p-1.5 space-y-1 hover:border-purple-400/60 active:cursor-grabbing min-w-0"
                  >
                    <button
                      type="button"
                      onClick={() => setPreviewAssetId(asset.mediaId)}
                      className="relative block aspect-video w-full overflow-hidden rounded-lg bg-[#161325]"
                      title="Pré-visualizar mídia"
                    >
                      {asset.thumbnailUrl ? (
                        <img
                          src={asset.thumbnailUrl}
                          alt={asset.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          {renderCategoryIcon(asset.category)}
                        </div>
                      )}
                      <span className="absolute left-1 top-1 rounded bg-black/75 px-1 py-0.5 text-[9px] font-mono text-slate-200">
                        {asset.format}
                      </span>
                      <span className="absolute right-1 bottom-1 rounded bg-black/75 px-1 py-0.5 text-[9px] font-mono text-amber-300">
                        {asset.durationSec}s
                      </span>
                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100">
                        <Play className="size-4 text-white" />
                      </span>
                    </button>
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-medium text-foreground" title={asset.name}>
                        {asset.name}
                      </p>
                      <p className="truncate text-[9px] text-muted-foreground">
                        {asset.width > 0 ? `${asset.width}x${asset.height} · ` : ''}
                        {asset.origin}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onInsertAsset(asset)}
                      className="inline-flex w-full items-center justify-center gap-1 rounded-md bg-primary/20 py-0.5 text-[10px] font-medium text-purple-200 hover:bg-primary/35"
                    >
                      <Plus className="size-2.5" /> Inserir
                    </button>
                  </div>
                ) : (
                  <div
                    key={asset.mediaId}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/aethera-asset', JSON.stringify(asset));
                    }}
                    className="cursor-grab rounded-xl border border-border/70 bg-[#0d0d17] p-2 space-y-1 hover:border-purple-400/60 active:cursor-grabbing min-w-0"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        type="button"
                        onClick={() => setPreviewAssetId(asset.mediaId)}
                        className="relative h-9 w-16 shrink-0 overflow-hidden rounded bg-[#161325] flex items-center justify-center"
                        title="Pré-visualizar"
                      >
                        {asset.thumbnailUrl ? (
                          <img src={asset.thumbnailUrl} alt={asset.name} className="h-full w-full object-cover" />
                        ) : (
                          renderCategoryIcon(asset.category)
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-foreground" title={asset.name}>
                          {asset.name}
                        </p>
                        <p className="truncate text-[10px] text-muted-foreground">
                          {CATEGORY_LABELS[asset.category]} · {asset.format} · {asset.durationSec}s
                          {asset.width > 0 ? ` · ${asset.width}x${asset.height}` : ''} · {asset.origin}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onInsertAsset(asset)}
                        className="shrink-0 rounded-lg bg-primary/25 p-1.5 text-purple-200 hover:bg-primary/40"
                        title="Inserir na Timeline"
                      >
                        <Plus className="size-3.5" />
                      </button>
                    </div>
                    {asset.kind === 'audio' && wave?.data && (
                      <WaveformCanvas
                        data={wave.data}
                        widthPx={200}
                        heightPx={20}
                        role={asset.category === 'music' ? 'music' : 'sfx'}
                        timelineDurationSec={asset.durationSec}
                        label={asset.name}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

import { useQuery } from '@tanstack/react-query';
import {
  FileText,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Music,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';

type MediaTab = 'all' | 'video' | 'audio' | 'image' | 'script';

interface LocalImportedAsset {
  mediaId: string;
  filePath: string;
  name: string;
  kind: 'video' | 'image' | 'audio';
  durationSec: number;
  width: number;
  height: number;
  mediaUrl: string;
  thumbnailUrl: string | null;
}

export function AetheraMediaLibraryPage() {
  const [tab, setTab] = useState<MediaTab>('all');
  const [search, setSearch] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [localImports, setLocalImports] = useState<LocalImportedAsset[]>([]);

  async function handleImport(filePath?: string) {
    const api = (window as unknown as {
      aetheraBridge?: { cinemaImportMedia?: (input?: { filePath?: string }) => Promise<LocalImportedAsset | null> };
    }).aetheraBridge;
    const imported = await api?.cinemaImportMedia?.(filePath ? { filePath } : undefined);
    if (!imported) return;
    setLocalImports((prev) => [imported, ...prev.filter((i) => i.mediaId !== imported.mediaId)]);
    setSelectedKey(`local:${imported.mediaId}`);
  }

  const projects = useQuery({
    queryKey: ['aethera-content-projects', 'default'],
    queryFn: () => window.neuralbridge.content.projects('default'),
  });
  const library = useQuery({
    queryKey: ['aethera-content-library', 'workspace', projects.data?.map((p) => p.id).join(',')],
    enabled: Boolean(projects.data),
    queryFn: async () =>
      Promise.all(
        (projects.data ?? []).map(async (project) => ({
          project,
          assets: await window.neuralbridge.content.library(project.id),
        })),
      ),
  });

  const allAssets = useMemo(
    () => [
      ...localImports.map((imp) => ({
        key: `local:${imp.mediaId}`,
        project: { id: 'local_import', title: 'Importação Local' },
        asset: {
          id: imp.mediaId,
          path: imp.filePath,
          rightsStatus: 'local_import',
          bytes: 0,
          sha256: imp.mediaId,
          mediaUrl: imp.mediaUrl,
          thumbnailUrl: imp.thumbnailUrl,
        },
        kind: imp.kind,
      })),
      ...(library.data ?? []).flatMap(({ project, assets }) =>
        assets.map((asset) => ({
          key: `${project.id}:${asset.id}`,
          project,
          asset: {
            ...asset,
            mediaUrl: `aethera-media://local?path=${encodeURIComponent(asset.path)}`,
            thumbnailUrl: /\.(png|jpe?g|webp)$/i.test(asset.path)
              ? `aethera-media://local?path=${encodeURIComponent(asset.path)}`
              : null,
          },
          kind: /\.(mp3|wav|ogg|flac)$/i.test(asset.path)
            ? ('audio' as const)
            : /\.(png|jpg|jpeg|webp)$/i.test(asset.path)
              ? ('image' as const)
              : /\.(md|txt|json)$/i.test(asset.path)
                ? ('script' as const)
                : ('video' as const),
        })),
      ),
    ],
    [library.data, localImports],
  );

  const filtered = useMemo(
    () =>
      allAssets.filter((item) => {
        if (tab !== 'all' && item.kind !== tab) return false;
        if (!search.trim()) return true;
        return (
          item.asset.path.toLowerCase().includes(search.toLowerCase()) ||
          item.project.title.toLowerCase().includes(search.toLowerCase())
        );
      }),
    [allAssets, tab, search],
  );

  const selected = filtered.find((i) => i.key === selectedKey) ?? filtered[0] ?? null;

  return (
    <div
      className="space-y-5 p-6 xl:p-8"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0] as (File & { path?: string }) | undefined;
        if (file?.path) void handleImport(file.path);
      }}
    >
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-border bg-gradient-to-r from-[#18102b] via-[#10101b] to-[#0c0c15] p-6">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.22em] text-purple-400 uppercase">
            Estúdio / Biblioteca
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">Biblioteca de Mídia</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Arraste vídeos, áudios ou imagens ou clique em Importar Mídia para extrair thumbnails e waveforms reais.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleImport()}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-xs font-semibold text-white hover:brightness-110"
          >
            <Upload className="size-3.5" /> Importar Mídia
          </button>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar na biblioteca..."
              className="h-9 w-64 rounded-xl border border-border bg-card pl-8 pr-3 text-xs text-foreground focus:border-primary focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['all', `Todos (${allAssets.length})`],
            ['video', 'Vídeos & Cenas'],
            ['audio', 'Áudios, SFX & Músicas'],
            ['image', 'Imagens & Thumbnails'],
            ['script', 'Roteiros & Templates'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
              tab === id
                ? 'border-primary/60 bg-primary/20 text-foreground'
                : 'border-border bg-card text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Main 3-Zone Library Layout */}
      <div className="grid gap-5 lg:grid-cols-12">
        {/* Collections Tree */}
        <aside className="rounded-2xl border border-border bg-card p-4 lg:col-span-3 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Coleções por Projeto
          </h2>
          {projects.data?.length ? (
            <ul className="space-y-1 text-xs">
              {projects.data.map((project) => (
                <li key={project.id}>
                  <button
                    type="button"
                    onClick={() => setSearch(project.title)}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    <span className="inline-flex items-center gap-2 truncate">
                      <FolderOpen className="size-3.5 text-purple-400" />
                      <span className="truncate">{project.title}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Nenhuma coleção criada ainda.</p>
          )}
        </aside>

        {/* Visual Thumbnail Grid */}
        <section className="lg:col-span-6">
          {projects.isLoading || library.isLoading ? (
            <div className="rounded-2xl border border-border bg-card p-8 text-center text-xs text-muted-foreground">
              Inventariando ativos do workspace...
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center space-y-2">
              <Sparkles className="mx-auto size-7 text-purple-400/70" />
              <p className="text-sm font-medium text-foreground">Nenhum ativo encontrado</p>
              <p className="text-xs text-muted-foreground">
                Os vídeos, áudios e roteiros adquiridos ou gerados pelos projetos aparecerão aqui com proveniência.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.length > 120 && (
                <p className="text-[11px] text-muted-foreground">
                  Exibindo 120 de {filtered.length} ativos (use a busca acima para filtrar).
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {filtered.slice(0, 120).map((item) => {
                const Icon =
                  item.kind === 'audio'
                    ? Music
                    : item.kind === 'image'
                      ? ImageIcon
                      : item.kind === 'script'
                        ? FileText
                        : Film;
                const active = selected?.key === item.key;
                const fileName = item.asset.path.split(/[\\/]/).pop() ?? item.asset.path;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setSelectedKey(item.key)}
                    className={`rounded-xl border p-3 text-left transition ${
                      active
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-card hover:border-primary/40'
                    }`}
                  >
                    <div className="mb-2.5 flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-[#1f1435] via-[#11111e] to-[#1a130b]">
                      {item.asset.thumbnailUrl ? (
                        <img src={item.asset.thumbnailUrl} alt={fileName} className="h-full w-full object-cover" />
                      ) : (
                        <Icon className="size-7 text-purple-300/80" />
                      )}
                    </div>
                    <p className="truncate text-xs font-semibold text-foreground">{fileName}</p>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">{item.project.title}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-purple-200">{item.kind}</span>
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-emerald-300">{item.asset.rightsStatus}</span>
                    </div>
                  </button>
                );
              })}
              </div>
            </div>
          )}
        </section>

        {/* Right Inspector */}
        <aside className="rounded-2xl border border-border bg-card p-4 lg:col-span-3 space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Inspetor de Ativo
          </h2>
          {selected ? (
            <div className="space-y-3 text-xs">
              <div className="flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-border bg-[#0b0b14]">
                {selected.kind === 'video' ? (
                  <video src={selected.asset.mediaUrl} controls className="h-full w-full object-contain" />
                ) : selected.kind === 'image' ? (
                  <img src={selected.asset.mediaUrl} alt="" className="h-full w-full object-contain" />
                ) : selected.kind === 'audio' ? (
                  <audio src={selected.asset.mediaUrl} controls className="w-full px-3" />
                ) : (
                  <Film className="size-8 text-purple-400/70" />
                )}
              </div>
              <p className="break-all font-semibold text-foreground">{selected.asset.path}</p>
              <div className="space-y-1.5 rounded-xl border border-border/70 bg-[#0d0d17] p-3 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Projeto</span>
                  <span className="truncate pl-2 font-medium">{selected.project.title}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Direitos</span>
                  <span className="inline-flex items-center gap-1 text-emerald-300">
                    <ShieldCheck className="size-3" /> {selected.asset.rightsStatus}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tamanho</span>
                  <span>{selected.asset.bytes.toLocaleString('pt-BR')} bytes</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">SHA-256</span>
                  <span className="font-mono">{selected.asset.sha256.slice(0, 12)}…</span>
                </div>
              </div>
              <Link
                to="/video"
                className="flex h-9 w-full items-center justify-center rounded-xl bg-primary px-3 text-xs font-semibold text-white hover:brightness-110"
              >
                Inserir no Editor
              </Link>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Selecione um ativo na grade para inspecionar metadados, direitos e enviar ao editor.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

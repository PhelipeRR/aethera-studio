import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Layers,
  Plus,
  RotateCcw,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { auditCreativeProject } from '../domain/pipeline-engine';
import type { CreativeArtProject, CreativeArtType, CreativeLayer } from '../domain/types';
import { useStudio } from '../store/studio-store';

const ART_TABS: ReadonlyArray<{ id: CreativeArtType; label: string }> = [
  { id: 'thumbnail', label: 'Thumbnail (1280×720)' },
  { id: 'banner', label: 'Banner (2560×1440)' },
  { id: 'avatar', label: 'Avatar (800×800)' },
  { id: 'watermark', label: "Marca d'Água (150×150)" },
];

function ArtPreviewCanvas({
  art,
  compact = false,
}: {
  art: CreativeArtProject;
  compact?: boolean;
}) {
  const bgLayer = art.layers.find((l) => l.kind === 'background');
  const badgeLayer = art.layers.find((l) => l.kind === 'badge');
  const headlineLayer = art.layers.find((l) => l.kind === 'headline');
  const watermarkLayer = art.layers.find((l) => l.kind === 'watermark');

  const aspectClass =
    art.artType === 'avatar' || art.artType === 'watermark'
      ? 'aspect-square max-w-[260px] mx-auto'
      : art.artType === 'banner'
        ? 'aspect-[21/9]'
        : 'aspect-video';

  return (
    <div
      className={`relative w-full ${aspectClass} rounded-2xl overflow-hidden select-none shadow-sm border border-black/10`}
      style={{
        background: bgLayer?.visible
          ? `radial-gradient(circle at 80% 20%, ${badgeLayer?.color ?? '#b8a4f4'}45 0%, transparent 55%), linear-gradient(135deg, ${bgLayer.color} 0%, #090910 100%)`
          : '#202026',
      }}
    >
      <div
        aria-hidden="true"
        className="absolute -right-8 -top-8 w-44 h-44 rounded-full border-2 opacity-20"
        style={{ borderColor: badgeLayer?.color ?? '#d8fb4f' }}
      />
      <div
        aria-hidden="true"
        className="absolute right-6 bottom-6 w-24 h-24 rounded-full blur-2xl opacity-35"
        style={{ backgroundColor: badgeLayer?.color ?? '#b8a4f4' }}
      />

      {badgeLayer?.visible && badgeLayer.text && (
        <span
          className={`absolute left-4 top-4 px-2.5 py-1 rounded-full font-bold tracking-wider text-[#111111] ${
            compact ? 'text-[9px]' : 'text-[11px]'
          }`}
          style={{ backgroundColor: badgeLayer.color }}
        >
          {badgeLayer.text}
        </span>
      )}

      {headlineLayer?.visible && headlineLayer.text && (
        <div
          className={`absolute inset-x-4 bottom-4 font-extrabold tracking-tight leading-[1.05] drop-shadow-sm ${
            compact
              ? 'text-base'
              : art.artType === 'avatar'
                ? 'text-5xl text-center inset-y-0 flex items-center justify-center'
                : 'text-2xl sm:text-3xl max-w-[82%]'
          }`}
          style={{ color: headlineLayer.color }}
        >
          {headlineLayer.text}
        </div>
      )}

      {watermarkLayer?.visible && watermarkLayer.text && (
        <span
          className="absolute right-3.5 bottom-3.5 px-2 py-0.5 rounded-lg bg-black/55 font-mono text-[10px] font-bold tracking-widest"
          style={{ color: watermarkLayer.color }}
        >
          {watermarkLayer.text}
        </span>
      )}
    </div>
  );
}

export function CreativeStudioPage() {
  const {
    brandKits,
    creativeProjects,
    createCreativeArt,
    runThumbnailLab,
    updateCreativeLayers,
    toggleApproveCreative,
    saveBrandKit,
  } = useStudio();

  const [artType, setArtType] = useState<CreativeArtType>('thumbnail');
  const [prompt, setPrompt] = useState('');
  const [headline, setHeadline] = useState('');
  const [fidelity, setFidelity] = useState<CreativeArtProject['fidelity']>('conceptual_art');
  const [selectedKitId, setSelectedKitId] = useState(brandKits[0]?.id ?? '');
  const [newKitName, setNewKitName] = useState('');
  const [activeArtId, setActiveArtId] = useState<string>(creativeProjects[0]?.id ?? '');
  const [labVariants, setLabVariants] = useState<CreativeArtProject[]>([]);
  const [undoStack, setUndoStack] = useState<CreativeLayer[][]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const activeArt = useMemo(
    () => creativeProjects.find((p) => p.id === activeArtId) ?? creativeProjects[0],
    [creativeProjects, activeArtId],
  );

  const activeAudit = useMemo(
    () => (activeArt ? auditCreativeProject(activeArt) : null),
    [activeArt],
  );

  const handleGenerateSingle = async () => {
    if (prompt.trim().length < 5 && headline.trim().length < 2) {
      setFormError('Descreva a arte desejada ou informe uma manchete curta.');
      return;
    }
    setFormError(null);
    const created = await createCreativeArt({
      artType,
      prompt: prompt.trim() || headline.trim(),
      headline: headline.trim(),
      fidelity,
      brandKitId: selectedKitId || brandKits[0]?.id || '',
    });
    setActiveArtId(created.id);
    setUndoStack([]);
  };

  const handleThumbnailLab = async () => {
    if (prompt.trim().length < 5 && headline.trim().length < 2) {
      setFormError('Informe um tema ou título curto para rodar o Thumbnail Lab A/B/C.');
      return;
    }
    setFormError(null);
    const variants = await runThumbnailLab({
      prompt: prompt.trim() || headline.trim(),
      headline: headline.trim(),
      fidelity,
      brandKitId: selectedKitId || brandKits[0]?.id || '',
    });
    setLabVariants(variants);
    if (variants[0]) {
      setActiveArtId(variants[0].id);
      setUndoStack([]);
    }
  };

  const mutateLayer = (layerId: string, patch: Partial<CreativeLayer>) => {
    if (!activeArt) return;
    setUndoStack((stack) => [...stack.slice(-10), activeArt.layers]);
    const next = activeArt.layers.map((l) => (l.id === layerId ? { ...l, ...patch } : l));
    void updateCreativeLayers(activeArt.id, next);
  };

  const handleUndo = () => {
    if (!activeArt || undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((stack) => stack.slice(0, -1));
    void updateCreativeLayers(activeArt.id, prev);
  };

  const handleSaveKit = async () => {
    if (!newKitName.trim()) return;
    const created = await saveBrandKit({
      name: newKitName.trim(),
      primaryBg: '#161426',
      secondaryBg: '#2b2250',
      accentColor: '#b8a4f4',
      textColor: '#ffffff',
      monogram: newKitName.trim().slice(0, 2).toUpperCase(),
    });
    setSelectedKitId(created.id);
    setNewKitName('');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111111]">Aethera Creative Studio</h1>
          <p className="text-xs text-[#62626c]">
            Thumbnails A/B/C, banners, avatares e marcas d&apos;água em camadas editáveis com Quality Gate (salvo no SQLite).
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Tipo de arte">
          {ART_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={artType === t.id}
              onClick={() => setArtType(t.id)}
              className={`h-9 px-3.5 rounded-xl text-xs font-semibold transition-colors ${
                artType === t.id
                  ? 'bg-[#111111] text-white'
                  : 'bg-white text-[#111111] hover:bg-[#f4f4f6]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <section className="xl:col-span-8 rounded-[28px] bg-white p-5 shadow-2xs space-y-3.5">
          <div>
            <label htmlFor="creative-prompt" className="sr-only">
              Descrição da arte
            </label>
            <textarea
              id="creative-prompt"
              rows={2}
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                if (formError) setFormError(null);
              }}
              placeholder="Descreva a arte desejada (ex.: Thumbnail Cyberpunk 2077 upgrades cibernéticos com alto contraste)..."
              className="w-full rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] p-3 text-sm text-[#111111] placeholder:text-[#62626c] outline-none focus:bg-white focus:border-[#8b6cf0]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="Título / Monograma curto (ex.: O SEGREDO QUÂNTICO)"
              aria-label="Título ou monograma curto"
              className="h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3.5 text-xs text-[#111111] outline-none focus:bg-white focus:border-[#8b6cf0]"
            />

            <select
              aria-label="Modo de fidelidade visual"
              value={fidelity}
              onChange={(e) => setFidelity(e.target.value as CreativeArtProject['fidelity'])}
              className="h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3 text-xs font-medium text-[#111111]"
            >
              <option value="conceptual_art">Fidelidade: Arte Conceitual (Liberdade IA)</option>
              <option value="content_faithful">Fidelidade: Fiel ao Conteúdo</option>
              <option value="authentic_gameplay">Fidelidade: Frame Autêntico</option>
            </select>
          </div>

          {formError && (
            <p role="alert" className="text-xs font-medium text-[#d23c4f]">
              {formError}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => void handleGenerateSingle()}
              className="h-10 px-5 rounded-xl bg-[#d8fb4f] text-[#111111] text-xs font-bold inline-flex items-center gap-2 hover:brightness-95 transition-all"
            >
              <Wand2 className="w-3.5 h-3.5" />
              <span>Gerar Arte Editável</span>
            </button>

            <button
              type="button"
              onClick={() => void handleThumbnailLab()}
              className="h-10 px-5 rounded-xl bg-[#b8a4f4] text-[#111111] text-xs font-bold inline-flex items-center gap-2 hover:brightness-95 transition-all"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Thumbnail Lab (3 Variações)</span>
            </button>
          </div>
        </section>

        <aside className="xl:col-span-4 rounded-[28px] bg-white p-5 shadow-2xs space-y-3.5">
          <div>
            <label htmlFor="brand-kit-select" className="block text-xs font-bold text-[#111111] mb-1.5">
              Brand Kit do Canal
            </label>
            <select
              id="brand-kit-select"
              value={selectedKitId}
              onChange={(e) => setSelectedKitId(e.target.value)}
              className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3 text-xs font-medium text-[#111111]"
            >
              {brandKits.map((kit) => (
                <option key={kit.id} value={kit.id}>
                  {kit.name} ({kit.monogram})
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={newKitName}
              onChange={(e) => setNewKitName(e.target.value)}
              placeholder="Novo Brand Kit..."
              aria-label="Nome do novo Brand Kit"
              className="flex-1 h-9 rounded-xl bg-[#f4f4f6] border border-[#e3e3e8] px-3 text-xs text-[#111111] outline-none"
            />
            <button
              type="button"
              onClick={() => void handleSaveKit()}
              className="h-9 px-4 rounded-xl bg-[#111111] text-white text-xs font-semibold inline-flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Salvar</span>
            </button>
          </div>

          <div className="pt-1 border-t border-[#e3e3e8]">
            <div className="text-xs font-bold text-[#111111] mb-2">
              Projetos Salvos ({creativeProjects.length})
            </div>
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {creativeProjects.slice(0, 6).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveArtId(item.id);
                    setUndoStack([]);
                  }}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs flex items-center justify-between gap-2 ${
                    activeArt?.id === item.id
                      ? 'bg-[#111111] text-white'
                      : 'bg-[#f4f4f6] text-[#111111] hover:bg-[#e8e8ee]'
                  }`}
                >
                  <span className="truncate font-medium">
                    {item.variantLabel ? `[${item.variantLabel}] ` : ''}
                    {item.headline}
                  </span>
                  {item.approved && (
                    <span className="px-1.5 py-0.5 rounded-full bg-[#d8fb4f] text-[#111111] text-[10px] font-bold shrink-0">
                      OK
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {labVariants.length > 0 && (
        <section className="rounded-[28px] bg-white p-5 shadow-2xs space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#111111]">Thumbnail Lab — Comparativo A / B / C</h2>
            <span className="text-xs text-[#62626c]">Clique em uma variação para editar camadas</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {labVariants.map((variant) => {
              const vAudit = auditCreativeProject(variant);
              const selected = activeArt?.id === variant.id;
              return (
                <button
                  key={variant.id}
                  type="button"
                  onClick={() => {
                    setActiveArtId(variant.id);
                    setUndoStack([]);
                  }}
                  className={`text-left rounded-3xl p-3 transition-all ${
                    selected ? 'bg-[#efe9fd] ring-2 ring-[#111111]' : 'bg-[#f4f4f6] hover:bg-[#ececf2]'
                  }`}
                >
                  <ArtPreviewCanvas art={variant} compact />
                  <div className="mt-2.5 flex items-center justify-between text-xs">
                    <span className="font-bold text-[#111111]">
                      Variante {variant.variantLabel} • {variant.archetype}
                    </span>
                    <span className="font-mono font-semibold text-[#2f7d32]">{vAudit.score}/100</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {activeArt && activeAudit && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
          <section className="xl:col-span-7 rounded-[28px] bg-white p-5 shadow-2xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-[#111111]">Prévia Editável — {activeArt.headline}</h2>
                <p className="text-xs text-[#62626c]">{activeArt.archetype}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={undoStack.length === 0}
                  className="h-9 px-3 rounded-full bg-[#f4f4f6] text-xs font-semibold text-[#111111] disabled:opacity-40 inline-flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Desfazer</span>
                </button>
                <button
                  type="button"
                  onClick={() => void toggleApproveCreative(activeArt.id)}
                  className={`h-9 px-4 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 ${
                    activeArt.approved ? 'bg-[#d8fb4f] text-[#111111]' : 'bg-[#111111] text-white'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{activeArt.approved ? 'Arte Aprovada' : 'Aprovar Arte'}</span>
                </button>
              </div>
            </div>

            <ArtPreviewCanvas art={activeArt} />
          </section>

          <section className="xl:col-span-5 rounded-[28px] bg-white p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-[#111111] inline-flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#6a46d8]" />
                <span>Camadas &amp; Quality Gate</span>
              </h2>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                  activeAudit.passed ? 'bg-[#d8fb4f] text-[#111111]' : 'bg-[#f9a8d4] text-[#111111]'
                }`}
              >
                {activeAudit.score}/100
              </span>
            </div>

            <div className="space-y-2.5">
              {activeArt.layers.map((layer) => (
                <div key={layer.id} className="rounded-2xl bg-[#f4f4f6] p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#111111]">{layer.label}</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={layer.color}
                        aria-label={`Cor da camada ${layer.label}`}
                        onChange={(e) => mutateLayer(layer.id, { color: e.target.value })}
                        className="w-6 h-6 rounded border-0 bg-transparent cursor-pointer"
                      />
                      <button
                        type="button"
                        onClick={() => mutateLayer(layer.id, { visible: !layer.visible })}
                        aria-label={`${layer.visible ? 'Ocultar' : 'Mostrar'} camada ${layer.label}`}
                        className="p-1.5 rounded-lg bg-white text-[#111111]"
                      >
                        {layer.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-[#62626c]" />}
                      </button>
                    </div>
                  </div>
                  {layer.text !== undefined && (
                    <input
                      type="text"
                      value={layer.text}
                      aria-label={`Texto da camada ${layer.label}`}
                      onChange={(e) => mutateLayer(layer.id, { text: e.target.value })}
                      className="w-full h-8 rounded-xl bg-white border border-[#e3e3e8] px-2.5 text-xs font-medium text-[#111111]"
                    />
                  )}
                </div>
              ))}
            </div>

            <div className="pt-2 border-t border-[#e3e3e8] space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#62626c]">
                Auditoria Automática
              </div>
              {activeAudit.checks.map((chk) => (
                <div key={chk.label} className="flex items-center justify-between text-xs">
                  <span className="text-[#111111]">{chk.label}</span>
                  <span className={chk.ok ? 'font-semibold text-[#2f7d32]' : 'font-semibold text-[#9a6200]'}>
                    {chk.ok ? 'OK' : 'Ajustar'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

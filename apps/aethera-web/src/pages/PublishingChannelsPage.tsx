import { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Plus,
  Radio,
  ShieldAlert,
} from 'lucide-react';
import type { ChannelConfig } from '../domain/types';
import { useStudio } from '../store/studio-store';

export function PublishingChannelsPage() {
  const { channels, projects, capabilities, createChannel, navigate } = useStudio();

  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<ChannelConfig['platform']>('youtube');
  const [niche, setNiche] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [toneOfVoice, setToneOfVoice] = useState('Cinematográfico e objetivo');
  const [monthlyBudgetUsd, setMonthlyBudgetUsd] = useState(80);
  const [maxConcurrentProductions, setMaxConcurrentProductions] = useState(2);
  const [editorialStrategy, setEditorialStrategy] = useState('');
  const [autonomyLevel, setAutonomyLevel] = useState<ChannelConfig['autonomyLevel']>('assisted');
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const youtubeCap = capabilities.items.find((i) => i.id === 'youtube-oauth');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !niche.trim()) return;
    setSubmitting(true);
    try {
      const ch = await createChannel({
        name: name.trim(),
        platform,
        niche: niche.trim(),
        targetAudience: targetAudience.trim() || 'Audiência principal do nicho',
        toneOfVoice: toneOfVoice.trim() || 'Editorial',
        language: 'pt-BR',
        monthlyBudgetUsd,
        maxConcurrentProductions,
        editorialStrategy: editorialStrategy.trim() || 'Publicação semanal com aprovação explícita obrigatória.',
        autonomyLevel,
      });
      setName('');
      setNiche('');
      setTargetAudience('');
      setEditorialStrategy('');
      setNotice(`Canal "${ch.name}" salvo no banco SQLite.`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-[28px] bg-white px-6 py-5 flex flex-wrap items-center justify-between gap-4 shadow-2xs">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6a46d8]">
            DISTRIBUIÇÃO &amp; CANAIS • /AETHERA/CHANNELS/NEW
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111111]">Publicação e Canais</h1>
          <p className="text-xs text-[#62626c] mt-0.5">
            Configuração de canais, política editorial, prontidão YouTube OAuth e fila de pacotes com aprovação humana.
          </p>
        </div>

        <span
          className={`h-9 px-4 rounded-full text-xs font-bold inline-flex items-center gap-2 ${
            youtubeCap?.available ? 'bg-[#d8fb4f] text-[#111111]' : 'bg-[#fde7f3] text-[#b42840]'
          }`}
        >
          <Radio className="w-4 h-4" />
          <span>{youtubeCap?.available ? 'YouTube OAuth Configurado' : 'Upload YouTube OAuth Bloqueado'}</span>
        </span>
      </div>

      {/* Honest YouTube OAuth Status */}
      {!youtubeCap?.available && (
        <div className="rounded-[24px] bg-[#fff4dc] px-5 py-3.5 text-xs text-[#704700] flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <strong>Status real da integração YouTube:</strong> {youtubeCap?.detail ?? 'Credenciais OAuth ausentes.'}{' '}
            Defina <code className="font-mono">YOUTUBE_OAUTH_CLIENT_ID</code> e{' '}
            <code className="font-mono">YOUTUBE_OAUTH_REDIRECT_URI</code> no ambiente para habilitar autenticação PKCE e
            upload direto. Nenhum envio falso é simulado.
          </div>
        </div>
      )}

      {notice && (
        <div className="rounded-2xl bg-[#f3fdd0] px-4 py-2.5 text-xs font-semibold text-[#111111] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-[#2f7d32]" />
          <span>{notice}</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        {/* Left: New Channel Setup Form (mirrors ContentChannelSetupPage) */}
        <section className="xl:col-span-6 rounded-[28px] bg-white p-6 shadow-2xs space-y-4">
          <h2 className="text-base font-bold text-[#111111]">Cadastrar Novo Canal</h2>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="ch-name" className="block text-xs font-semibold text-[#111111] mb-1">
                  Nome do canal
                </label>
                <input
                  id="ch-name"
                  required
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex.: Laboratório Cinema BR"
                  className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3.5 text-xs text-[#111111]"
                />
              </div>
              <div>
                <label htmlFor="ch-platform" className="block text-xs font-semibold text-[#111111] mb-1">
                  Plataforma
                </label>
                <select
                  id="ch-platform"
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value as ChannelConfig['platform'])}
                  className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3 text-xs text-[#111111]"
                >
                  <option value="youtube">YouTube</option>
                  <option value="instagram">Instagram Reels</option>
                  <option value="tiktok">TikTok</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="ch-niche" className="block text-xs font-semibold text-[#111111] mb-1">
                  Nicho editorial
                </label>
                <input
                  id="ch-niche"
                  required
                  type="text"
                  value={niche}
                  onChange={(e) => setNiche(e.target.value)}
                  placeholder="Ex.: Documentários de Ciência & Games"
                  className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3.5 text-xs text-[#111111]"
                />
              </div>
              <div>
                <label htmlFor="ch-tone" className="block text-xs font-semibold text-[#111111] mb-1">
                  Tom de voz
                </label>
                <input
                  id="ch-tone"
                  type="text"
                  value={toneOfVoice}
                  onChange={(e) => setToneOfVoice(e.target.value)}
                  className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3.5 text-xs text-[#111111]"
                />
              </div>
            </div>

            <div>
              <label htmlFor="ch-audience" className="block text-xs font-semibold text-[#111111] mb-1">
                Público-alvo
              </label>
              <input
                id="ch-audience"
                type="text"
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
                placeholder="Ex.: Criadores, estudantes de audiovisual e entusiastas 18–35 anos"
                className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3.5 text-xs text-[#111111]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor="ch-budget" className="block text-xs font-semibold text-[#111111] mb-1">
                  Orçamento/mês (USD)
                </label>
                <input
                  id="ch-budget"
                  type="number"
                  min={0}
                  value={monthlyBudgetUsd}
                  onChange={(e) => setMonthlyBudgetUsd(Number(e.target.value) || 0)}
                  className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3 text-xs font-mono text-[#111111]"
                />
              </div>
              <div>
                <label htmlFor="ch-conc" className="block text-xs font-semibold text-[#111111] mb-1">
                  Máx. simultâneas
                </label>
                <input
                  id="ch-conc"
                  type="number"
                  min={1}
                  max={10}
                  value={maxConcurrentProductions}
                  onChange={(e) => setMaxConcurrentProductions(Number(e.target.value) || 1)}
                  className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3 text-xs font-mono text-[#111111]"
                />
              </div>
              <div>
                <label htmlFor="ch-autonomy" className="block text-xs font-semibold text-[#111111] mb-1">
                  Autonomia
                </label>
                <select
                  id="ch-autonomy"
                  value={autonomyLevel}
                  onChange={(e) => setAutonomyLevel(e.target.value as ChannelConfig['autonomyLevel'])}
                  className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3 text-xs text-[#111111]"
                >
                  <option value="manual">Manual</option>
                  <option value="assisted">Assistido</option>
                  <option value="autonomous">Autônomo (com gate)</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="ch-strategy" className="block text-xs font-semibold text-[#111111] mb-1">
                Estratégia editorial
              </label>
              <textarea
                id="ch-strategy"
                rows={2}
                value={editorialStrategy}
                onChange={(e) => setEditorialStrategy(e.target.value)}
                placeholder="Cadência de publicação, proporção long-form × Shorts e política de aprovação..."
                className="w-full rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] p-3 text-xs text-[#111111]"
              />
            </div>

            <button
              type="submit"
              disabled={submitting || !name.trim() || !niche.trim()}
              className="h-10 px-5 rounded-full bg-[#111111] text-white text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50"
            >
              <Plus className="w-4 h-4 text-[#d8fb4f]" />
              <span>Criar Canal no Estúdio</span>
            </button>
          </form>
        </section>

        {/* Right: Configured Channels + Publishing Packages */}
        <div className="xl:col-span-6 space-y-4">
          <section className="rounded-[28px] bg-white p-5 shadow-2xs space-y-3">
            <h2 className="text-base font-bold text-[#111111]">Canais Cadastrados ({channels.length})</h2>
            <div className="space-y-2.5">
              {channels.map((ch) => (
                <article key={ch.id} className="rounded-2xl bg-[#f4f4f6] p-4 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-bold text-[#111111]">{ch.name}</div>
                    <div className="flex items-center gap-1.5">
                      <span className="px-2 py-0.5 rounded-full bg-white text-[10px] font-mono uppercase text-[#6a46d8]">
                        {ch.platform} • {ch.autonomyLevel}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-[#fde7f3] text-[10px] font-semibold text-[#b42840]">
                        OAuth: {ch.oauthStatus}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-[#62626c]">
                    {ch.niche} • Orçamento ${ch.monthlyBudgetUsd}/mês • Máx. {ch.maxConcurrentProductions} simultâneas
                  </p>
                  <p className="text-[11px] text-[#111111]">{ch.editorialStrategy}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-[28px] bg-white p-5 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[#111111]">Pacotes de Publicação</h2>
              <span className="text-[11px] font-medium text-[#62626c]">Aprovação obrigatória</span>
            </div>
            <div className="space-y-2">
              {projects.map((p) => (
                <div
                  key={p.id}
                  className="rounded-2xl bg-[#f4f4f6] p-3.5 flex flex-wrap items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[#111111] truncate">{p.publicationPackage.title}</div>
                    <div className="text-[11px] text-[#62626c] font-mono">
                      v{p.publicationPackage.version} • {p.publicationPackage.visibility} •{' '}
                      {p.scheduledDate ? `Agenda: ${p.scheduledDate}` : 'Sem data'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                        p.publicationPackage.approvalStatus === 'approved'
                          ? 'bg-[#d8fb4f] text-[#111111]'
                          : 'bg-white text-[#9a6200]'
                      }`}
                    >
                      {p.publicationPackage.approvalStatus === 'approved' ? 'Aprovado' : 'Pendente'}
                    </span>
                    <button
                      type="button"
                      onClick={() => navigate('manual_projects', p.id, 'package')}
                      className="h-8 px-3 rounded-full bg-[#111111] text-white text-[11px] font-semibold inline-flex items-center gap-1"
                    >
                      <span>Abrir</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded-2xl bg-[#efe9fd] p-3 text-[11px] text-[#2a1d5c] flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>
                Regra de segurança do estúdio: nenhuma publicação é disparada automaticamente sem aprovação humana explícita no pacote e credenciais OAuth válidas.
              </span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

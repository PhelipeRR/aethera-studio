import React, { useState } from 'react';
import { BookOpen, CheckCircle2, GraduationCap, LoaderCircle, MessageSquare, Plus, Trash2 } from 'lucide-react';

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g);
  return tokens.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={idx} className="rounded bg-white/10 px-1 py-0.5 font-mono text-[11px] text-amber-200">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <em key={idx} className="italic text-purple-100">
          {part.slice(1, -1)}
        </em>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function FormattedAcademyAnswer({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  return (
    <div className="space-y-1.5 text-xs leading-relaxed text-foreground">
      {lines.map((raw, idx) => {
        const line = raw.trim();
        if (!line) return <div key={idx} className="h-1" />;

        const headingMatch = line.match(/^#{1,4}\s+(.+)$/);
        if (headingMatch) {
          return (
            <h4 key={idx} className="pt-1 text-xs font-semibold text-purple-200">
              {renderInlineMarkdown(headingMatch[1] ?? '')}
            </h4>
          );
        }

        if (/^\*\*[^*]+\*\*$/.test(line)) {
          return (
            <h4 key={idx} className="pt-1 text-xs font-semibold text-purple-200">
              {line.slice(2, -2)}
            </h4>
          );
        }

        const bulletMatch = line.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
        if (bulletMatch) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-1">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-purple-400" />
              <span>{renderInlineMarkdown(bulletMatch[1] ?? '')}</span>
            </div>
          );
        }

        return <p key={idx}>{renderInlineMarkdown(line)}</p>;
      })}
    </div>
  );
}

export interface AcademyMaterialView {
  materialId: string;
  title: string;
  kind: 'video' | 'audio' | 'image' | 'document' | 'script' | 'timeline';
  sourceUri: string;
  author: string;
  license: string;
  rightsScope: 'study_only' | 'reusable_owned';
  mode: 'study' | 'reference' | 'train';
  assignedDirectors: string[];
  createdAt: string;
}

export interface AcademyKnowledgeView {
  knowledgeId: string;
  materialId: string;
  directorId: string;
  techniqueName: string;
  observedInfo: string;
  proposedTechnique: string;
  referenceLocation: string;
  validationState: 'extracted' | 'evaluating' | 'validated' | 'rejected';
  testedInExercise: boolean;
  confidence: number;
}

export interface AcademyExerciseView {
  exerciseId: string;
  title: string;
  directorId: string;
  qualityScore: number;
  passed: boolean;
  notes: string;
  createdAt: string;
}

export interface AcademySnapshotView {
  materials: AcademyMaterialView[];
  knowledge: AcademyKnowledgeView[];
  exercises: AcademyExerciseView[];
}

interface AcademyAskResultView {
  answer: string;
  sufficientKnowledge?: boolean;
  synthesisMode?: 'rf07_ai' | 'grounded_extractive' | 'insufficient_evidence';
  citations: Array<{
    materialId: string;
    title: string;
    reference: string;
    excerpt: string;
    relevanceScore?: number;
  }>;
}

interface AetheraAcademyPanelProps {
  academy: AcademySnapshotView;
  busy: boolean;
  onIngest: (input: {
    title: string;
    kind: AcademyMaterialView['kind'];
    sourceUri?: string;
    author: string;
    license: string;
    rightsScope: AcademyMaterialView['rightsScope'];
    mode: AcademyMaterialView['mode'];
    textContent?: string;
  }) => Promise<void>;
  onRunExercise: (knowledge: AcademyKnowledgeView) => Promise<void>;
  onDeleteMaterial: (materialId: string) => Promise<void>;
  onReprocess?: () => Promise<void>;
  onAsk: (question: string) => Promise<AcademyAskResultView | null>;
}

const MODE_LABELS: Record<AcademyMaterialView['mode'], string> = {
  study: 'Estudar (técnica)',
  reference: 'Referência (estilo)',
  train: 'Treinar (exercícios)',
};

export function AetheraAcademyPanel({
  academy,
  busy,
  onIngest,
  onRunExercise,
  onDeleteMaterial,
  onReprocess,
  onAsk,
}: AetheraAcademyPanelProps) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<AcademyMaterialView['kind']>('document');
  const [mode, setMode] = useState<AcademyMaterialView['mode']>('study');
  const [author, setAuthor] = useState('Acervo Interno');
  const [license, setLicense] = useState('CC0 / Uso Interno');
  const [rightsScope, setRightsScope] = useState<AcademyMaterialView['rightsScope']>('study_only');
  const [textContent, setTextContent] = useState('');
  const [question, setQuestion] = useState('');
  const [qaResult, setQaResult] = useState<AcademyAskResultView | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [asking, setAsking] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [runningExerciseId, setRunningExerciseId] = useState<string | null>(null);

  const handleSubmitMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const trimmed = textContent.trim();
    setIngesting(true);
    try {
      await onIngest({
        title: title.trim(),
        kind,
        author: author.trim() || 'Acervo Interno',
        license: license.trim() || 'Uso Interno',
        rightsScope,
        mode,
        ...(trimmed ? { textContent: trimmed } : {}),
      });
      setTitle('');
      setTextContent('');
    } finally {
      setIngesting(false);
    }
  };

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    setAsking(true);
    try {
      const res = await onAsk(question.trim());
      if (res) setQaResult(res);
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Ingest Material Form */}
        <form
          onSubmit={handleSubmitMaterial}
          className="rounded-2xl border border-border bg-card p-5 space-y-4"
        >
          <div className="flex items-center gap-2">
            <GraduationCap className="size-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-foreground">
              Importar Material para Aethera Academia
            </h2>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Título do vídeo, livro, roteiro ou áudio"
              aria-label="Título do material"
              className="sm:col-span-2 rounded-xl border border-border bg-[#0d0d17] px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground"
            />
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as AcademyMaterialView['kind'])}
              aria-label="Tipo de material"
              className="rounded-xl border border-border bg-[#0d0d17] px-3 py-2 text-xs text-foreground"
            >
              <option value="document">Documento / Livro / PDF</option>
              <option value="video">Vídeo / Filme / Trailer</option>
              <option value="audio">Áudio / Trilha / Narração</option>
              <option value="image">Imagem / Referência Visual</option>
              <option value="script">Roteiro</option>
            </select>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as AcademyMaterialView['mode'])}
              aria-label="Modo de aprendizado"
              className="rounded-xl border border-border bg-[#0d0d17] px-3 py-2 text-xs text-foreground"
            >
              <option value="study">Estudar (extrair técnicas)</option>
              <option value="reference">Referência (direção de arte)</option>
              <option value="train">Treinar (gerar exercícios)</option>
            </select>
            <input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Autor / Estúdio"
              aria-label="Autor"
              className="rounded-xl border border-border bg-[#0d0d17] px-3 py-2 text-xs text-foreground"
            />
            <select
              value={rightsScope}
              onChange={(e) => setRightsScope(e.target.value as AcademyMaterialView['rightsScope'])}
              aria-label="Escopo de direitos"
              className="rounded-xl border border-border bg-[#0d0d17] px-3 py-2 text-xs text-foreground"
            >
              <option value="study_only">Apenas estudo (study_only)</option>
              <option value="reusable_owned">Reutilizável / Próprio</option>
            </select>
            <input
              value={license}
              onChange={(e) => setLicense(e.target.value)}
              placeholder="Licença / Procedência"
              aria-label="Licença"
              className="sm:col-span-2 rounded-xl border border-border bg-[#0d0d17] px-3 py-2 text-xs text-foreground"
            />
            <textarea
              value={textContent}
              onChange={(e) => setTextContent(e.target.value)}
              rows={3}
              placeholder="Cole trechos técnicos, anotações ou deixe em branco para selecionar arquivo local (vídeo/áudio/doc)..."
              aria-label="Conteúdo do material"
              className="sm:col-span-2 rounded-xl border border-border bg-[#0d0d17] px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <button
            type="submit"
            disabled={busy || ingesting || !title.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-amber-500 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {ingesting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            {ingesting
              ? 'Indexando e analisando...'
              : textContent.trim()
                ? 'Indexar e Rotear para Diretores'
                : 'Selecionar Arquivo & Indexar'}
          </button>
        </form>

        {/* Ask Academy Q&A */}
        <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="size-4 text-purple-400" />
            <h2 className="text-sm font-semibold text-foreground">
              Perguntar à Academia (com Citações Verificáveis)
            </h2>
          </div>

          <form onSubmit={handleAsk} className="flex gap-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ex.: O que aprendemos sobre J-cut, LUFS ou safe zones?"
              aria-label="Pergunta à Academia"
              className="flex-1 rounded-xl border border-border bg-[#0d0d17] px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              disabled={busy || asking || !question.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-primary/50 bg-primary/20 px-4 py-2 text-xs font-medium text-foreground hover:bg-primary/30 disabled:opacity-50"
            >
              {asking && <LoaderCircle className="size-3.5 animate-spin" />}
              {asking ? 'Consultando...' : 'Consultar'}
            </button>
          </form>

          {qaResult ? (
            <div className="space-y-3 rounded-xl border border-border bg-[#0d0d17] p-3.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-purple-300">Resposta fundamentada</span>
                {qaResult.synthesisMode && (
                  <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] text-muted-foreground">
                    {qaResult.synthesisMode === 'rf07_ai'
                      ? 'Síntese RF-07 (IA)'
                      : qaResult.synthesisMode === 'grounded_extractive'
                        ? 'Extração Estruturada'
                        : 'Evidência Insuficiente'}
                  </span>
                )}
              </div>
              <FormattedAcademyAnswer text={qaResult.answer} />
              {qaResult.citations.length > 0 && (
                <div className="space-y-1.5 border-t border-border/60 pt-2">
                  <p className="text-[11px] font-semibold text-amber-300">Fontes citadas:</p>
                  {qaResult.citations.map((c, idx) => (
                    <div key={`${c.materialId}-${idx}`} className="text-[11px] text-muted-foreground leading-relaxed">
                      <span className="text-foreground font-medium">{c.title}</span> ({c.reference}) —{' '}
                      {c.excerpt}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {academy.materials.length} material(is) · {academy.knowledge.length} técnica(s) extraída(s) ·{' '}
              {academy.exercises.length} exercício(s) executado(s).
            </p>
          )}
        </div>
      </div>

      {/* Materials & Extracted Knowledge */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BookOpen className="size-4 text-purple-300" />
              <h3 className="text-sm font-semibold text-foreground">
                Materiais na Biblioteca de Estudo ({academy.materials.length})
              </h3>
            </div>
            {onReprocess && academy.materials.length > 0 && (
              <button
                type="button"
                disabled={busy || reprocessing}
                onClick={async () => {
                  setReprocessing(true);
                  try {
                    await onReprocess();
                  } finally {
                    setReprocessing(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-[#121222] px-2.5 py-1 text-[11px] text-purple-200 hover:border-primary/50 disabled:opacity-50"
              >
                {reprocessing && <LoaderCircle className="size-3 animate-spin" />}
                {reprocessing ? 'Reprocessando...' : 'Reprocessar Acervo'}
              </button>
            )}
          </div>
          {academy.materials.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nenhum material importado ainda. Importe um vídeo, áudio, livro ou roteiro acima.
            </p>
          ) : (
            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
              {academy.materials.map((m) => (
                <div
                  key={m.materialId}
                  className="flex items-start justify-between gap-3 rounded-xl border border-border bg-[#0d0d17] p-3 text-xs"
                >
                  <div className="space-y-1">
                    <div className="font-semibold text-foreground">{m.title}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {m.kind} · {MODE_LABELS[m.mode]} · {m.rightsScope} · {m.author}
                    </div>
                    <div className="text-[11px] text-purple-300">
                      Diretores: {m.assignedDirectors.join(', ')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDeleteMaterial(m.materialId)}
                    title="Excluir material e memórias derivadas"
                    className="rounded-lg border border-border p-1.5 text-muted-foreground hover:border-destructive/60 hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-foreground">
              Conhecimentos Extraídos & Exercícios ({academy.knowledge.length})
            </h3>
          </div>
          {academy.knowledge.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Técnicas extraídas aparecerão aqui com separação entre dado observado, técnica proposta e validação prática.
            </p>
          ) : (
            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
              {academy.knowledge.map((k) => (
                <div
                  key={k.knowledgeId}
                  className="rounded-xl border border-border bg-[#0d0d17] p-3 text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-foreground">{k.techniqueName}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        k.validationState === 'validated'
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-amber-500/15 text-amber-300'
                      }`}
                    >
                      {k.validationState}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    <strong>Observado:</strong> {k.observedInfo}
                  </p>
                  <p className="text-[11px] text-purple-200">
                    <strong>Técnica:</strong> {k.proposedTechnique}
                  </p>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[10px] text-muted-foreground">
                      {k.directorId} · {k.referenceLocation}
                    </span>
                    <button
                      type="button"
                      disabled={busy || runningExerciseId === k.knowledgeId}
                      onClick={async () => {
                        setRunningExerciseId(k.knowledgeId);
                        try {
                          await onRunExercise(k);
                        } finally {
                          setRunningExerciseId(null);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                    >
                      {runningExerciseId === k.knowledgeId && <LoaderCircle className="size-3 animate-spin" />}
                      {runningExerciseId === k.knowledgeId
                        ? 'Validando...'
                        : k.testedInExercise
                          ? 'Re-testar Exercício'
                          : 'Praticar & Validar'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

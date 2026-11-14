import { BookMarked, CheckCircle2, Mic, Play, Plus, RefreshCw, Volume2 } from 'lucide-react';
import { useState } from 'react';

export type PronunciationCategoryView =
  | 'common_pt_br'
  | 'anime_character'
  | 'work_title'
  | 'game_term'
  | 'english_loanword'
  | 'acronym';

export interface PronunciationDictionaryEntryView {
  id: string;
  term: string;
  expectedPronunciation: string;
  ttsForm: string;
  scope: 'global' | 'language' | 'voice' | 'channel' | 'project';
  category: PronunciationCategoryView;
  language?: string;
  approved?: boolean;
  approvedByUser?: boolean;
}

export interface AudioQualityGateReportView {
  passed: boolean;
  overallScore?: number;
  requiresHumanListeningCheck: boolean;
  failingSegmentIds: string[];
  findings: Array<{ segmentId: string; severity: 'warn' | 'fail'; code: string; message: string }>;
}

const DEFAULT_PT_BR_ENTRIES: PronunciationDictionaryEntryView[] = [
  {
    id: 'ptbr_cabeca',
    term: 'cabeça',
    expectedPronunciation: 'ca-be-ça (sibilante suave, sem distorção)',
    ttsForm: 'cabeça',
    scope: 'language',
    category: 'common_pt_br',
    language: 'pt-BR',
    approved: true,
  },
  {
    id: 'ptbr_anime',
    term: 'anime',
    expectedPronunciation: 'a-ni-mê',
    ttsForm: 'animê',
    scope: 'language',
    category: 'work_title',
    language: 'pt-BR',
    approved: true,
  },
  {
    id: 'ptbr_manga',
    term: 'mangá',
    expectedPronunciation: 'man-gá',
    ttsForm: 'mangá',
    scope: 'language',
    category: 'work_title',
    language: 'pt-BR',
    approved: true,
  },
];

interface VoiceDirectorPanelProps {
  voiceId?: string;
  audioQuality?: AudioQualityGateReportView | null;
  segments?: Array<{ segmentId: string; text: string }>;
  onRegenerateSegment?: (segmentId: string, overrideText?: string) => void;
  onTestSample?: (text: string) => Promise<void> | void;
}

export function VoiceDirectorPanel({
  voiceId = '9190edfa',
  audioQuality,
  segments = [],
  onRegenerateSegment,
  onTestSample,
}: VoiceDirectorPanelProps) {
  const [expressiveness, setExpressiveness] = useState(0.65);
  const [baseWpm, setBaseWpm] = useState(148);
  const [dictionary, setDictionary] = useState<PronunciationDictionaryEntryView[]>([
    ...DEFAULT_PT_BR_ENTRIES,
  ]);
  const [newTerm, setNewTerm] = useState('');
  const [newExpected, setNewExpected] = useState('');
  const [newTtsForm, setNewTtsForm] = useState('');
  const [newCategory, setNewCategory] = useState<PronunciationCategoryView>('anime_character');
  const [sampleText, setSampleText] = useState(
    'Você já parou para pensar no que passa pela cabeça do protagonista quando tudo parece perdido?',
  );
  const [testingSample, setTestingSample] = useState(false);

  const addEntry = () => {
    if (!newTerm.trim() || !newExpected.trim()) return;
    setDictionary((prev) => [
      ...prev,
      {
        id: `dict_${Date.now()}`,
        term: newTerm.trim(),
        expectedPronunciation: newExpected.trim(),
        ttsForm: newTtsForm.trim() || newTerm.trim(),
        category: newCategory,
        scope: 'channel',
        voiceId,
        language: 'pt-BR',
        approvedByUser: true,
      },
    ]);
    setNewTerm('');
    setNewExpected('');
    setNewTtsForm('');
  };

  return (
    <section className="sg-panel space-y-4 rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Mic className="size-4 text-primary" />
            AI Voice Director & Dicionário de Pronúncia
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Direção de ritmo, pausas por pontuação, dicionário pt-BR/anime e regeneração isolada por trecho.
          </p>
        </div>
        {audioQuality && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs ${
              audioQuality.passed
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
            }`}
          >
            <CheckCircle2 className="size-3.5" />
            Áudio {audioQuality.overallScore}/100
          </span>
        )}
      </div>

      {/* Ritmo e Expressividade */}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block rounded-xl border border-border bg-background/50 p-3 text-xs">
          <div className="flex justify-between">
            <span>Expressividade narrativa</span>
            <span className="font-mono text-primary">{Math.round(expressiveness * 100)}%</span>
          </div>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={expressiveness}
            onChange={(e) => setExpressiveness(Number(e.target.value))}
            className="mt-2 w-full accent-primary"
          />
        </label>

        <label className="block rounded-xl border border-border bg-background/50 p-3 text-xs">
          <div className="flex justify-between">
            <span>Ritmo base (palavras/min)</span>
            <span className="font-mono text-primary">{baseWpm} ppm</span>
          </div>
          <input
            type="range"
            min={120}
            max={180}
            step={2}
            value={baseWpm}
            onChange={(e) => setBaseWpm(Number(e.target.value))}
            className="mt-2 w-full accent-primary"
          />
        </label>
      </div>

      {/* Teste rápido de amostra */}
      <div className="space-y-2 rounded-xl border border-border bg-background/40 p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium">
          <Volume2 className="size-3.5 text-primary" />
          Reproduzir amostra antes da produção
        </p>
        <div className="flex gap-2">
          <input
            value={sampleText}
            onChange={(e) => setSampleText(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs"
          />
          <button
            type="button"
            disabled={testingSample || !sampleText.trim()}
            onClick={async () => {
              if (!onTestSample) return;
              setTestingSample(true);
              try {
                await onTestSample(sampleText);
              } finally {
                setTestingSample(false);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            <Play className="size-3" />
            {testingSample ? 'Sintetizando…' : 'Ouvir amostra'}
          </button>
        </div>
      </div>

      {/* Dicionário de Pronúncia */}
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-xs font-medium">
          <BookMarked className="size-3.5 text-primary" />
          Dicionário de Pronúncia (sem alterar o roteiro editorial)
        </p>
        <div className="grid gap-2 sm:grid-cols-4">
          <input
            value={newTerm}
            onChange={(e) => setNewTerm(e.target.value)}
            placeholder="Palavra (ex: cabeça, Gojo)"
            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs"
          />
          <input
            value={newExpected}
            onChange={(e) => setNewExpected(e.target.value)}
            placeholder="Pronúncia esperada"
            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs"
          />
          <input
            value={newTtsForm}
            onChange={(e) => setNewTtsForm(e.target.value)}
            placeholder="Forma TTS (opcional)"
            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs"
          />
          <div className="flex gap-1.5">
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value as PronunciationCategoryView)}
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
            >
              <option value="pt_br_common">PT-BR comum</option>
              <option value="anime_character">Anime / Personagem</option>
              <option value="japanese_name">Nome japonês</option>
              <option value="game_term">Termo de jogo</option>
              <option value="acronym">Sigla</option>
            </select>
            <button
              type="button"
              onClick={addEntry}
              className="rounded-lg border border-primary px-2.5 text-xs text-primary"
              aria-label="Adicionar pronúncia"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {dictionary.map((entry) => (
            <span
              key={entry.id}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] ${
                entry.approvedByUser
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                  : 'border-border bg-background text-muted-foreground'
              }`}
            >
              <strong>{entry.term}</strong> → {entry.expectedPronunciation}
            </span>
          ))}
        </div>
      </div>

      {/* Regeneração direcionada por trecho */}
      {segments.length > 0 && (
        <div className="space-y-1.5 border-t border-border pt-3">
          <p className="text-xs font-medium">Trechos da narração ({segments.length})</p>
          <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
            {segments.map((seg) => (
              <div key={seg.segmentId} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/50 px-3 py-2 text-xs">
                <span className="truncate text-muted-foreground">{seg.text}</span>
                {onRegenerateSegment && (
                  <button
                    type="button"
                    onClick={() => onRegenerateSegment(seg.segmentId)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-primary/40 px-2.5 py-1 text-[11px] text-primary hover:bg-primary/10"
                  >
                    <RefreshCw className="size-3" />
                    Corrigir narração deste trecho
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

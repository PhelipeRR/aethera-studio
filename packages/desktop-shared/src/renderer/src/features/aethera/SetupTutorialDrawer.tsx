import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  HelpCircle,
  LoaderCircle,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  INTEGRATION_TUTORIALS,
  loadTutorialStepProgress,
  saveTutorialStepProgress,
  type TutorialIntegrationId,
} from './settings-tutorials';

interface SetupTutorialDrawerProps {
  integrationId: TutorialIntegrationId | null;
  onClose: () => void;
  onHighlightField?: (fieldId: string | null) => void;
  onTestConnection: (id: TutorialIntegrationId) => Promise<{ ok: boolean; message: string }>;
}

export function SetupTutorialDrawer({
  integrationId,
  onClose,
  onHighlightField,
  onTestConnection,
}: SetupTutorialDrawerProps) {
  const spec = integrationId ? INTEGRATION_TUTORIALS[integrationId] : null;
  const [stepIdx, setStepIdx] = useState(0);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!integrationId || !spec) {
      onHighlightField?.(null);
      return;
    }
    const saved = loadTutorialStepProgress(integrationId);
    const bounded = Math.min(saved, Math.max(0, spec.steps.length - 1));
    setStepIdx(bounded);
    setTestResult(null);
    onHighlightField?.(spec.steps[bounded]?.targetFieldId ?? null);
  }, [integrationId, spec, onHighlightField]);

  useEffect(() => {
    if (!integrationId || !spec) return;
    saveTutorialStepProgress(integrationId, stepIdx);
    onHighlightField?.(spec.steps[stepIdx]?.targetFieldId ?? null);
  }, [integrationId, spec, stepIdx, onHighlightField]);

  if (!spec || !integrationId) return null;

  const currentStep = spec.steps[stepIdx] ?? spec.steps[0]!;
  const totalSteps = spec.steps.length;
  const progressPct = Math.round(((stepIdx + 1) / totalSteps) * 100);

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(value);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await onTestConnection(integrationId);
      setTestResult(res);
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Falha ao testar conexão.',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <aside
      aria-label={`Tutorial: ${spec.title}`}
      className="rounded-2xl border border-purple-500/40 bg-[#0d0d1a] p-5 space-y-4 shadow-xl"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-purple-300">
            <HelpCircle className="size-3.5" />
            Tutorial Guiado · Revisado em {spec.lastReviewedAt}
          </div>
          <h3 className="text-sm font-semibold text-foreground">{spec.title}</h3>
          <p className="text-xs text-muted-foreground">{spec.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            onHighlightField?.(null);
            onClose();
          }}
          aria-label="Fechar tutorial"
          className="rounded-lg p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Progress Bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Etapa {stepIdx + 1} de {totalSteps}</span>
          <span>{progressPct}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-purple-500 to-amber-400 transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Required Credentials */}
      <div className="rounded-xl border border-border bg-[#090912] p-3 text-xs space-y-1.5">
        <div className="flex items-center gap-1.5 font-medium text-emerald-300">
          <ShieldCheck className="size-3.5" />
          Credenciais necessárias (armazenadas localmente com segurança)
        </div>
        <ul className="list-disc pl-4 text-[11px] text-muted-foreground space-y-0.5">
          {spec.requiredCredentials.map((cred) => (
            <li key={cred}>{cred}</li>
          ))}
        </ul>
      </div>

      {/* Current Step */}
      <div className="rounded-xl border border-purple-500/30 bg-[#121224] p-4 space-y-2.5">
        <p className="text-xs font-semibold text-foreground">
          {stepIdx + 1}. {currentStep.title}
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">{currentStep.instruction}</p>

        {currentStep.example && (
          <p className="rounded-lg bg-black/30 px-2.5 py-1.5 font-mono text-[11px] text-amber-200">
            {currentStep.example}
          </p>
        )}

        {currentStep.copyValue && (
          <button
            type="button"
            onClick={() => void handleCopy(currentStep.copyValue!)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-[#0d0d17] px-2.5 py-1 text-[11px] text-foreground hover:border-primary/50"
          >
            <Copy className="size-3" />
            {copiedKey === currentStep.copyValue ? 'Copiado!' : (currentStep.copyLabel ?? 'Copiar valor')}
          </button>
        )}
      </div>

      {/* Official Portal + Test Connection */}
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={spec.officialPortalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-[#131324] px-3 py-1.5 text-xs font-medium text-purple-200 hover:border-primary/50"
        >
          <ExternalLink className="size-3.5" />
          {spec.officialPortalLabel}
        </a>

        <button
          type="button"
          onClick={() => void handleTest()}
          disabled={testing}
          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50"
        >
          {testing ? <LoaderCircle className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
          {testing ? 'Testando...' : 'Testar conexão'}
        </button>
      </div>

      {testResult && (
        <div
          role="status"
          className={`rounded-xl border p-3 text-xs ${
            testResult.ok
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
          }`}
        >
          {testResult.message}
        </div>
      )}

      {/* Navigation Footer */}
      <div className="flex items-center justify-between border-t border-border/60 pt-3">
        <button
          type="button"
          disabled={stepIdx === 0}
          onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          <ChevronLeft className="size-3.5" />
          Voltar
        </button>

        {stepIdx < totalSteps - 1 ? (
          <button
            type="button"
            onClick={() => setStepIdx((i) => Math.min(totalSteps - 1, i + 1))}
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
          >
            Próxima etapa
            <ChevronRight className="size-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              onHighlightField?.(null);
              onClose();
            }}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Concluir tutorial
          </button>
        )}
      </div>
    </aside>
  );
}

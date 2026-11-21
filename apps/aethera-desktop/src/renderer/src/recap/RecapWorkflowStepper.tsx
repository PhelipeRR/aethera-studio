import { useRef, type KeyboardEvent } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Download,
  Film,
  Layers,
  Mic,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import type { RecapWorkflowStepId, RecapWorkflowStepState, WorkflowStepStatus } from '../recap-timeline-model.js';

const STEP_ICONS: Record<RecapWorkflowStepId, typeof BookOpen> = {
  projeto: BookOpen,
  capitulos: Download,
  analise: Sparkles,
  roteiro: BookOpen,
  narracao: Mic,
  storyboard: Layers,
  producao: RefreshCw,
  revisao: ShieldCheck,
};

const STATUS_META: Record<
  WorkflowStepStatus,
  { label: string; dot: string; bg: string; border: string; fg: string }
> = {
  pending: {
    label: 'Pendente',
    dot: '#a1a1aa',
    bg: 'transparent',
    border: 'transparent',
    fg: '#52525b',
  },
  processing: {
    label: 'Processando',
    dot: '#6a46d8',
    bg: '#efe9fd',
    border: '#d6c8fb',
    fg: '#2a1d5c',
  },
  ready: {
    label: 'Pronta',
    dot: '#2f7d32',
    bg: '#eaf7df',
    border: '#bbf7d0',
    fg: '#166534',
  },
  needs_review: {
    label: 'Precisa de revisão',
    dot: '#b45309',
    bg: '#fef3c7',
    border: '#fde68a',
    fg: '#9a6200',
  },
  error: {
    label: 'Erro',
    dot: '#b42840',
    bg: '#fde7f3',
    border: '#fbcfe8',
    fg: '#b42840',
  },
};

export interface RecapWorkflowStepperProps {
  steps: readonly RecapWorkflowStepState[];
  activeStep: RecapWorkflowStepId;
  onSelectStep: (step: RecapWorkflowStepId) => void;
}

export function RecapWorkflowStepper({ steps, activeStep, onSelectStep }: RecapWorkflowStepperProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = (idx + 1) % steps.length;
      onSelectStep(steps[next]!.id);
      tabRefs.current[next]?.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = (idx - 1 + steps.length) % steps.length;
      onSelectStep(steps[prev]!.id);
      tabRefs.current[prev]?.focus();
    }
  };

  return (
    <nav
      aria-label="Fluxo de produção do Aethera Recap"
      role="tablist"
      className="recap-stepper-chrome"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        borderRadius: 20,
        padding: 6,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))',
        gap: 4,
      }}
    >
      {steps.map((step, idx) => {
        const isActive = step.id === activeStep;
        const meta = STATUS_META[step.status];
        const Icon = STEP_ICONS[step.id];

        return (
          <button
            key={step.id}
            ref={(el) => {
              tabRefs.current[idx] = el;
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={`${step.index}. ${step.label} — ${meta.label}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSelectStep(step.id)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className="recap-pressable"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 4,
              padding: '8px 11px',
              borderRadius: 14,
              border: isActive
                ? '1.5px solid #111111'
                : `1px solid ${meta.border !== 'transparent' ? meta.border : 'transparent'}`,
              background: isActive ? '#111111' : meta.bg,
              color: isActive ? '#ffffff' : '#111111',
              textAlign: 'left',
              minHeight: 48,
              fontFamily: 'inherit',
            }}
          >
            <div style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '-0.01em',
                }}
              >
                <Icon style={{ width: 13, height: 13, flexShrink: 0, opacity: isActive ? 1 : 0.78 }} aria-hidden="true" />
                <span>{step.label}</span>
              </span>
              {step.status === 'ready' ? (
                <CheckCircle2 style={{ width: 13, height: 13, color: isActive ? '#d8fb4f' : '#2f7d32', flexShrink: 0 }} aria-hidden="true" />
              ) : step.status === 'error' ? (
                <XCircle style={{ width: 13, height: 13, color: isActive ? '#fda4af' : '#b42840', flexShrink: 0 }} aria-hidden="true" />
              ) : step.status === 'needs_review' ? (
                <AlertTriangle style={{ width: 13, height: 13, color: isActive ? '#fde68a' : '#b45309', flexShrink: 0 }} aria-hidden="true" />
              ) : (
                <span
                  aria-hidden="true"
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 9999,
                    background: isActive ? '#d8fb4f' : meta.dot,
                    flexShrink: 0,
                  }}
                />
              )}
            </div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                fontFamily: 'var(--font-mono, monospace)',
                color: isActive ? 'rgba(255,255,255,0.75)' : meta.fg,
              }}
            >
              {String(step.index).padStart(2, '0')} · {meta.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

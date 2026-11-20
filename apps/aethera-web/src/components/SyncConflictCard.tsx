import { useState } from 'react';
import { AlertTriangle, Copy, Download, Upload } from 'lucide-react';
import type { ResolveSyncConflictRequest, SyncConflictPayload } from '../../../aethera-remote-host/src/contracts/v1';

interface SyncConflictCardProps {
  conflict: SyncConflictPayload;
  onResolve: (
    projectId: string,
    strategy: ResolveSyncConflictRequest['strategy'],
    clientData?: SyncConflictPayload['incomingData'],
  ) => Promise<void>;
}

export function SyncConflictCard({ conflict, onResolve }: SyncConflictCardProps) {
  const [resolving, setResolving] = useState<string | null>(null);

  const handleAction = async (strategy: ResolveSyncConflictRequest['strategy']) => {
    setResolving(strategy);
    try {
      await onResolve(
        conflict.projectId,
        strategy,
        strategy === 'keep_server' ? undefined : conflict.incomingData,
      );
    } finally {
      setResolving(null);
    }
  };

  return (
    <div className="rounded-2xl bg-[#fde7f3] border border-[#f5b7d5] p-4 space-y-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-[#b42840] shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-[#831843]">
              Conflito de versão detectado — {conflict.serverProject.data.title}
            </div>
            <p className="text-[#831843]/85 mt-0.5">
              Sua edição partiu da revisão <strong>v{conflict.expectedVersion ?? 0}</strong>, mas o PC/Desktop já
              avançou para <strong>v{conflict.serverVersion}</strong> (por{' '}
              <code className="font-mono">{conflict.serverProject.updatedBy}</code>). Nenhuma alteração foi sobrescrita.
            </p>
          </div>
        </div>
      </div>

      {conflict.changedFields.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold text-[#831843]">Campos divergentes:</span>
          {conflict.changedFields.map((field) => (
            <span
              key={field}
              className="px-2 py-0.5 rounded-full bg-white text-[#831843] font-mono text-[10px] font-semibold"
            >
              {field}
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        <div className="rounded-xl bg-white/90 p-3 space-y-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#6a46d8]">
            Versão no PC / Desktop (v{conflict.serverVersion})
          </div>
          <div className="font-semibold text-[#111111]">{conflict.serverProject.data.title}</div>
          <p className="text-[11px] text-[#62626c] line-clamp-3">{conflict.serverProject.data.briefing}</p>
        </div>
        <div className="rounded-xl bg-white/90 p-3 space-y-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#b42840]">
            Sua edição no Web
          </div>
          <div className="font-semibold text-[#111111]">{conflict.incomingData.title}</div>
          <p className="text-[11px] text-[#62626c] line-clamp-3">{conflict.incomingData.briefing}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          disabled={resolving !== null}
          onClick={() => void handleAction('keep_server')}
          className="h-8 px-3.5 rounded-full bg-[#111111] text-white text-[11px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5 text-[#d8fb4f]" />
          <span>{resolving === 'keep_server' ? 'Aplicando...' : 'Manter versão do PC'}</span>
        </button>
        <button
          type="button"
          disabled={resolving !== null}
          onClick={() => void handleAction('force_client')}
          className="h-8 px-3.5 rounded-full bg-white text-[#111111] border border-[#e3e3e8] text-[11px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          <Upload className="w-3.5 h-3.5 text-[#6a46d8]" />
          <span>{resolving === 'force_client' ? 'Enviando...' : 'Aplicar minha edição'}</span>
        </button>
        <button
          type="button"
          disabled={resolving !== null}
          onClick={() => void handleAction('fork_copy')}
          className="h-8 px-3.5 rounded-full bg-[#d8fb4f] text-[#111111] text-[11px] font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          <Copy className="w-3.5 h-3.5" />
          <span>{resolving === 'fork_copy' ? 'Duplicando...' : 'Salvar minha edição como cópia'}</span>
        </button>
      </div>
    </div>
  );
}

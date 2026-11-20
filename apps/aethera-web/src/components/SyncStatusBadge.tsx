import { AlertTriangle, CheckCircle2, Clock, HardDrive } from 'lucide-react';
import type { ProjectSyncBadgeState } from '../../../aethera-remote-host/src/contracts/v1';

interface SyncStatusBadgeProps {
  state: ProjectSyncBadgeState;
  version?: number;
  inverted?: boolean;
}

export function SyncStatusBadge({ state, version, inverted = false }: SyncStatusBadgeProps) {
  if (state === 'synced') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#d8fb4f] text-[#111111] shrink-0">
        <CheckCircle2 className="w-3 h-3" />
        <span>Sincronizado{version !== undefined ? ` v${version}` : ''}</span>
      </span>
    );
  }
  if (state === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#fef3c7] text-[#92400e] shrink-0">
        <Clock className="w-3 h-3" />
        <span>Pendente</span>
      </span>
    );
  }
  if (state === 'conflict') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#fde7f3] text-[#b42840] shrink-0">
        <AlertTriangle className="w-3 h-3" />
        <span>Conflito</span>
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${
        inverted ? 'bg-white/15 text-white/85' : 'bg-white text-[#62626c] border border-[#e3e3e8]'
      }`}
    >
      <HardDrive className="w-3 h-3" />
      <span>Local (Web)</span>
    </span>
  );
}

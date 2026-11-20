import { useId } from 'react';

export function AetheraMark({ compact = false }: { compact?: boolean }) {
  const gradId = useId();
  return (
    <div className="flex items-center gap-2.5 select-none">
      <svg
        width="28"
        height="28"
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <defs>
          <linearGradient id={gradId} x1="4" y1="28" x2="28" y2="4" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#6a46d8" />
            <stop offset="55%" stopColor="#9c7df2" />
            <stop offset="100%" stopColor="#d8fb4f" />
          </linearGradient>
        </defs>
        <path
          d="M16 4L27.5 26H21.8L16 14.2L10.2 26H4.5L16 4Z"
          fill={`url(#${gradId})`}
        />
        <circle cx="16" cy="22.5" r="2.5" fill="#111111" />
      </svg>
      {!compact && (
        <div className="leading-none">
          <div className="text-[13px] font-bold tracking-[0.2em] text-[#111111]">AETHERA</div>
          <div className="mt-0.5 text-[9px] font-semibold tracking-[0.26em] text-[#9a6200]">STUDIO</div>
        </div>
      )}
    </div>
  );
}

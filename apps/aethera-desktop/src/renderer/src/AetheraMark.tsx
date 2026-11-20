import { useId } from 'react';

export function AetheraMark({ compact = false }: { compact?: boolean }) {
  const gradId = useId();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, userSelect: 'none' }}>
      <svg
        width="28"
        height="28"
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
        style={{ flexShrink: 0 }}
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
        <div style={{ lineHeight: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.2em', color: '#111111' }}>AETHERA</div>
          <div style={{ marginTop: 3, fontSize: 9, fontWeight: 600, letterSpacing: '0.26em', color: '#9a6200' }}>STUDIO</div>
        </div>
      )}
    </div>
  );
}

import { useId } from 'react';

export interface AetheraMarkProps {
  compact?: boolean;
  size?: number;
  variant?: 'full' | 'small' | 'mono';
  className?: string;
  label?: string;
}

/**
 * Canonical Aethera Studio brand mark — 100% identical to apps/aethera-web/src/components/AetheraMark.tsx.
 * Prism "A" with gradient (#6a46d8 -> #9c7df2 -> #d8fb4f), ink core dot (#111111),
 * and AETHERA / STUDIO wordmark.
 */
export function AetheraPrismLogo({
  size = 28,
  variant = 'full',
  className,
  label,
}: {
  size?: number;
  variant?: 'full' | 'small' | 'mono';
  className?: string;
  label?: string;
} = {}) {
  const gradId = useId();
  const a11y = label
    ? { role: 'img' as const, 'aria-label': label }
    : { 'aria-hidden': true as const };

  if (variant === 'mono') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        className={className}
        style={{ flexShrink: 0 }}
        data-variant="mono"
        {...a11y}
      >
        <path d="M16 4L27.5 26H21.8L16 14.2L10.2 26H4.5L16 4Z" fill="currentColor" />
        <circle cx="16" cy="22.5" r="2.5" fill="currentColor" opacity="0.7" />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      style={{ flexShrink: 0 }}
      data-variant={variant}
      {...a11y}
    >
      <defs>
        <linearGradient id={gradId} x1="4" y1="28" x2="28" y2="4" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6a46d8" />
          <stop offset="55%" stopColor="#9c7df2" />
          <stop offset="100%" stopColor="#d8fb4f" />
        </linearGradient>
      </defs>
      <path d="M16 4L27.5 26H21.8L16 14.2L10.2 26H4.5L16 4Z" fill={`url(#${gradId})`} />
      <circle cx="16" cy="22.5" r="2.5" fill="#111111" />
    </svg>
  );
}

export function AetheraMark({
  compact = false,
  size = 28,
  variant = 'full',
  className,
  label,
}: AetheraMarkProps = {}) {
  if (compact) {
    return <AetheraPrismLogo size={size} variant={variant} className={className} label={label} />;
  }

  return (
    <div
      className={className}
      style={{ display: 'flex', alignItems: 'center', gap: 10, userSelect: 'none' }}
    >
      <AetheraPrismLogo size={size} variant={variant} label={label} />
      <div style={{ lineHeight: 1 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.2em',
            color: '#111111',
          }}
        >
          AETHERA
        </div>
        <div
          style={{
            marginTop: 2,
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.26em',
            color: '#9a6200',
          }}
        >
          STUDIO
        </div>
      </div>
    </div>
  );
}

/**
 * Drop-in signature replacement for shared screens (VelixPage, AetheraProductionWorkspace)
 * so every screen in Aethera Studio Desktop uses the exact Web prism logo & wordmark.
 */
export function AetheraSignature({ as: Heading = 'h1' }: { as?: 'h1' | 'h2' | 'p' } = {}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, userSelect: 'none' }}>
      <AetheraPrismLogo size={40} />
      <div style={{ lineHeight: 1 }}>
        <Heading
          style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: '0.2em',
            color: '#111111',
            textTransform: 'uppercase',
          }}
        >
          AETHERA
        </Heading>
        <p
          style={{
            margin: '4px 0 0',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.26em',
            color: '#9a6200',
            textTransform: 'uppercase',
          }}
        >
          STUDIO
        </p>
      </div>
    </div>
  );
}

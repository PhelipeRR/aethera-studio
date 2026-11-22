import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export interface OutroCompositionPalette {
  primary: string;
  secondary: string;
  energy: string;
  glow: string;
  particles: string;
  text: string;
  ctaBg: string;
  ctaText: string;
}

export interface OutroCompositionLogoTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  glowIntensity: number;
  revealIntensity: number;
}

export interface OutroCompositionTexts {
  preTitle: string;
  channelTitle: string;
  subscribeCtaText: string;
  nextVideoLabel: string;
  nextVideoTitle: string;
}

export interface OutroStudioCompositionProps {
  templateId: 'fire_reveal' | 'electric_reveal' | 'particle_reveal' | 'glitch_reveal' | string;
  aspectRatio: '16:9' | '9:16';
  palette: OutroCompositionPalette;
  intensity: number; // 0..100
  parallaxEnabled: boolean;
  backgroundImageUrl?: string | null;
  logoImageUrl?: string | null;
  logoDisabled?: boolean;
  logoTransform: OutroCompositionLogoTransform;
  texts: OutroCompositionTexts;
  showSubscribeCta: boolean;
  showNextVideoCard: boolean;
  showSafeAreaGuides?: boolean;
  reducedMotion?: boolean;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Deterministic-by-frame Remotion composition for all 4 MotionVelix Outro Studio 3.0 templates:
 * `fire_reveal`, `electric_reveal`, `particle_reveal`, `glitch_reveal`.
 *
 * Scales the canonical 15s timeline proportionally:
 * 0–2s env prep | 2–5s energy/flames | 5–7s progressive logo reveal |
 * 7–10s channel name | 10–13s subscribe CTA | 13–15s final hold & exit.
 */
export const OutroStudioComposition: React.FC<OutroStudioCompositionProps> = ({
  templateId,
  aspectRatio,
  palette,
  intensity,
  parallaxEnabled,
  backgroundImageUrl,
  logoImageUrl,
  logoDisabled = false,
  logoTransform,
  texts,
  showSubscribeCta,
  showNextVideoCard,
  showSafeAreaGuides = false,
  reducedMotion = false,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();

  const progress = durationInFrames > 1 ? frame / (durationInFrames - 1) : 0;
  const tSec = frame / Math.max(1, fps);
  const totalSec = durationInFrames / Math.max(1, fps);
  const scaleTime = totalSec / 15;

  // Proportional 6-phase keyframes (exact 0-2-5-7-10-13-15s at 15s duration)
  const kEnvEnd = 2 * scaleTime;
  const kEnergyStart = 2 * scaleTime;
  const kEnergyEnd = 5 * scaleTime;
  const kLogoStart = 5 * scaleTime;
  const kLogoEnd = 7 * scaleTime;
  const kTitleStart = 7 * scaleTime;
  const kTitleEnd = 10 * scaleTime;
  const kCtaStart = 10 * scaleTime;
  const kCtaEnd = 13 * scaleTime;
  const kHoldStart = 13 * scaleTime;

  const normIntensity = clamp01(intensity / 100);
  const isVertical = aspectRatio === '9:16';

  // Master fade-in & exit fade-out
  const masterFadeIn = interpolate(tSec, [0, Math.max(0.35, kEnvEnd * 0.4)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const masterFadeOut = interpolate(tSec, [kHoldStart + (totalSec - kHoldStart) * 0.45, totalSec], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const masterOpacity = masterFadeIn * masterFadeOut;

  // Phase 2: Energy / Flames / Electric / Particles / Glitch entrance
  const energyAppear = interpolate(tSec, [kEnergyStart, kEnergyEnd], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Phase 3: Progressive logo reveal (5–7s)
  const logoReveal = interpolate(tSec, [kLogoStart, kLogoEnd], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const logoSpring = reducedMotion
    ? logoReveal
    : spring({
        frame: Math.max(0, frame - Math.round(kLogoStart * fps)),
        fps,
        config: { damping: 14, stiffness: 110, mass: 0.9 },
      });

  // Phase 4: Channel title reveal (7–10s)
  const titleReveal = interpolate(tSec, [kTitleStart, kTitleStart + (kTitleEnd - kTitleStart) * 0.65], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Phase 5: Subscribe CTA reveal (10–13s)
  const ctaReveal = interpolate(tSec, [kCtaStart, kCtaStart + (kCtaEnd - kCtaStart) * 0.55], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Layer 1: Deterministic parallax motion
  const bgScale =
    parallaxEnabled && !reducedMotion
      ? 1.04 + 0.12 * (0.4 + 0.9 * normIntensity) * progress
      : 1.02;
  const bgPanX =
    parallaxEnabled && !reducedMotion
      ? Math.sin(progress * Math.PI * 2) * (18 * (0.4 + normIntensity))
      : 0;
  const bgPanY =
    parallaxEnabled && !reducedMotion
      ? Math.cos(progress * Math.PI * 2) * (10 * (0.4 + normIntensity))
      : 0;

  // Safe area bounds
  const safeLeft = Math.round(width * (isVertical ? 0.08 : 0.06));
  const safeRight = Math.round(width * (isVertical ? 0.14 : 0.06));
  const safeTop = Math.round(height * (isVertical ? 0.14 : 0.08));
  const safeBottom = Math.round(height * (isVertical ? 0.22 : 0.12));

  // Template-specific Layer 3 (Organic Flames / Electric Arcs / Orbital Particles / Cyber Glitch)
  const renderEnergyLayer = () => {
    const baseOpacity = energyAppear * (0.35 + 0.65 * normIntensity);
    const pulse = reducedMotion ? 1 : 0.88 + 0.12 * Math.sin(tSec * 4.2);
    const cx = width / 2;
    const cy = height * 0.41;

    if (templateId === 'electric_reveal') {
      const boltCount = Math.max(5, Math.round(5 + 6 * normIntensity));
      return (
        <svg width={width} height={height} style={{ position: 'absolute', inset: 0, opacity: baseOpacity }}>
          <defs>
            <radialGradient id="rmElecGlow" cx="50%" cy="41%" r="48%">
              <stop offset="0%" stopColor={palette.glow} stopOpacity={0.6 * pulse} />
              <stop offset="55%" stopColor={palette.primary} stopOpacity={0.25} />
              <stop offset="100%" stopColor="#000000" stopOpacity={0} />
            </radialGradient>
          </defs>
          <rect width={width} height={height} fill="url(#rmElecGlow)" />
          <circle
            cx={cx}
            cy={cy}
            r={Math.min(width, height) * (0.18 + 0.05 * energyAppear)}
            fill="none"
            stroke={palette.energy}
            strokeWidth={3.5}
            opacity={0.85 * pulse}
          />
          {Array.from({ length: boltCount }).map((_, idx) => {
            const angle = (idx / boltCount) * Math.PI * 2 + (reducedMotion ? 0 : tSec * 0.45);
            const jitter = reducedMotion ? 0 : Math.sin(frame * 0.7 + idx * 3.1) * 0.14;
            const r1 = Math.min(width, height) * 0.12;
            const r2 = Math.min(width, height) * 0.3;
            const r3 = Math.min(width, height) * 0.5;
            const p1 = `${cx + Math.cos(angle) * r1},${cy + Math.sin(angle) * r1}`;
            const p2 = `${cx + Math.cos(angle + jitter) * r2},${cy + Math.sin(angle - jitter) * r2}`;
            const p3 = `${cx + Math.cos(angle - jitter * 0.6) * r3},${cy + Math.sin(angle + jitter * 0.6) * r3}`;
            return (
              <g key={idx}>
                <polyline points={`${p1} ${p2} ${p3}`} fill="none" stroke={palette.energy} strokeWidth={4} strokeLinecap="round" opacity={0.8} />
                <polyline points={`${p1} ${p2} ${p3}`} fill="none" stroke="#FFFFFF" strokeWidth={1.5} strokeLinecap="round" opacity={0.9} />
              </g>
            );
          })}
        </svg>
      );
    }

    if (templateId === 'particle_reveal') {
      const count = Math.max(16, Math.round(18 + 38 * normIntensity));
      const converge = interpolate(tSec, [kEnergyStart, kLogoEnd], [1.45, 0.72], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });
      return (
        <svg width={width} height={height} style={{ position: 'absolute', inset: 0, opacity: baseOpacity }}>
          <defs>
            <radialGradient id="rmPartGlow" cx="50%" cy="41%" r="52%">
              <stop offset="0%" stopColor={palette.glow} stopOpacity={0.55 * pulse} />
              <stop offset="60%" stopColor={palette.primary} stopOpacity={0.22} />
              <stop offset="100%" stopColor="#000000" stopOpacity={0} />
            </radialGradient>
          </defs>
          <rect width={width} height={height} fill="url(#rmPartGlow)" />
          {Array.from({ length: count }).map((_, i) => {
            const golden = i * 2.3999632297 + (reducedMotion ? 0 : tSec * (0.35 + (i % 5) * 0.08));
            const frac = (i + 1) / (count + 1);
            const r = Math.min(width, height) * (0.08 + 0.38 * Math.sqrt(frac)) * converge;
            const px = cx + Math.cos(golden) * r * (isVertical ? 0.95 : 1.3);
            const py = cy + Math.sin(golden) * r * (isVertical ? 1.1 : 0.82);
            const dotR = 2 + (i % 4) * 1.6;
            const color = i % 3 === 0 ? palette.particles : i % 2 === 0 ? palette.energy : palette.glow;
            return <circle key={i} cx={px} cy={py} r={dotR} fill={color} opacity={0.45 + ((i * 19) % 50) / 100} />;
          })}
        </svg>
      );
    }

    if (templateId === 'glitch_reveal') {
      const sliceCount = Math.max(8, Math.round(8 + 10 * normIntensity));
      const glitchBurst = reducedMotion ? 0 : Math.abs(Math.sin(tSec * 9.5)) > 0.72 ? 1 : 0.25;
      return (
        <svg width={width} height={height} style={{ position: 'absolute', inset: 0, opacity: baseOpacity }}>
          <defs>
            <linearGradient id="rmCyberWash" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={palette.primary} stopOpacity={0.28} />
              <stop offset="50%" stopColor="#000000" stopOpacity={0} />
              <stop offset="100%" stopColor={palette.secondary} stopOpacity={0.28} />
            </linearGradient>
          </defs>
          <rect width={width} height={height} fill="url(#rmCyberWash)" />
          {Array.from({ length: sliceCount }).map((_, i) => {
            const y = ((i + 0.5) / sliceCount) * height;
            const shift = Math.sin(frame * 0.9 + i * 2.7) * 34 * glitchBurst * (0.4 + normIntensity);
            const w = width * (0.14 + ((i * 23) % 28) / 100);
            const x = ((i * 173) % 72) * (width / 100) + shift;
            const h = 3 + (i % 4) * 4;
            return (
              <rect
                key={i}
                x={x}
                y={y}
                width={w}
                height={h}
                fill={i % 2 === 0 ? palette.primary : palette.secondary}
                opacity={0.38 * glitchBurst}
              />
            );
          })}
        </svg>
      );
    }

    // Default: `fire_reveal` — organic turbulent flames + heat glow + rising embers
    const plumeCount = 9;
    const emberCount = Math.max(14, Math.round(14 + 28 * normIntensity));
    return (
      <svg width={width} height={height} style={{ position: 'absolute', inset: 0, opacity: baseOpacity }}>
        <defs>
          <radialGradient id="rmFireHalo" cx="50%" cy="46%" r="58%">
            <stop offset="0%" stopColor={palette.glow} stopOpacity={0.58 * pulse} />
            <stop offset="48%" stopColor={palette.energy} stopOpacity={0.34} />
            <stop offset="100%" stopColor="#000000" stopOpacity={0} />
          </radialGradient>
        </defs>
        <rect width={width} height={height} fill="url(#rmFireHalo)" />
        {Array.from({ length: plumeCount }).map((_, i) => {
          const frac = i / (plumeCount - 1);
          const bx = width * (0.08 + frac * 0.84);
          const wave = reducedMotion ? 0 : Math.sin(tSec * 3.8 + i * 1.35) * (24 * (0.4 + normIntensity));
          const tipHeight = height * (0.34 + (1 - Math.abs(frac - 0.5) * 1.4) * 0.38) * energyAppear;
          const tipY = height - tipHeight + wave * 0.6;
          const spread = width * 0.11;
          const fill = i % 3 === 0 ? palette.glow : i % 2 === 0 ? palette.energy : palette.primary;
          return (
            <path
              key={i}
              d={`M ${bx - spread},${height} Q ${bx - spread * 0.45 + wave},${(height + tipY) / 2} ${bx + wave * 0.5},${tipY} Q ${bx + spread * 0.45 + wave},${(height + tipY) / 2} ${bx + spread},${height} Z`}
              fill={fill}
              opacity={0.42 * pulse}
            />
          );
        })}
        {Array.from({ length: emberCount }).map((_, i) => {
          const riseSpeed = 0.08 + (i % 5) * 0.03;
          const rawY = 1 - ((progress * (1.2 + riseSpeed * 5) + i * 0.13) % 1);
          const ex = width * (((i * 37 + 13) % 92 + 4) / 100) + (reducedMotion ? 0 : Math.sin(tSec * 2.5 + i) * 14);
          const ey = rawY * height;
          const r = 1.6 + (i % 4) * 1.3;
          return <circle key={i} cx={ex} cy={ey} r={r} fill={palette.particles} opacity={0.75 * (1 - Math.abs(rawY - 0.5))} />;
        })}
      </svg>
    );
  };

  // Progressive mask clipPath for Layer 4 & 5 (Logo reveal 5–7s)
  const revealPct = Math.round(
    interpolate(logoReveal, [0, 1], [0, 100], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
  );
  const logoClipPath =
    templateId === 'glitch_reveal'
      ? `inset(0 ${100 - revealPct}% 0 0)`
      : `circle(${Math.round(revealPct * 0.85)}% at 50% 50%)`;

  const logoBoxMaxW = Math.round((width - safeLeft - safeRight) * (isVertical ? 0.56 : 0.34));
  const logoBoxMaxH = Math.round((height - safeTop - safeBottom) * (isVertical ? 0.24 : 0.34));
  const titleFontSize = Math.round(width * (isVertical ? 0.064 : 0.042));
  const preFontSize = Math.round(width * (isVertical ? 0.024 : 0.014));
  const ctaFontSize = Math.round(width * (isVertical ? 0.032 : 0.018));
  const glowPx = Math.round((logoTransform.glowIntensity / 100) * 34);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#05070D',
        overflow: 'hidden',
        opacity: masterOpacity,
        fontFamily: 'Inter, Segoe UI, system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Layer 1: Background Image + Parallax */}
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        {backgroundImageUrl ? (
          <img
            src={backgroundImageUrl}
            alt=""
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: `translate3d(${bgPanX}px, ${bgPanY}px, 0) scale(${bgScale})`,
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              background: `radial-gradient(circle at 50% 42%, ${palette.primary}33 0%, #0B0F1A 55%, #05070D 100%)`,
            }}
          />
        )}
      </AbsoluteFill>

      {/* Layer 2: Environment & Dynamic Vignette */}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(circle at 50% 45%, rgba(0,0,0,0.12) 0%, rgba(5,7,13,0.68) 100%)',
        }}
      />

      {/* Layer 3 & 8: Template Energy / Flames / Electric / Particles / Glitch */}
      <AbsoluteFill>{renderEnergyLayer()}</AbsoluteFill>

      {/* Safe-Zone Content Container (Layers 4, 5, 6, 7) */}
      <div
        style={{
          position: 'absolute',
          left: safeLeft,
          right: safeRight,
          top: safeTop,
          bottom: safeBottom,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: isVertical ? 26 : 18,
        }}
      >
        {/* Layer 4 & 5: Progressive Reveal Mask + User-Selected Logo */}
        {!logoDisabled && (
          <div
            style={{
              width: logoBoxMaxW,
              height: logoBoxMaxH,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              clipPath: logoClipPath,
              opacity: logoReveal,
              transform: `translate3d(${logoTransform.offsetX}px, ${logoTransform.offsetY}px, 0) scale(${
                logoTransform.scale * (0.86 + 0.14 * logoSpring)
              })`,
              filter: glowPx > 0 ? `drop-shadow(0 0 ${glowPx}px ${palette.glow})` : undefined,
            }}
          >
            {logoImageUrl ? (
              <img
                src={logoImageUrl}
                alt="Logotipo do canal"
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  width: 'auto',
                  height: 'auto',
                  objectFit: 'contain',
                }}
              />
            ) : (
              <div
                style={{
                  padding: '16px 28px',
                  borderRadius: 20,
                  border: `2px dashed ${palette.glow}88`,
                  background: 'rgba(12, 15, 24, 0.55)',
                  color: palette.text,
                  fontSize: Math.max(14, Math.round(titleFontSize * 0.42)),
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                }}
              >
                SELECIONE UMA LOGO
              </div>
            )}
          </div>
        )}

        {/* Layer 6: Channel Name Reveal (7–10s) */}
        <div
          style={{
            textAlign: 'center',
            opacity: titleReveal,
            transform: `translate3d(0, ${(1 - titleReveal) * 18}px, 0)`,
          }}
        >
          <div
            style={{
              fontSize: preFontSize,
              fontWeight: 700,
              letterSpacing: '0.22em',
              color: palette.glow,
              textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            {texts.preTitle || 'OBRIGADO POR ASSISTIR'}
          </div>
          <div
            style={{
              fontSize: titleFontSize,
              fontWeight: 800,
              color: palette.text,
              letterSpacing: '-0.02em',
              textShadow: `0 4px 24px ${palette.primary}88`,
            }}
          >
            {texts.channelTitle || 'Seu Canal'}
          </div>
        </div>

        {/* Layer 7: Subscribe CTA & Optional Next Video Card (10–13s) */}
        {(showSubscribeCta || showNextVideoCard) && (
          <div
            style={{
              display: 'flex',
              flexDirection: isVertical ? 'column' : 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 16,
              opacity: ctaReveal,
              transform: `translate3d(0, ${(1 - ctaReveal) * 14}px, 0)`,
            }}
          >
            {showSubscribeCta && (
              <div
                style={{
                  padding: isVertical ? '14px 32px' : '12px 28px',
                  borderRadius: 9999,
                  backgroundColor: palette.ctaBg,
                  color: palette.ctaText,
                  fontSize: ctaFontSize,
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  boxShadow: `0 8px 30px ${palette.ctaBg}66`,
                }}
              >
                {texts.subscribeCtaText || 'INSCREVA-SE NO CANAL'}
              </div>
            )}

            {showNextVideoCard && (
              <div
                style={{
                  width: isVertical ? Math.round((width - safeLeft - safeRight) * 0.72) : Math.round(width * 0.22),
                  padding: '12px 16px',
                  borderRadius: 14,
                  background: 'rgba(12, 15, 24, 0.78)',
                  border: `2px solid ${palette.energy}`,
                  color: palette.text,
                  textAlign: 'left',
                }}
              >
                <div style={{ fontSize: Math.max(10, Math.round(ctaFontSize * 0.65)), fontWeight: 700, color: palette.glow }}>
                  {texts.nextVideoLabel || 'PRÓXIMO VÍDEO'}
                </div>
                <div style={{ fontSize: Math.max(12, Math.round(ctaFontSize * 0.82)), fontWeight: 600, marginTop: 4 }}>
                  {texts.nextVideoTitle || 'Assista ao próximo episódio'}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Optional Safe-Area Guide Overlay (16:9 YouTube / 9:16 Reels/TikTok) */}
      {showSafeAreaGuides && (
        <div
          style={{
            position: 'absolute',
            left: safeLeft,
            right: safeRight,
            top: safeTop,
            bottom: safeBottom,
            border: '2px dashed rgba(182, 245, 0, 0.75)',
            borderRadius: 12,
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 6,
              left: 10,
              fontSize: 12,
              fontWeight: 700,
              color: '#B6F500',
              background: 'rgba(0,0,0,0.65)',
              padding: '2px 8px',
              borderRadius: 6,
            }}
          >
            Área segura {aspectRatio}
          </span>
        </div>
      )}
    </AbsoluteFill>
  );
};

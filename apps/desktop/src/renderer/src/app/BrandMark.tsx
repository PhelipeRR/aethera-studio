import voidDisk from '@/assets/void/void-disk-480.webp';

/**
 * Singularity mark (lote 50.04, user decision): Void without its face. The same accretion-disk artwork as the mascot
 * (extracted from docs/assets/singularity/reference-void-mascot.webp) over an opaque black horizon, so the brand and
 * the companion are one symbol. The app icon is rendered from the same artwork (scripts/generate-icon.mjs).
 * Decorative by default; pass `label` when the mark stands alone as the brand.
 */
export function SingularityMark({ className, label }: { className?: string; label?: string }) {
  return (
    <svg viewBox="40 0 660 515" className={className} {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}>
      <ellipse cx="381" cy="284" rx="174" ry="186" fill="#010304" />
      <image href={voidDisk} x="0" y="0" width="725" height="515" preserveAspectRatio="xMidYMid meet" />
    </svg>
  );
}

/** The brand mark wherever the app shows its symbol (header, empty chat). */
export function BrandMark({ className }: { className?: string }) {
  return <SingularityMark {...(className ? { className } : {})} />;
}

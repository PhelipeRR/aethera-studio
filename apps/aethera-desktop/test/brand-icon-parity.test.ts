import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transformAetheraShellBrand } from '../scripts/aethera-shell-brand-transform.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

const CANONICAL_PRISM_PATH = 'M16 4L27.5 26H21.8L16 14.2L10.2 26H4.5L16 4Z';
const CANONICAL_STOPS = ['#6a46d8', '#9c7df2', '#d8fb4f'];

test('Desktop AetheraMark, build icon.svg, and Web/Desktop favicons match Aethera Web mark exactly', () => {
  const webMark = readFileSync(resolve(REPO_ROOT, 'apps/aethera-web/src/components/AetheraMark.tsx'), 'utf8');
  const desktopMark = readFileSync(resolve(REPO_ROOT, 'apps/aethera-desktop/src/renderer/src/AetheraMark.tsx'), 'utf8');
  const buildIconSvg = readFileSync(resolve(REPO_ROOT, 'apps/aethera-desktop/build/icon.svg'), 'utf8');
  const desktopFavicon = readFileSync(resolve(REPO_ROOT, 'apps/aethera-desktop/src/renderer/public/favicon.svg'), 'utf8');
  const webFavicon = readFileSync(resolve(REPO_ROOT, 'apps/aethera-web/public/favicon.svg'), 'utf8');

  for (const [name, content] of [
    ['webMark', webMark],
    ['desktopMark', desktopMark],
    ['buildIconSvg', buildIconSvg],
    ['desktopFavicon', desktopFavicon],
    ['webFavicon', webFavicon],
  ] as const) {
    assert.ok(content.includes(CANONICAL_PRISM_PATH), `${name} must contain canonical prism path`);
    for (const stop of CANONICAL_STOPS) {
      assert.ok(content.includes(stop), `${name} must contain gradient stop ${stop}`);
    }
    assert.ok(content.includes('cx="16" cy="22.5" r="2.5"'), `${name} must contain ink core dot`);
    assert.ok(content.includes('#111111'), `${name} must use #111111 ink`);
  }

  assert.equal(desktopFavicon, webFavicon, 'Desktop and Web favicon.svg must be byte-identical');
  assert.equal(buildIconSvg, webFavicon, 'build/icon.svg and favicon.svg must be byte-identical');
});

test('apps/aethera-desktop/build/icon.ico is a valid multi-resolution Windows ICO with 7 embedded PNGs', () => {
  const ico = readFileSync(resolve(REPO_ROOT, 'apps/aethera-desktop/build/icon.ico'));
  assert.equal(ico.readUInt16LE(0), 0, 'ICO reserved bytes must be 0');
  assert.equal(ico.readUInt16LE(2), 1, 'ICO type must be 1');
  const count = ico.readUInt16LE(4);
  assert.equal(count, 7, 'ICO must embed 7 resolutions (16..256 px)');

  const expectedDims = [16, 24, 32, 48, 64, 128, 0]; // 0 denotes 256 in ICO spec
  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16;
    assert.equal(ico.readUInt8(entry), expectedDims[i]);
    assert.equal(ico.readUInt8(entry + 1), expectedDims[i]);
    const size = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    assert.ok(size > 100, `entry ${i} PNG payload must be non-empty`);
    assert.deepEqual(ico.subarray(offset, offset + 8), pngMagic, `entry ${i} must be valid PNG`);
  }
});

test('apps/aethera-desktop/build/icon.png is a valid 512x512 PNG', () => {
  const png = readFileSync(resolve(REPO_ROOT, 'apps/aethera-desktop/build/icon.png'));
  assert.deepEqual(png.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  assert.equal(png.readUInt32BE(16), 512, 'icon.png width must be 512');
  assert.equal(png.readUInt32BE(20), 512, 'icon.png height must be 512');
});

test('transformAetheraShellBrand upgrades legacy AetheraPrismLogo (function and const arrow) and is idempotent', () => {
  const legacyFnShell = `
import React from 'react';
function AetheraPrismLogo() {
  return <svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="#d9b875" /></svg>;
}
export function AetheraShell() {
  return <header><AetheraPrismLogo /><span>AETHERA</span></header>;
}
`;
  const upgradedFn = transformAetheraShellBrand(legacyFnShell, '/repo/packages/desktop-shared/src/renderer/src/app/AetheraShell.tsx');
  assert.ok(upgradedFn);
  assert.ok(upgradedFn.includes(CANONICAL_PRISM_PATH));
  assert.ok(upgradedFn.includes('#6a46d8'));
  assert.ok(upgradedFn.includes('#d8fb4f'));
  assert.ok(upgradedFn.includes('export function AetheraShell()'));

  // Idempotent on second run
  assert.equal(
    transformAetheraShellBrand(upgradedFn, '/repo/packages/desktop-shared/src/renderer/src/app/AetheraShell.tsx'),
    null,
  );

  // Supports const arrow syntax too
  const legacyArrowShell = `
export const AetheraPrismLogo = () => (
  <svg viewBox="0 0 32 32"><rect width="32" height="32" fill="#000" /></svg>
);
export function AetheraShell() { return <AetheraPrismLogo />; }
`;
  const upgradedArrow = transformAetheraShellBrand(legacyArrowShell, 'C:\\repo\\packages\\desktop-shared\\src\\renderer\\src\\app\\AetheraShell.tsx');
  assert.ok(upgradedArrow);
  assert.ok(upgradedArrow.includes('export function AetheraPrismLogo'));
  assert.ok(upgradedArrow.includes(CANONICAL_PRISM_PATH));

  // Does not touch unrelated files
  assert.equal(transformAetheraShellBrand(legacyFnShell, '/repo/apps/desktop/src/AppShell.tsx'), null);
});

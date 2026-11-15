import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

/**
 * Smoke test to prevent shipping AetheraStudio with missing native binaries.
 * This runs against the unpacked build output (win-unpacked) to verify that
 * sharp and its @img/* native dependencies are correctly included outside
 * the ASAR archive before the NSIS installer is generated.
 *
 * Run after `electron-builder --win --x64` and before distribution.
 */
describe('Aethera Desktop — Sharp Native Binary Smoke Test', () => {
 // Monorepo root is two levels up from apps/aethera-desktop/test/
 const MONOREPO_ROOT = resolve(__dirname, '../../..');
 const UNPACKED_ROOT = resolve(MONOREPO_ROOT, 'dist/aethera/win-unpacked/resources/app.asar.unpacked/node_modules');

 it('includes sharp module in app.asar.unpacked', () => {
 // Sharp 0.35.x uses dist/ structure instead of lib/index.js
 const sharpDist = resolve(UNPACKED_ROOT, 'sharp/dist');
 const sharpPkg = resolve(UNPACKED_ROOT, 'sharp/package.json');
 expect(existsSync(sharpPkg)).toBe(true);
 expect(existsSync(sharpDist)).toBe(true);
 });

 it('includes @img/sharp-win32-x64 native addon', () => {
 const nativeAddon = resolve(UNPACKED_ROOT, '@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.5.node');
 expect(existsSync(nativeAddon)).toBe(true);
 });

 it('includes @img/sharp-libvips-win32-x64 runtime DLLs', () => {
 const libvipsDll = resolve(UNPACKED_ROOT, '@img/sharp-libvips-win32-x64/lib/libvips-42.dll');
 expect(existsSync(libvipsDll)).toBe(true);
 });

 it('can load sharp and execute a real image resize operation', async () => {
 // Use createRequire to load sharp from the unpacked build path,
 // simulating how Electron's main process resolves native modules at runtime.
 const requireFromUnpacked = createRequire(resolve(UNPACKED_ROOT, 'sharp/package.json'));
 const sharp = requireFromUnpacked('sharp');

 // 1×1 transparent PNG as base64
 const inputPng = Buffer.from(
 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
 'base64',
 );

 const outputBuffer = await sharp(inputPng).resize(8, 8).png().toBuffer();
 expect(outputBuffer.length).toBeGreaterThan(0);
 // Verify output is a valid PNG (starts with PNG signature)
 expect(outputBuffer[0]).toBe(0x89);
 expect(outputBuffer[1]).toBe(0x50); // 'P'
 expect(outputBuffer[2]).toBe(0x4e); // 'N'
 expect(outputBuffer[3]).toBe(0x47); // 'G'
 });
});
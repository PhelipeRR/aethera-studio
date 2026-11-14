import sharp from 'sharp';
// Extracts the Void artwork from the user's reference sheet (lote 50.04): crop, erase the painted face,
// turn the black background into transparency (the art is light on black), save for the app.
// Run: node scripts/extract-void-mascot.mjs [preview.png]
const src = 'docs/assets/singularity/reference-void-mascot.webp';
const outDir = 'apps/desktop/src/renderer/src/assets/void';
const preview = process.argv[2];
const crop = { left: 20, top: 100, width: 725, height: 515 };
const { data, info } = await sharp(src).extract(crop).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const eyes = [{ cx: 345, cy: 280, rx: 84, ry: 48 }, { cx: 494, cy: 246, rx: 68, ry: 52 }];
// Body of the mascot; the nebula wisps and stray stars beyond it fade out so the HUD stays clean on any desktop.
const body = { cx: 380, cy: 258, rx: 350, ry: 230 };
for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
  const i = (y * info.width + x) * 4;
  // Erase the face: the horizon behind it is black.
  for (const e of eyes) {
    const d = ((x - e.cx) / e.rx) ** 2 + ((y - e.cy) / e.ry) ** 2;
    // Feathered: fully black at the centre, untouched at the edge, so the glow halo goes too without a hard rim.
    if (d < 1) { const keep = Math.max(0, (d - 0.6) / 0.4); data[i] *= keep; data[i + 1] *= keep; data[i + 2] *= keep; }
  }
  const r = data[i], g = data[i + 1], b = data[i + 2];
  const lum = Math.max(r, g, b);
  const reach = Math.sqrt(((x - body.cx) / body.rx) ** 2 + ((y - body.cy) / body.ry) ** 2);
  const vignette = Math.min(1, Math.max(0, (1.18 - reach) / 0.3));
  // Teal and blue come from the reference's background nebula, not from Void: they fade out; the disk's purple stays.
  const teal = Math.min(1, Math.max(0, ((g + b) / 2 - r) / 30));
  const a = Math.min(1, Math.max(0, (lum - 24) / 72)) * vignette * (1 - teal);
  // Light-on-black art is effectively premultiplied: restore full colour where it becomes translucent.
  const k = a > 0.02 ? 1 / Math.max(a, lum / 255) : 0;
  data[i] = Math.min(255, r * k); data[i + 1] = Math.min(255, g * k); data[i + 2] = Math.min(255, b * k); data[i + 3] = Math.round(a * 255);
}
const base = sharp(data, { raw: info });
await base.clone().resize({ width: 480 }).webp({ quality: 92, alphaQuality: 100 }).toFile(`${outDir}/void-disk-480.webp`);
if (preview) await base.clone().png().toFile(preview);
console.log('ok', info.width, info.height);

// Proposta de marca do Aethera (documentação, não código do app). Gera os SVGs e as prévias em PNG.
// Rodar a partir da raiz: node docs/aethera/brand/build-brand.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const dir = join(import.meta.dirname);
const C = 32;
const pt = (r, deg) => { const a = (deg * Math.PI) / 180; return `${(C + r * Math.cos(a)).toFixed(2)} ${(C + r * Math.sin(a)).toFixed(2)}`; };
// Six aperture blades between the core (r 10.5) and the ring (r 26.5), swept 38 degrees.
const blades = Array.from({ length: 6 }, (_, i) => {
  const s = i * 60 - 90, e = s + 60;
  return `<path d="M ${pt(9, s)} L ${pt(9, e)} L ${pt(26.5, e + 38)} A 26.5 26.5 0 0 0 ${pt(26.5, s + 38)} Z" fill="url(#blade)" stroke="#f0d595" stroke-opacity="0.75" stroke-width="0.7" stroke-linejoin="round"/>`;
}).join('');
const defs = `<defs>
  <linearGradient id="ring" x1="0.9" y1="0.05" x2="0.1" y2="0.95"><stop offset="0" stop-color="#f6e2b0"/><stop offset="0.45" stop-color="#d9b875"/><stop offset="1" stop-color="#7a5e28"/></linearGradient>
  <linearGradient id="blade" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5a4720"/><stop offset="0.55" stop-color="#2a2312"/><stop offset="1" stop-color="#0d1b1c"/></linearGradient>
  <radialGradient id="bead"><stop offset="0" stop-color="#fff8e6"/><stop offset="0.35" stop-color="#f3d79a" stop-opacity="0.9"/><stop offset="1" stop-color="#d9b875" stop-opacity="0"/></radialGradient>
</defs>`;
// "Diamond ring" bead: the eclipse's last light, upper right, the same place the Void's disk is brightest.
const bead = (r) => `<circle cx="${(C + 28 * Math.cos(-0.72)).toFixed(2)}" cy="${(C + 28 * Math.sin(-0.72)).toFixed(2)}" r="${r}" fill="url(#bead)"/>`;

const full = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${defs}
  <circle cx="32" cy="32" r="28" fill="#010304"/>${blades}
  <circle cx="32" cy="32" r="28" fill="none" stroke="url(#ring)" stroke-width="3"/>${bead(5)}
</svg>`;
// Small sizes (24 px and below): blades drop out; ring, black core and the bead stay.
const small = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${defs}
  <circle cx="32" cy="32" r="27" fill="#041417"/>
  <circle cx="32" cy="32" r="13" fill="#010304"/>
  <circle cx="32" cy="32" r="27" fill="none" stroke="url(#ring)" stroke-width="6"/>${bead(8)}
</svg>`;
// One colour (gold) for menus, the tray or embossing.
const mono = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="27" fill="none" stroke="#d9b875" stroke-width="6"/><circle cx="32" cy="32" r="12" fill="#d9b875"/><circle cx="${(C + 28 * Math.cos(-0.72)).toFixed(2)}" cy="${(C + 28 * Math.sin(-0.72)).toFixed(2)}" r="5" fill="#d9b875"/></svg>`;
writeFileSync(join(dir, 'aethera-mark.svg'), full);
writeFileSync(join(dir, 'aethera-mark-small.svg'), small);
writeFileSync(join(dir, 'aethera-mark-mono.svg'), mono);

// Preview sheet on the Singularity background: full mark 128/64, small 24/16, mono 32, and the lockup.
const W = 900, H = 330;
const tile = async (svg, size) => sharp(Buffer.from(svg), { density: 600 }).resize(size, size).png().toBuffer();
const wordmark = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="520" height="90"><style>.w{font:300 46px 'Inter','Segoe UI',sans-serif;letter-spacing:15px;fill:#e4e1d6}.t{font:500 13px 'Inter','Segoe UI',sans-serif;letter-spacing:5px;fill:#d9b875}</style><text x="0" y="52" class="w">AETHERA</text><text x="3" y="80" class="t">AI CINEMATIC STUDIO</text></svg>`);
const labels = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><style>.l{font:12px 'Segoe UI',sans-serif;fill:#9aa9a5}</style>
  <text x="40" y="196" class="l">completo 128 px</text><text x="196" y="196" class="l">64 px</text><text x="290" y="196" class="l">24 px</text><text x="345" y="196" class="l">16 px</text><text x="400" y="196" class="l">monocromático</text>
  <text x="40" y="310" class="l">assinatura: símbolo + AETHERA (mesma régua tipográfica do SINGULARITY / AI ORCHESTRATOR)</text></svg>`);
await sharp({ create: { width: W, height: H, channels: 4, background: '#041417' } })
  .composite([
    { input: await tile(full, 128), left: 40, top: 40 },
    { input: await tile(full, 64), left: 196, top: 72 },
    { input: await tile(small, 24), left: 296, top: 92 },
    { input: await tile(small, 16), left: 352, top: 96 },
    { input: await tile(mono, 32), left: 420, top: 88 },
    { input: await tile(full, 72), left: 40, top: 212 },
    { input: wordmark, left: 130, top: 206 },
    { input: labels, left: 0, top: 0 },
  ])
  .png()
  .toFile(join(dir, 'aethera-brand-preview.png'));
console.log('ok');

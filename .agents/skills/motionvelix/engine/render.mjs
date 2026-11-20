#!/usr/bin/env node
/* MotionVelix RENDER v2 — cena HTML (engine/mv.js) → vídeo profissional.
 *
 *   node engine/render.mjs cena.html saida.mp4 [opções]
 *
 *   --data roteiro.json   injeta JSON em window.MV_DATA (templates data-driven)
 *   --audio trilha.mp3    trilha/narração de fundo      --audio-vol 1.0
 *   --mb 4                MOTION BLUR real (4–8 subframes por frame; shutter 180°). Use no render final.
 *   --shutter 0.5         fração do frame com obturador aberto (0.5 = 180°, 1 = borrão máximo)
 *   --fps 60              sobrescreve o fps da cena
 *   --alpha               fundo transparente → .mov ProRes 4444 (qualidade máx.) ou .webm VP9 (20x menor)
 *                         + gera .sfx.wav com os efeitos sonoros da cena
 *   --no-sfx              não mixa os efeitos sonoros da cena (MV.sfx)      --sfx-vol 1.0
 *   --preview 0,1.5,3     só gera PNGs nesses tempos (conferência rápida)
 *   --webgl              habilita WebGL (templates 3D / Three.js)
 *   --from 2 --to 5       renderiza só um trecho       --workers N       --crf 16
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SFX_DIR = path.join(HERE, '..', 'assets', 'sfx');
let FFMPEG = 'ffmpeg';
try { const c = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.motionvelix', 'config.json'), 'utf8')); if (c.ffmpeg && fs.existsSync(c.ffmpeg)) FFMPEG = c.ffmpeg; } catch { }

let chromium;
for (const m of ['playwright', '/opt/npm-tools/node_modules/playwright/index.mjs', path.join(os.homedir(), '.motionvelix/node_modules/playwright/index.mjs')]) {
  try { ({ chromium } = await import(m)); break; } catch { }
}
if (!chromium) { console.error('Playwright não encontrado. Rode: python3 scripts/setup.py'); process.exit(1); }

const args = process.argv.slice(2);
const VALS = ['data', 'audio', 'audio-vol', 'fps', 'workers', 'from', 'to', 'preview', 'crf', 'mb', 'shutter', 'sfx-vol'];
const opt = (k, d) => { const i = args.indexOf('--' + k); if (i < 0) return d; return VALS.includes(k) ? args[i + 1] : true; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALS.includes(args[i - 1].slice(2))));
const [htmlIn, outFile] = pos;
if (!htmlIn || !outFile) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]); process.exit(1); }

const alpha = !!opt('alpha', false);
const dv = opt('data', null); const data = dv ? (String(dv).trim().startsWith('{') ? dv : fs.readFileSync(dv, 'utf8')) : null;   // arquivo ou JSON inline
const workers = parseInt(opt('workers', Math.max(1, Math.min(6, os.cpus().length - 1))));
const crf = opt('crf', '16');
const MB = Math.max(1, parseInt(opt('mb', 1)));
const SHUT = parseFloat(opt('shutter', .5));
const url = pathToFileURL(path.resolve(htmlIn)).href;
const run = (cmd, a) => new Promise((res, rej) => { const p = spawn(cmd, a, { stdio: ['ignore', 'inherit', 'inherit'] }); p.on('close', c => c ? rej(new Error(cmd + ' falhou')) : res()); });

async function openPage(browser, meta) {
  const page = await browser.newPage({ viewport: { width: meta?.w || 1080, height: meta?.h || 1920 }, deviceScaleFactor: 1 });
  if (data) await page.addInitScript(d => { window.MV_DATA = JSON.parse(d); }, data);
  page.on('pageerror', e => console.error('[cena] erro JS:', e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => window.__mv.ready());
  return page;
}

const GL = opt('webgl', false) ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : [];
const browser = await chromium.launch({ args: ['--allow-file-access-from-files', '--disable-web-security', '--font-render-hinting=none', '--force-color-profile=srgb', ...GL] });
const probe = await openPage(browser);
const meta = await probe.evaluate(() => ({ w: __mv.w, h: __mv.h, fps: __mv.fps, dur: __mv.dur, sfx: __mv.sfx || [] }));
await probe.close();
const fps = parseFloat(opt('fps', meta.fps));
const t0 = parseFloat(opt('from', 0)), t1 = parseFloat(opt('to', meta.dur));
console.log(`cena ${meta.w}x${meta.h} @${fps}fps  ${t0}s→${t1.toFixed(2)}s  workers=${workers}${MB > 1 ? `  motion-blur x${MB}` : ''}${alpha ? '  [alfa]' : ''}  sfx=${meta.sfx.length}`);

// ---------- prévia ----------
if (opt('preview', null)) {
  const page = await openPage(browser, meta);
  const base = outFile.replace(/\.(mp4|mov|png)$/i, '');
  for (const t of String(opt('preview')).split(',').map(Number)) {
    await page.evaluate(t => __mv.seek(t), t);
    const f = `${base}_t${t.toFixed(2)}.png`;
    await page.screenshot({ path: f, omitBackground: alpha });
    console.log('prévia', f);
  }
  await browser.close(); process.exit(0);
}

// ---------- render paralelo ----------
const total = Math.round((t1 - t0) * fps);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mvr-'));
const per = Math.ceil(total / workers);
const tStart = Date.now(); let done = 0;

async function renderSeg(k) {
  const a = k * per, b = Math.min(total, a + per);
  if (a >= b) return null;
  const seg = path.join(tmp, `seg${String(k).padStart(3, '0')}.${alpha ? 'mov' : 'mp4'}`);
  const enc = alpha ? ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le'] : ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p'];
  // motion blur: N subframes por frame → média (tmix) → 1 a cada N
  const vf = MB > 1 ? ['-vf', `tmix=frames=${MB},select='eq(mod(n\\,${MB})\\,${MB - 1})',setpts=N/(${fps}*TB)`] : [];
  const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps * MB), '-c:v', alpha ? 'png' : 'mjpeg', '-i', '-', ...vf, '-r', String(fps), ...enc, seg], { stdio: ['pipe', 'inherit', 'inherit'] });
  const page = await openPage(browser, meta);
  for (let i = a; i < b; i++) {
    for (let s = 0; s < MB; s++) {
      const off = MB > 1 ? ((s + .5) / MB - .5) * SHUT / fps : 0;
      await page.evaluate(t => __mv.seek(t), t0 + i / fps + off);
      let buf;
      for (let tr = 0; ; tr++) {   // tenta de novo se o navegador falhar a captura (máquina sobrecarregada)
        try { buf = alpha ? await page.screenshot({ type: 'png', omitBackground: true }) : await page.screenshot({ type: 'jpeg', quality: 95 }); break; }
        catch (e) { if (tr >= 3) throw e; await new Promise(r => setTimeout(r, 400)); }
      }
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    }
    done++;
    if (done % 15 === 0) { const el = (Date.now() - tStart) / 1000; process.stdout.write(`\r  ${done}/${total} frames  (${(done / el).toFixed(1)} fps · ~${Math.round((total - done) / (done / el))}s restantes)   `); }
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  await page.close();
  return seg;
}
const segs = (await Promise.all([...Array(workers).keys()].map(renderSeg))).filter(Boolean);
await browser.close();
console.log(`\n  frames prontos em ${((Date.now() - tStart) / 1000).toFixed(1)}s — montando…`);
const list = path.join(tmp, 'list.txt');
fs.writeFileSync(list, segs.map(s => `file '${s}'`).join('\n'));
const vidOnly = path.join(tmp, alpha ? 'v.mov' : 'v.mp4');
await run(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', vidOnly]);

// ---------- áudio: trilha + efeitos sonoros da cena ----------
const useSfx = !opt('no-sfx', false);
const cues = useSfx ? meta.sfx.filter(c => c.at >= t0 && c.at < t1).map(c => ({ ...c, file: fs.existsSync(c.name) ? c.name : path.join(SFX_DIR, c.name + '.wav') })).filter(c => fs.existsSync(c.file)) : [];
const miss = useSfx ? meta.sfx.filter(c => !fs.existsSync(c.name) && !fs.existsSync(path.join(SFX_DIR, c.name + '.wav'))).map(c => c.name) : [];
if (miss.length) console.log('  aviso: sfx não encontrados:', [...new Set(miss)].join(', '), '(rode scripts/gerar_sfx.py)');
const audio = opt('audio', null);
const dur = (t1 - t0).toFixed(3);
const sfxVol = parseFloat(opt('sfx-vol', 1)), musVol = parseFloat(opt('audio-vol', 1));

async function mixAudio(outWav, withMusic) {
  const ins = [], fl = [], labs = [];
  let idx = 0;
  if (withMusic && audio) { ins.push('-i', audio); fl.push(`[${idx}:a]atrim=${t0}:${t1},asetpts=PTS-STARTPTS,volume=${musVol}[m]`); labs.push('[m]'); idx++; }
  for (const c of cues) { ins.push('-i', c.file); const ms = Math.round((c.at - t0) * 1000); fl.push(`[${idx}:a]adelay=${ms}|${ms},volume=${(c.vol * sfxVol).toFixed(3)}[s${idx}]`); labs.push(`[s${idx}]`); idx++; }
  if (!labs.length) return false;
  fl.push(`${labs.join('')}amix=inputs=${labs.length}:normalize=0:dropout_transition=0,apad,atrim=0:${dur},alimiter=limit=0.95[a]`);
  const fcf = path.join(tmp, 'a.txt'); fs.writeFileSync(fcf, fl.join(';'));
  await run(FFMPEG, ['-y', '-loglevel', 'error', ...ins, '-filter_complex_script', fcf, '-map', '[a]', '-ar', '48000', '-ac', '2', outWav]);
  return true;
}

if (alpha) {
  if (/\.webm$/i.test(outFile)) await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', vidOnly, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '5M', '-auto-alt-ref', '0', '-row-mt', '1', outFile]);
  else fs.copyFileSync(vidOnly, outFile);
  if (cues.length) { const w = outFile.replace(/\.[^.]+$/, '') + '.sfx.wav'; await mixAudio(w, false); console.log('  efeitos sonoros →', w, '(use em mv_edit.py compor --sfx)'); }
} else {
  const mixWav = path.join(tmp, 'mix.wav');
  const has = await mixAudio(mixWav, true);
  if (has) await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', vidOnly, '-i', mixWav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', outFile]);
  else await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', vidOnly, '-c', 'copy', '-movflags', '+faststart', outFile]);
}
fs.writeFileSync(outFile.replace(/\.[^.]+$/, '') + '.cues.json', JSON.stringify({ dur: t1 - t0, fps, sfx: meta.sfx }, null, 0));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`✔ ${outFile}  (${cues.length} efeitos sonoros mixados)`);

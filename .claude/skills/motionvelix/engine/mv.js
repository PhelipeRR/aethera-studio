/* MotionVelix ENGINE v1 — motor de animação determinístico (tudo é função do tempo t).
 * Sem dependências. Cada frame é calculado do zero por MV.seek(t) => render frame-perfect.
 * Uso básico:
 *   MV.setup({w:1080,h:1920,fps:30,dur:12});
 *   MV.to('#titulo', {from:{y:80,opacity:0,blur:12}, to:{y:0,opacity:1,blur:0}, at:0, dur:.6, ease:'outExpo'});
 *   MV.fn(0, 12, t => {...})   // desenho livre por frame (canvas, contadores...)
 */
(function () {
  const E = {
    linear: p => p,
    inQuad: p => p * p, outQuad: p => 1 - (1 - p) * (1 - p),
    inCubic: p => p ** 3, outCubic: p => 1 - (1 - p) ** 3,
    inOutCubic: p => p < .5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2,
    outQuart: p => 1 - (1 - p) ** 4, inQuart: p => p ** 4,
    inOutQuart: p => p < .5 ? 8 * p ** 4 : 1 - (-2 * p + 2) ** 4 / 2,
    outExpo: p => p === 1 ? 1 : 1 - 2 ** (-10 * p),
    inExpo: p => p === 0 ? 0 : 2 ** (10 * p - 10),
    inOutExpo: p => p === 0 ? 0 : p === 1 ? 1 : p < .5 ? 2 ** (20 * p - 10) / 2 : (2 - 2 ** (-20 * p + 10)) / 2,
    outBack: p => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2; },
    outBackSoft: p => { const c1 = 1.1, c3 = c1 + 1; return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2; },
    inBack: p => { const c1 = 1.70158; return (c1 + 1) * p ** 3 - c1 * p ** 2; },
    outElastic: p => p === 0 ? 0 : p === 1 ? 1 : 2 ** (-10 * p) * Math.sin((p * 10 - .75) * (2 * Math.PI) / 3) + 1,
    spring: p => 1 - Math.exp(-6.5 * p) * Math.cos(p * 11),          // mola com overshoot leve
    springSoft: p => 1 - Math.exp(-7 * p) * Math.cos(p * 7.5),
    smooth: p => p * p * (3 - 2 * p),                                  // "Apple-like" suave
    // curva estilo motion designer: entra rápido, assenta longo (padrão MotionVelix)
    mv: p => 1 - Math.pow(1 - p, 5),
  };
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, p) => a + (b - a) * p;
  const DEF = { x: 0, y: 0, z: 0, scale: 1, sx: 1, sy: 1, rot: 0, rx: 0, ry: 0, skx: 0, opacity: 1, blur: 0, bright: 1, sat: 1,
    clipT: 0, clipR: 0, clipB: 0, clipL: 0, ls: null, width: null, height: null, radius: null, draw: null };
  const st = { w: 1080, h: 1920, fps: 30, dur: 10, tweens: [], fns: [], targets: new Map(), t: 0, sfx: [], loads: [] };

  function els(sel) {
    if (!sel) return [];
    if (typeof sel === 'string') return [...document.querySelectorAll(sel)];
    if (sel instanceof Element) return [sel];
    return [...sel].flatMap(x => els(x));
  }
  function reg(el) {
    if (!st.targets.has(el)) st.targets.set(el, { tweens: [] });
    return st.targets.get(el);
  }

  const MV = {
    E, clamp, lerp,
    setup(o) { Object.assign(st, o); document.documentElement.style.setProperty('--W', st.w + 'px'); document.documentElement.style.setProperty('--H', st.h + 'px'); return MV; },
    get state() { return st; },
    /** anima propriedades: from/to, at (s), dur (s), ease */
    to(sel, o) {
      els(sel).forEach((el, i) => {
        const at = (o.at || 0) + (o.stagger || 0) * i;
        const tw = { el, from: o.from || {}, to: o.to || {}, at, dur: Math.max(o.dur ?? .6, 1e-4), ease: E[o.ease || 'mv'] || o.ease };
        reg(el).tweens.push(tw);
      });
      return MV;
    },
    /** função livre executada a cada frame no intervalo [a,b] — recebe (t local, p 0..1, tGlobal) */
    fn(a, b, f, ease) { st.fns.push({ a, b, f, ease: E[ease || 'linear'] || ease }); return MV; },
    /** efeito sonoro sincronizado: MV.sfx('whoosh', 1.2, .8) — o renderizador mixa sozinho (assets/sfx/<nome>.wav ou caminho) */
    sfx(name, at, vol = 1) { if (name && at > -0.05) st.sfx.push({ name, at: Math.max(0, at), vol }); return MV; },
    /** define estado inicial fixo */
    set(sel, props) { els(sel).forEach(el => reg(el).base = Object.assign(reg(el).base || {}, props)); return MV; },

    seek(t) {
      st.t = t;
      for (const [el, d] of st.targets) {
        const s = Object.assign({}, DEF, d.base || {});
        const touched = new Set(Object.keys(d.base || {}));
        // para cada propriedade: usa o último tween iniciado; antes de qualquer tween usa o "from" do primeiro
        const byProp = {};
        for (const tw of d.tweens) for (const k of new Set([...Object.keys(tw.from), ...Object.keys(tw.to)])) (byProp[k] = byProp[k] || []).push(tw);
        for (const k in byProp) {
          const list = byProp[k].sort((a, b) => a.at - b.at);
          let cur = null;
          for (const tw of list) if (tw.at <= t) cur = tw;
          let v;
          if (!cur) { const f = list[0]; v = k in f.from ? f.from[k] : s[k]; }
          else {
            const p = cur.ease(clamp((t - cur.at) / cur.dur));
            const prev = list[list.indexOf(cur) - 1];
            const fromV = k in cur.from ? cur.from[k] : (prev ? (k in prev.to ? prev.to[k] : prev.from[k]) : DEF[k]);
            const toV = k in cur.to ? cur.to[k] : fromV;
            v = (typeof fromV === 'number' && typeof toV === 'number') ? lerp(fromV, toV, p) : (p < 1 ? fromV : toV);
          }
          s[k] = v; touched.add(k);
        }
        apply(el, s, touched);
      }
      for (const f of st.fns) if (t >= f.a - 1e-6 && t <= f.b + 1e-6) { const p = clamp((t - f.a) / Math.max(f.b - f.a, 1e-4)); f.f(t - f.a, f.ease(p), t); }
      return MV;
    },

    // ---------- utilidades de texto ----------
    /** quebra texto em palavras (<span class=w>), mantendo *destaques* como .hl */
    words(sel, { mask = false } = {}) {
      // aceita texto com *destaque* (pode cobrir várias palavras) e <br>. Não passe HTML pronto.
      const out = [];
      els(sel).forEach(el => {
        const raw = el.dataset.raw || el.innerHTML; el.dataset.raw = raw;
        const toks = raw.replace(/<br\s*\/?>/gi, ' \n ').split(/\s+/).filter(Boolean);
        let on = false; const html = [];
        for (const tk of toks) {
          if (tk === '\n') { html.push('<br>'); continue; }
          let w = tk; const st0 = w.startsWith('*'); if (st0) { on = true; w = w.slice(1); }
          const m = w.match(/\*([.,!?:;…]*)$/); let closes = false; if (m) { closes = true; w = w.replace(/\*([.,!?:;…]*)$/, '$1'); }
          const inner = `<span class="w${on ? ' hl' : ''}">${w}</span>`;
          html.push(mask ? `<span class="mask">${inner}</span>` : inner);
          if (closes) on = false;
        }
        el.innerHTML = html.join(' ');
        out.push(...el.querySelectorAll('.w'));
      });
      return out;
    },
    chars(sel) {
      const out = [];
      els(sel).forEach(el => {
        const txt = el.textContent; el.innerHTML = [...txt].map(c => c === ' ' ? ' ' : `<span class="c">${c}</span>`).join('');
        out.push(...el.querySelectorAll('.c'));
      });
      return out;
    },
    /** máquina de escrever: escreve `text` em el entre at e at+dur, com cursor */
    type(sel, text, at, dur, { cursor = true, sfx = true } = {}) {
      if (sfx && dur > .25) MV.sfx('digitando', at, .5);
      els(sel).forEach(el => MV.fn(-1, 1e9, (lt, p, g) => {
        const n = Math.round(clamp((g - at) / dur) * text.length);
        const blink = cursor && g >= at - .4 && (Math.floor(g * 2.2) % 2 === 0 || (n > 0 && n < text.length));
        el.innerHTML = escapeHtml(text.slice(0, n)) + (cursor ? `<span class="caret" style="opacity:${blink ? 1 : 0}">▍</span>` : '');
      }));
      return MV;
    },
    /** contador numérico com formato pt-BR */
    count(sel, from, to, at, dur, { prefix = '', suffix = '', dec = 0, ease = 'outExpo', sep = '.' } = {}) {
      els(sel).forEach(el => {
        const fmt = v => prefix + fmtNum(v, dec, sep) + suffix;
        const ez = E[ease] || ease;
        MV.fn(-1, 1e9, (lt, p, g) => { el.textContent = fmt(lerp(from, to, ez(clamp((g - at) / dur)))); });
      });
      return MV;
    },
    /** desenha um path SVG (stroke) */
    draw(sel, at, dur, ease = 'inOutCubic') {
      els(sel).forEach(p => {
        const L = p.getTotalLength(); p.style.strokeDasharray = L;
        MV.fn(-1, 1e9, (lt, pp, g) => { const q = (E[ease] || ease)(clamp((g - at) / dur)); p.style.strokeDashoffset = L * (1 - q); });
      });
      return MV;
    },
    /** ponto que viaja num path */
    follow(dotSel, pathSel, at, dur, ease = 'inOutCubic') {
      const dot = els(dotSel)[0], p = els(pathSel)[0], L = p.getTotalLength();
      MV.fn(-1, 1e9, (lt, pp, g) => { const q = (E[ease] || ease)(clamp((g - at) / dur)); const pt = p.getPointAtLength(L * q); dot.setAttribute('cx', pt.x); dot.setAttribute('cy', pt.y); dot.style.opacity = g < at ? 0 : 1; });
      return MV;
    },
    /** animação Lottie (LottieFiles/After Effects via Bodymovin) controlada frame a frame.
     *  Requer <script src="../engine/vendor/lottie.min.js">.  src = objeto JSON ou caminho .json
     *  o: {speed:1, loop:false, from:0 (frame inicial), until:null} */
    lottie(sel, src, at = 0, o = {}) {
      const el = els(sel)[0];
      const p = (async () => {
        const data = typeof src === 'string' ? await MV.loadJSON(src) : src;
        const anim = window.lottie.loadAnimation({ container: el, renderer: 'svg', loop: false, autoplay: false, animationData: data });
        await new Promise(r => anim.addEventListener('DOMLoaded', r));
        const fr = data.fr || 30, total = (o.until ?? data.op) - (o.from ?? data.ip ?? 0);
        MV.fn(-1, 1e9, (lt, pp, g) => {
          let f = Math.max(0, (g - at) * fr * (o.speed || 1));
          f = o.loop ? f % total : Math.min(f, total - 1);
          anim.goToAndStop((o.from ?? data.ip ?? 0) + f, true);
          el.style.visibility = g < at ? 'hidden' : 'visible';
        });
      })();
      st.loads.push(p);
      return MV;
    },
    /** carrega JSON local (funciona em file:// — XHR) */
    loadJSON(src) { return new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open('GET', src); x.onload = () => { try { res(JSON.parse(x.responseText)); } catch (e) { rej(e); } }; x.onerror = () => rej(new Error('não carregou ' + src)); x.send(); }); },
    rand(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); },
  };

  // ---------- PRESETS de entrada/saída (a "linguagem" MotionVelix) ----------
  MV.fx = {
    pop: (s, at, o = {}) => MV.to(s, { from: { scale: o.s0 ?? .6, opacity: 0 }, to: { scale: 1, opacity: 1 }, at, dur: o.dur ?? .45, ease: 'outBack', stagger: o.stagger }),
    rise: (s, at, o = {}) => MV.to(s, { from: { y: o.y ?? 60, opacity: 0, blur: o.blur ?? 8 }, to: { y: 0, opacity: 1, blur: 0 }, at, dur: o.dur ?? .6, ease: 'mv', stagger: o.stagger }),
    blurIn: (s, at, o = {}) => MV.to(s, { from: { opacity: 0, blur: o.blur ?? 24, scale: o.s0 ?? 1.15 }, to: { opacity: 1, blur: 0, scale: 1 }, at, dur: o.dur ?? .55, ease: 'outCubic', stagger: o.stagger }),
    slam: (s, at, o = {}) => MV.to(s, { from: { scale: o.s0 ?? 2.4, opacity: 0, blur: 10 }, to: { scale: 1, opacity: 1, blur: 0 }, at, dur: o.dur ?? .35, ease: 'outExpo', stagger: o.stagger }),
    maskUp: (s, at, o = {}) => MV.to(s, { from: { y: o.y ?? 170 }, to: { y: 0 }, at, dur: o.dur ?? .55, ease: 'outExpo', stagger: o.stagger ?? .06 }),
    slideL: (s, at, o = {}) => MV.to(s, { from: { x: o.x ?? 200, opacity: 0 }, to: { x: 0, opacity: 1 }, at, dur: o.dur ?? .5, ease: 'outExpo', stagger: o.stagger }),
    wipeR: (s, at, o = {}) => MV.to(s, { from: { clipR: 100 }, to: { clipR: 0 }, at, dur: o.dur ?? .5, ease: 'inOutExpo', stagger: o.stagger }),
    flip3d: (s, at, o = {}) => MV.to(s, { from: { rx: o.rx ?? -70, opacity: 0, z: -200 }, to: { rx: 0, opacity: 1, z: 0 }, at, dur: o.dur ?? .7, ease: 'outExpo', stagger: o.stagger }),
    out: (s, at, o = {}) => MV.to(s, { from: {}, to: { opacity: 0, blur: o.blur ?? 14, y: o.y ?? -30, scale: o.scale ?? 1 }, at, dur: o.dur ?? .35, ease: 'inCubic', stagger: o.stagger }),
    dim: (s, at, o = {}) => MV.to(s, { from: {}, to: { opacity: o.to ?? .28 }, at, dur: o.dur ?? .4, ease: 'outCubic' }),
    punch: (s, at, o = {}) => { MV.to(s, { from: {}, to: { scale: o.s ?? 1.12 }, at, dur: .12, ease: 'outQuad' }); MV.to(s, { from: {}, to: { scale: 1 }, at: at + .12, dur: .4, ease: 'outElastic' }); return MV; },
    shake: (s, at, o = {}) => { const r = MV.rand(7); els(s).forEach(el => MV.fn(at, at + (o.dur ?? .3), (lt, p) => { const a = (1 - p) * (o.amp ?? 14); el.style.translate = `${(r() - .5) * a}px ${(r() - .5) * a}px`; })); return MV; },
  };

  // som padrão de cada preset (desligue com {sfx:false} ou troque com {sfx:'nome'})
  const FXSND = { pop: 'pop', slam: 'tap', slideL: 'deslize', wipeR: 'deslize', flip3d: 'deslize', punch: 'tap', blurIn: null, rise: null, maskUp: null, out: null, dim: null, shake: null };
  for (const k of Object.keys(MV.fx)) {
    const f = MV.fx[k];
    MV.fx[k] = (s, at, o = {}) => { const snd = o.sfx === undefined ? FXSND[k] : o.sfx; if (snd) { const n = o.stagger ? Math.min(els(s).length, 8) : 1; for (let i = 0; i < n; i++) MV.sfx(snd, at + i * (o.stagger || 0), (o.vol ?? .7) * (i ? .6 : 1)); } return f(s, at, o); };
  }

  function fmtNum(v, dec, sep) {
    const n = Math.abs(v).toFixed(dec).split('.');
    n[0] = n[0].replace(/\B(?=(\d{3})+(?!\d))/g, sep);
    return (v < 0 ? '-' : '') + n.join(sep === '.' ? ',' : '.');
  }
  function escapeHtml(s) { return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

  function apply(el, s, touched) {
    const tf = [];
    if (s.x || s.y || s.z) tf.push(`translate3d(${s.x}px,${s.y}px,${s.z}px)`);
    if (s.rot) tf.push(`rotate(${s.rot}deg)`);
    if (s.rx) tf.push(`rotateX(${s.rx}deg)`);
    if (s.ry) tf.push(`rotateY(${s.ry}deg)`);
    if (s.skx) tf.push(`skewX(${s.skx}deg)`);
    if (s.scale !== 1 || s.sx !== 1 || s.sy !== 1) tf.push(`scale(${s.scale * s.sx},${s.scale * s.sy})`);
    el.style.transform = tf.join(' ');
    el.style.opacity = s.opacity;
    const f = [];
    if (s.blur > .05) f.push(`blur(${s.blur}px)`);
    if (s.bright !== 1) f.push(`brightness(${s.bright})`);
    if (s.sat !== 1) f.push(`saturate(${s.sat})`);
    el.style.filter = f.join(' ');
    if (s.clipT || s.clipR || s.clipB || s.clipL) el.style.clipPath = `inset(${s.clipT}% ${s.clipR}% ${s.clipB}% ${s.clipL}%)`;
    else if (touched.has('clipR') || touched.has('clipL') || touched.has('clipT') || touched.has('clipB')) el.style.clipPath = 'none';
    if (s.ls !== null) el.style.letterSpacing = s.ls + 'em';
    if (s.width !== null) el.style.width = s.width + (typeof s.width === 'number' ? 'px' : '');
    if (s.height !== null) el.style.height = s.height + (typeof s.height === 'number' ? 'px' : '');
    if (s.radius !== null) el.style.borderRadius = s.radius + 'px';
  }

  window.MV = MV;
  // interface que o renderizador usa
  window.__mv = {
    get w() { return st.w; }, get h() { return st.h; }, get fps() { return st.fps; }, get dur() { return st.dur; }, get sfx() { return st.sfx; },
    seek: t => { MV.seek(t); },
    ready: async () => { if (document.fonts) await document.fonts.ready; if (window.MV_READY) await window.MV_READY; await Promise.all(st.loads); MV.seek(0); },
  };
  // modo prévia no navegador: ?play  (ou ?t=3.2 para congelar)
  addEventListener('load', () => {
    const q = new URLSearchParams(location.search);
    if (q.has('t')) { MV.seek(parseFloat(q.get('t'))); return; }
    if (q.has('play')) { const t0 = performance.now(); const loop = () => { MV.seek(((performance.now() - t0) / 1000) % st.dur); requestAnimationFrame(loop); }; loop(); }
    else MV.seek(0);
  });
})();

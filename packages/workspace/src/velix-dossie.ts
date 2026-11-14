/** A scene the app ships itself: only the kit's engine, fonts and sounds come from the user's installation. */
export const VELIX_DOSSIE_ID = 'dossie';

export const VELIX_DOSSIE_EXAMPLE = {
  serie: 'Nome da série',
  rodape: 'Seu nome ou marca',
  duracao: 14,
  cenas: [
    { at: 0, blocos: [
      { tipo: 'lead', texto: 'A pergunta que abre o vídeo.', at: 0 },
      { tipo: 'grande', texto: 'A palavra-chave.', at: 1 },
    ] },
    { at: 3.5, capitulo: { n: 1, titulo: 'Primeiro capítulo', cor: 'vermelho' }, fonte: 'Fonte: veículo, data', blocos: [
      { tipo: 'pontos', titulo: 'Total: 81', total: 81, destaque: 41, cor: 'vermelho', at: 4 },
      { tipo: 'barras', itens: [{ nome: 'Opção A', valor: 41, cor: 'laranja' }, { nome: 'Opção B', valor: 54, cor: 'vermelho' }], at: 5.5 },
      { tipo: 'tarja', texto: 'A frase que fica na cabeça.', at: 7 },
    ] },
    { at: 8.5, capitulo: { n: 2, titulo: 'Segundo capítulo', cor: 'verde' }, blocos: [
      { tipo: 'cards', itens: [{ titulo: 'Azul', texto: 'o que faz', cor: 'azul' }, { titulo: 'Laranja', texto: 'o que faz', cor: 'laranja' }, { titulo: 'Verde', texto: 'o que faz', cor: 'verde' }], at: 9 },
      { tipo: 'nota', titulo: 'Veículo, data', texto: 'O que a fonte diz.', cor: 'vermelho', at: 10.5 },
      { tipo: 'texto', texto: 'A conclusão desta parte.', at: 12 },
    ] },
  ],
};

export const VELIX_DOSSIE_GUIDE = 'Campos: serie, rodape, duracao (s) e cenas. Cada cena: at (segundo em que começa), capitulo { n, titulo, cor } opcional, fonte opcional, e blocos. Cada bloco tem tipo e at (segundo em que aparece). Tipos: lead e texto { texto }, grande { texto }, tarja { texto, cor }, foto { src, etiqueta, credito }, cards { itens: [{ titulo, texto, cor, cheio }] }, pontos { titulo, total, destaque, cor, nota }, barras { titulo, itens: [{ nome, valor, cor }], nota }, contador { rotulo, de, para, prefixo, sufixo, cor }, nota { titulo, texto, cor }, citacao { texto, autor }, grafico { titulo, pontos: [{ x, y }], nota }, balanca { esquerda, direita, inclina }. Cores: amarelo, vermelho, azul, laranja, verde. Em textos, *palavra* destaca. Fotos usam caminho relativo a este arquivo. Sem linhas ligando anos sem dado no gráfico.';

export const VELIX_DOSSIE_HTML = String.raw`<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="__ENGINE__/mv.css">
<script src="__ENGINE__/mv.js"></script>
<style>
  body{background:#0c1322}
  #fundo{position:absolute;inset:-60px;background-color:#0c1322;background-image:radial-gradient(rgba(150,175,220,.1) 2px,transparent 2.6px);background-size:44px 44px}
  #vinheta{position:absolute;inset:0;background:radial-gradient(120% 80% at 50% 30%,transparent 40%,rgba(5,9,18,.75))}
  #prog{position:absolute;top:0;left:0;right:0;height:9px;background:rgba(255,255,255,.1)}
  #prog i{display:block;height:100%;width:0;background:var(--amarelo)}
  :root{--amarelo:#ffc933;--vermelho:#ff5a5f;--azul:#6ea8fe;--laranja:#ff9447;--verde:#43d08a;--tinta:#f3f5fa;--apagado:#8e99ae;--cartao:#172136}
  #topo{position:absolute;left:60px;top:190px;display:flex;align-items:center;gap:16px;font:800 25px Inter;letter-spacing:.04em;color:var(--tinta)}
  #topo b{width:42px;height:42px;border-radius:9px;background:var(--amarelo);color:#0c1322;display:grid;place-items:center;font:900 28px Inter}
  #rodape{position:absolute;left:60px;bottom:392px;font:600 21px Inter;letter-spacing:.06em;color:var(--apagado)}
  #rodape::before{content:'';display:block;width:62px;height:4px;background:var(--amarelo);margin-bottom:12px}
  .cena{position:absolute;left:60px;right:90px;top:268px;bottom:500px;opacity:0;display:flex;flex-direction:column;gap:26px}
  .cena.abre{justify-content:center}
  .cap{display:flex;align-items:center;gap:20px;font:900 56px/1.1 Inter;letter-spacing:-.02em;color:var(--tinta)}
  .cap b{flex:none;width:76px;height:76px;border-radius:8px;display:grid;place-items:center;color:#0c1322;font:900 52px Inter}
  .fonte{position:absolute;left:0;right:0;bottom:-46px;font:500 21px/1.3 Inter;color:var(--apagado)}
  .b{opacity:0}
  .lead{font:800 56px/1.16 Inter;letter-spacing:-.02em;color:var(--tinta)}
  .texto{font:800 42px/1.25 Inter;letter-spacing:-.01em;color:var(--tinta)}
  .grande{font:900 112px/1.04 Inter;letter-spacing:-.03em;color:var(--amarelo)}
  .hl{color:var(--amarelo)}
  .grande .hl,.tarja .hl,.card .hl,.cit .hl{color:inherit}
  .tarja{align-self:flex-start;max-width:100%;padding:18px 26px;border-radius:6px;font:900 44px/1.2 Inter;color:#0c1322}
  .foto{position:relative;height:520px;border-radius:14px;overflow:hidden;background:#000}
  .foto img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .foto span{position:absolute;left:22px;top:22px;padding:7px 14px;background:var(--amarelo);color:#0c1322;font:900 28px Inter;border-radius:4px}
  .foto em{position:absolute;right:16px;bottom:12px;padding:3px 8px;background:rgba(0,0,0,.55);font:500 19px Inter;color:#dfe4ee;font-style:normal;border-radius:3px}
  .foto::after{content:'';position:absolute;right:0;bottom:0;width:34px;height:34px;border:solid var(--amarelo);border-width:0 4px 4px 0}
  .cards{display:flex;gap:14px}
  .card{flex:1;min-width:0;background:var(--cartao);border-radius:10px;padding:20px 20px 28px;border-top:6px solid}
  .card h4{margin:0 0 10px;font:900 33px/1.15 Inter}
  .card p{margin:0;font:600 27px/1.3 Inter;color:var(--tinta)}
  .card.cheio{border:0;padding:30px 24px}
  .card.cheio h4{margin:0;color:#0c1322;font-size:44px}
  .tit{font:800 40px/1.2 Inter;color:var(--tinta);margin-bottom:18px}
  .pts{display:grid;gap:12px}
  .pts i{aspect-ratio:1;border-radius:50%;background:#2c3852}
  .obs{margin-top:16px;font:800 34px/1.25 Inter}
  .linha{display:grid;grid-template-columns:150px 1fr;align-items:center;gap:16px;margin-bottom:16px;font:800 34px Inter;color:var(--tinta)}
  .trilho{height:52px;background:#1c2740;border-radius:26px;overflow:hidden}
  .enche{height:100%;width:0;border-radius:26px;display:flex;align-items:center;justify-content:flex-end;padding-right:20px;color:#0c1322;font:900 32px Inter;min-width:70px}
  .ct{font:900 170px/1 Inter;letter-spacing:-.03em}
  .ct+div{font:700 36px/1.25 Inter;color:var(--tinta);margin-top:8px}
  .nota{background:var(--cartao);border-left:7px solid;border-radius:8px;padding:22px 26px}
  .nota h4{margin:0 0 8px;font:900 32px Inter}
  .nota p{margin:0;font:600 32px/1.3 Inter;color:var(--tinta)}
  .cit{font:800 italic 46px/1.25 Inter;color:var(--tinta)}
  .cit small{display:block;margin-bottom:10px;font:600 30px Inter;color:var(--apagado);font-style:normal}
  .graf{position:relative;height:440px;margin:8px 0 74px;border-bottom:3px solid #3a4763}
  .gp{position:absolute;width:30px;height:30px;margin:-15px;border-radius:50%;background:var(--amarelo)}
  .gv{position:absolute;transform:translate(-50%,-140%);font:900 32px Inter;color:var(--tinta)}
  .gx{position:absolute;bottom:-38px;transform:translateX(-50%);font:700 23px Inter;color:var(--apagado)}
  .gx.baixo{bottom:-68px}
  .bal{position:relative;height:440px}
  .bal svg{position:absolute;inset:0;width:100%;height:100%}
</style></head>
<body>
<div id="stage">
  <div id="fundo"></div><div id="vinheta"></div>
  <div id="prog"><i></i></div>
  <div id="topo"><b>?</b><span id="serie"></span></div>
  <div id="cenas"></div>
  <div id="rodape"></div>
</div>
<script>
const D = window.MV_DATA || { serie: '', rodape: '', duracao: 4, cenas: [] };
const COR = { amarelo: 'var(--amarelo)', vermelho: 'var(--vermelho)', azul: 'var(--azul)', laranja: 'var(--laranja)', verde: 'var(--verde)' };
const cor = (nome, padrao) => COR[nome] || COR[padrao] || COR.amarelo;
const safe = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rico = (s) => safe(s).replace(/\*(.+?)\*/g, '<span class="hl">$1</span>');
const ALTURA = 1920;
const cenas = D.cenas || [];
const FIM = D.duracao || (cenas.length ? cenas[cenas.length - 1].at + 5 : 4);
document.getElementById('serie').textContent = D.serie || '';
document.getElementById('topo').style.display = D.serie ? 'flex' : 'none';
const rodape = document.getElementById('rodape');
rodape.textContent = D.rodape || '';
if (!D.rodape) rodape.style.display = 'none';
const raiz = document.getElementById('cenas');

function entra(el, at, som) {
  MV.to(el, { from: { opacity: 0, y: 26 }, to: { opacity: 1, y: 0 }, at, dur: .42, ease: 'outExpo' });
  if (som) MV.sfx(som, at, .28);
}

const BLOCOS = {
  lead(el, b) { el.className += ' lead'; el.innerHTML = rico(b.texto); },
  texto(el, b) { el.className += ' texto'; el.innerHTML = rico(b.texto); },
  grande(el, b) { el.className += ' grande'; el.innerHTML = rico(b.texto); },
  tarja(el, b) { el.className += ' tarja'; el.style.background = cor(b.cor, 'amarelo'); el.innerHTML = rico(b.texto); },
  foto(el, b, at, fim) {
    el.className += ' foto';
    const src = /^https?:/i.test(b.src || '') ? '' : (b.src || '');
    el.innerHTML = '<img src="' + safe(src) + '" alt="">' + (b.etiqueta ? '<span>' + safe(b.etiqueta) + '</span>' : '') + (b.credito ? '<em>' + safe(b.credito) + '</em>' : '');
    const img = el.querySelector('img');
    if (b.posicao) img.style.objectPosition = b.posicao;
    MV.fn(at, fim + .5, (t) => { img.style.scale = 1 + Math.min(t, 10) * .008; });
  },
  cards(el, b) {
    el.className += ' cards';
    el.innerHTML = (b.itens || []).map((c) => '<div class="card' + (c.cheio ? ' cheio' : '') + '" style="border-color:' + cor(c.cor) + (c.cheio ? ';background:' + cor(c.cor) : '') + '"><h4 style="' + (c.cheio ? '' : 'color:' + cor(c.cor)) + '">' + rico(c.titulo) + '</h4>' + (c.texto ? '<p>' + rico(c.texto) + '</p>' : '') + '</div>').join('');
  },
  pontos(el, b, at) {
    const total = Math.min(b.total || 0, 200);
    const colunas = total <= 20 ? 10 : total <= 60 ? 12 : total <= 98 ? 14 : 22;
    el.innerHTML = (b.titulo ? '<div class="tit">' + rico(b.titulo) + '</div>' : '') + '<div class="pts" style="grid-template-columns:repeat(' + colunas + ',1fr)">' + Array.from({ length: total }, () => '<i></i>').join('') + '</div>' + (b.nota ? '<div class="obs" style="color:' + cor(b.cor, 'vermelho') + '">' + rico(b.nota) + '</div>' : '');
    const marcados = [...el.querySelectorAll('.pts i')].slice(0, b.destaque || 0);
    const passo = Math.min(.03, 1.1 / Math.max(marcados.length, 1));
    marcados.forEach((p, i) => MV.fn(at + .3 + i * passo, at + 9999, () => { p.style.background = cor(b.cor, 'vermelho'); }));
    MV.sfx('traco', at + .3, .22);
  },
  barras(el, b, at) {
    const itens = b.itens || [];
    const max = Math.max(...itens.map((i) => i.valor), 1);
    el.innerHTML = (b.titulo ? '<div class="tit">' + safe(b.titulo) + '</div>' : '') + itens.map((i) => '<div class="linha"><span>' + safe(i.nome) + '</span><div class="trilho"><div class="enche" style="background:' + cor(i.cor, 'azul') + '"><span>0</span></div></div></div>').join('') + (b.nota ? '<div class="obs" style="color:var(--amarelo)">' + safe(b.nota) + '</div>' : '');
    [...el.querySelectorAll('.enche')].forEach((barra, i) => {
      const inicio = at + .25 + i * .16;
      const alvo = itens[i].valor / max * 100;
      MV.fn(inicio, inicio + 9999, (t) => { const p = Math.min(t / .8, 1); barra.style.width = alvo * (1 - Math.pow(1 - p, 3)) + '%'; });
      MV.count(barra.querySelector('span'), 0, itens[i].valor, inicio, .8, {});
      MV.sfx('tic', inicio, .2);
    });
  },
  contador(el, b, at) {
    el.innerHTML = '<div class="ct" style="color:' + cor(b.cor) + '">0</div><div>' + safe(b.rotulo) + '</div>';
    MV.count(el.querySelector('.ct'), b.de || 0, b.para, at + .1, 1, { prefix: b.prefixo || '', suffix: b.sufixo || '' });
    MV.sfx('sucesso', at + 1, .22);
  },
  nota(el, b) { el.className += ' nota'; el.style.borderColor = cor(b.cor, 'vermelho'); el.innerHTML = (b.titulo ? '<h4 style="color:' + cor(b.cor, 'vermelho') + '">' + safe(b.titulo) + '</h4>' : '') + '<p>' + rico(b.texto) + '</p>'; },
  citacao(el, b) { el.className += ' cit'; el.innerHTML = (b.autor ? '<small>' + safe(b.autor) + '</small>' : '') + '“' + rico(b.texto) + '”'; },
  grafico(el, b) {
    const ps = b.pontos || [];
    const xs = ps.map((p) => p.x); const ys = ps.map((p) => p.y);
    const x0 = Math.min(...xs); const x1 = Math.max(...xs); const y0 = Math.min(...ys); const y1 = Math.max(...ys);
    const px = (x) => 6 + (x - x0) / Math.max(x1 - x0, 1) * 88;
    const py = (y) => 78 - (y - y0) / Math.max(y1 - y0, 1) * 58;
    el.innerHTML = (b.titulo ? '<div class="tit">' + safe(b.titulo) + '</div>' : '') + '<div class="graf">' + ps.map((p, i) => '<div class="b gp" style="left:' + px(p.x) + '%;top:' + py(p.y) + '%"></div><div class="b gv" style="left:' + px(p.x) + '%;top:' + py(p.y) + '%">' + safe(p.y) + '</div><div class="b gx' + (i > 0 && (p.x - ps[i - 1].x) / Math.max(x1 - x0, 1) < .09 && i % 2 ? ' baixo' : '') + '" style="left:' + px(p.x) + '%">' + safe(p.x) + '</div>').join('') + '</div>' + (b.nota ? '<div class="obs" style="color:var(--apagado)">' + safe(b.nota) + '</div>' : '');
  },
  balanca(el, b, at) {
    const pratos = '<g id="trav"><rect x="110" y="84" width="680" height="9" fill="#dfe4ee"/><path d="M110 88 L40 210 M110 88 L180 210" stroke="#dfe4ee" stroke-width="3"/><path d="M790 88 L720 210 M790 88 L860 210" stroke="#dfe4ee" stroke-width="3"/><path d="M30 210 h160 a80 62 0 0 1 -160 0" fill="#ff9447"/><path d="M710 210 h160 a80 62 0 0 1 -160 0" fill="#ff5a5f"/></g>';
    el.className += ' bal';
    el.innerHTML = '<svg viewBox="0 0 900 440"><rect x="442" y="84" width="16" height="310" fill="#8e99ae"/><rect x="370" y="390" width="160" height="12" fill="#8e99ae"/>' + pratos + '<text x="150" y="310" fill="#f3f5fa" font-family="Inter" font-weight="800" font-size="30" text-anchor="middle">' + safe(b.esquerda) + '</text><text x="750" y="310" fill="#f3f5fa" font-family="Inter" font-weight="800" font-size="30" text-anchor="middle">' + safe(b.direita) + '</text></svg>';
    const trav = el.querySelector('#trav');
    trav.style.transformOrigin = '450px 88px';
    MV.fn(at, at + 9999, (t) => { trav.style.rotate = (b.inclina || 0) * (1 - Math.pow(1 - Math.min(t / 1, 1), 3)) + 'deg'; });
  },
};

cenas.forEach((cena, i) => {
  const proxima = cenas[i + 1];
  const inicio = cena.at != null ? cena.at : 0;
  const fim = proxima ? proxima.at : FIM;
  const entradaCena = i === 0 ? -.4 : inicio;
  const el = document.createElement('section');
  el.className = 'cena' + (cena.capitulo ? '' : ' abre');
  raiz.appendChild(el);
  MV.to(el, { from: { opacity: 0 }, to: { opacity: 1 }, at: entradaCena, dur: .25, ease: 'linear' });
  if (proxima) MV.to(el, { from: { opacity: 1 }, to: { opacity: 0 }, at: fim - .22, dur: .22, ease: 'linear' });
  if (i > 0) MV.sfx('deslize', inicio, .22);
  if (cena.capitulo) {
    const cap = document.createElement('div');
    cap.className = 'b cap';
    cap.innerHTML = (cena.capitulo.n != null ? '<b style="background:' + cor(cena.capitulo.cor) + '">' + safe(cena.capitulo.n) + '</b>' : '') + '<span>' + safe(cena.capitulo.titulo) + '</span>';
    el.appendChild(cap);
    entra(cap, entradaCena, null);
  }
  (cena.blocos || []).forEach((b, k) => {
    const bloco = document.createElement('div');
    bloco.className = 'b';
    el.appendChild(bloco);
    const at = b.at != null ? b.at : inicio + .25 + k * 1.1;
    const quando = i === 0 && at <= 0 ? -.4 : at;
    (BLOCOS[b.tipo] || BLOCOS.texto)(bloco, b, quando, fim);
    entra(bloco, quando, b.tipo === 'tarja' || b.tipo === 'cards' ? 'pop' : null);
    bloco.querySelectorAll('.b').forEach((filho, n) => MV.to(filho, { from: { opacity: 0 }, to: { opacity: 1 }, at: quando + .15 + Math.floor(n / 3) * .12, dur: .3, ease: 'outExpo' }));
  });
  if (cena.fonte) {
    const f = document.createElement('div');
    f.className = 'b fonte';
    f.textContent = cena.fonte;
    el.appendChild(f);
    entra(f, entradaCena + .1, null);
  }
});

MV.fn(0, FIM, (t) => {
  document.querySelector('#prog i').style.width = (t / FIM * 100) + '%';
  document.getElementById('fundo').style.translate = Math.sin(t * .15) * 16 + 'px ' + Math.cos(t * .12) * 16 + 'px';
});
MV.setup({ w: 1080, h: ALTURA, fps: 30, dur: FIM });
</script></body></html>
`;

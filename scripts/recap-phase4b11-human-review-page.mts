/**
 * Phase 4B.11 — builds a self-contained human review page for the panels still blocked by the
 * fidelity review ledger. No inference, no network. Crops are embedded so the page works offline.
 *
 * The page exports `recap-human-review-decisions.json`; apply it with
 * `npx tsx scripts/recap-phase4b11-apply-human-review.mts <decisions.json>`.
 * Each decision carries the analysis fingerprint it was made against, so a decision about an
 * analysis that changed afterwards is refused.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
	loadRecapFidelityReviewLedger,
	recapAnalysisFingerprint,
	type ExtractedPanel,
	type PanelAnalysis,
} from '../packages/cinema/src/recap/index.js';

const CHAPTER_ID = 'nano-machine-capitulo-01';
const workspace = resolve(process.env['APPDATA'] ?? '', 'AetheraStudio', 'recap-workspace');
const checkpointDir = join(workspace, 'checkpoints', CHAPTER_ID);
const ledgerPath = join(checkpointDir, 'fidelity-review-ledger.json');
const outDir = resolve('.aethera-recap-data', 'phase4b11-human-review');
const outPath = join(outDir, 'review-blocked-panels.html');

const checkpoint = JSON.parse(readFileSync(join(checkpointDir, 'recap-checkpoint.json'), 'utf8')) as { extractedPanels: ExtractedPanel[]; panelAnalyses: PanelAnalysis[] };
const ledger = loadRecapFidelityReviewLedger(ledgerPath);
if (!ledger) throw new Error(`Ledger ausente: ${ledgerPath}`);
const ledgerSha256 = createHash('sha256').update(readFileSync(ledgerPath)).digest('hex');
const analysisById = new Map(checkpoint.panelAnalyses.map((analysis) => [analysis.panelId, analysis]));
const panelById = new Map(checkpoint.extractedPanels.map((panel) => [panel.panelId, panel]));
const order = new Map(checkpoint.extractedPanels.map((panel, index) => [panel.panelId, index]));

const blocked = ledger.reviews
	.filter((review) => review.status !== 'verified' && review.eligibility !== 'visual_only')
	.sort((a, b) => (order.get(a.panelId) ?? 0) - (order.get(b.panelId) ?? 0));

const items = blocked.map((review) => {
	const analysis = analysisById.get(review.panelId);
	const panel = panelById.get(review.panelId);
	if (!analysis || !panel?.croppedImagePath) throw new Error(`Painel incompleto: ${review.panelId}`);
	const analysisSha256 = recapAnalysisFingerprint(analysis);
	if (analysisSha256 !== review.analysisSha256) throw new Error(`Revisão obsoleta para ${review.panelId}; gere o ledger de novo.`);
	return {
		panelId: review.panelId,
		shortId: review.panelId.replace(`${CHAPTER_ID}_`, ''),
		analysisSha256,
		image: `data:image/png;base64,${readFileSync(panel.croppedImagePath).toString('base64')}`,
		width: panel.width,
		height: panel.height,
		reviewDetail: review.evidence.map((item) => item.detail).join(' '),
		issues: review.issues.map((item) => ({ code: item.code, severity: item.severity, detail: item.detail })),
		analysis: {
			visualDescription: analysis.visualDescription ?? '',
			characters: analysis.characters,
			dialogues: analysis.dialogues.map((entry) => ({ kind: entry.kind ?? 'dialogue', speaker: entry.speaker ?? '', text: entry.text })),
			actions: analysis.actions.map((action) => ({ type: action.type, description: action.description })),
		},
	};
});

const data = { schemaVersion: 1, chapterId: CHAPTER_ID, ledgerSha256, generatedAtIso: new Date().toISOString(), items };
const json = JSON.stringify(data).replace(/</g, '\\u003c');

const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Revisão humana — ${blocked.length} painéis bloqueados</title>
<style>
:root { color-scheme: light dark; --bg: #f5f5f7; --surface: #fff; --text: #1d1d1f; --muted: #6e6e73; --line: #d2d2d7; --accent: #0066cc; --major: #b3261e; --minor: #9a6700; --ok: #1a7f37; --radius: 14px; }
@media (prefers-color-scheme: dark) { :root { --bg: #000; --surface: #1c1c1e; --text: #f5f5f7; --muted: #98989d; --line: #38383a; --accent: #2997ff; --major: #ff6b5e; --minor: #e3b341; --ok: #3fb950; } }
* { box-sizing: border-box; }
body { margin: 0; font: 100%/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
header { position: sticky; top: 0; z-index: 10; display: flex; flex-wrap: wrap; gap: .75rem; align-items: center; justify-content: space-between; padding: .75rem 1.5rem; background: color-mix(in srgb, var(--bg) 78%, transparent); backdrop-filter: blur(20px) saturate(180%); border-bottom: 1px solid var(--line); }
@media (prefers-reduced-transparency: reduce) { header { background: var(--bg); backdrop-filter: none; } }
h1 { font-size: 1.25rem; line-height: 1.2; letter-spacing: -0.01em; margin: 0; }
.sub { color: var(--muted); font-size: .875rem; margin: .125rem 0 0; }
.toolbar { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
button, select { font: inherit; }
.btn { border: 1px solid var(--line); background: var(--surface); color: var(--text); border-radius: 980px; padding: .45rem 1rem; cursor: pointer; transition: transform 100ms ease-out, background-color 150ms; }
.btn:active { transform: scale(0.97); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn:disabled { opacity: .45; cursor: not-allowed; transform: none; }
:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
label.check { display: inline-flex; gap: .4rem; align-items: center; font-size: .875rem; color: var(--muted); }
main { max-width: 1280px; margin: 0 auto; padding: 1.5rem; display: grid; gap: 1.5rem; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); display: grid; grid-template-columns: minmax(260px, 2fr) 3fr; overflow: hidden; }
.card[data-state="done"] { border-color: color-mix(in srgb, var(--ok) 55%, var(--line)); }
@media (max-width: 860px) { .card { grid-template-columns: 1fr; } }
.crop { background: #111; display: flex; align-items: flex-start; justify-content: center; max-height: 82vh; overflow: auto; }
.crop img { width: 100%; height: auto; display: block; }
.body { padding: 1.25rem 1.5rem; display: grid; gap: 1rem; align-content: start; }
.title { display: flex; gap: .75rem; align-items: baseline; justify-content: space-between; }
.title h2 { margin: 0; font-size: 1.125rem; letter-spacing: -0.01em; }
.state { font-size: .8125rem; color: var(--muted); }
.card[data-state="done"] .state { color: var(--ok); }
h3 { font-size: .75rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 0 0 .35rem; }
ul { margin: 0; padding-left: 1.1rem; }
.issues li { margin-bottom: .35rem; }
.chip { display: inline-block; font-size: .75rem; font-weight: 600; padding: .05rem .45rem; border-radius: 6px; margin-right: .35rem; }
.chip.major, .chip.critical { color: var(--major); background: color-mix(in srgb, var(--major) 14%, transparent); }
.chip.minor { color: var(--minor); background: color-mix(in srgb, var(--minor) 16%, transparent); }
.mono { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: .8125rem; }
.muted { color: var(--muted); }
fieldset { border: 0; padding: 0; margin: 0; }
.seg { display: grid; grid-template-columns: repeat(4, 1fr); gap: .35rem; }
@media (max-width: 560px) { .seg { grid-template-columns: repeat(2, 1fr); } }
.seg input { position: absolute; opacity: 0; pointer-events: none; }
.seg label { border: 1px solid var(--line); border-radius: 10px; padding: .55rem .6rem; cursor: pointer; font-size: .875rem; line-height: 1.25; transition: transform 100ms ease-out, border-color 150ms, background-color 150ms; }
.seg label:active { transform: scale(0.98); }
.seg label small { display: block; color: var(--muted); font-size: .75rem; margin-top: .15rem; }
.seg input:checked + label { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
.seg input:focus-visible + label { outline: 3px solid var(--accent); outline-offset: 2px; }
textarea { width: 100%; font: inherit; font-size: .875rem; color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: .55rem .7rem; resize: vertical; }
textarea[aria-invalid="true"] { border-color: var(--major); }
.err { color: var(--major); font-size: .8125rem; min-height: 1.1em; margin: .2rem 0 0; }
.hint { font-size: .8125rem; color: var(--muted); margin: .2rem 0 0; }
.edit { display: grid; gap: .75rem; }
.edit[hidden] { display: none; }
.toast { position: fixed; bottom: 1.25rem; left: 50%; transform: translateX(-50%); background: var(--text); color: var(--bg); padding: .55rem 1rem; border-radius: 980px; font-size: .875rem; opacity: 0; transition: opacity 200ms; pointer-events: none; }
.toast.show { opacity: 1; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
</head>
<body>
<header>
  <div>
    <h1>Revisão humana dos painéis bloqueados</h1>
    <p class="sub"><span id="progress"></span> · capítulo ${CHAPTER_ID} · as decisões ficam salvas neste navegador até você exportar.</p>
  </div>
  <div class="toolbar">
    <label class="check"><input type="checkbox" id="onlyPending"> Só pendentes</label>
    <button class="btn" id="copy" type="button">Copiar JSON</button>
    <button class="btn primary" id="download" type="button">Baixar decisões</button>
  </div>
</header>
<main id="list" aria-live="polite"></main>
<div class="toast" id="toast" role="status"></div>
<script type="application/json" id="data">${json}</script>
<script>
(() => {
  const data = JSON.parse(document.getElementById('data').textContent);
  const storeKey = 'recap-human-review:' + data.chapterId + ':' + data.ledgerSha256;
  const saved = JSON.parse(localStorage.getItem(storeKey) || '{}');
  const DECISIONS = [
    ['accept', 'Aceitar como está', 'A análise está correta; descarta os problemas apontados.'],
    ['correct', 'Corrigir', 'Editar descrição, personagens, falas e ações.'],
    ['visual_only', 'Só visual', 'O painel entra no vídeo sem gerar fatos narrativos.'],
    ['keep', 'Manter bloqueado', 'Sem decisão agora; continua na fila.'],
  ];
  const KINDS = ['dialogue', 'thought', 'narration', 'sfx'];
  const ACTIONS = ['dialogue', 'combat', 'movement', 'reaction', 'observation', 'transformation', 'interaction', 'none'];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dialoguesToText = (list) => list.map((d) => [d.kind, d.speaker, d.text].join(' | ')).join('\\n');
  const actionsToText = (list) => list.map((a) => a.type + ': ' + a.description).join('\\n');
  const persist = () => localStorage.setItem(storeKey, JSON.stringify(saved));
  const toast = (msg) => { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200); };

  function parseCorrection(item, form) {
    const errors = [];
    const characters = form.characters.value.split('\\n').map((s) => s.trim()).filter(Boolean);
    const dialogues = form.dialogues.value.split('\\n').map((s) => s.trim()).filter(Boolean).map((line, i) => {
      const parts = line.split('|').map((s) => s.trim());
      if (parts.length < 3) { errors.push('Fala ' + (i + 1) + ': use "tipo | falante | texto".'); return null; }
      const [kind, speaker, ...rest] = parts;
      if (!KINDS.includes(kind)) errors.push('Fala ' + (i + 1) + ': tipo deve ser ' + KINDS.join(', ') + '.');
      const text = rest.join(' | ');
      if (!text) errors.push('Fala ' + (i + 1) + ': texto vazio.');
      return { kind, speaker, text };
    }).filter(Boolean);
    const actions = form.actions.value.split('\\n').map((s) => s.trim()).filter(Boolean).map((line, i) => {
      const at = line.indexOf(':');
      const type = at > 0 ? line.slice(0, at).trim() : '';
      const description = at > 0 ? line.slice(at + 1).trim() : '';
      if (!ACTIONS.includes(type) || !description) { errors.push('Ação ' + (i + 1) + ': use "tipo: descrição" com tipo ' + ACTIONS.join(', ') + '.'); return null; }
      return { type, description };
    }).filter(Boolean);
    const visualDescription = form.visualDescription.value.trim();
    if (!visualDescription) errors.push('Descrição vazia.');
    return { errors, correction: { visualDescription, characters, dialogues, actions } };
  }

  function validate(item, card) {
    const form = card.querySelector('form');
    const decision = form.decision.value;
    const note = form.note.value.trim();
    const errors = [];
    if (decision && decision !== 'keep' && note.length < 8) errors.push('Escreva o motivo da decisão (o que você viu no crop).');
    let correction;
    if (decision === 'correct') { const parsed = parseCorrection(item, form); errors.push(...parsed.errors); correction = parsed.correction; }
    form.note.setAttribute('aria-invalid', String(decision && decision !== 'keep' && note.length < 8));
    card.querySelector('.err').textContent = errors.join(' ');
    const done = Boolean(decision) && errors.length === 0;
    card.dataset.state = done ? 'done' : 'pending';
    card.querySelector('.state').textContent = done ? (decision === 'keep' ? 'Mantido bloqueado' : 'Decidido') : 'Pendente';
    saved[item.panelId] = { decision, note, ...(decision === 'correct' ? { draft: { visualDescription: form.visualDescription.value, characters: form.characters.value, dialogues: form.dialogues.value, actions: form.actions.value } } : saved[item.panelId]?.draft ? { draft: saved[item.panelId].draft } : {}), valid: done, correction: done && decision === 'correct' ? correction : undefined };
    persist();
    updateProgress();
  }

  function render() {
    const list = document.getElementById('list');
    list.innerHTML = '';
    for (const item of data.items) {
      const s = saved[item.panelId] || {};
      const draft = s.draft || {};
      const card = document.createElement('article');
      card.className = 'card';
      card.id = item.shortId;
      card.dataset.state = s.valid ? 'done' : 'pending';
      card.innerHTML = '<div class="crop"><img loading="lazy" alt="Crop do painel ' + esc(item.shortId) + '" src="' + item.image + '" width="' + item.width + '" height="' + item.height + '"></div>'
        + '<div class="body">'
        + '<div class="title"><h2>' + esc(item.shortId) + '</h2><span class="state">Pendente</span></div>'
        + '<section><h3>Problemas encontrados (revisão v2)</h3><ul class="issues">' + item.issues.map((i) => '<li><span class="chip ' + esc(i.severity) + '">' + esc(i.severity) + '</span><span class="mono">' + esc(i.code) + '</span> — ' + esc(i.detail) + '</li>').join('') + '</ul><p class="hint">O que o revisor viu: ' + esc(item.reviewDetail) + '</p></section>'
        + '<section><h3>Análise do modelo</h3><p>' + esc(item.analysis.visualDescription) + '</p>'
        + '<p><strong>Personagens:</strong> ' + (item.analysis.characters.map(esc).join('; ') || '<span class="muted">nenhum</span>') + '</p>'
        + '<p><strong>Falas:</strong></p><ul>' + (item.analysis.dialogues.map((d) => '<li><span class="mono">' + esc(d.kind) + '</span> ' + (d.speaker ? '(' + esc(d.speaker) + ') ' : '') + esc(d.text) + '</li>').join('') || '<li class="muted">nenhuma</li>') + '</ul>'
        + '<p><strong>Ações:</strong></p><ul>' + (item.analysis.actions.map((a) => '<li><span class="mono">' + esc(a.type) + '</span> ' + esc(a.description) + '</li>').join('') || '<li class="muted">nenhuma</li>') + '</ul></section>'
        + '<form novalidate><fieldset><legend><h3>Sua decisão</h3></legend><div class="seg">'
        + DECISIONS.map(([v, l, h]) => '<input type="radio" name="decision" id="' + item.shortId + '-' + v + '" value="' + v + '"' + (s.decision === v ? ' checked' : '') + '><label for="' + item.shortId + '-' + v + '">' + l + '<small>' + h + '</small></label>').join('')
        + '</div></fieldset>'
        + '<div class="edit"' + (s.decision === 'correct' ? '' : ' hidden') + '>'
        + '<label><h3>Descrição visual</h3><textarea name="visualDescription" rows="3"></textarea></label>'
        + '<label><h3>Personagens (um por linha, rótulo visual)</h3><textarea name="characters" rows="3"></textarea></label>'
        + '<label><h3>Falas (tipo | falante | texto)</h3><textarea name="dialogues" rows="3" class="mono"></textarea><p class="hint">Tipos: ' + KINDS.join(', ') + '. Falante pode ficar vazio. SFX em hangul não entra.</p></label>'
        + '<label><h3>Ações (tipo: descrição)</h3><textarea name="actions" rows="3" class="mono"></textarea><p class="hint">Tipos: ' + ACTIONS.join(', ') + '.</p></label>'
        + '</div>'
        + '<label><h3>Motivo</h3><textarea name="note" rows="2" placeholder="O que você viu no crop que sustenta a decisão"></textarea></label>'
        + '<p class="err" aria-live="polite"></p></form></div>';
      list.appendChild(card);
      const form = card.querySelector('form');
      form.visualDescription.value = draft.visualDescription ?? item.analysis.visualDescription;
      form.characters.value = draft.characters ?? item.analysis.characters.join('\\n');
      form.dialogues.value = draft.dialogues ?? dialoguesToText(item.analysis.dialogues);
      form.actions.value = draft.actions ?? actionsToText(item.analysis.actions);
      form.note.value = s.note || '';
      form.addEventListener('input', () => {
        card.querySelector('.edit').hidden = form.decision.value !== 'correct';
        validate(item, card);
      });
      if (s.decision) validate(item, card);
    }
    applyFilter();
  }

  function updateProgress() {
    const done = data.items.filter((i) => saved[i.panelId]?.valid).length;
    document.getElementById('progress').textContent = done + ' de ' + data.items.length + ' decididos';
  }

  function applyFilter() {
    const only = document.getElementById('onlyPending').checked;
    for (const card of document.querySelectorAll('.card')) card.hidden = only && card.dataset.state === 'done';
  }

  function exportJson() {
    const decisions = data.items.filter((i) => saved[i.panelId]?.valid).map((i) => {
      const s = saved[i.panelId];
      return { panelId: i.panelId, analysisSha256: i.analysisSha256, decision: s.decision, note: s.note.trim(), ...(s.decision === 'correct' ? { correction: s.correction } : {}) };
    });
    return JSON.stringify({ schemaVersion: 1, chapterId: data.chapterId, ledgerSha256: data.ledgerSha256, exportedAtIso: new Date().toISOString(), decisions }, null, 2);
  }

  document.getElementById('onlyPending').addEventListener('change', applyFilter);
  document.getElementById('download').addEventListener('click', () => {
    const blob = new Blob([exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'recap-human-review-decisions.json';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Arquivo baixado.');
  });
  document.getElementById('copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(exportJson()); toast('JSON copiado.'); }
    catch { toast('Não foi possível copiar; use Baixar decisões.'); }
  });
  render();
  updateProgress();
})();
</script>
</body>
</html>
`;

mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, html, 'utf8');
console.log(JSON.stringify({ outPath, panels: items.length, ledgerSha256, sizeKb: Math.round(html.length / 1024) }));

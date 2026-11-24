/**
 * Phase 4B.11 — fidelity review ledger v2 (after re-analysis of the 31 blocked panels).
 *
 * No inference. The 31 panels blocked by ledger v1 were re-analysed locally (qwen3.5:4b) with the
 * corrected prompt `recap-v2-identity-sfx`: 13 in job rjob-mwv5t9fm-d11b2a92 and 18 in job
 * rjob-mwv67dux-cef978d4 (the 18 had first been replayed from the VisionRouter cache).
 * Each of the 31 crops was inspected again and reviewed against its new analysis (R2 below).
 * The other 80 reviews of ledger v1 are kept only while they still match the crop SHA-256 and the
 * analysis fingerprint. Ledger v1 is archived next to the ledger; no artifact is overwritten.
 *
 * Review rule (same bar as v1): an issue is recorded when the analysis changes who is present,
 * who does what to whom, what is said, or what an object is. Pose/orientation nuances that do not
 * change those facts are not issues. A label that reuses the protagonist's descriptor for another
 * person is major when nothing in the panel's analysis tells them apart, minor when the
 * description itself disambiguates (e.g. names the blue hoodie).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
	buildRecapFidelityGateFromReviews,
	canForwardToStoryEngine,
	loadRecapFidelityReviewLedger,
	recapAnalysisFingerprint,
	recapFidelityReviewLedgerSchema,
	type ExtractedPanel,
	type PanelAnalysis,
	type RecapFidelityIssue,
	type RecapFidelityReviewRecord,
} from '../packages/cinema/src/recap/index.js';

const RUN_ID = 'recap-1795538364251';
const CHAPTER_ID = 'nano-machine-capitulo-01';
const workspace = resolve(process.env['APPDATA'] ?? '', 'AetheraStudio', 'recap-workspace');
const checkpointDir = join(workspace, 'checkpoints', CHAPTER_ID);
const checkpointPath = join(checkpointDir, 'recap-checkpoint.json');
const ledgerPath = join(checkpointDir, 'fidelity-review-ledger.json');
const ledgerV1ArchivePath = join(checkpointDir, 'fidelity-review-ledger.v1.json');
const fidelityDir = join(workspace, 'projects', RUN_ID, 'fidelity');
const reportPath = join(fidelityDir, 'fidelity-gate-report-independent-v2.json');
const queuePath = join(fidelityDir, 'fidelity-human-review-queue-v2.json');
const REVIEWER = 'claude-code: revisão visual independente do crop após reanálise (Fase 4B.11, v2)';
const REVIEWED_AT = '2026-11-24T21:20:00.000Z';
const ORIGIN = 'scripts/audit-recap-phase4b11-fidelity-ledger-v2.mts';

function atomicWrite(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporary, content, 'utf8');
	renameSync(temporary, path);
}

type Severity = RecapFidelityIssue['severity'];
type Problem = [RecapFidelityIssue['code'], Severity, string];
type Review = { detail: string; problems?: Problem[] };

const NEWCOMER_FUSED = 'O jovem de moletom azul e branco (recém-chegado) recebe um descritor do protagonista ferido de túnica clara, e nada na análise do painel os distingue; isso funde duas pessoas.';
const NEWCOMER_LABEL_OVERLAP = 'O rótulo do jovem de moletom ("cabelo escuro espetado") é o mesmo usado para o protagonista em outros painéis; a descrição do painel cita o moletom, mas o rótulo sozinho é ambíguo.';

const R2: Record<string, Review> = {
	p1_2: { detail: 'Um único jovem de túnica clara cai pela encosta em três momentos; balões EUAACK...!!, ACK!!!, ACCK!!! conferem (gritos não lexicais).', problems: [['CHARACTER_IDENTITY_UNCERTAIN', 'minor', 'O mesmo jovem em queda aparece como dois personagens ("túnica clara com faixa lavanda" e "túnica clara e cabelo escuro espetado").']] },
	p1_3: { detail: 'Crop contém apenas traços de um glifo coreano e a borda de um balão; não há personagem.', problems: [['CHARACTER_HALLUCINATION', 'major', 'A análise descreve uma figura de túnica clara com faixa lavanda que não existe no crop.']] },
	p1_4: { detail: 'Jovem de quatro no chão, cabeça baixa, túnica clara rasgada; balões ...SHIT!! e I CAN\'T MOVE... MY LEG ANYMORE...! conferem; um rótulo só.' },
	p6_1: { detail: 'Jovem descalço de túnica clara avança gritando EUARGHH!!! e golpeia com uma faca curta entre figuras encapuzadas; SFX coreano não transcrito.', problems: [['ACTION_MISMATCH', 'major', 'A análise inverte o papel: diz que o jovem é atingido e sente dor, mas o crop mostra o jovem desferindo o golpe com a lâmina.']] },
	p6_2: { detail: 'Figura encapuzada de luvas listradas saca a espada em movimento rápido; SFX coreano 착아아아 corretamente omitido do diálogo.' },
	p6_3: { detail: 'Jovem de túnica clara rasgada, assustado, golpeia com uma faca curta enquanto uma lâmina escura vem da esquerda; balão KEUK...!.', problems: [['OCR_INCOMPLETE', 'minor', 'O balão diz "KEUK...!", transcrito como "REUR...!".'], ['OBJECT_MISMATCH', 'minor', 'A arma do jovem é uma faca curta, não uma espada.']] },
	p7_0: { detail: 'O encapuzado mascarado avança com o braço estendido e a mão aberta para agarrar (SFX 촤악); não há segundo personagem.', problems: [['ACTION_MISMATCH', 'major', 'A análise diz que o encapuzado leva um soco; no crop é ele quem avança para agarrar.'], ['CHARACTER_HALLUCINATION', 'major', 'O "personagem com máscara escura" que daria o soco não existe; a máscara é do próprio encapuzado.']] },
	p7_1: { detail: 'Encapuzado agarra o jovem de frente pela gola/garganta e o ergue do chão; SFX coreano 콱.', problems: [['ACTION_MISMATCH', 'major', 'A análise diz que o jovem é agarrado "por trás" e puxado para trás; o crop mostra um agarrão frontal pela garganta, erguendo-o.']] },
	p7_3: { detail: 'Close da mão do jovem segurando uma lâmina curta reluzente junto à própria faixa lavanda; SFX 스윽 não transcrito. A descrição neutra confere.' },
	p8_2: { detail: 'Encapuzado com sangue jorrando da cabeça/pescoço enquanto o jovem de túnica clara avança de quatro em primeiro plano; SFX coreano.', problems: [['ACTION_MISMATCH', 'major', 'A análise trata o jovem como o ferido/derrotado e omite que o encapuzado é atingido (coerente com "kill one of our members" no painel seguinte).'], ['CHARACTER_IDENTITY_UNCERTAIN', 'major', 'O mesmo rótulo do jovem aparece duas vezes e o encapuzado não está na lista de personagens.']] },
	p8_4: { detail: 'Três encapuzados de costas observam o membro morto caído e o jovem de quatro; espada no chão; os dois balões conferem e a descrição confere.', problems: [['CHARACTER_HALLUCINATION', 'major', 'A lista inclui "jovem de moletom azul", que não aparece neste painel.'], ['CHARACTER_IDENTITY_UNCERTAIN', 'major', 'Quatro rótulos para um único jovem e nenhum para os três encapuzados visíveis.']] },
	p9_2: { detail: 'Encapuzado corta o jovem de túnica clara com a espada; o jovem é lançado para trás com sangue; SFX coreano.', problems: [['ACTION_MISMATCH', 'minor', 'A descrição diz que o ataque é contra uma figura "caída no chão"; o jovem está em pé sendo arremessado para trás.']] },
	p10_4: { detail: 'Encapuzado atravessa o abdômen do jovem com a espada; balões HOW DOES IT FEEL TO HAVE A HOLE IN YOUR STOMACH? e UGHHH!!! conferem.', problems: [['CHARACTER_IDENTITY_UNCERTAIN', 'minor', 'Três rótulos para o mesmo jovem; o encapuzado só aparece nas ações.']] },
	p11_1: { detail: 'Pé enfaixado do atacante pisa na ferida do jovem, que grita com sangue na boca; balões SLOWLY!! MORE!!, DIE AN EXCRUCIATING DEATH!! e ......!!!!!! conferem.', problems: [['CHARACTER_IDENTITY_UNCERTAIN', 'major', 'A análise chama o jovem protagonista de "personagem feminino".'], ['CHARACTER_HALLUCINATION', 'minor', 'A perna que pisa é a perna enfaixada do atacante, não uma "perna descalça".']] },
	p11_2: { detail: 'Encapuzado com espada pisa no jovem caído e imóvel; capa em primeiro plano; dois rótulos distintos.' },
	p11_4: { detail: 'Encapuzado mascarado de perfil, balão de pensamento acima; SFX 후 (suspiro) citado só como som, não como fala.' },
	p12_0: { detail: 'Explosão de luz dourada com SFX coreano 파앗 nas bordas; sem fala e sem personagens, como na análise.' },
	p13_0: { detail: 'Jovem de costas em primeiro plano; ao fundo, atacante de roupas escuras é golpeado e espirra sangue; empunhadura de espada reluz.', problems: [['CHARACTER_IDENTITY_UNCERTAIN', 'minor', 'A figura ensanguentada é um atacante de roupas escuras sendo golpeado, listada só como "corpo coberto em sangue".']] },
	p13_3: { detail: 'Encapuzado mascarado arregala o olho com gota de suor; balão "!!" como reação (sound_effect).' },
	p14_2: { detail: 'Jovem de moletom azul e branco, visor/headset sobre os olhos, braços cruzados, envolto em eletricidade; SFX 파직 não transcrito; rótulo distinto do protagonista.', problems: [['OBJECT_MISMATCH', 'minor', 'O acessório é um visor/headset, não óculos escuros.']] },
	p15_0: { detail: 'Tronco e braços cruzados do jovem de moletom azul e branco com eletricidade; SFX coreano.', problems: [['CHARACTER_IDENTITY_UNCERTAIN', 'major', `${NEWCOMER_FUSED} Aqui o rótulo é "jovem de túnica clara com faixa lavanda".`]] },
	p15_3: { detail: 'Queixo e sorriso do jovem de moletom azul (zíper visível) com faíscas azuis; SFX coreano não transcrito; a descrição cita o moletom.', problems: [['CHARACTER_IDENTITY_UNCERTAIN', 'minor', NEWCOMER_LABEL_OVERLAP]] },
	p16_3: { detail: 'Golpe de energia destrói a cena; encapuzado observa; balão SIR!!! e SFX coreano.', problems: [['DIALOGUE_OMISSION', 'minor', 'O grito "SIR!!!" está em balão de fala, mas foi classificado como sound_effect.']] },
	p18_1: { detail: 'Encapuzado de capa vermelha e roupas cinza salta para longe pelo céu noturno com a espada.', problems: [['ACTION_MISMATCH', 'major', 'A análise descreve uma "queda vertical" em posição de ataque; o crop mostra o encapuzado saltando para longe (fuga).'], ['CHARACTER_IDENTITY_UNCERTAIN', 'minor', 'O rótulo "jovem de túnica clara e capa marrom" reaproveita o descritor do protagonista para o assassino encapuzado.']] },
	p20_0: { detail: 'Visão desfocada (ponto de vista do protagonista moribundo) do jovem de moletom azul; balões MY EYESIGHT IS GETTING FUZZY... e MY ENTIRE BODY\'S GETTING FRIGID... conferem.', problems: [['CHARACTER_IDENTITY_UNCERTAIN', 'major', `${NEWCOMER_FUSED} A ação ainda atribui as falas do protagonista à figura visível.`]] },
	p20_2: { detail: 'Jovem de moletom azul olha o dispositivo de pulso; balões DID THEY FIND ME ALREADY? e SHIT! I GUESS THERE IS NO CHOICE. conferem.', problems: [['CHARACTER_IDENTITY_UNCERTAIN', 'major', `${NEWCOMER_FUSED} Rótulo "jovem de cabelo escuro despenteado"; a descrição fala em "túnica azul escura".`]] },
	p20_3: { detail: 'Mão tira dispositivo luminoso do coldre no cinto do jovem de moletom branco e azul; balão I WAS GOING TO COME HERE EARLIER... confere.', problems: [['CHARACTER_IDENTITY_UNCERTAIN', 'major', `${NEWCOMER_FUSED} Rótulo "pessoa de túnica clara com dispositivo em mão".`]] },
	p21_0: { detail: 'Mão de outra pessoa (manga clara) aproxima um injetor do rosto ensanguentado do jovem; SFX 푸욱 não transcrito.', problems: [['ACTION_MISMATCH', 'minor', 'A descrição diz que o próprio jovem segura a seringa; o injetor está na mão de outra pessoa.']] },
	p21_1: { detail: 'Jovem de moletom injeta algo no abdômen do jovem caído; balão I\'M THE ONE INJECTING IT, AND IT\'S MAKING ME CRINGE. confere.', problems: [['CHARACTER_IDENTITY_UNCERTAIN', 'major', `${NEWCOMER_FUSED} O injetor recebe o rótulo "jovem de cabelo escuro despenteado".`]] },
	p21_3: { detail: 'Jovem de moletom azul e branco ajoelhado ao lado do jovem caído, descalço e ensanguentado; balão HEY, ANCES-TOR NIM? confere; rótulos distintos e corretos.' },
	p21_4: { detail: 'Jovem de moletom sorri sobre o rosto do jovem moribundo, que chora; balão PLEASE MAKE SURE TO SUCCEED... confere; a descrição distingue os dois.', problems: [['CHARACTER_IDENTITY_UNCERTAIN', 'minor', NEWCOMER_LABEL_OVERLAP]] },
};

function issues(panelId: string, problems: Problem[]): RecapFidelityIssue[] {
	return problems.map(([code, severity, detail]) => ({ code, severity, detail, evidence: [{ source: 'image', detail, ref: panelId }], blocksNarrativeFact: severity === 'major' || severity === 'critical' }));
}

const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8')) as { extractedPanels: ExtractedPanel[]; panelAnalyses: PanelAnalysis[] };
const analysisById = new Map(checkpoint.panelAnalyses.map((analysis) => [analysis.panelId, analysis]));
const ledgerV1 = loadRecapFidelityReviewLedger(ledgerPath);
if (!ledgerV1) throw new Error(`Ledger v1 ausente: ${ledgerPath}`);
const v1ById = new Map(ledgerV1.reviews.map((review) => [review.panelId, review]));

const reviews: RecapFidelityReviewRecord[] = [];
const fresh: string[] = [];
const kept: string[] = [];
for (const panel of checkpoint.extractedPanels) {
	const analysis = analysisById.get(panel.panelId);
	if (!analysis) throw new Error(`Painel sem análise: ${panel.panelId}`);
	const shortId = panel.panelId.replace(`${CHAPTER_ID}_`, '');
	const analysisSha256 = recapAnalysisFingerprint(analysis);
	const review = R2[shortId];
	if (review) {
		const previous = v1ById.get(panel.panelId);
		if (previous && previous.analysisSha256 === analysisSha256) throw new Error(`Painel ${shortId} não foi reanalisado: a revisão v1 ainda se aplica.`);
		const problems = review.problems ?? [];
		reviews.push({
			panelId: panel.panelId,
			panelSha256: panel.imageHash,
			analysisSha256,
			status: problems.length > 0 ? 'needs_review' : 'verified',
			evidence: [{ source: 'image', detail: review.detail, ref: panel.panelId }],
			issues: issues(panel.panelId, problems),
			reviewer: REVIEWER,
			reviewedAtIso: REVIEWED_AT,
			origin: ORIGIN,
		});
		fresh.push(panel.panelId);
		continue;
	}
	const previous = v1ById.get(panel.panelId);
	if (!previous) throw new Error(`Sem revisão v1 nem v2: ${panel.panelId}`);
	if (previous.panelSha256 !== panel.imageHash || previous.analysisSha256 !== analysisSha256) {
		throw new Error(`Revisão v1 obsoleta sem revisão nova: ${panel.panelId}`);
	}
	reviews.push(previous);
	kept.push(panel.panelId);
}

const unused = Object.keys(R2).filter((id) => !fresh.includes(`${CHAPTER_ID}_${id}`));
if (unused.length > 0) throw new Error(`Revisões sem painel correspondente: ${unused.join(', ')}`);

const ledger = recapFidelityReviewLedgerSchema.parse({ schemaVersion: 1, chapterId: CHAPTER_ID, reviews });
const result = buildRecapFidelityGateFromReviews({ panels: checkpoint.extractedPanels, analyses: checkpoint.panelAnalyses, ledger });
if (result.staleReviewPanelIds.length || result.unreviewedPanelIds.length || result.missingAnalysisPanelIds.length) {
	throw new Error(`Ledger incompleto: ${JSON.stringify({ stale: result.staleReviewPanelIds, unreviewed: result.unreviewedPanelIds, missing: result.missingAnalysisPanelIds })}`);
}

for (const path of [ledgerV1ArchivePath, reportPath, queuePath]) if (existsSync(path)) throw new Error(`Recusando sobrescrever artefato: ${path}`);
atomicWrite(ledgerV1ArchivePath, `${JSON.stringify(ledgerV1, null, 2)}\n`);
atomicWrite(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
atomicWrite(reportPath, `${JSON.stringify({ schemaVersion: 1, phase: '4B.11.independent-fidelity-v2', runId: RUN_ID, chapterId: CHAPTER_ID, createdAtIso: new Date().toISOString(), freshReviews: fresh.length, keptReviews: kept.length, report: result.report }, null, 2)}\n`);
atomicWrite(queuePath, `${JSON.stringify({ panelIds: result.report.humanReviewQueue, generatedAtIso: new Date().toISOString() }, null, 2)}\n`);

const issueCounts: Record<string, number> = {};
for (const panel of result.report.panels) for (const item of panel.issues) issueCounts[`${item.code}/${item.severity}`] = (issueCounts[`${item.code}/${item.severity}`] ?? 0) + 1;
console.log(JSON.stringify({
	status: result.report.status,
	canForwardToStoryEngine: canForwardToStoryEngine(result.report),
	panels: result.report.panels.length,
	fresh: fresh.length,
	kept: kept.length,
	verified: result.report.panels.filter((panel) => panel.status === 'verified').length,
	narrativeEligible: result.report.storyEngineEligiblePanelIds.length,
	visualOnly: result.report.visualOnlyPanelIds,
	blocked: result.report.blockedPanelIds.map((id) => id.replace(`${CHAPTER_ID}_`, '')),
	reviewQueue: result.report.humanReviewQueue.length,
	issueCounts,
	ledgerPath,
	reportPath,
}, null, 2));

/**
 * Phase 4B.11 — independent fidelity review ledger for run recap-1795538364251 (111 panels).
 *
 * No inference. Joins the productive checkpoint with independent visual reviews:
 *  - 60 reviews written in this phase after inspecting each crop (51 new panels + 9 panels
 *    re-analysed by the first smoke of this run, whose content no longer matches history);
 *  - 51 historical reviews (Phases 4B.5/4B.9) inherited ONLY when the current analysis text and
 *    description are byte-identical to the historical checkpoint that was reviewed.
 * Every review is bound to the crop SHA-256 and to the analysis fingerprint, so any re-analysis
 * invalidates it. Writes are atomic and never overwrite an existing artifact.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
	buildRecapFidelityGateFromReviews,
	canForwardToStoryEngine,
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
const checkpointPath = join(workspace, 'checkpoints', CHAPTER_ID, 'recap-checkpoint.json');
const historicalIndexPath = join(workspace, 'compatibility', 'historical-checkpoints.json');
const fidelityDir = join(workspace, 'projects', RUN_ID, 'fidelity');
// Chapter-level: reviews are bound to crop SHA + analysis fingerprint, so any run of this chapter may reuse them.
const ledgerPath = join(workspace, 'checkpoints', CHAPTER_ID, 'fidelity-review-ledger.json');
const reportPath = join(fidelityDir, 'fidelity-gate-report-independent-v1.json');
const queuePath = join(fidelityDir, 'fidelity-human-review-queue-v1.json');
const HISTORICAL_REPORTS = [
	resolve('.aethera-recap-data/phase4b5-qwen35-pilot-20261123/qwen-cache/fidelity-gate-report-after-paddleocr-v1.json'),
	resolve('.aethera-recap-data/phase4b9-qwen35-expansion-20261124/report-20/fidelity-gate-report-v1.json'),
];
const REVIEWER = 'claude-code: revisão visual independente do crop (Fase 4B.11)';
const REVIEWED_AT = '2026-11-24T20:40:00.000Z';

function atomicWrite(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporary, content, 'utf8');
	renameSync(temporary, path);
}

type Severity = RecapFidelityIssue['severity'];
type Problem = [RecapFidelityIssue['code'], Severity, string];
type Review = { detail: string; problems?: Problem[]; visualOnly?: boolean };

// Recurrent defect: the model reuses the protagonist's descriptors ("jovem de cabelo escuro
// despenteado/espetado", "pessoa de cabelos escuros e túnica clara rasgada") for different people.
const ALIAS_SPLIT = 'O mesmo jovem de túnica clara aparece sob vários descritores; os atacantes encapuzados visíveis não estão na lista.';
const NEWCOMER_AS_PROTAGONIST = 'O jovem de moletom azul e branco (recém-chegado) recebe o mesmo descritor usado para o protagonista ferido de túnica clara; isso funde duas pessoas.';

const R: Record<string, Review> = {
	// 9 panels re-analysed in this run (first smoke) — historical reviews do not apply.
	p0_0: { detail: 'Paisagem noturna de montanhas com neblina, lua e folhagem em primeiro plano; sem personagens nem texto.' },
	p0_1: { detail: 'Jovem descalço de túnica clara e faixa lavanda corre sozinho por trilha escura entre folhagens; sem texto.' },
	p0_2: { detail: 'Close do jovem de cabelo escuro despenteado, túnica clara rasgada, gritando em movimento; sem texto.' },
	p1_0: { detail: 'Membro claro pressionado contra solo/vegetação com SFX coreano; não é possível afirmar se é mão ou pé, e o painel não sustenta fato narrativo.', visualOnly: true, problems: [['INSUFFICIENT_EVIDENCE', 'minor', 'A análise afirma "perna descalça pisando"; o crop é ambíguo (mão ou pé). Mantido só como peso visual.']] },
	p1_1: { detail: 'Close de olho roxo com gota de suor; balão "!!!" classificado como reação (sound_effect), não como fala.' },
	p1_2: { detail: 'Queda pela encosta em três momentos; balões EUAACK...!!, ACK!!!, ACCK!!! conferem.', problems: [['CHARACTER_IDENTITY_UNCERTAIN', 'minor', 'Um único jovem em queda aparece como dois personagens ("túnica clara com faixa lavanda" e "cabelo escuro espetado").']] },
	p1_3: { detail: 'Crop contém apenas um glifo coreano preto e a borda de um balão; não há personagem.', problems: [['CHARACTER_HALLUCINATION', 'major', 'A análise descreve um personagem de cabelo espetado, túnica rasgada e pernas descalças que não existe no crop.']] },
	p1_4: { detail: 'Jovem de quatro no chão, cabeça baixa, com os balões ...SHIT!! e I CAN\'T MOVE... MY LEG ANYMORE...! corretos.', problems: [['CHARACTER_IDENTITY_UNCERTAIN', 'minor', 'O mesmo jovem aparece como dois personagens; a descrição diz "de costas", mas ele está de frente com a cabeça baixa.']] },
	p2_0: { detail: 'Close de olho roxo arregalado com poeira; balão "......!" confere.' },
	// 51 panels analysed for the first time in this run.
	p4_2: { detail: 'Jovem de cabelo claro em tom azulado, de perfil, com feixe de luz azul; os dois balões (PEASANT BLOOD / PAINLESS DEATH) conferem; SFX coreano vermelho não é fala.' },
	p5_1: { detail: 'Close de figura encapuzada e mascarada com íris vermelha; balões HOH? e DID YOU LEARN SOME MARTIAL ARTS FROM WARRIOR JANG? conferem.' },
	p5_3: { detail: 'Figura encapuzada e mascarada sob lua cheia; os dois balões conferem.' },
	p6_1: { detail: 'Jovem descalço de túnica clara golpeia com uma faca curta entre figuras encapuzadas; balão EUARGHH!!! confere como grito.', problems: [['ACTION_MISMATCH', 'minor', 'A análise trata o jovem só como vítima de ataque; o crop mostra o jovem desferindo golpes com a lâmina.']] },
	p6_2: { detail: 'Figura encapuzada de luvas listradas saca a espada em movimento; o texto visível é SFX coreano (착아아아), não fala.', problems: [['SFX_AS_DIALOGUE', 'major', 'O SFX coreano foi transcrito como a fala inexistente "KOOY".']] },
	p7_1: { detail: 'Figura encapuzada agarra o jovem pela gola/garganta e o ergue; SFX coreano 콱.', problems: [['ACTION_MISMATCH', 'major', 'A análise diz que a figura segura o jovem "por trás"; o crop mostra o agarrão frontal pela garganta.'], ['CHARACTER_IDENTITY_UNCERTAIN', 'minor', ALIAS_SPLIT]] },
	p7_4: { detail: 'Dois encapuzados mascarados em cena tempestuosa; balões WATCH OUT!! e HUH? conferem.' },
	p8_2: { detail: 'Encapuzado com sangue jorrando da cabeça/pescoço enquanto o jovem de túnica clara avança de quatro em primeiro plano; SFX coreano.', problems: [['ACTION_MISMATCH', 'major', 'A análise inverte quem foi ferido: o encapuzado é atingido (coerente com "kill one of our members" no painel seguinte), não o jovem.'], ['CHARACTER_IDENTITY_UNCERTAIN', 'minor', ALIAS_SPLIT]] },
	p8_4: { detail: 'Três encapuzados observam o membro morto caído e o jovem de quatro; os dois balões conferem.', problems: [['CHARACTER_IDENTITY_UNCERTAIN', 'major', 'Cinco descritores para o mesmo jovem e nenhum para os três encapuzados visíveis; a descrição também o coloca "em pé".']] },
	p9_1: { detail: 'Encapuzado avança com espada e SFX 파앗; balão YOU DAMNED BRAT! confere.' },
	p9_2: { detail: 'Encapuzado corta o jovem de túnica clara com a espada; o jovem é lançado para trás com sangue; SFX coreano.', problems: [['CHARACTER_IDENTITY_UNCERTAIN', 'major', 'Sete descritores para um único jovem; o atacante encapuzado não está na lista.']] },
	p10_1: { detail: 'Jovem ferido, com expressão de choque, ao lado da lâmina; SFX coreano 푸욱.' },
	p10_3: { detail: 'Close do jovem gritando com sangue na boca; balão KEUK... confere.' },
	p10_4: { detail: 'Encapuzado atravessa o abdômen do jovem com a espada; balões HOW DOES IT FEEL TO HAVE A HOLE IN YOUR STOMACH? e UGHHH!!! conferem.', problems: [['CHARACTER_IDENTITY_UNCERTAIN', 'minor', ALIAS_SPLIT]] },
	p11_1: { detail: 'Pé enfaixado do atacante pisa na ferida do jovem; balões SLOWLY!! MORE!!, DIE AN EXCRUCIATING DEATH!! e ......!!!!!! conferem.', problems: [['CHARACTER_HALLUCINATION', 'minor', 'A "perna descalça" listada como personagem é a perna enfaixada do atacante.']] },
	p11_2: { detail: 'Encapuzado com espada pisa no jovem caído; capa em primeiro plano.', problems: [['CHARACTER_IDENTITY_UNCERTAIN', 'minor', ALIAS_SPLIT]] },
	p12_0: { detail: 'Explosão de luz dourada com SFX coreano 파앗 nas bordas; sem fala.', problems: [['SFX_AS_DIALOGUE', 'major', 'O glifo coreano "앗" foi lido como a fala inexistente "ok".']] },
	p12_2: { detail: 'Explosão de energia dourada sobre a cena; encapuzado reage com balão ?!!; SFX coreano 퍼엉.' },
	p13_0: { detail: 'Jovem de costas em primeiro plano; ao fundo, figura escura é atingida e espirra sangue.', problems: [['DIALOGUE_HALLUCINATION', 'major', 'A análise registra a fala "N/A", que não existe no crop.'], ['ACTION_MISMATCH', 'major', 'A figura ensanguentada ao fundo veste roupas escuras (atacante), não "túnica clara".']] },
	p13_1: { detail: 'Três encapuzados diante de explosão de partículas; balão JUST NOW... SOMETHING LIKE A BEAM OF WHITE LIGHT... confere.' },
	p13_4: { detail: 'Encapuzado aponta para cima com a espada na outra mão; balão HE\'S BEHIND US!!! confere.' },
	p14_1: { detail: 'Figura de costas envolta em eletricidade azul diante de três encapuzados na floresta; SFX 파직.' },
	p14_2: { detail: 'Jovem de moletom azul e branco, visor sobre os olhos, braços cruzados, envolto em eletricidade; SFX 파직.', problems: [['CHARACTER_IDENTITY_UNCERTAIN', 'major', NEWCOMER_AS_PROTAGONIST], ['OBJECT_MISMATCH', 'minor', 'O acessório é um visor/headset, não óculos escuros.']] },
	p15_0: { detail: 'Tronco e braços cruzados do jovem de moletom com eletricidade; SFX coreano.', problems: [['CHARACTER_IDENTITY_UNCERTAIN', 'major', NEWCOMER_AS_PROTAGONIST]] },
	p15_1: { detail: 'Encapuzado de capa vermelha corre com a espada; balão WHO ARE YOU! confere.' },
	p15_3: { detail: 'Queixo e sorriso do jovem de moletom (zíper visível) com faíscas azuis; SFX coreano.', problems: [['CHARACTER_IDENTITY_UNCERTAIN', 'major', NEWCOMER_AS_PROTAGONIST]] },
	p15_4: { detail: 'Clarão dourado com SFX coreano 번쩍; sem personagens nem fala.' },
	p16_0: { detail: 'Close do olho arregalado de encapuzado com respingos escuros; balão HUH... HUH?! confere.' },
	p16_3: { detail: 'Golpe de energia destrói a cena; encapuzado observa; balão SIR!!! e SFX coreano.', problems: [['DIALOGUE_OMISSION', 'minor', 'O grito "SIR!!!" está em balão de fala, mas foi classificado como sound_effect.']] },
	p17_1: { detail: 'Close do encapuzado com olhos arregalados; balão CAN IT BE THAT THIS IS THE POWER OF A MASTER WHO\'S RISEN TO THE HIGHEST LEVEL?! confere.' },
	p17_2: { detail: 'Fundo de velocidade azul com SFX coreano vermelho; sem personagens.' },
	p17_4: { detail: 'Mãos enfaixadas sacam a espada em movimento; sem texto.' },
	p17_5: { detail: 'Jovem ferido com sangue na boca e no torso; balão THAT KID ALREADY LOST A LOT OF BLOOD... confere.' },
	p18_1: { detail: 'Encapuzado de capa vermelha salta/foge pelo céu noturno com a espada.', problems: [['CHARACTER_IDENTITY_UNCERTAIN', 'major', 'A figura em fuga é o assassino encapuzado; a análise a identifica com o descritor do protagonista ferido.']] },
	p18_2: { detail: 'Mão brilhante com eletricidade azul; SFX coreano 키이잉.' },
	p19_0: { detail: 'Jovem caído de cabeça para baixo, sorrindo com os dentes cerrados; balão ...SERVES YOU ALL RIGHT. confere.' },
	p19_2: { detail: 'Olho fechado do jovem moribundo; balões WOW~~ e IT LOOKS LIKE OUR ANCESTOR IS IN A HAPPY MOOD... conferem.' },
	p19_3: { detail: 'Balão isolado ANCESTOR...? confere.' },
	p19_5: { detail: 'Balão isolado WHO IS IT...? WHAT KIND OF NONSENSE... confere.' },
	p20_0: { detail: 'Visão desfocada do jovem de moletom azul; balões MY EYESIGHT IS GETTING FUZZY... e MY ENTIRE BODY\'S GETTING FRIGID... conferem.', problems: [['CHARACTER_IDENTITY_UNCERTAIN', 'major', NEWCOMER_AS_PROTAGONIST]] },
	p20_2: { detail: 'Jovem de moletom olha o dispositivo de pulso; balões DID THEY FIND ME ALREADY? e SHIT! I GUESS THERE IS NO CHOICE. conferem.', problems: [['CHARACTER_IDENTITY_UNCERTAIN', 'major', NEWCOMER_AS_PROTAGONIST]] },
	p20_3: { detail: 'Mão tira dispositivo luminoso do coldre no cinto do jovem de moletom; balão I WAS GOING TO COME HERE EARLIER... confere.', problems: [['CHARACTER_IDENTITY_UNCERTAIN', 'major', 'O personagem listado é o protagonista ferido; o crop mostra o jovem de moletom.']] },
	p21_0: { detail: 'Mão de outra pessoa (manga clara) aproxima um injetor do rosto ensanguentado do jovem; SFX 푸욱.', problems: [['ACTION_MISMATCH', 'minor', 'A análise sugere que o próprio jovem leva o objeto à boca; o injetor está na mão de outra pessoa.'], ['CHARACTER_IDENTITY_UNCERTAIN', 'minor', ALIAS_SPLIT]] },
	p21_1: { detail: 'Jovem de moletom injeta algo no abdômen do jovem caído; balão I\'M THE ONE INJECTING IT... confere.', problems: [['CHARACTER_IDENTITY_UNCERTAIN', 'major', NEWCOMER_AS_PROTAGONIST]] },
	p21_3: { detail: 'Jovem de moletom ajoelhado ao lado do jovem caído e ensanguentado; balão HEY, ANCES-TOR NIM? confere.', problems: [['CHARACTER_IDENTITY_UNCERTAIN', 'major', NEWCOMER_AS_PROTAGONIST]] },
	p21_4: { detail: 'Jovem de moletom sorri sobre o rosto do jovem moribundo; balão PLEASE MAKE SURE TO SUCCEED... confere.', problems: [['CHARACTER_IDENTITY_UNCERTAIN', 'major', NEWCOMER_AS_PROTAGONIST]] },
	p22_1: { detail: 'Corpo caído e descalço atingido por um raio azul; balão "......." e SFX 파직.' },
	p23_0: { detail: 'Olho arregalado com gota de suor; caixa de sistema 034-4532-5893 e balão …?! conferem.' },
	p23_1: { detail: 'Balão isolado THERE\'S A STRANGE VOICE INSIDE MY HEAD... confere.' },
	p23_3: { detail: 'Caixa de sistema 7TH GENERATION NANO MACHINE, confere.' },
	p23_4: { detail: 'Caixa de sistema STARTING ACTIVATION. confere.' },
};

const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8')) as { extractedPanels: ExtractedPanel[]; panelAnalyses: PanelAnalysis[] };
const analysisById = new Map(checkpoint.panelAnalyses.map((analysis) => [analysis.panelId, analysis]));
const historicalIndex = JSON.parse(readFileSync(historicalIndexPath, 'utf8')) as { results: Array<{ panelId: string; filePath: string | null }> };
const historicalReviews = new Map<string, { report: string; createdAtIso: string; panel: any }>();
for (const reportFile of HISTORICAL_REPORTS) {
	const report = JSON.parse(readFileSync(reportFile, 'utf8')) as { createdAtIso: string; before: { panels: any[] } };
	for (const panel of report.before.panels) historicalReviews.set(panel.panelId, { report: reportFile, createdAtIso: report.createdAtIso, panel });
}

function issues(panelId: string, problems: Problem[]): RecapFidelityIssue[] {
	return problems.map(([code, severity, detail]) => ({ code, severity, detail, evidence: [{ source: 'image', detail, ref: panelId }], blocksNarrativeFact: severity === 'major' || severity === 'critical' }));
}

const reviews: RecapFidelityReviewRecord[] = [];
const inherited: string[] = [];
const fresh: string[] = [];
for (const panel of checkpoint.extractedPanels) {
	const analysis = analysisById.get(panel.panelId);
	if (!analysis) throw new Error(`Painel sem análise: ${panel.panelId}`);
	const shortId = panel.panelId.replace(`${CHAPTER_ID}_`, '');
	const base = { panelId: panel.panelId, panelSha256: panel.imageHash, analysisSha256: recapAnalysisFingerprint(analysis) };
	const review = R[shortId];
	if (review) {
		const problems = review.problems ?? [];
		reviews.push({
			...base,
			status: problems.length > 0 ? 'needs_review' : 'verified',
			evidence: [{ source: 'image', detail: review.detail, ref: panel.panelId }],
			issues: issues(panel.panelId, problems),
			...(review.visualOnly ? { eligibility: 'visual_only' as const } : {}),
			reviewer: REVIEWER,
			reviewedAtIso: REVIEWED_AT,
			origin: 'scripts/audit-recap-phase4b11-fidelity-ledger.mts',
		});
		fresh.push(panel.panelId);
		continue;
	}
	// Inherit only when the reviewed historical content is identical to the current analysis.
	const historicalFile = historicalIndex.results.find((item) => item.panelId === panel.panelId)?.filePath;
	if (!historicalFile) throw new Error(`Sem revisão nova nem checkpoint histórico: ${panel.panelId}`);
	const historical = JSON.parse(readFileSync(historicalFile, 'utf8')) as any;
	const historicalTexts = (historical.analysis.frames ?? []).flatMap((frame: any) => (frame.visibleText ?? []).map((item: any) => item.text));
	const sameContent = JSON.stringify(historicalTexts) === JSON.stringify(analysis.dialogues.map((entry) => entry.text))
		&& (historical.analysis.description ?? '') === (analysis.visualDescription ?? '');
	if (!sameContent) throw new Error(`Conteúdo atual diverge do histórico revisado, exige revisão nova: ${panel.panelId}`);
	const source = historicalReviews.get(historical.panel.panelId);
	if (!source) throw new Error(`Revisão histórica ausente: ${historical.panel.panelId}`);
	const evidence = (source.panel.checks.visual.evidence as any[]).filter((item) => item.source === 'image' || item.source === 'human_review');
	const humanIssues = (source.panel.issues as RecapFidelityIssue[]).filter((item) => item.detail !== 'Não há evidência independente de revisão visual; schema e confiança do modelo não são suficientes.');
	reviews.push({
		...base,
		status: source.panel.status === 'verified' ? 'verified' : 'needs_review',
		evidence: evidence.map((item) => ({ source: item.source, detail: item.detail, ref: panel.panelId })),
		issues: humanIssues.map((item) => ({ ...item, evidence: item.evidence.map((entry) => ({ ...entry, ref: panel.panelId })) })),
		reviewer: `revisão visual independente histórica (${historical.panel.panelId})`,
		reviewedAtIso: source.createdAtIso,
		origin: source.report,
	});
	inherited.push(panel.panelId);
}

const unused = Object.keys(R).filter((id) => !fresh.includes(`${CHAPTER_ID}_${id}`));
if (unused.length > 0) throw new Error(`Revisões sem painel correspondente: ${unused.join(', ')}`);

const ledger = recapFidelityReviewLedgerSchema.parse({ schemaVersion: 1, chapterId: CHAPTER_ID, reviews });
const result = buildRecapFidelityGateFromReviews({ panels: checkpoint.extractedPanels, analyses: checkpoint.panelAnalyses, ledger });
if (result.staleReviewPanelIds.length || result.unreviewedPanelIds.length || result.missingAnalysisPanelIds.length) {
	throw new Error(`Ledger incompleto: ${JSON.stringify({ stale: result.staleReviewPanelIds, unreviewed: result.unreviewedPanelIds, missing: result.missingAnalysisPanelIds })}`);
}

for (const path of [ledgerPath, reportPath, queuePath]) if (existsSync(path)) throw new Error(`Recusando sobrescrever artefato: ${path}`);
atomicWrite(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
atomicWrite(reportPath, `${JSON.stringify({ schemaVersion: 1, phase: '4B.11.independent-fidelity', runId: RUN_ID, chapterId: CHAPTER_ID, createdAtIso: new Date().toISOString(), freshReviews: fresh.length, inheritedReviews: inherited.length, report: result.report }, null, 2)}\n`);
atomicWrite(queuePath, `${JSON.stringify({ panelIds: result.report.humanReviewQueue, generatedAtIso: new Date().toISOString() }, null, 2)}\n`);

const issueCounts: Record<string, number> = {};
for (const panel of result.report.panels) for (const item of panel.issues) issueCounts[`${item.code}/${item.severity}`] = (issueCounts[`${item.code}/${item.severity}`] ?? 0) + 1;
console.log(JSON.stringify({
	status: result.report.status,
	canForwardToStoryEngine: canForwardToStoryEngine(result.report),
	panels: result.report.panels.length,
	fresh: fresh.length,
	inherited: inherited.length,
	verified: result.report.panels.filter((panel) => panel.status === 'verified').length,
	narrativeEligible: result.report.storyEngineEligiblePanelIds.length,
	visualOnly: result.report.visualOnlyPanelIds,
	blocked: result.report.blockedPanelIds.length,
	reviewQueue: result.report.humanReviewQueue.length,
	issueCounts,
	ledgerPath,
	reportPath,
}, null, 2));

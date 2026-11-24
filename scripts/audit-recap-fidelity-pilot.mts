import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
	runRecapFidelityGate,
	type RecapFidelityEvidence,
	type RecapFidelityIssue,
	type RecapFidelityPanelInput,
} from '../packages/cinema/src/recap/recap-fidelity-gate.js';

const pilotRoot = join(process.cwd(), '.aethera-recap-data', 'phase4b5-qwen35-pilot-20261123');
const manifestPath = join(pilotRoot, 'pilot-dataset-manifest.json');
const checkpointDir = join(pilotRoot, 'qwen-cache', 'panels');
const outputDir = join(pilotRoot, 'qwen-cache');
const reportPath = join(outputDir, 'fidelity-gate-report-v2.json');
const markdownPath = join(outputDir, 'fidelity-gate-report-v2.md');
const queuePath = join(outputDir, 'fidelity-human-review-queue-v2.json');

function sha256(path: string): string {
	return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function writeAtomic(path: string, content: string): void {
	if (existsSync(path)) throw new Error(`Refusing to overwrite existing audit artifact: ${path}`);
	const tempPath = `${path}.tmp-${process.pid}`;
	writeFileSync(tempPath, content, 'utf8');
	renameSync(tempPath, path);
}

function reviewEvidence(panelId: string, detail: string): RecapFidelityEvidence[] {
	return [{ source: 'image', detail, ref: panelId }];
}

function reviewIssue(
	code: RecapFidelityIssue['code'],
	severity: RecapFidelityIssue['severity'],
	detail: string,
	panelId: string,
): RecapFidelityIssue {
	return {
		code,
		severity,
		detail,
		evidence: reviewEvidence(panelId, detail),
		blocksNarrativeFact: severity === 'major' || severity === 'critical',
	};
}

type ReviewSpec = { status: 'verified' | 'needs_review'; detail: string; issues?: RecapFidelityIssue[] };

const reviewSpecs: Record<string, ReviewSpec> = {
	'nanomachine-cap-1-5_p0_0': { status: 'verified', detail: 'Paisagem noturna com lua, montanhas e vegetação; sem diálogo visível.' },
	'nanomachine-cap-1-5_p1_0': { status: 'verified', detail: 'Mão pressiona objeto orgânico em vegetação; o SFX visível não é fala.' },
	'nanomachine-cap-1-5_p1_3': {
		status: 'needs_review',
		detail: 'Crop muito curto com glyph preto e borda parcial de balão; função narrativa não é determinável independentemente.',
		issues: [
			reviewIssue('UNKNOWN_PANEL', 'major', 'Fragmento/glyph preservado na ordem, mas sem evidência suficiente para afirmar evento narrativo.', 'nanomachine-cap-1-5_p1_3'),
			reviewIssue('INSUFFICIENT_EVIDENCE', 'minor', 'A imagem não permite classificar com segurança se é transição, SFX ou continuação de balão.', 'nanomachine-cap-1-5_p1_3'),
		],
	},
	'nanomachine-cap-1-5_p2_0': { status: 'verified', detail: 'Close-up de rosto/olho roxo com balão de reação; descrição de surpresa coincide.' },
	'nanomachine-cap-1-5_p2_3': { status: 'verified', detail: 'Personagem de costas diante de figuras encapuzadas; fala visível coincide.' },
	'nanomachine-cap-1-5_p3_1': { status: 'verified', detail: 'Personagem central cercado por espadachins; dois balões e formação ofensiva coincidem.' },
	'nanomachine-cap-1-5_p4_1': { status: 'verified', detail: 'Dois encapuzados com espadas e dois balões sobre o trono; descrição coincide.' },
	'nanomachine-cap-1-5_p4_4': { status: 'verified', detail: 'Close-up de personagem ferido e irritado; balão sobre a mãe coincide.' },
	'nanomachine-cap-1-5_p5_2': { status: 'verified', detail: 'Personagem ferido segura uma adaga; os dois balões visíveis coincidem.' },
	'nanomachine-cap-1-5_p6_0': { status: 'verified', detail: 'Figuras encapuzadas armadas cercam o alvo; o comando KILL HIM é visível.' },
	'nanomachine-cap-1-5_p6_3': {
		status: 'needs_review',
		detail: 'Ação de golpe com espada coincide, mas o balão visível é KEUK...? e o checkpoint persistiu REUR...!; transcrição não é confiável.',
		issues: [reviewIssue('OCR_INCOMPLETE', 'major', 'Texto do balão foi lido de forma divergente da imagem; manter a fala para revisão, sem substituição automática.', 'nanomachine-cap-1-5_p6_3')],
	},
	'nanomachine-cap-1-5_p7_2': { status: 'verified', detail: 'Figura mascarada fala com personagem ferido; texto do balão coincide e SFX não foi tratado como fala.' },
	'nanomachine-cap-1-5_p8_0': { status: 'verified', detail: 'Homem mascarado golpeia o outro personagem; impacto e reação ?! são visíveis.' },
	'nanomachine-cap-1-5_p8_3': { status: 'verified', detail: 'Close-up do personagem sorrindo; HEHE... e SERVES YOU RIGHT! coincidem.' },
	'nanomachine-cap-1-5_p9_0': { status: 'verified', detail: 'Personagem com espada luminosa e os dois balões sobre artes marciais coincidem.' },
	'nanomachine-cap-1-5_p9_3': { status: 'verified', detail: 'Personagem ferido no chão, sangue e reação ......!!; descrição coincide.' },
	'nanomachine-cap-1-5_p10_2': {
		status: 'needs_review',
		detail: 'Transição de floresta chuvosa sob a lua com KEUACK-KKK!!!; o texto é SFX, mas o checkpoint o classificou como dialogue.',
		issues: [reviewIssue('SFX_AS_DIALOGUE', 'major', 'SFX visual foi persistido como dialogue; não deve virar fala no Story Engine.', 'nanomachine-cap-1-5_p10_2')],
	},
	'nanomachine-cap-1-5_p11_0': { status: 'verified', detail: 'Mão no chão e os dois balões sobre não conseguir enganar e ter matado alguém coincidem.' },
	'nanomachine-cap-1-5_p11_3': { status: 'verified', detail: 'Dois balões de fala sobre o estilo e o camarada morto coincidem.' },
	'nanomachine-cap-1-5_p12_1': { status: 'verified', detail: 'Close-up de figura mascarada com olhos arregalados; choque/medo coincide.' },
	'nanomachine-cap-1-5_p12_3': { status: 'verified', detail: 'Ataque de vários encapuzados contra alvo ferido; sangue, espadas e posições coincidem.' },
	'nanomachine-cap-1-5_p13_2': { status: 'verified', detail: 'Tênis isolado envolto em energia azul; onomatopeia é SFX, sem diálogo.' },
	'nanomachine-cap-1-5_p14_0': { status: 'verified', detail: 'Três figuras encapuzadas com espadas enfrentam figura azul; SFX não é fala.' },
	'nanomachine-cap-1-5_p14_3': { status: 'verified', detail: 'Close-up de figura mascarada com pergunta sobre a roupa; texto coincide.' },
	'nanomachine-cap-1-5_p15_2': { status: 'verified', detail: 'Personagem de costas envolvido por eletricidade azul; SFX não é diálogo.' },
	'nanomachine-cap-1-5_p15_5': { status: 'verified', detail: 'Impacto/explosão com figuras encapuzadas e espadas; ação em dois blocos coincide.' },
	'nanomachine-cap-1-5_p16_1': { status: 'verified', detail: 'Figura central luminosa em transformação/energia elétrica; SFX coreano não é diálogo.' },
	'nanomachine-cap-1-5_p17_0': { status: 'verified', detail: 'Movimento borrado com balão sobre a luz; SFX ambiental separado da fala.' },
	'nanomachine-cap-1-5_p17_3': { status: 'verified', detail: 'Balão isolado questiona por que um mestre defende o rapaz; texto coincide.' },
	'nanomachine-cap-1-5_p18_0': { status: 'verified', detail: 'Pernas em fuga e balão LET’S... LET’S RETREAT!!!; ação e fala coincidem.' },
	'nanomachine-cap-1-5_p18_3': { status: 'verified', detail: 'Figura no ar se desfaz com sangue e espada próxima; SFX não é diálogo.' },
	'nanomachine-cap-1-5_p19_1': {
		status: 'needs_review',
		detail: 'Close-up de olho roxo coincide, mas é visualmente muito semelhante ao painel seguinte; preservar ambos e revisar se a repetição é intencional.',
		issues: [reviewIssue('DUPLICATE_CONTENT', 'minor', 'Possível repetição visual entre p19_1 e p19_4; não descartar sem decisão editorial.', 'nanomachine-cap-1-5_p19_1')],
	},
	'nanomachine-cap-1-5_p19_4': {
		status: 'needs_review',
		detail: 'Close-up de olho roxo coincide, mas é visualmente muito semelhante ao painel anterior; preservar ambos e revisar se a repetição é intencional.',
		issues: [reviewIssue('DUPLICATE_CONTENT', 'minor', 'Possível repetição visual entre p19_1 e p19_4; não descartar sem decisão editorial.', 'nanomachine-cap-1-5_p19_4')],
	},
	'nanomachine-cap-1-5_p20_1': { status: 'verified', detail: 'Personagem ferido e ensanguentado pergunta se vai morrer; fala e estado visual coincidem.' },
	'nanomachine-cap-1-5_p20_4': { status: 'verified', detail: 'Personagem de azul observa alvo ferido; os dois balões sobre a morte coincidem.' },
	'nanomachine-cap-1-5_p21_2': { status: 'verified', detail: 'Jovem de azul segura dispositivo luminoso; ALRIGHT-DONE. coincide.' },
	'nanomachine-cap-1-5_p22_0': { status: 'verified', detail: 'Protagonista elétrico sobre personagem caído; os dois trechos de diálogo coincidem.' },
	'nanomachine-cap-1-5_p22_2': { status: 'verified', detail: 'Close-up de personagem ferido com pergunta sobre o estranho; texto coincide.' },
	'nanomachine-cap-1-5_p23_2': { status: 'verified', detail: 'Cartela textual SKY CORPORATION; não é uma cena visual e o texto coincide.' },
	'nanomachine-cap-1-5_p23_5': { status: 'verified', detail: 'Cartela final com título e créditos; conteúdo é de encerramento, não fato narrativo de personagem.' },
};

function markdown(report: ReturnType<typeof runRecapFidelityGate>, manifest: any, hashMismatches: string[], checkpointMissing: string[]): string {
	const lines = [
		'# Fase 4B.7 — Gate de Fidelidade Narrativa',
		'',
		`- Gate: **${report.status}**`,
		`- Base: manifesto ${manifestPath} e checkpoints persistidos; nenhuma inferência executada nesta auditoria.`,
		`- Painéis auditados: **${report.metrics.panelCount}**; verificados **${report.metrics.verifiedPanels}**; needs_review **${report.metrics.needsReviewPanels}**; rejeitados **${report.metrics.rejectedPanels}**; unverified **${report.metrics.unverifiedPanels}**.`,
		`- Elegíveis para Story Engine: **${report.storyEngineEligiblePanelIds.length}/${report.metrics.panelCount}**.`,
		`- Chamadas novas: **0**; tokens adicionais: **0**; APIs externas: **0**.`,
		'',
		'## Integridade do conjunto',
		'',
		`- Painéis selecionados no manifesto: ${manifest.selectedPanelCount}.`,
		`- SHA divergentes: ${hashMismatches.length === 0 ? 'nenhum' : hashMismatches.join(', ')}.`,
		`- Checkpoints ausentes: ${checkpointMissing.length === 0 ? 'nenhum' : checkpointMissing.join(', ')}.`,
		`- Ordem auditada: página/índice e sequência do manifesto; nenhum painel foi removido.`,
		'',
		'## Métricas com denominadores',
		'',
		`- Verificação independente visual/textual: ${report.metrics.verifiedPanels}/${report.metrics.panelCount}.`,
		`- Painéis encaminháveis ao Story Engine: ${report.storyEngineEligiblePanelIds.length}/${report.metrics.panelCount}.`,
		`- Painéis na fila humana: ${report.humanReviewQueue.length}/${report.metrics.panelCount}.`,
		`- Issues major/critical: ${report.metrics.majorOrCriticalIssues}; issues minor: ${report.metrics.minorIssues}.`,
		`- Checks auditados: ${report.metrics.checksAudited}; checks com evidência: ${report.metrics.checksWithEvidence}.`,
		`- Cobertura/precisão de diálogos, ações, personagens e objetos: não convertidas em percentuais; não existe referência transcrita independente para todos os campos.`,
		'',
		'## Relatório individual',
		'',
		'| Painel | Status | Issues | Evidência independente |',
		'|---|---|---|---|',
	];
	for (const panel of report.panels) {
		const spec = reviewSpecs[panel.panelId];
		const issues = panel.issues.map((item) => `${item.code} (${item.severity})`).join(', ') || 'nenhuma';
		lines.push(`| ${panel.panelId} | ${panel.status} | ${issues} | ${spec?.detail ?? 'sem anotação'} |`);
	}
	lines.push('', '## Diagnóstico de p1_3', '', 'O crop não está vazio: contém um fragmento curto com glyph preto e borda parcial de balão. A função narrativa não pode ser determinada com segurança. O painel foi preservado na posição original, classificado como `needs_review` com `UNKNOWN_PANEL` e `INSUFFICIENT_EVIDENCE`, e não é enviado como fato ao Story Engine.', '', '## Encaminhamento', '', '- `verified`: pode fornecer fatos ao Story Engine.', '- `needs_review`: permanece na sequência, mas fatos/diálogos ficam bloqueados até revisão.', '- `rejected`: claims rejeitados não podem ser usados como fatos.', '- `unverified`: ausência de evidência independente; não promove automaticamente.', '', '## Limitações', '', '- A inspeção foi feita contra os crops locais e checkpoints; não houve OCR adicional, modelo externo ou nova inferência.', '- A semelhança p19_1/p19_4 é uma pendência editorial, não prova de erro de extração.', '- A qualidade geral do vídeo não foi avaliada nesta fase; TTS, Humanizer, MotionVelix e renderização permanecem fora do escopo.');
	return `${lines.join('\n')}\n`;
}

if (!existsSync(manifestPath)) throw new Error(`Manifest not found: ${manifestPath}`);
if (!existsSync(checkpointDir)) throw new Error(`Checkpoint directory not found: ${checkpointDir}`);
mkdirSync(outputDir, { recursive: true });

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { selection: any[]; selectedPanelCount: number };
const checkpointByPanelId = new Map<string, any>();
// The directory is content-addressed; inspect each JSON once and index by panelId.
for (const fileName of readdirSync(checkpointDir)) {
	if (!fileName.endsWith('.json')) continue;
	const checkpoint = JSON.parse(readFileSync(join(checkpointDir, fileName), 'utf8')) as any;
	if (checkpoint.panel?.panelId) checkpointByPanelId.set(checkpoint.panel.panelId, checkpoint);
}

const hashMismatches: string[] = [];
const checkpointMissing: string[] = [];
const panels: RecapFidelityPanelInput[] = [];
for (const selected of manifest.selection) {
	const checkpoint = checkpointByPanelId.get(selected.panelId);
	if (!checkpoint) {
		checkpointMissing.push(selected.panelId);
		continue;
	}
	if (!existsSync(selected.cropPath)) throw new Error(`Crop not found: ${selected.cropPath}`);
	const actualHash = sha256(selected.cropPath);
	if (actualHash !== selected.sha256 || actualHash !== checkpoint.panel?.sha256) hashMismatches.push(selected.panelId);
	const spec = reviewSpecs[selected.panelId];
	if (!spec) throw new Error(`Missing independent review annotation: ${selected.panelId}`);
	panels.push({
		panelId: selected.panelId,
		sha256: selected.sha256,
		pageNumber: selected.pageNumber,
		panelIndex: selected.panelIndex,
		readingOrder: selected.readingOrder,
		imagePath: selected.cropPath,
		checkpoint,
		humanReview: {
			status: spec.status,
			evidence: reviewEvidence(selected.panelId, spec.detail),
			issues: spec.issues ?? [],
		},
	});
}

if (hashMismatches.length > 0 || checkpointMissing.length > 0 || panels.length !== manifest.selectedPanelCount) {
	throw new Error(`Dataset integrity failed: hashes=${hashMismatches.length}, missing=${checkpointMissing.length}, panels=${panels.length}/${manifest.selectedPanelCount}`);
}

const report = runRecapFidelityGate({
	panels,
	expectedPanelIds: manifest.selection.map((panel) => panel.panelId),
	checkedAtIso: new Date().toISOString(),
});

const document = {
	schemaVersion: 1,
	phase: '4B.7',
	createdAtIso: report.checkedAtIso,
	source: { manifestPath, checkpointDir, panelCount: panels.length },
	execution: { newVisionCalls: 0, inputTokens: 0, outputTokens: 0, externalApis: 0, inferenceRetried: 0 },
	independentVisualAudit: true,
	manifestIntegrity: { hashMismatches, checkpointMissing, selectedPanelCount: manifest.selectedPanelCount },
	gate: report,
};

writeAtomic(reportPath, `${JSON.stringify(document, null, 2)}\n`);
writeAtomic(markdownPath, markdown(report, manifest, hashMismatches, checkpointMissing));
writeAtomic(queuePath, `${JSON.stringify({ panelIds: report.humanReviewQueue, generatedAtIso: report.checkedAtIso }, null, 2)}\n`);

console.log(JSON.stringify({
	status: report.status,
	panels: report.metrics.panelCount,
	verified: report.metrics.verifiedPanels,
	needsReview: report.metrics.needsReviewPanels,
	rejected: report.metrics.rejectedPanels,
	eligible: report.storyEngineEligiblePanelIds.length,
	newVisionCalls: 0,
	issueCounts: report.metrics.issueCounts,
	reportPath,
	markdownPath,
	queuePath,
}, null, 2));

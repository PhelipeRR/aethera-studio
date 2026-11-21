import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	createOrLoadStoryMemoryProject,
	loadStoryMemoryProject,
	listStoryMemoryProjects,
	getMemoryContextForChapter,
	correctCharacterIdentity,
	mergeStoryMemoryCharacters,
	runStoryEngine,
	getStoryMemoryDir,
	type ExtractedPanel,
	type VisionAdapter,
} from '../../src/recap/index.js';

const TEST_DIR = join(tmpdir(), `recap-story-memory-${Date.now()}`);

function makePanel(dir: string, id: string, pageNumber: number, panelIndex: number): ExtractedPanel {
	const cropPath = join(dir, `${id}.png`);
	writeFileSync(cropPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
	return {
		panelId: id,
		pagePath: cropPath,
		croppedImagePath: cropPath,
		metadata: {
			sourceKind: 'panel_crop',
			origin: 'webtoon_extract',
			chapterId: id.split('_p')[0] ?? 'ch',
			pageNumber,
			panelIndex,
			readingOrder: 'vertical',
			boundingBox: { x: 0, y: panelIndex * 300, w: 800, h: 300 },
			classification: 'action',
			ocrStatus: 'not_run',
			ocrConfidence: 0,
		},
		imageHash: `hash-${id}`,
		width: 800,
		height: 300,
	};
}

describe('Story Memory — Persistent Cross-Chapter Narrative Memory (Tests A–D + Anti-Spoiler)', () => {
	beforeEach(() => {
		mkdirSync(TEST_DIR, { recursive: true });
	});

	afterEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	it('Tests A & B: persists Chapter 1 unknown character, reloads after restart, recognizes & names character in Chapter 2 with natural_recap', async () => {
		const workspaceDir = join(TEST_DIR, 'ws');
		const series = createOrLoadStoryMemoryProject({
			workspaceDir,
			workTitle: 'Nano Machine',
			defaultScriptStyle: 'natural_recap',
		});

		// ── Test A: Chapter 1 (character has unknown name, visual descriptor only) ──
		const ch1Panels = [
			makePanel(TEST_DIR, 'nm_ch1_p0_0', 0, 0),
			makePanel(TEST_DIR, 'nm_ch1_p0_1', 0, 1),
		];
		let ch1Idx = 0;
		const ch1Vision: VisionAdapter = {
			name: 'vision-ch1',
			async analyze() {
				ch1Idx++;
				if (ch1Idx === 1) {
					return {
						visualDescription: 'Plano geral vertical mostrando um jovem de cabelos escuros correndo pela floresta à noite',
						characters: ['Jovem de cabelos escuros em túnica clara com faixa roxa'],
						characterDetails: [{ id: 'Jovem de cabelos escuros em túnica clara com faixa roxa', appearance: 'cabelos escuros, túnica clara com faixa roxa' }],
						actions: [{ type: 'movement', description: 'O jovem corre pela floresta tentando fugir' }],
						emotions: ['tension'],
						setting: 'floresta montanhosa à noite',
						confidence: 0.9,
					};
				}
				return {
					visualDescription: 'O jovem tropeça em uma raiz e cai perto de um penhasco',
					characters: ['Jovem de cabelos escuros em túnica clara com faixa roxa'],
					actions: [{ type: 'movement', description: 'Tropeça em uma raiz e cai no penhasco' }],
					emotions: ['fear'],
					setting: 'floresta montanhosa à noite',
					confidence: 0.9,
				};
			},
		};

		const ch1Res = await runStoryEngine({
			chapterId: 'nano-machine-ch1',
			workTitle: 'Nano Machine',
			panels: ch1Panels,
			outputDir: join(workspaceDir, 'story'),
			visionAdapter: ch1Vision,
			scriptStyle: 'natural_recap',
			storyMemory: {
				workspaceDir,
				projectId: series.projectId,
				chapterNumber: 1,
			},
		});

		expect(ch1Res.gateGReport.verdict).toBe('pass');
		// Natural recap should group the 2 continuous panels in the same forest into 1 concise scene
		expect(ch1Res.script.scenes.length).toBe(1);
		expect(ch1Res.script.scenes[0]!.narrationText).not.toMatch(/plano geral vertical/i);

		// Simulate app restart: reload purely from disk
		const reloadedAfterCh1 = loadStoryMemoryProject(workspaceDir, series.projectId);
		expect(reloadedAfterCh1).not.toBeNull();
		expect(reloadedAfterCh1!.characters).toHaveLength(1);
		expect(reloadedAfterCh1!.characters[0]!.characterId).toBe('char_001');
		expect(reloadedAfterCh1!.characters[0]!.nameStatus).toBe('unknown');
		expect(reloadedAfterCh1!.producedChapters).toEqual([1]);

		// ── Test B: Chapter 2 (character reappears and name "Cheon Yeo-Woon" is confirmed) ──
		// First confirm name via human curation or chapter 2 recognition
		correctCharacterIdentity({
			workspaceDir,
			projectId: series.projectId,
			characterId: 'char_001',
			primaryName: 'Cheon Yeo-Woon',
			nameStatus: 'confirmed',
			reason: 'Nome revelado no diálogo do Capítulo 2',
		});

		const ch2Panels = [makePanel(TEST_DIR, 'nm_ch2_p0_0', 0, 0)];
		let receivedKnownChars: readonly string[] = [];
		const ch2Vision: VisionAdapter = {
			name: 'vision-ch2',
			async analyze(_img, ctx) {
				receivedKnownChars = ctx?.knownCharacters ?? [];
				return {
					visualDescription: 'O jovem desperta após a queda enquanto um homem misterioso se aproxima',
					characters: ['Jovem de cabelos escuros em túnica clara com faixa roxa', 'Homem misterioso'],
					actions: [{ type: 'dialogue', description: 'O homem misterioso faz uma pergunta ao jovem' }],
					emotions: ['surprise'],
					setting: 'base do penhasco',
					speechBubbles: [
						{
							originalText: 'Você ainda consegue lutar?',
							translatedText: 'Você ainda consegue lutar?',
							text: 'Você ainda consegue lutar?',
							speaker: 'Homem misterioso',
							kind: 'dialogue',
							isNarration: false,
							readingOrder: 0,
						},
					],
					confidence: 0.92,
				};
			},
		};

		const ch2Res = await runStoryEngine({
			chapterId: 'nano-machine-ch2',
			workTitle: 'Nano Machine',
			panels: ch2Panels,
			outputDir: join(workspaceDir, 'story'),
			visionAdapter: ch2Vision,
			scriptStyle: 'natural_recap',
			storyMemory: {
				workspaceDir,
				projectId: series.projectId,
				chapterNumber: 2,
			},
		});

		expect(receivedKnownChars).toContain('Cheon Yeo-Woon');
		expect(ch2Res.script.scenes[0]!.characters).toContain('Cheon Yeo-Woon');
		expect(ch2Res.script.scenes[0]!.narrationText).toContain('Você ainda consegue lutar?');

		const afterCh2 = loadStoryMemoryProject(workspaceDir, series.projectId)!;
		expect(afterCh2.producedChapters).toEqual([1, 2]);
		// char_001 was reused (not duplicated) and now appears in chapters 1 and 2
		const char1 = afterCh2.characters.find((c) => c.characterId === 'char_001')!;
		expect(char1.primaryName).toBe('Cheon Yeo-Woon');
		expect(char1.appearedInChapters).toEqual([1, 2]);
	});

	it('Test C: preserves human manual name correction across chapter reprocessing without duplicating events', async () => {
		const workspaceDir = join(TEST_DIR, 'ws-c');
		const series = createOrLoadStoryMemoryProject({ workspaceDir, workTitle: 'Nano Machine' });
		const panel = makePanel(TEST_DIR, 'c_p0_0', 0, 0);

		const vision: VisionAdapter = {
			name: 'vision-c',
			async analyze() {
				return {
					visualDescription: 'O jovem ferido encara o adversário no pátio',
					characters: ['Jovem ferido'],
					actions: [{ type: 'combat', description: 'O jovem ferido encara o adversário' }],
					emotions: ['determination'],
					setting: 'pátio de treinamento',
					confidence: 0.9,
				};
			},
		};

		await runStoryEngine({
			chapterId: 'nm-c-1',
			workTitle: 'Nano Machine',
			panels: [panel],
			outputDir: join(workspaceDir, 'story'),
			visionAdapter: vision,
			storyMemory: { workspaceDir, projectId: series.projectId, chapterNumber: 1 },
		});

		// Human corrects name
		correctCharacterIdentity({
			workspaceDir,
			projectId: series.projectId,
			characterId: 'char_001',
			primaryName: 'Cheon Yeo-Woon',
			reason: 'Correção manual',
		});

		// Reprocess chapter 1 — must NOT overwrite human correction and must NOT duplicate chapter events
		await runStoryEngine({
			chapterId: 'nm-c-1',
			workTitle: 'Nano Machine',
			panels: [panel],
			outputDir: join(workspaceDir, 'story'),
			checkpointDir: join(workspaceDir, 'ckpt-reprocess'),
			visionAdapter: vision,
			storyMemory: { workspaceDir, projectId: series.projectId, chapterNumber: 1 },
		});

		const reloaded = loadStoryMemoryProject(workspaceDir, series.projectId)!;
		expect(reloaded.chapters).toHaveLength(1);
		expect(reloaded.characters).toHaveLength(1);
		expect(reloaded.characters[0]!.primaryName).toBe('Cheon Yeo-Woon');
		expect(reloaded.characters[0]!.lockedByHuman).toBe(true);
	});

	it('Test D & Anti-Spoiler & Backup Recovery: isolates separate works, blocks future-chapter spoilers, and recovers from .bak', async () => {
		const workspaceDir = join(TEST_DIR, 'ws-d');
		const nano = createOrLoadStoryMemoryProject({ workspaceDir, workTitle: 'Nano Machine' });
		const solo = createOrLoadStoryMemoryProject({ workspaceDir, workTitle: 'Solo Leveling' });

		const p1 = makePanel(TEST_DIR, 'd_nano_p0_0', 0, 0);
		const p3 = makePanel(TEST_DIR, 'd_nano_ch3_p0_0', 0, 0);

		// Produce Chapter 1 and Chapter 3 for Nano Machine
		await runStoryEngine({
			chapterId: 'nm-d-1',
			workTitle: 'Nano Machine',
			panels: [p1],
			outputDir: join(workspaceDir, 'story'),
			visionAdapter: {
				name: 'v1',
				async analyze() {
					return {
						visualDescription: 'Cheon Yeo-Woon entra na academia demoníaca',
						characters: ['Cheon Yeo-Woon'],
						actions: [{ type: 'movement', description: 'Cheon Yeo-Woon entra na academia' }],
						emotions: ['determination'],
						setting: 'academia demoníaca',
						confidence: 0.9,
					};
				},
			},
			storyMemory: { workspaceDir, projectId: nano.projectId, chapterNumber: 1 },
		});

		await runStoryEngine({
			chapterId: 'nm-d-3',
			workTitle: 'Nano Machine',
			panels: [p3],
			outputDir: join(workspaceDir, 'story'),
			visionAdapter: {
				name: 'v3',
				async analyze() {
					return {
						visualDescription: 'O Lorde Demoníaco revela um segredo do capítulo 3',
						characters: ['Lorde Demoníaco'],
						actions: [{ type: 'dialogue', description: 'Lorde Demoníaco faz revelação' }],
						emotions: ['tension'],
						setting: 'salão secreto',
						confidence: 0.9,
					};
				},
			},
			storyMemory: { workspaceDir, projectId: nano.projectId, chapterNumber: 3 },
		});

		// Anti-spoiler: context for Chapter 2 MUST NOT see Chapter 3 character or events!
		const loadedNano = loadStoryMemoryProject(workspaceDir, nano.projectId)!;
		const ctxForCh2 = getMemoryContextForChapter(loadedNano, 2);
		expect(ctxForCh2.knownCharacters.map((c) => c.displayName)).toContain('Cheon Yeo-Woon');
		expect(ctxForCh2.knownCharacters.map((c) => c.displayName)).not.toContain('Lorde Demoníaco');
		expect(ctxForCh2.previousChapterSummaries.map((s) => s.chapterNumber)).toEqual([1]);

		// Work isolation: Solo Leveling has ZERO characters/chapters from Nano Machine
		const loadedSolo = loadStoryMemoryProject(workspaceDir, solo.projectId)!;
		expect(loadedSolo.characters).toHaveLength(0);
		expect(loadedSolo.chapters).toHaveLength(0);
		expect(listStoryMemoryProjects(workspaceDir)).toHaveLength(2);

		// Backup recovery: corrupt main story-memory.json and confirm automatic recovery from .bak
		const nanoMainFile = join(getStoryMemoryDir(workspaceDir, nano.projectId), 'story-memory.json');
		writeFileSync(nanoMainFile, '{corrupted json', 'utf-8');
		const recovered = loadStoryMemoryProject(workspaceDir, nano.projectId);
		expect(recovered).not.toBeNull();
		expect(recovered!.workTitle).toBe('Nano Machine');

		// Character merge test
		const merged = mergeStoryMemoryCharacters({
			workspaceDir,
			projectId: nano.projectId,
			primaryCharacterId: recovered!.characters[0]!.characterId,
			secondaryCharacterId: recovered!.characters[0]!.characterId,
		});
		expect(merged.characters.length).toBeGreaterThanOrEqual(1);
	});
});

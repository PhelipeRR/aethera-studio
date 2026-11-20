/**
 * Phases 4.4, 5, 6 & 7 — Automated Integration & State-Machine Tests
 *
 * Uses EXPLICIT SYNTHETIC FIXTURES to validate prompt-based incremental revision,
 * dependency graph rework ratios, persistent state-machine orchestration,
 * preview-before-master governance, and standardized Phase 7.3 release bundles.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	buildRecapAudiovisualPlan,
	planRecapRevisionImpact,
	applyRecapRevisionPlan,
	runRecapProductionOrchestrator,
	loadOrchestratorState,
	AgentCircuitBreaker,
	classifyVisionError,
	type ExtractedPanel,
	type RecapScript,
} from '../../src/recap/index.js';

function makePanel(id: string, pageNumber: number, imagePath: string): ExtractedPanel {
	return {
		panelId: id,
		pagePath: imagePath,
		croppedImagePath: imagePath,
		metadata: {
			sourceKind: 'panel_crop',
			origin: 'webtoon_extract',
			chapterId: 'fixture-cap-01',
			pageNumber,
			panelIndex: pageNumber,
			readingOrder: 'vertical',
			boundingBox: { x: 0, y: pageNumber * 100, w: 800, h: 1000 },
			classification: pageNumber === 1 ? 'dialogue' : 'action',
			ocrStatus: 'not_run',
			ocrConfidence: 0,
		},
		imageHash: `hash-${id}`,
		width: 800,
		height: 1000,
	};
}

function makeFixtureScript(panels: readonly ExtractedPanel[]): RecapScript {
	return {
		chapterId: 'fixture-cap-01',
		title: '[FIXTURE] Nano Machine Cap. 01',
		style: 'cinematic_recap',
		totalEstimatedDurationSec: 10,
		generatedAtIso: new Date().toISOString(),
		generatedBy: 'synthetic-fixture',
		scenes: [
			{
				sceneId: 'scene-1',
				narrationText: 'Cheon entra no pátio sombrio sob o olhar dos guardas.',
				characters: ['Cheon'],
				eventDescription: 'Chegada ao pátio.',
				panelIds: [panels[0]!.panelId],
				croppedImagePaths: [panels[0]!.croppedImagePath!],
				estimatedDurationSec: 3.5,
				emotion: 'tension',
				narrativeIntent: 'exposition',
				confidence: 0.9,
				reviewStatus: 'approved',
			},
			{
				sceneId: 'scene-2',
				narrationText: 'O rival desafia Cheon com um aviso silencioso.',
				characters: ['Cheon', 'Rival'],
				eventDescription: 'Desafio.',
				panelIds: [panels[1]!.panelId],
				croppedImagePaths: [panels[1]!.croppedImagePath!],
				estimatedDurationSec: 3.5,
				emotion: 'determination',
				narrativeIntent: 'rising_action',
				confidence: 0.9,
				reviewStatus: 'approved',
			},
			{
				sceneId: 'scene-3',
				narrationText: 'O golpe decisivo fecha o confronto.',
				characters: ['Cheon'],
				eventDescription: 'Clímax.',
				panelIds: [panels[2]!.panelId],
				croppedImagePaths: [panels[2]!.croppedImagePath!],
				estimatedDurationSec: 3.0,
				emotion: 'anger',
				narrativeIntent: 'climax',
				confidence: 0.9,
				reviewStatus: 'approved',
			},
		],
	};
}

describe('Phases 4.4, 5, 6 & 7 — Prompt Revision, Dependency Graph, State-Machine Orchestrator & Release Bundle', () => {
	it('Phases 4.4 & 5.4: computes exact incremental Impact Plans and applies localized mutations without unnecessary rework', () => {
		const dir = mkdtempSync(join(tmpdir(), 'recap-p44-rev-'));
		try {
			const img = join(dir, 'p.png');
			writeFileSync(img, 'png');
			const panels = [makePanel('p-1', 0, img), makePanel('p-2', 1, img), makePanel('p-3', 2, img), makePanel('p-4', 3, img)];
			const script = makeFixtureScript(panels);
			const plan = buildRecapAudiovisualPlan({ script, panels, options: { isSyntheticFixture: true } });

			// 1. Music & narration adjustment -> ZERO video re-encode!
			const musicImpact = planRecapRevisionImpact({
				prompt: 'Reduza a música e destaque a narração',
				script,
				plan,
			});
			expect(musicImpact.understood).toBe(true);
			expect(musicImpact.reprocessStages).toEqual(['audio_mix', 'mux_mp4', 'gate_h']);
			expect(musicImpact.reusedStages).toContain('shot_render');
			expect(musicImpact.estimatedVideoReworkRatio).toBe(0);

			const afterMusic = applyRecapRevisionPlan({ script, plan, impactPlan: musicImpact });
			expect(afterMusic.plan.ducking.musicBaseGainDb).toBeLessThan(plan.ducking.musicBaseGainDb);
			expect(afterMusic.plan.ducking.musicDuckingDb).toBeLessThan(plan.ducking.musicDuckingDb);

			// 2. Make scene 2 more dramatic -> only 1/3 scenes affected
			const dramaImpact = planRecapRevisionImpact({
				prompt: 'Deixe a cena 2 mais dramática',
				script,
				plan,
			});
			expect(dramaImpact.affectedSceneIds).toEqual(['scene-2']);
			expect(dramaImpact.estimatedVideoReworkRatio).toBe(0.33);
			const afterDrama = applyRecapRevisionPlan({ script, plan, impactPlan: dramaImpact });
			expect(afterDrama.script.scenes[1]!.narrativeIntent).toBe('climax');

			// 3. Swap panel on scene 1 -> does not reprocess audio_sync
			const swapImpact = planRecapRevisionImpact({
				prompt: 'Troque o painel da cena 1',
				script,
				plan,
				availablePanelIds: ['p-1', 'p-2', 'p-3', 'p-4'],
			});
			expect(swapImpact.reusedStages).toContain('audio_sync');
			const afterSwap = applyRecapRevisionPlan({ script, plan, impactPlan: swapImpact });
			expect(afterSwap.script.scenes[0]!.panelIds[0]).not.toBe('p-1');

			// 4. Pronunciation fix -> preserves editorial narrationText and records override
			const pronImpact = planRecapRevisionImpact({
				prompt: 'Corrija a pronúncia de "Cheon" para "Tchon"',
				script,
				plan,
			});
			expect(pronImpact.reprocessStages).toContain('pronunciation');
			expect(pronImpact.reprocessStages).toContain('audio_sync');
			const afterPron = applyRecapRevisionPlan({ script, plan, impactPlan: pronImpact });
			expect(afterPron.pronunciationOverrides).toEqual([{ from: 'Cheon', to: 'Tchon' }]);
			expect(afterPron.script.scenes[0]!.narrationText).toContain('Cheon');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('Phases 5.1–5.3 & 7.3: pauses cleanly on quota exhaustion, resumes to preview approval, and exports standardized release bundle on master approval', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'recap-p5-orch-'));
		try {
			const img = join(dir, 'panel.png');
			writeFileSync(img, 'png-bytes');
			const panels = [makePanel('p-1', 0, img), makePanel('p-2', 1, img), makePanel('p-3', 2, img)];
			const script = makeFixtureScript(panels);

			// 1. All providers tripped -> pauses cleanly with paused_provider_unavailable (never fabricates)
			const cb = new AgentCircuitBreaker();
			cb.recordError('claude', classifyVisionError("You've hit your weekly limit · resets Nov 22, 3pm", 'claude'));
			const paused = await runRecapProductionOrchestrator({
				runId: 'run-001',
				chapterId: 'fixture-cap-01',
				workTitle: 'Nano Machine',
				panels,
				workspaceDir: dir,
				circuitBreaker: cb,
				providers: [{ id: 'claude', label: 'Claude CLI', detect: async () => ({ available: true }) }],
				dryRunRender: true,
			});
			expect(paused.record.state).toBe('paused_provider_unavailable');
			expect(loadOrchestratorState(join(dir, 'state'))?.state).toBe('paused_provider_unavailable');

			// 2. With existing script (or recovered provider), renders preview and pauses at awaiting_preview_approval
			const preview = await runRecapProductionOrchestrator({
				runId: 'run-001',
				chapterId: 'fixture-cap-01',
				workTitle: 'Nano Machine',
				panels,
				workspaceDir: dir,
				providers: [{ id: 'claude-gateway', label: 'Claude Gateway', detect: async () => ({ available: true }) }],
				existingScript: script,
				plannerOptions: { isSyntheticFixture: true, approvalStatus: 'technical_fixture_unapproved' },
				masterApproved: false,
				dryRunRender: true,
			});
			expect(preview.record.state).toBe('awaiting_preview_approval');

			// 3. After human approves preview (masterApproved: true) -> completes and exports Phase 7.3 release bundle
			const done = await runRecapProductionOrchestrator({
				runId: 'run-001',
				chapterId: 'fixture-cap-01',
				workTitle: 'Nano Machine',
				panels,
				workspaceDir: dir,
				providers: [{ id: 'claude-gateway', label: 'Claude Gateway', detect: async () => ({ available: true }) }],
				existingScript: script,
				plannerOptions: { isSyntheticFixture: true, approvalStatus: 'technical_fixture_unapproved' },
				masterApproved: true,
				dryRunRender: true,
			});
			expect(done.record.state).toBe('completed');
			expect(done.record.exportBundleDir).toBeDefined();
			const manifestPath = join(done.record.exportBundleDir!, 'project.json');
			expect(existsSync(manifestPath)).toBe(true);
			const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
			expect(manifest.workTitle).toBe('Nano Machine');
			expect(manifest.artifacts.script).toBe('recap-script.json');
			expect(manifest.artifacts.plan).toBe('recap-audiovisual-plan.json');
			expect(manifest.artifacts.captions).toContain('.ass');
			expect(manifest.artifacts.thumbnail).toContain('thumbnail-');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildShotZoompanFilter, resolveMotionVelixKit } from '../../src/recap/phase3/recap-motionvelix.js';
import type { RecapPanelShot, RecapVfxSpec } from '../../src/recap/phase3/recap-audiovisual-types.js';
import {
	deleteRecapProject,
	listRecapProjects,
	loadRecapProjectDetail,
	saveRecapProjectRecord,
} from '../../src/recap/phase5/recap-project-store.js';
import type { RecapOrchestratorRecord } from '../../src/recap/phase5/recap-production-orchestrator.js';

function withTempDir(fn: (root: string) => void): void {
	const dir = mkdtempSync(join(tmpdir(), 'aethera-recap-test-'));
	try {
		fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function makeOrchestratorRecord(overrides: Partial<RecapOrchestratorRecord> = {}): RecapOrchestratorRecord {
	return {
		schemaVersion: 1,
		runId: 'run-default',
		chapterId: 'chapter-01',
		workTitle: 'Obra Teste — Cap. 01',
		state: 'awaiting_preview_approval',
		completedSteps: ['import', 'gate-f', 'vision', 'continuity', 'script', 'humanize', 'motion', 'gate-h'],
		previewMp4Path: '/tmp/preview.mp4',
		masterMp4Path: null,
		updatedAtIso: '2026-11-21T10:00:00.000Z',
		...overrides,
	};
}

test('resolveMotionVelixKit discovers kit from NB_VELIX_DIR/assets/sfx and workspace .agents/skills/motionvelix', () => {
	withTempDir((root) => {
		const fakeHome = join(root, 'home');
		const fakeCwd = join(root, 'workspace');
		mkdirSync(fakeHome, { recursive: true });
		mkdirSync(fakeCwd, { recursive: true });

		// 1. Missing kit reports honest uninstalled status
		const absent = resolveMotionVelixKit({ envVelixDir: '', cwd: fakeCwd, homeDir: fakeHome });
		assert.equal(absent.installed, false);
		assert.equal(absent.availableSfx.length, 0);
		assert.equal(absent.missingSfx.length, 5);

		// 2. Kit installed in NB_VELIX_DIR/assets/sfx with SKILL.md
		const envRoot = join(root, 'motionvelix-kit');
		const envSfx = join(envRoot, 'assets', 'sfx');
		mkdirSync(envSfx, { recursive: true });
		writeFileSync(join(envRoot, 'SKILL.md'), '# MotionVelix', 'utf-8');
		writeFileSync(join(envSfx, 'whoosh.wav'), 'RIFF');
		writeFileSync(join(envSfx, 'impacto.wav'), 'RIFF');
		writeFileSync(join(envSfx, 'riser.wav'), 'RIFF');

		const fromEnv = resolveMotionVelixKit({ envVelixDir: envRoot, cwd: fakeCwd, homeDir: fakeHome });
		assert.equal(fromEnv.installed, true);
		assert.equal(fromEnv.sfxDir, envSfx);
		assert.equal(fromEnv.kitRoot, envRoot);
		assert.equal(fromEnv.hasRemotionKit, true);
		assert.equal(fromEnv.availableSfx.length, 3);
		assert.equal(fromEnv.missingSfx.length, 2);

		// 3. Complete 5/5 kit in workspace .agents/skills/motionvelix/assets/sfx
		const wsSfx = join(fakeCwd, '.agents', 'skills', 'motionvelix', 'assets', 'sfx');
		mkdirSync(wsSfx, { recursive: true });
		for (const file of ['whoosh.wav', 'impacto.wav', 'riser.wav', 'papel.wav', 'brilho.wav']) {
			writeFileSync(join(wsSfx, file), 'RIFF');
		}
		const fromWs = resolveMotionVelixKit({ envVelixDir: '', cwd: fakeCwd, homeDir: fakeHome });
		assert.equal(fromWs.installed, true);
		assert.equal(fromWs.sfxDir, wsSfx);
		assert.equal(fromWs.availableSfx.length, 5);
		assert.equal(fromWs.missingSfx.length, 0);
	});
});

test('buildShotZoompanFilter honors X-axis motion, VFX contrast/vignette/shake, balloon protection, and transitions', () => {
	const baseShot: RecapPanelShot = {
		shotId: 'shot-1',
		sceneId: 'scene-1',
		sceneIndex: 0,
		panelId: 'p1',
		pageNumber: 1,
		imagePath: '/tmp/panel1.png',
		startMs: 0,
		endMs: 3000,
		durationMs: 3000,
		motionStyle: 'pan_left_to_right',
		focalStart: { x: 0.25, y: 0.5, zoom: 1.0 },
		focalEnd: { x: 0.75, y: 0.5, zoom: 1.12 },
		transitionIn: 'dip_black',
		balloonSafeZoneProtected: false,
		framingCropRisk: { atRisk: false },
	};

	const vfx: RecapVfxSpec = {
		sceneId: 'scene-1',
		vignetteStrength: 0.28,
		contrastBoost: 1.14,
		shakeIntensity: 0.5,
		balloonSafe: false,
	};

	const filterWithVfx = buildShotZoompanFilter(baseShot, 1280, 720, 24, vfx);
	// Must interpolate X focal point (0.25 -> 0.75), not hardcode center
	assert.match(filterWithVfx, /0\.250\+\(0\.500\)\*/);
	// Must apply contrast, vignette, shake (since not balloon-protected), and dip_black fade
	assert.match(filterWithVfx, /eq=contrast=1\.14/);
	assert.match(filterWithVfx, /vignette=angle=/);
	assert.match(filterWithVfx, /sin\(on\*1\.9\)/);
	assert.match(filterWithVfx, /fade=t=in:st=0:d=0\.28:color=black/);

	// When balloonSafeZoneProtected is true, shake must NOT be applied
	const safeShot: RecapPanelShot = {
		...baseShot,
		balloonSafeZoneProtected: true,
		transitionIn: 'flash_white',
	};
	const filterBalloonSafe = buildShotZoompanFilter(safeShot, 1280, 720, 24, vfx);
	assert.doesNotMatch(filterBalloonSafe, /sin\(on\*1\.9\)/);
	assert.match(filterBalloonSafe, /fade=t=in:st=0:d=0\.16:color=white/);
});

test('project store persists multiple projects without overwriting, discovers legacy records, and restores detail artifacts', () => {
	withTempDir((root) => {
		const workspaceDir = join(root, 'recap-workspace');
		const legacyCheckpointsRoot = join(root, 'recap-checkpoints');

		const rec1 = makeOrchestratorRecord({
			runId: 'run-001',
			chapterId: 'ch-01',
			workTitle: 'Capítulo 01',
			updatedAtIso: '2026-11-20T10:00:00.000Z',
		});
		const rec2 = makeOrchestratorRecord({
			runId: 'run-002',
			chapterId: 'ch-02',
			workTitle: 'Capítulo 02 (Mais Recente)',
			state: 'completed',
			masterMp4Path: '/tmp/master2.mp4',
			updatedAtIso: '2026-11-21T11:30:00.000Z',
		});

		saveRecapProjectRecord(workspaceDir, rec1, {
			script: {
				chapterId: 'ch-01',
				title: 'Capítulo 01',
				style: 'empolgado',
				totalEstimatedDurationSec: 30,
				scenes: [
					{
						sceneId: 'scene-1',
						narrationText: 'O herói desperta na masmorra dupla.',
						characters: ['Jinwoo'],
						eventDescription: 'Despertar',
						panelIds: ['p1'],
						estimatedDurationSec: 6,
						emotion: 'tension',
						narrativeIntent: 'hook',
						confidence: 0.95,
						reviewStatus: 'ok',
					},
				],
			},
			gateHReport: {
				gate: 'H',
				verdict: 'pass',
				checkedAtIso: '2026-11-20T10:00:00.000Z',
				reasons: [],
				metrics: { audioClipped: false, sfxPlanned: 2, sfxApplied: 2 },
				findings: [],
			},
		});
		saveRecapProjectRecord(workspaceDir, rec2);

		// Legacy checkpoint record in old recap-checkpoints directory
		const legacyDir = join(legacyCheckpointsRoot, 'ch-legacy');
		mkdirSync(legacyDir, { recursive: true });
		writeFileSync(
			join(legacyDir, 'recap-orchestrator-state.json'),
			JSON.stringify(
				makeOrchestratorRecord({
					runId: 'run-legacy',
					chapterId: 'ch-legacy',
					workTitle: 'Projeto Legado',
					updatedAtIso: '2026-11-19T08:00:00.000Z',
				}),
			),
			'utf-8',
		);

		const list = listRecapProjects(workspaceDir, legacyCheckpointsRoot);
		assert.equal(list.length, 3);
		assert.equal(list[0]?.runId, 'run-002');
		assert.equal(list[1]?.runId, 'run-001');
		assert.equal(list[2]?.runId, 'run-legacy');

		const detail = loadRecapProjectDetail(workspaceDir, 'run-001', legacyCheckpointsRoot);
		assert.ok(detail);
		assert.equal(detail.record.workTitle, 'Capítulo 01');
		assert.equal(detail.script?.scenes.length, 1);
		assert.equal(detail.script?.scenes[0]?.narrationText, 'O herói desperta na masmorra dupla.');
		assert.equal(detail.gateHReport?.verdict, 'pass');
	});
});

test('deleteRecapProject removes target safely, protects shared chapter caches, repoints legacy mirror, and blocks path traversal', () => {
	withTempDir((root) => {
		const workspaceDir = join(root, 'recap-workspace');
		const legacyCheckpointsRoot = join(root, 'recap-checkpoints');

		// Two projects sharing chapterId `ch-shared`
		const pA = makeOrchestratorRecord({
			runId: 'run-a',
			chapterId: 'ch-shared',
			workTitle: 'Run A',
			updatedAtIso: '2026-11-21T09:00:00.000Z',
		});
		const pB = makeOrchestratorRecord({
			runId: 'run-b',
			chapterId: 'ch-shared',
			workTitle: 'Run B',
			updatedAtIso: '2026-11-21T10:00:00.000Z',
		});
		saveRecapProjectRecord(workspaceDir, pA);
		saveRecapProjectRecord(workspaceDir, pB);

		const sharedRenderDir = join(workspaceDir, 'render', 'ch-shared');
		mkdirSync(sharedRenderDir, { recursive: true });
		writeFileSync(join(sharedRenderDir, 'preview.mp4'), 'video');

		// Reject path traversal
		const bad = deleteRecapProject(workspaceDir, '../outside', legacyCheckpointsRoot);
		assert.equal(bad.ok, false);

		// Delete Run B (newest, which is also mirrored in state/recap-orchestrator-state.json)
		const delB = deleteRecapProject(workspaceDir, 'run-b', legacyCheckpointsRoot);
		assert.equal(delB.ok, true);
		assert.equal(delB.deleted, 'run-b');
		// Shared chapter render dir MUST remain because Run A still references ch-shared
		assert.equal(existsSync(sharedRenderDir), true);

		const afterFirstDelete = listRecapProjects(workspaceDir, legacyCheckpointsRoot);
		assert.equal(afterFirstDelete.length, 1);
		assert.equal(afterFirstDelete[0]?.runId, 'run-a');

		// Now delete Run A — no project references ch-shared anymore, so sharedRenderDir is cleaned up
		const delA = deleteRecapProject(workspaceDir, 'run-a', legacyCheckpointsRoot);
		assert.equal(delA.ok, true);
		assert.equal(existsSync(sharedRenderDir), false);
		assert.equal(listRecapProjects(workspaceDir, legacyCheckpointsRoot).length, 0);
	});
});

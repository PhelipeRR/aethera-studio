import { describe, expect, it, vi } from 'vitest';
import type { AgentAdapter, AgentStatus } from '@neuralbridge/agents';
import type { VideoResearchRun } from '@neuralbridge/orchestrator/video-research';
import type { VelixReference } from '@neuralbridge/workspace';
import { runContextualResearch, type ContextualResearchOptions } from '../src/recap/contextual-research.js';

// ─── Test Fixtures ───────────────────────────────────────────────────────────

function makeAdapter(overrides: Partial<AgentStatus> = {}): AgentAdapter {
	return {
 id: 'test-agent',
 label: 'Test Agent',
 async detect() {
 return {
 installed: overrides.installed ?? true,
 authenticated: overrides.authenticated ?? true,
 version: overrides.version ?? '1.0.0',
 problems: overrides.problems ?? [],
 };
 },
 async run() {
 throw new Error('Not implemented — use mock');
 },
	};
}

function makeOptions(overrides: Partial<ContextualResearchOptions> = {}): ContextualResearchOptions {
	return {
 enabled: true,
 workTitle: 'One Piece',
 currentChapter: 100,
 maxAllowedChapter: 100,
 allowTheories: false,
 extraTerms: ['Luffy'],
 cwd: '/tmp/test-workspace',
 ...overrides,
	};
}

function makeReference(overrides: Partial<VelixReference> = {}): VelixReference {
	return {
 kind: 'texto',
 title: 'Referência de teste',
 url: 'https://example.com/test',
 license: 'citação',
 note: 'Informação confirmada sobre o capítulo 50.',
 ...overrides,
	};
}

function makeVideoResearchRun(references: VelixReference[], rejected = 0): VideoResearchRun {
	return {
 references,
 rejected,
 generation: {
 executionId: 'exec-test-123',
 model: 'test-model-v1',
 tokensUsed: 1000,
 costUsd: 0.01,
 startedAt: new Date().toISOString(),
 finishedAt: new Date().toISOString(),
 },
	};
}

// Mock the orchestrator module
vi.mock('@neuralbridge/orchestrator/video-research', () => ({
	runVideoResearch: vi.fn(),
}));

import { runVideoResearch } from '@neuralbridge/orchestrator/video-research';
const mockRunVideoResearch = vi.mocked(runVideoResearch);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Contextual Research / YouTube Agent — Phase 2.2.2-B', () => {
	beforeEach(() => {
 mockRunVideoResearch.mockReset();
	});

	it('returns empty result when disabled', async () => {
 const adapter = makeAdapter();
 const options = makeOptions({ enabled: false });

 const result = await runContextualResearch({ adapter, options });

 expect(result.skipped).toBe(true);
 expect(result.accepted).toHaveLength(0);
 expect(result.rejected).toHaveLength(0);
 expect(result.agentId).toBe('none');
 expect(result.warnings.some((w) => w.includes('disabled'))).toBe(true);
 expect(mockRunVideoResearch).not.toHaveBeenCalled();
	});

	it('skips when adapter is not installed', async () => {
 const adapter = makeAdapter({ installed: false, problems: ['CLI not found'] });
 const options = makeOptions();

 const result = await runContextualResearch({ adapter, options });

 expect(result.skipped).toBe(true);
 expect(result.warnings.some((w) => w.includes('not installed'))).toBe(true);
 expect(mockRunVideoResearch).not.toHaveBeenCalled();
	});

	it('skips when adapter is not authenticated', async () => {
 const adapter = makeAdapter({ authenticated: false, problems: ['Not logged in'] });
 const options = makeOptions();

 const result = await runContextualResearch({ adapter, options });

 expect(result.skipped).toBe(true);
 expect(result.warnings.some((w) => w.includes('not authenticated'))).toBe(true);
	});

	it('accepts valid references within chapter limit', async () => {
 const adapter = makeAdapter();
 const options = makeOptions({ currentChapter: 100, maxAllowedChapter: 100 });
 const refs: VelixReference[] = [
 makeReference({ title: 'Luffy vs Kaido', note: 'Batalha no capítulo 98.' }),
 makeReference({ title: 'Gear Fifth', note: 'Transformação revelada no capítulo 1044.', kind: 'imagem' }),
 ];
 mockRunVideoResearch.mockResolvedValue(makeVideoResearchRun(refs));

 const result = await runContextualResearch({ adapter, options });

 // Chapter 98 is within limit (100), so accepted
 // Chapter 1044 exceeds limit, so rejected
 expect(result.skipped).toBe(false);
 expect(result.accepted).toHaveLength(1);
 expect(result.accepted[0]!.title).toBe('Luffy vs Kaido');
 expect(result.rejected).toHaveLength(1);
 expect(result.rejected[0]!.rejectionReason).toContain('chapter 1044');
 expect(result.totalRaw).toBe(2);
	});

	it('rejects references with spoiler indicators', async () => {
 const adapter = makeAdapter();
 const options = makeOptions();
 const refs: VelixReference[] = [
 makeReference({ title: 'Morte do Ace - Spoiler', note: 'Revelação do desfecho.' }),
 makeReference({ title: 'Análise do arco Wano', note: 'Discussão sobre o capítulo 100.' }),
 ];
 mockRunVideoResearch.mockResolvedValue(makeVideoResearchRun(refs));

 const result = await runContextualResearch({ adapter, options });

 expect(result.rejected).toHaveLength(1);
 expect(result.rejected[0]!.title).toContain('Morte do Ace');
 expect(result.rejected[0]!.rejectionReason).toContain('spoiler');
 expect(result.accepted).toHaveLength(1);
	});

	it('rejects theories when allowTheories is false', async () => {
 const adapter = makeAdapter();
 const options = makeOptions({ allowTheories: false });
 const refs: VelixReference[] = [
 makeReference({ title: 'Teoria: Luffy é filho de Dragon', note: 'Especulação baseada em pistas.' }),
 makeReference({ title: 'Fato confirmado: Luffy é capitão', note: 'Confirmado no capítulo 1.' }),
 ];
 mockRunVideoResearch.mockResolvedValue(makeVideoResearchRun(refs));

 const result = await runContextualResearch({ adapter, options });

 expect(result.rejected).toHaveLength(1);
 expect(result.rejected[0]!.title).toContain('Teoria');
 expect(result.rejected[0]!.rejectionReason).toContain('theory');
 expect(result.accepted).toHaveLength(1);
 expect(result.accepted[0]!.confidenceTag).toBe('confirmed_fact');
	});

	it('accepts theories when allowTheories is true', async () => {
 const adapter = makeAdapter();
 const options = makeOptions({ allowTheories: true });
 const refs: VelixReference[] = [
 makeReference({ title: 'Teoria: One Piece é um planeta', note: 'Hipótese discutida pela comunidade.' }),
 ];
 mockRunVideoResearch.mockResolvedValue(makeVideoResearchRun(refs));

 const result = await runContextualResearch({ adapter, options });

 expect(result.accepted).toHaveLength(1);
 expect(result.accepted[0]!.confidenceTag).toBe('theory');
	});

	it('classifies official sources correctly', async () => {
 const adapter = makeAdapter();
 const options = makeOptions();
 const refs: VelixReference[] = [
 makeReference({ url: 'https://myanimelist.net/anime/21/One_Piece', note: 'Dados oficiais da obra.' }),
 makeReference({ url: 'https://en.wikipedia.org/wiki/One_Piece', note: 'Artigo enciclopédico.' }),
 ];
 mockRunVideoResearch.mockResolvedValue(makeVideoResearchRun(refs));

 const result = await runContextualResearch({ adapter, options });

 expect(result.accepted).toHaveLength(2);
 expect(result.accepted[0]!.confidenceTag).toBe('official_source');
 expect(result.accepted[1]!.confidenceTag).toBe('official_source');
	});

	it('handles research failure gracefully', async () => {
 const adapter = makeAdapter();
 const options = makeOptions();
 mockRunVideoResearch.mockRejectedValue(new Error('Network timeout'));

 const result = await runContextualResearch({ adapter, options });

 expect(result.skipped).toBe(true);
 expect(result.accepted).toHaveLength(0);
 expect(result.warnings.some((w) => w.includes('failed'))).toBe(true);
 expect(result.warnings.some((w) => w.includes('panel-only'))).toBe(true);
	});

	it('preserves URLs and licenses from original references', async () => {
 const adapter = makeAdapter();
 const options = makeOptions();
 const refs: VelixReference[] = [
 makeReference({
 url: 'https://wikimedia.org/image.png',
 license: 'CC BY-SA 4.0',
 note: 'Imagem oficial.',
 kind: 'imagem',
 }),
 ];
 mockRunVideoResearch.mockResolvedValue(makeVideoResearchRun(refs));

 const result = await runContextualResearch({ adapter, options });

 expect(result.accepted).toHaveLength(1);
 expect(result.accepted[0]!.url).toBe('https://wikimedia.org/image.png');
 expect(result.accepted[0]!.license).toBe('CC BY-SA 4.0');
	});

	it('records agent and model telemetry', async () => {
 const adapter = makeAdapter({ id: 'claude' });
 const options = makeOptions();
 mockRunVideoResearch.mockResolvedValue(makeVideoResearchRun([makeReference()]));

 const result = await runContextualResearch({ adapter, options });

 expect(result.agentId).toBe('claude');
 expect(result.model).toBe('test-model-v1');
 expect(result.executionId).toBe('exec-test-123');
	});

	it('respects abort signal', async () => {
 const adapter = makeAdapter();
 const controller = new AbortController();
 const options = makeOptions({ signal: controller.signal });
 mockRunVideoResearch.mockImplementation(async () => {
 controller.abort();
 throw new Error('Aborted');
 });

 const result = await runContextualResearch({ adapter, options });

 expect(result.skipped).toBe(true);
 expect(result.warnings.some((w) => w.includes('failed') || w.includes('Aborted'))).toBe(true);
	});

	it('uses extra terms in search topic', async () => {
 const adapter = makeAdapter();
 const options = makeOptions({ workTitle: 'Naruto', currentChapter: 50, extraTerms: ['Sasuke', 'Sharingan'] });
 mockRunVideoResearch.mockResolvedValue(makeVideoResearchRun([]));

 await runContextualResearch({ adapter, options });

 expect(mockRunVideoResearch).toHaveBeenCalledWith(
 adapter,
 expect.stringContaining('Naruto'),
 expect.stringContaining('capítulo 50'),
 expect.anything(),
 );
	});

	it('does not replace panel evidence with external references', async () => {
 // This test validates that the research module only returns references;
 // it does NOT modify panels or script structure.
 const adapter = makeAdapter();
 const options = makeOptions();
 const refs: VelixReference[] = [
 makeReference({ title: 'Contexto externo', note: 'Informação complementar.' }),
 ];
 mockRunVideoResearch.mockResolvedValue(makeVideoResearchRun(refs));

 const result = await runContextualResearch({ adapter, options });

 // Result contains only references, no panel modifications
 expect(result.accepted).toHaveLength(1);
 expect(result.accepted[0]).not.toHaveProperty('panelId');
 expect(result.accepted[0]).not.toHaveProperty('croppedImagePath');
	});
});
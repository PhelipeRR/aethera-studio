import { describe, expect, it, beforeEach } from 'vitest';
import type {
	ContextualResearchOptions,
	RawResearchReference,
	ResearchPort,
	ResearchPortRequest,
	ResearchPortResult,
} from '../src/recap/contextual-research.js';
import { runContextualResearch } from '../src/recap/contextual-research.js';

// ─── Test Fixtures ───────────────────────────────────────────────────────────

function makeOptions(overrides: Partial<ContextualResearchOptions> = {}): ContextualResearchOptions {
	return {
		enabled: true,
		workTitle: 'One Piece',
		currentChapter: 100,
		maxAllowedChapter: 100,
		allowTheories: false,
		extraTerms: ['Luffy'],
		...overrides,
	};
}

function makeReference(overrides: Partial<RawResearchReference> = {}): RawResearchReference {
	return {
		kind: 'texto',
		title: 'Referência de teste',
		url: 'https://example.com/test',
		license: 'citação',
		note: 'Informação confirmada sobre o capítulo 50.',
		...overrides,
	};
}

function createMockPort(
	responses?: ResearchPortResult | ((req: ResearchPortRequest) => ResearchPortResult),
): ResearchPort & { calls: ResearchPortRequest[] } {
	const calls: ResearchPortRequest[] = [];
	return {
		name: 'mock-research-port',
		calls,
		async research(input: ResearchPortRequest): Promise<ResearchPortResult> {
			calls.push(input);
			if (typeof responses === 'function') return responses(input);
			if (responses) return responses;
			return {
				references: [makeReference()],
				rejectedCount: 0,
				agentId: 'mock-agent',
				model: 'mock-model-v1',
				executionId: 'exec-mock-001',
				ok: true,
			};
		},
	};
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Contextual Research / YouTube Agent — Phase 2.2.2-B', () => {
	it('returns empty result when disabled', async () => {
		const port = createMockPort();
		const options = makeOptions({ enabled: false });

		const result = await runContextualResearch({ port, options });

		expect(result.skipped).toBe(true);
		expect(result.accepted).toHaveLength(0);
		expect(result.rejected).toHaveLength(0);
		expect(result.agentId).toBe('none');
		expect(result.warnings.some((w) => w.includes('disabled'))).toBe(true);
		expect(port.calls).toHaveLength(0);
	});

	it('accepts valid references within chapter limit', async () => {
		const refs: RawResearchReference[] = [
			makeReference({ title: 'Luffy vs Kaido', note: 'Batalha no capítulo 98.' }),
			// Avoid spoiler keywords like "revelada" to test temporal filter specifically
			makeReference({ title: 'Gear Fifth Design', note: 'Arte conceitual do capítulo 1044.', kind: 'imagem' }),
		];
		const port = createMockPort({ references: refs, rejectedCount: 0, agentId: 'mock-agent', model: 'mock-model-v1', ok: true });
		const options = makeOptions({ currentChapter: 100, maxAllowedChapter: 100 });

		const result = await runContextualResearch({ port, options });

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
		const refs: RawResearchReference[] = [
			makeReference({ title: 'Morte do Ace - Spoiler', note: 'Revelação do desfecho.' }),
			makeReference({ title: 'Análise do arco Wano', note: 'Discussão sobre o capítulo 100.' }),
		];
		const port = createMockPort({ references: refs, rejectedCount: 0, agentId: 'mock-agent', model: 'mock-model-v1', ok: true });
		const options = makeOptions();

		const result = await runContextualResearch({ port, options });

		expect(result.rejected).toHaveLength(1);
		expect(result.rejected[0]!.title).toContain('Morte do Ace');
		expect(result.rejected[0]!.rejectionReason).toContain('spoiler');
		expect(result.accepted).toHaveLength(1);
	});

	it('rejects theories when allowTheories is false', async () => {
		const refs: RawResearchReference[] = [
			makeReference({ title: 'Teoria: Luffy é filho de Dragon', note: 'Especulação baseada em pistas.' }),
			makeReference({ title: 'Fato confirmado: Luffy é capitão', note: 'Confirmado no capítulo 1.' }),
		];
		const port = createMockPort({ references: refs, rejectedCount: 0, agentId: 'mock-agent', model: 'mock-model-v1', ok: true });
		const options = makeOptions({ allowTheories: false });

		const result = await runContextualResearch({ port, options });

		expect(result.rejected).toHaveLength(1);
		expect(result.rejected[0]!.title).toContain('Teoria');
		// When allowTheories=false, classifyConfidence returns 'unverified' for theories
		expect(result.rejected[0]!.rejectionReason).toContain('unverified');
		expect(result.accepted).toHaveLength(1);
		expect(result.accepted[0]!.confidenceTag).toBe('confirmed_fact');
	});

	it('accepts theories when allowTheories is true', async () => {
		const refs: RawResearchReference[] = [
			makeReference({ title: 'Teoria: One Piece é um planeta', note: 'Hipótese discutida pela comunidade.' }),
		];
		const port = createMockPort({ references: refs, rejectedCount: 0, agentId: 'mock-agent', model: 'mock-model-v1', ok: true });
		const options = makeOptions({ allowTheories: true });

		const result = await runContextualResearch({ port, options });

		expect(result.accepted).toHaveLength(1);
		expect(result.accepted[0]!.confidenceTag).toBe('theory');
	});

	it('classifies official sources correctly', async () => {
		const refs: RawResearchReference[] = [
			makeReference({ url: 'https://myanimelist.net/anime/21/One_Piece', note: 'Dados oficiais da obra.' }),
			makeReference({ url: 'https://en.wikipedia.org/wiki/One_Piece', note: 'Artigo enciclopédico.' }),
		];
		const port = createMockPort({ references: refs, rejectedCount: 0, agentId: 'mock-agent', model: 'mock-model-v1', ok: true });
		const options = makeOptions();

		const result = await runContextualResearch({ port, options });

		expect(result.accepted).toHaveLength(2);
		expect(result.accepted[0]!.confidenceTag).toBe('official_source');
		expect(result.accepted[1]!.confidenceTag).toBe('official_source');
	});

	it('handles research failure gracefully', async () => {
		const port = createMockPort({ references: [], rejectedCount: 0, agentId: 'mock-agent', model: null, ok: false, error: 'Network timeout' });
		const options = makeOptions();

		const result = await runContextualResearch({ port, options });

		expect(result.skipped).toBe(true);
		expect(result.accepted).toHaveLength(0);
		expect(result.warnings.some((w) => w.includes('failed'))).toBe(true);
		expect(result.warnings.some((w) => w.includes('panel-only'))).toBe(true);
	});

	it('handles unexpected errors gracefully', async () => {
		const port: ResearchPort = {
			name: 'error-port',
			async research() { throw new Error('Unexpected crash'); },
		};
		const options = makeOptions();

		const result = await runContextualResearch({ port, options });

		expect(result.skipped).toBe(true);
		expect(result.accepted).toHaveLength(0);
		expect(result.warnings.some((w) => w.includes('Unexpected crash'))).toBe(true);
	});

	it('preserves URLs and licenses from original references', async () => {
		const refs: RawResearchReference[] = [
			makeReference({
				url: 'https://wikimedia.org/image.png',
				license: 'CC BY-SA 4.0',
				note: 'Imagem oficial.',
				kind: 'imagem',
			}),
		];
		const port = createMockPort({ references: refs, rejectedCount: 0, agentId: 'mock-agent', model: 'mock-model-v1', ok: true });
		const options = makeOptions();

		const result = await runContextualResearch({ port, options });

		expect(result.accepted).toHaveLength(1);
		expect(result.accepted[0]!.url).toBe('https://wikimedia.org/image.png');
		expect(result.accepted[0]!.license).toBe('CC BY-SA 4.0');
	});

	it('records agent and model telemetry', async () => {
		const port = createMockPort({ references: [makeReference()], rejectedCount: 0, agentId: 'claude', model: 'opus-5-5', executionId: 'exec-real-123', ok: true });
		const options = makeOptions();

		const result = await runContextualResearch({ port, options });

		expect(result.agentId).toBe('claude');
		expect(result.model).toBe('opus-5-5');
		expect(result.executionId).toBe('exec-real-123');
	});

	it('respects abort signal', async () => {
		const controller = new AbortController();
		const port: ResearchPort = {
			name: 'abort-port',
			async research() {
				controller.abort();
				throw new Error('Aborted');
			},
		};
		const options = makeOptions({ signal: controller.signal });

		const result = await runContextualResearch({ port, options });

		expect(result.skipped).toBe(true);
		expect(result.warnings.some((w) => w.includes('Aborted'))).toBe(true);
	});

	it('uses extra terms in search topic', async () => {
		const port = createMockPort();
		const options = makeOptions({ workTitle: 'Naruto', currentChapter: 50, extraTerms: ['Sasuke', 'Sharingan'] });

		await runContextualResearch({ port, options });

		expect(port.calls).toHaveLength(1);
		expect(port.calls[0]!.topic).toContain('Naruto');
		expect(port.calls[0]!.topic).toContain('capítulo 50');
		expect(port.calls[0]!.topic).toContain('Sasuke');
		expect(port.calls[0]!.topic).toContain('Sharingan');
	});

	it('does not replace panel evidence with external references', async () => {
		// This test validates that the research module only returns references;
		// it does NOT modify panels or script structure.
		const refs: RawResearchReference[] = [
			makeReference({ title: 'Contexto externo', note: 'Informação complementar.' }),
		];
		const port = createMockPort({ references: refs, rejectedCount: 0, agentId: 'mock-agent', model: 'mock-model-v1', ok: true });
		const options = makeOptions();

		const result = await runContextualResearch({ port, options });

		// Result contains only references, no panel modifications
		expect(result.accepted).toHaveLength(1);
		expect(result.accepted[0]).not.toHaveProperty('panelId');
		expect(result.accepted[0]).not.toHaveProperty('croppedImagePath');
	});

	it('works with a single agent available', async () => {
		const port: ResearchPort = {
			name: 'single-agent-port',
			async research() {
				return {
					references: [makeReference({ title: 'Info oficial', note: 'Confirmado.' })],
					rejectedCount: 0,
					agentId: 'only-agent',
					model: 'only-model',
					ok: true,
				};
			},
		};
		const options = makeOptions();

		const result = await runContextualResearch({ port, options });

		expect(result.skipped).toBe(false);
		expect(result.agentId).toBe('only-agent');
		expect(result.accepted).toHaveLength(1);
	});

	it('returns empty accepted list when all references are filtered out', async () => {
		const refs: RawResearchReference[] = [
			makeReference({ title: 'Spoiler do final', note: 'Revela o desfecho do capítulo 200.' }),
			makeReference({ title: 'Teoria não confirmada', note: 'Especulação sem base.' }),
		];
		const port = createMockPort({ references: refs, rejectedCount: 0, agentId: 'mock-agent', model: 'mock-model-v1', ok: true });
		const options = makeOptions({ allowTheories: false, maxAllowedChapter: 100 });

		const result = await runContextualResearch({ port, options });

		expect(result.accepted).toHaveLength(0);
		expect(result.rejected).toHaveLength(2);
		expect(result.skipped).toBe(false);
	});
});
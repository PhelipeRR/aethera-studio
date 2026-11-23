/**
 * The Claude vision provider must not claim a model it never asked for: without an explicit model
 * the CLI runs the account's default, and the UI should show what the CLI reports it ran.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createClaudeVisionProvider, ensureVisionHealthProbeImage } from '../../src/recap/index.js';
import type { ClaudeVisionProviderOptions } from '../../src/recap/claude-vision-provider.js';

function adapter(seen: { model?: string | undefined }): ClaudeVisionProviderOptions['adapter'] {
	return {
		id: 'claude',
		detect: async () => ({ installed: true, authenticated: true, problems: [] }) as never,
		run: async function* (req: { model?: string }) {
			seen.model = req.model;
			yield { kind: 'session' as const, sessionId: 's1', model: 'claude-opus-5-5' };
			yield { kind: 'result' as const, ok: true, text: JSON.stringify({ nature: 'dialogue', description: 'Dois personagens conversam.', confidence: 0.8 }) };
			yield { kind: 'done' as const, ok: true, exitCode: 0 };
		},
	} as unknown as ClaudeVisionProviderOptions['adapter'];
}

describe('createClaudeVisionProvider model reporting', () => {
	it('passes no model by default and reports the model the CLI actually ran', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'claude-vision-model-'));
		try {
			const seen: { model?: string | undefined } = {};
			const provider = createClaudeVisionProvider({ adapter: adapter(seen), cwd: dir });
			expect(provider.model).toBe('claude-cli-default');
			expect(provider.model).not.toMatch(/sonnet/);
			expect(provider.lastReportedModel?.()).toBeNull();
			await provider.analyze!({ frames: [{ hash: 'h', path: ensureVisionHealthProbeImage(dir) }] });
			expect(seen.model).toBeUndefined();
			expect(provider.lastReportedModel?.()).toBe('claude-opus-5-5');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('forwards an explicit model (Claude Gateway) to the CLI', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'claude-vision-model-'));
		try {
			const seen: { model?: string | undefined } = {};
			const provider = createClaudeVisionProvider({ adapter: adapter(seen), cwd: dir, providerId: 'claude-gateway', model: 'claude-opus-5-5' });
			expect(provider.model).toBe('claude-opus-5-5');
			await provider.analyze!({ frames: [{ hash: 'h', path: ensureVisionHealthProbeImage(dir) }] });
			expect(seen.model).toBe('claude-opus-5-5');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

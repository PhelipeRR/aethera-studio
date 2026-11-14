import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCliAdapter, CodexCliAdapter, type AgentAdapter } from '@neuralbridge/agents';
import { generateVideoIdeas, generateVideoScript, runVideoResearch, suggestMotionScenes } from '@neuralbridge/orchestrator';
import { describe, expect, it } from 'vitest';

// One real read-only script per provider, to prove the version keeps what the provider itself reported.
// NB_REAL_AGENT narrows it to one CLI, since the Velix page refuses Claude near its weekly limit.
const enabled = process.env['NB_REAL_CLI'] === '1';
const only = process.env['NB_REAL_AGENT'];
const adapters: [string, () => AgentAdapter][] = [
  ['claude', () => new ClaudeCliAdapter()],
  ['codex', () => new CodexCliAdapter()],
];

describe.skipIf(!enabled)('Velix script with the real CLIs', () => {
  for (const [name, create] of adapters.filter(([id]) => !only || id === only)) {
    it(`${name}: reports the provider, model and execution`, { timeout: 300_000 }, async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'nb-velix-script-'));
      const script = await generateVideoScript([create()], { brief: 'Vídeo curto sobre por que o céu é azul.', seconds: 15, images: [], sources: '' }, cwd);
      console.log(`provider metadata: ${JSON.stringify(script.generation)}`);
      expect(script.narration.length).toBeGreaterThan(0);
      expect(script.data.cenas.length).toBeGreaterThan(0);
      expect(script.generation).toMatchObject({ agent: name, executionId: expect.any(String), generatedAt: expect.any(String) });
    });

    it(`${name}: research reports real web use and https sources`, { timeout: 300_000 }, async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'nb-velix-research-'));
      const run = await runVideoResearch(create(), 'por que o céu é azul', cwd);
      console.log(`provider metadata: ${JSON.stringify(run.generation)} references=${run.references.length} rejected=${run.rejected}`);
      expect(run.references.every((item) => item.url.startsWith('https://'))).toBe(true);
      expect(run.generation.agent).toBe(name);
    });

    it(`${name}: cancelling stops a structured run without an answer`, { timeout: 120_000 }, async () => {
      const controller = new AbortController();
      const cwd = mkdtempSync(join(tmpdir(), 'nb-velix-cancel-'));
      const request = { niche: 'ciência', mode: 'generate' as const, references: [], avoidTitles: [] };
      setTimeout(() => controller.abort(), 1_500);
      await expect(generateVideoIdeas(create(), request, cwd, controller.signal)).rejects.toMatchObject({ code: 'cancelled', agent: name });
    });

    it(`${name}: suggests a composition inside the contract`, { timeout: 300_000 }, async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'nb-velix-motion-'));
      const result = await suggestMotionScenes(create(), { script: 'O céu é azul porque a atmosfera espalha mais a luz de onda curta.', fps: 30 }, cwd);
      console.log(`provider metadata: ${JSON.stringify(result.generation)} scenes=${result.scenes.length}`);
      expect(result.scenes.length).toBeGreaterThan(0);
    });

    it(`${name}: proposes ideas grounded in the given references`, { timeout: 300_000 }, async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'nb-velix-ideas-'));
      const reference = { title: 'Rayleigh scattering', url: 'https://en.wikipedia.org/wiki/Rayleigh_scattering', publisher: 'Wikipedia', publishedAt: null };
      const { ideas, generation } = await generateVideoIdeas(create(), { niche: 'ciência do cotidiano', mode: 'generate', references: [reference], avoidTitles: [] }, cwd);
      console.log(`provider metadata: ${JSON.stringify(generation)} ideas=${ideas.length}`);
      expect(ideas.length).toBeGreaterThan(0);
      expect(ideas.flatMap((idea) => idea.referenceUrls).every((url) => url === reference.url)).toBe(true);
      expect(generation.agent).toBe(name);
    });
  }
});

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProductionConsoleService } from '../src/main/production-console.js';
import { PRODUCTION_AGENT_PROVIDERS, runProductionAgentCommand } from '../src/main/production-agent-providers.js';

const enabled = process.env['AETHERA_CONSOLE_REAL'] === '1';

/** Same prompt shape the studio sends for research, used only to measure real latency of the CLI providers. */
function researchPrompt(workTitle: string, theme: string): string {
  return [
    'Você é o Pesquisador Editorial Factual do Aethera Studio.',
    `Produza um dossiê estruturado sobre a obra "${workTitle}" para o tema "${theme}".`,
    'Identifique exatamente 3 entidades distintas ranqueadas pelos critérios: dificuldade; punitividade.',
    'Para cada entidade, liste fatos verificáveis, mecânicas/acontecimentos principais, padrões de ataque ou fases, consenso da comunidade e incertezas explícitas (diferencie fatos de opiniões; nunca invente fatos).',
    'Responda SOMENTE com JSON válido no formato:',
    '{"workTitle":"...","theme":"...","rankingCriteria":["..."],"entities":[{"entityName":"...","workTitle":"...","role":"...","rankPosition":1,"verifiedFacts":["..."],"mechanicsOrEvents":["..."],"attackPatternsOrPhases":["..."],"communityConsensus":"...","uncertainties":["..."],"sources":[{"title":"...","kind":"community"}]}],"uncertainties":["..."],"sourcesUsed":["..."]}',
  ].join('\n');
}

/**
 * Opt-in probe: measures how long each installed CLI really takes on the studio's research prompt, which is the
 * number that decides whether the 90 s research cap holds. Run with AETHERA_CONSOLE_REAL=1.
 */
describe.runIf(enabled)('latência real da pesquisa por provedor', () => {
  it('mede o tempo de cada CLI com o prompt de pesquisa completo', async () => {
    const outDir = join(process.cwd(), 'artifacts', 'aethera-console', `latency-${Date.now()}`);
    mkdirSync(outDir, { recursive: true });
    const service = new ProductionConsoleService({ logsDir: join(outDir, 'logs') });
    const results: Array<{ provider: string; ok: boolean; durationMs: number; failureReason?: string; textChars: number; jsonParsed: boolean }> = [];

    for (const provider of PRODUCTION_AGENT_PROVIDERS) {
      if (!provider.locate()) continue;
      const outcome = await runProductionAgentCommand(provider, {
        console: service,
        projectId: 'latency_probe',
        jobId: 'latency_probe',
        runId: `latency_${provider.id}`,
        stage: 'pesquisa',
        label: 'Sonda de latência',
        prompt: researchPrompt('Elden Ring', 'chefes mais difíceis'),
        timeoutMs: 300_000,
      });
      const jsonParsed = (() => {
        try {
          JSON.parse(/[[{][\s\S]*[}\]]/.exec(outcome.text)?.[0] ?? 'null');
          return true;
        } catch {
          return false;
        }
      })();
      results.push({
        provider: provider.id,
        ok: outcome.ok,
        durationMs: outcome.durationMs,
        ...(outcome.failureReason ? { failureReason: outcome.failureReason } : {}),
        textChars: outcome.text.length,
        jsonParsed,
      });
      writeFileSync(join(outDir, `${provider.id}.txt`), outcome.text.slice(0, 20_000), 'utf8');
    }

    writeFileSync(join(outDir, 'latency.json'), JSON.stringify(results, null, 2), 'utf8');
    console.log('latência por provedor:', JSON.stringify(results));
    expect(results.length).toBeGreaterThan(0);
  }, 1_200_000);
});

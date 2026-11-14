import { VIDEO_FORMATS, type ProductionBrief } from '@neuralbridge/shared';
import type { AetheraProviderTask } from './agent-orchestrator.js';

/**
 * AUTO-04 Prompt-to-Production: interprets a single natural-language prompt into a structured ProductionBrief,
 * inferring duration, aspect ratio, production type, language, and target word count.
 */
export function interpretPromptToBrief(prompt: string, projectId = 'default'): ProductionBrief {
  const clean = prompt.trim();
  const minMatch = /(\d+)\s*(?:min|minutos?|m\b)/iu.exec(clean);
  const secMatch = /(\d+)\s*(?:s|seg|segundos?)\b/iu.exec(clean);
  const durationSec = minMatch ? Number(minMatch[1]) * 60 : secMatch ? Number(secMatch[1]) : 180;
  const clampedDuration = Math.max(30, Math.min(3_600, durationSec));

  const isVertical = /9:16|vertical|shorts?|reels?|tiktok/iu.test(clean);
  const formatId = isVertical ? 'youtube-short' : 'youtube-long';
  const { id, width, height, fps, aspectRatio, safeArea } = VIDEO_FORMATS[formatId];

  const isList = /top\s*\d+|\b\d+\s+(?:melhores|piores|chefes|jogos|dicas|fatos)/iu.test(clean);
  const isTutorial = /como\s+fazer|tutorial|passo\s+a\s+passo|guia/iu.test(clean);
  const productionType = isList ? 'top_list' : isTutorial ? 'tutorial' : 'documentary';

  const isEnglish = /\b(?:in\s+english|ingl[eê]s)\b/iu.test(clean);
  const language = isEnglish ? 'en-US' : 'pt-BR';
  const targetWords = Math.round((clampedDuration / 60) * 150);

  return {
    schemaVersion: 1,
    projectId,
    format: { id, width, height, fps, aspectRatio, safeArea },
    productionType,
    topic: clean,
    targetDurationSeconds: clampedDuration,
    targetWords,
    language,
    audience: 'geral',
    tone: /cinematogr[aá]fico|[eé]pico|dram[aá]tico/iu.test(clean) ? 'cinematográfico e envolvente' : 'analítico e envolvente',
    narrativeStyle: 'explicativo',
    researchDepth: 'standard',
    sourceCount: 5,
    pace: 'standard',
    budgetUsd: 10,
  };
}

/** Builds the 12-stage autonomous multi-agent DAG for a ProductionBrief (AUTO-02 / AUTO-04). */
export function buildAutonomousPipelineDag(brief: ProductionBrief, cwd: string): AetheraProviderTask[] {
  return [
    { id: 'interpretation', capability: 'creative_direction', preferredProvider: 'claude', cwd, mode: 'read-only', prompt: `Interpretar briefing: ${brief.topic} (${brief.targetDurationSeconds}s, ${brief.language})` },
    { id: 'research', capability: 'creative_direction', preferredProvider: 'claude', cwd, mode: 'read-only', dependsOn: ['interpretation'], prompt: `Pesquisar fatos e referências para: ${brief.topic}` },
    { id: 'script', capability: 'script', preferredProvider: 'claude', cwd, mode: 'read-only', dependsOn: ['research'], prompt: `Escrever roteiro de ~${brief.targetWords} palavras em ${brief.language}` },
    { id: 'storyboard', capability: 'creative_direction', preferredProvider: 'claude', cwd, mode: 'read-only', dependsOn: ['script'], prompt: `Planejar storyboard e direção editorial` },
    { id: 'media_acquisition', capability: 'execution', preferredProvider: 'codex', cwd, mode: 'edit', dependsOn: ['storyboard'], prompt: `Adquirir/gerar mídia autonomamente para o storyboard` },
    { id: 'narration', capability: 'execution', preferredProvider: 'codex', cwd, mode: 'edit', dependsOn: ['script'], prompt: `Gerar narração TTS e sincronizar palavras` },
    { id: 'music', capability: 'execution', preferredProvider: 'codex', cwd, mode: 'edit', dependsOn: ['storyboard'], prompt: `Selecionar/gerar trilha sonora contextual` },
    { id: 'sfx', capability: 'automation', preferredProvider: 'codex', cwd, mode: 'edit', dependsOn: ['storyboard', 'narration'], prompt: `Classificar e aplicar SFX contextuais` },
    { id: 'vfx', capability: 'remotion_composition', preferredProvider: 'codex', cwd, mode: 'edit', dependsOn: ['storyboard', 'media_acquisition'], prompt: `Aplicar VFX cinematográficos e transições` },
    { id: 'composition', capability: 'remotion_composition', preferredProvider: 'codex', cwd, mode: 'edit', dependsOn: ['media_acquisition', 'narration', 'music', 'sfx', 'vfx'], prompt: `Montar TimelineDocument final` },
    { id: 'render', capability: 'automation', preferredProvider: 'codex', cwd, mode: 'edit', dependsOn: ['composition'], prompt: `Renderizar MP4 final via Remotion + FFmpeg` },
    { id: 'quality_gate', capability: 'validation', preferredProvider: 'claude', cwd, mode: 'read-only', dependsOn: ['render'], prompt: `Executar Quality Gate cinematográfico final` },
  ];
}

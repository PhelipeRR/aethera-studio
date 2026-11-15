import type { CompositionPlanner, CreativePlanInput, ThumbnailLabVariant } from './composition-planner.js';
import { CreativeDirectorAgent, type DirectorCritiqueIssue } from './creative-director.js';
import type { QualityGateService } from './quality-gate.js';
import type { CreativeProjectDocument, QualityAuditReport } from './schemas.js';

export type TechnicalEngineId = 'claude-code' | 'codex-cli' | 'antigravity-cli' | 'claude-gateway';

export type OrchestratorRole =
  | 'creative_direction'
  | 'technical_composition'
  | 'visual_refinement'
  | 'semantic_review';

export interface ReasoningEngineProvider {
  readonly id: TechnicalEngineId;
  isAvailable(): Promise<boolean>;
  runPrompt(prompt: string): Promise<{ text: string }>;
}

export interface OrchestrationStepTrace {
  role: OrchestratorRole;
  assignedEngine: TechnicalEngineId | 'local-deterministic';
  fallbackUsed: boolean;
  summary: string;
}

export interface CreativeOrchestrationResult {
  availableEngines: TechnicalEngineId[];
  traces: OrchestrationStepTrace[];
  directorIssues: DirectorCritiqueIssue[];
  document: CreativeProjectDocument;
  audit: QualityAuditReport;
}

const ROLE_PREFERRED_ENGINE: Record<OrchestratorRole, TechnicalEngineId> = {
  creative_direction: 'claude-code',
  technical_composition: 'codex-cli',
  visual_refinement: 'antigravity-cli',
  semantic_review: 'claude-gateway',
};

/**
 * Sanitizes untrusted prompt/script/video metadata before passing to reasoning agents.
 */
export function sanitizeUntrustedCreativeInput(raw: string): string {
  return raw
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/<\/?(system|assistant|developer|tool_call|instructions?)>/gi, '')
    .slice(0, 2000)
    .trim();
}

export class CreativeOrchestrator {
  private readonly director: CreativeDirectorAgent;

  constructor(
    private readonly providers: ReasoningEngineProvider[],
    private readonly planner: CompositionPlanner,
    private readonly qualityGate: QualityGateService,
    director?: CreativeDirectorAgent,
  ) {
    this.director = director ?? new CreativeDirectorAgent();
  }

  async detectAvailableEngines(): Promise<TechnicalEngineId[]> {
    const available: TechnicalEngineId[] = [];
    for (const p of this.providers) {
      try {
        if (await p.isAvailable()) {
          available.push(p.id);
        }
      } catch {
        // Ignore unavailable provider
      }
    }
    return available;
  }

  private pickProviderForRole(
    role: OrchestratorRole,
    availableProviders: ReasoningEngineProvider[],
  ): { provider: ReasoningEngineProvider | null; fallbackUsed: boolean } {
    const preferredId = ROLE_PREFERRED_ENGINE[role];
    const exact = availableProviders.find((p) => p.id === preferredId);
    if (exact) return { provider: exact, fallbackUsed: false };
    if (availableProviders.length > 0) {
      return { provider: availableProviders[0]!, fallbackUsed: true };
    }
    return { provider: null, fallbackUsed: true };
  }

  async orchestrateCreation(input: CreativePlanInput): Promise<CreativeOrchestrationResult> {
    const safePrompt = sanitizeUntrustedCreativeInput(input.prompt);
    const availableProviders: ReasoningEngineProvider[] = [];
    for (const p of this.providers) {
      try {
        if (await p.isAvailable()) availableProviders.push(p);
      } catch {
        // Provider offline
      }
    }

    const traces: OrchestrationStepTrace[] = [];
    const roles: OrchestratorRole[] = [
      'creative_direction',
      'technical_composition',
      'visual_refinement',
      'semantic_review',
    ];

    let refinedHeadline = input.headline;

    for (const role of roles) {
      const { provider, fallbackUsed } = this.pickProviderForRole(role, availableProviders);
      if (!provider) {
        traces.push({
          role,
          assignedEngine: 'local-deterministic',
          fallbackUsed: true,
          summary: `Executado pelo planejador determinístico local (${role}).`,
        });
        continue;
      }

      try {
        const res = await provider.runPrompt(
          `[Aethera Creative Studio :: ${role}] ArtType=${input.artType}. UserBrief=${JSON.stringify(safePrompt)}. Respond concisely with visual direction notes.`,
        );
        if (role === 'creative_direction' && !refinedHeadline) {
          const match = res.text.match(/HEADLINE:\s*([^\n\r]{3,42})/i);
          if (match?.[1]) refinedHeadline = match[1].trim();
        }
        traces.push({
          role,
          assignedEngine: provider.id,
          fallbackUsed,
          summary: res.text.slice(0, 180) || `${role} concluído por ${provider.id}.`,
        });
      } catch {
        traces.push({
          role,
          assignedEngine: 'local-deterministic',
          fallbackUsed: true,
          summary: `Fallback local após falha em ${provider.id} (${role}).`,
        });
      }
    }

    const planned = this.planner.buildDocument({
      ...input,
      prompt: safePrompt,
      ...(refinedHeadline ? { headline: refinedHeadline } : {}),
    });
    const directorReview = this.director.reviewAndRefine(planned, { brandKit: input.brandKit ?? null });
    const document = directorReview.document;
    const audit = await this.qualityGate.auditProject(document, { brandKit: input.brandKit ?? null });

    return {
      availableEngines: availableProviders.map((p) => p.id),
      traces,
      directorIssues: directorReview.issues,
      document,
      audit,
    };
  }

  async orchestrateThumbnailLab(
    input: Omit<CreativePlanInput, 'artType' | 'variantStyle'>,
  ): Promise<{
    availableEngines: TechnicalEngineId[];
    variants: ThumbnailLabVariant[];
  }> {
    const availableEngines = await this.detectAvailableEngines();
    const safePrompt = sanitizeUntrustedCreativeInput(input.prompt);
    const variants = await this.planner.generateThumbnailLabVariations(
      { ...input, prompt: safePrompt },
      this.qualityGate,
    );
    return { availableEngines, variants };
  }
}

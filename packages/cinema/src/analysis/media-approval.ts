import {
  assessIdentity,
  mentionsName,
  type ContentDomain,
  type EditorialRole,
  type IdentityAssessment,
  type IdentitySubject,
  type MediaCandidateAssessment,
  type ObservedIdentity,
  type WorkReference,
} from './media-providers/semantic-media.js';
import type { LicenseDecision, ProviderMediaItem } from './media-providers/types.js';
import { expandNarrativeAliases, isAssemblyEligibleDecision, type MediaRelevanceDecision } from '../qc/media-relevance-gate.js';

/**
 * Per-scene media approval with four independent verdicts:
 *
 * 1. **Identity** — is this the expected work/character? Approved only by frame evidence or a provenance lookup
 *    (never by title or channel).
 * 2. **Literal correspondence** — do proven intervals show the narrated event? Requires identity + exact match.
 * 3. **Contextual support** — may it illustrate the scene without proving the event?
 * 4. **Usage authorization** — what the license says, independent of relevance.
 *
 * This layer only confirms or downgrades the Media Relevance Gate; it never upgrades a decision.
 */

export interface ApprovalInterval {
  sceneId: string;
  startSec: number;
  endSec: number;
  provingTimestampsSec: number[];
  provingDescriptions: string[];
}

export interface SceneMediaApproval {
  sceneId: string;
  mediaId: string;
  title: string;
  origin: string;
  sourceUrl: string;
  /** Pre-download assessment (media type, editorial-role ceiling) when the candidate came from the registry. */
  preDownload?: Pick<MediaCandidateAssessment, 'mediaType' | 'mediaTypeConfidence' | 'maxEditorialRole' | 'canProveScene' | 'domain'> & {
    identityStatus: IdentityAssessment['status'];
  };
  visualVerificationStatus: 'visually_verified' | 'unverified_metadata_only' | 'pending';
  visualConfidence: number;
  sampledTimestampsSec: number[];
  identity: IdentityAssessment & { approval: 'approved' | 'rejected' | 'pending' | 'not_required' };
  literalCorrespondence: { status: 'proven' | 'not_proven'; correspondenceLevel: string; intervals: ApprovalInterval[]; reason: string };
  contextualSupport: { status: 'eligible' | 'not_eligible'; intervals: ApprovalInterval[]; reason: string };
  usageAuthorization: {
    status: 'authorized' | 'authorized_with_restrictions' | 'pending_review' | 'blocked' | 'unknown';
    basis: 'provider_license_metadata' | 'publisher_channel_match' | 'local_library' | 'none';
    licenseId: string;
    reasons: string[];
  };
  /** Final editorial role after frames; null when the media cannot be used for this scene. */
  editorialRole: EditorialRole | null;
  /** Set when this layer downgraded the gate's decision (identity mismatch or role ceiling). */
  downgrade?: { from: string; to: string; reason: string };
}

export interface ApprovalCandidateInput {
  mediaId: string;
  title?: string;
  description?: string;
  origin: string;
  url: string;
  providerItem?: ProviderMediaItem;
  licenseDecision?: LicenseDecision;
  assessment?: MediaCandidateAssessment;
  license?: string;
}

export interface ApprovalSceneInput {
  sceneId: string;
  entities?: string[];
  work?: WorkReference;
  projectDomain?: ContentDomain;
}

const GENERIC_VISUAL_DESCRIPTOR_RE =
  /\b(cidade|pessoa|pessoas|personagem|personagens|pedestre|pedestres|multidao|multidão|homem|homens|mulher|mulheres|garoto|garota|menino|menina|crianca|criança|carro|carros|automovel|automóvel|porsche|ferrari|lamborghini|sedan|suv|caminhao|caminhão|veiculo|veículo|veiculos|veículos|moto|motos|motocicleta|rua|ruas|avenida|predio|prédio|predios|prédios|edificio|edifício|edificios|edifícios|noite|noturna|noturno|luz|luzes|luminoso|luminosos|iluminada|iluminadas|iluminado|iluminados|neon|neons|holograma|hologramas|letreiro|letreiros|paineis|painéis|maquina|máquina|maquinas|máquinas|estrutura|estruturas|tela|cenario|cenário|paisagem|ambiente|fundo|objeto|arma|armas|espada|armadura|canoa|barco|navio|cavalo|cavalos|floresta|montanha|rio|mar|lago|agua|água|fogo|explosao|explosão|ceu|céu|nuvem|estrada|trilha|casa|casas|cabana|cabanas|rancho|fazenda|celeiro|acampamento|fogueira|igreja|loja|ponte|trem|aviao|avião|helicoptero|helicóptero|arvore|árvore|animal|animais|lobo|urso|passaro|pássaro|sol|lua|neve|chuva|deserto|praia|vilarejo|vila|aldeia|ribeirinho|estacionado|estacionados|freira|padre|monge|policial|policiais|policia|polícia|soldado|soldados|guerreiro|mago|zumbi|robo|robô|cyborg|ciborgue|android|androide|ninja|samurai|pirata|cowboy|xerife|bandido|mercenário|mercenario|city|person|character|characters|pedestrian|pedestrians|man|men|woman|women|car|cars|vehicle|vehicles|street|streets|building|buildings|night|light|lights|neon|hologram|sign|signs|panel|machine|structure|screen|scenery|landscape|background|object|weapon|weapons|sword|armor|crowd|people|canoe|boat|ship|horse|horses|forest|mountain|river|lake|water|fire|explosion|sky|cloud|road|trail|house|cabin|cabins|ranch|barn|farm|camp|campfire|bridge|train|plane|helicopter|tree|animal|snow|rain|desert|beach|village|town|riverside|parked|nun|priest|monk|cop|cops|police|soldier|soldiers|warrior|wizard|zombie|robot|cyborg|detective|doctor|nurse|hud|interface|menu|gameplay)\b/i;

function isGenericVisualDescriptor(entity: string): boolean {
  const trimmed = entity.trim();
  if (!trimmed) return true;
  // Single-token short aliases (e.g. "v" in Cyberpunk 2077) are character codenames, never a contradicting work title.
  if (trimmed.length <= 2) return true;
  if (GENERIC_VISUAL_DESCRIPTOR_RE.test(trimmed)) return true;
  // Multi-word all-lowercase phrases are almost always descriptive nouns, not named titles.
  if (trimmed.split(/\s+/).length >= 3 && trimmed === trimmed.toLowerCase()) return true;
  return false;
}

/** Observed identity from frames (detected entities) or from an anime provenance lookup (trace.moe-like). */
export function observedIdentityFromDecision(decision: MediaRelevanceDecision, expected: string[]): ObservedIdentity | undefined {
  const prov = decision.animeProvenance;
  if (prov && !prov.isAmbiguous && prov.workTitle) {
    return { detectedWork: prov.workTitle, confidence: prov.confidence, source: 'provenance_lookup' };
  }
  if (decision.visualVerificationStatus !== 'visually_verified') return undefined;
  const frames = (decision.visualEvidence ?? []).filter((f) => f.confidence >= 0.4);
  if (frames.length === 0) return undefined;
  const frameMatchesExpected = (f: (typeof frames)[number], exp: string): boolean => {
    const expanded = expandNarrativeAliases(
      `${f.description ?? ''} ${f.detectedEntities.join(' ')}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase(),
    );
    return f.detectedEntities.some((d) => mentionsName(d, exp) || mentionsName(exp, d)) || mentionsName(expanded, exp);
  };
  const proving = frames.filter((f) => expected.some((e) => frameMatchesExpected(f, e)));
  // Same proof density the gate requires for exact matches (≥30% of confident frames, at least one).
  const minFrames = Math.max(1, Math.ceil(frames.length * 0.3));
  if (proving.length >= minFrames) {
    const name = expected.find((e) => proving.some((f) => frameMatchesExpected(f, e))) ?? expected[0] ?? '';
    const confidence = proving.reduce((acc, f) => acc + f.confidence, 0) / proving.length;
    return { detectedWork: name, confidence: Number(confidence.toFixed(2)), source: 'vision' };
  }
  // Frames confidently show named entities, none of them expected: a different work/character.
  // Ignore generic visual scene descriptions (e.g. "cidade noturna com painéis luminosos", "pessoa de cabelo vermelho").
  const others = new Map<string, { n: number; conf: number }>();
  for (const f of frames) {
    for (const d of f.detectedEntities) {
      const expandedD = expandNarrativeAliases(d.toLowerCase());
      if (expected.some((e) => mentionsName(d, e) || mentionsName(e, d) || mentionsName(expandedD, e))) continue;
      if (isGenericVisualDescriptor(d)) continue;
      const cur = others.get(d) ?? { n: 0, conf: 0 };
      others.set(d, { n: cur.n + 1, conf: cur.conf + f.confidence });
    }
  }
  const top = [...others.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  if (top && top[1].n >= minFrames && proving.length === 0) {
    return { detectedWork: top[0], confidence: Number((top[1].conf / top[1].n).toFixed(2)), source: 'vision' };
  }
  return undefined;
}

function toIntervals(decision: MediaRelevanceDecision, sceneId: string): ApprovalInterval[] {
  return (decision.matchedIntervals ?? [])
    .filter((i) => i.segmentId === sceneId && i.endSec > i.startSec)
    .map((i) => ({
      sceneId,
      startSec: i.startSec,
      endSec: i.endSec,
      provingTimestampsSec: i.provingTimestampsSec ?? [],
      provingDescriptions: i.provingDescriptions ?? [],
    }));
}

function usageOf(cand: ApprovalCandidateInput): SceneMediaApproval['usageAuthorization'] {
  if (cand.origin === 'local_library') {
    return { status: 'authorized', basis: 'local_library', licenseId: cand.license ?? 'local', reasons: ['Arquivo da biblioteca local do usuário (direitos sob responsabilidade do usuário).'] };
  }
  const lic = cand.licenseDecision;
  const rights = cand.assessment?.rights;
  const licenseId = cand.providerItem?.license.licenseId ?? cand.license ?? 'unknown';
  const basis: SceneMediaApproval['usageAuthorization']['basis'] = rights?.basis ?? (licenseId === 'publisher_promotional' ? 'publisher_channel_match' : 'none');
  if (!lic) return { status: 'unknown', basis, licenseId, reasons: ['Sem decisão de licença do provedor; publicação exige revisão humana.'] };
  const status =
    lic.status === 'allowed' ? 'authorized' : lic.status === 'allowed_with_restrictions' ? 'authorized_with_restrictions' : lic.status === 'blocked' ? 'blocked' : 'pending_review';
  return { status, basis, licenseId, reasons: lic.reasons };
}

/**
 * Builds the four verdicts for one media × scene from the gate's decision. `effectiveDecision` is the gate decision,
 * or a downgraded copy when identity evidence contradicts it or the pre-download role ceiling forbids literal use.
 */
export function buildSceneMediaApproval(
  cand: ApprovalCandidateInput,
  decision: MediaRelevanceDecision,
  scene: ApprovalSceneInput,
): { approval: SceneMediaApproval; effectiveDecision: MediaRelevanceDecision } {
  const ctx = { ...(scene.entities ? { entities: scene.entities } : {}), ...(scene.work ? { work: scene.work } : {}), ...(scene.projectDomain ? { projectDomain: scene.projectDomain } : {}) };
  const subject: IdentitySubject = cand.providerItem ?? { title: cand.title ?? cand.url, ...(cand.description ? { description: cand.description } : {}) };
  const expected = [scene.work?.canonicalTitle, ...(scene.work?.alternativeTitles ?? []), ...(scene.entities ?? [])].filter((e): e is string => Boolean(e && e.trim()));
  const observed = observedIdentityFromDecision(decision, expected);
  const identity = assessIdentity(subject, ctx, observed);
  const gateEligible = isAssemblyEligibleDecision(decision);
  const visuallyVerified = decision.visualVerificationStatus === 'visually_verified';
  const intervals = toIntervals(decision, scene.sceneId);
  const ceilingForbidsLiteral = cand.assessment !== undefined && !cand.assessment.canProveScene;

  const identityApproval: SceneMediaApproval['identity']['approval'] =
    identity.status === 'not_required'
      ? 'not_required'
      : identity.status === 'mismatch'
        ? 'rejected'
        : identity.status === 'confirmed_by_analysis'
          ? 'approved'
          : 'pending';

  let effectiveDecision = decision;
  let downgrade: SceneMediaApproval['downgrade'];
  if (identityApproval === 'rejected' && (gateEligible || decision.accepted)) {
    downgrade = { from: decision.editorialStatus ?? (gateEligible ? 'approved_for_scene' : 'accepted'), to: 'candidate', reason: identity.evidence[0] ?? 'Identidade incompatível.' };
    effectiveDecision = {
      ...decision,
      accepted: false,
      assemblyEligible: false,
      editorialStatus: 'candidate',
      correspondenceLevel: 'rejected',
      relevanceTier: 'rejected',
      eligibleSegmentIds: [],
      rejectionCode: 'wrong_anime_or_entity',
      reason: `Identidade incompatível: ${identity.evidence[0] ?? 'obra diferente da esperada'}`,
    };
  } else if (gateEligible && (ceilingForbidsLiteral || (identityApproval === 'pending' && expected.length > 0))) {
    const reason = ceilingForbidsLiteral
      ? `Tipo ${cand.assessment?.mediaType} não comprova a cena (${cand.assessment?.reasons[0] ?? 'apenas apoio contextual'}).`
      : 'Frames não confirmaram a identidade da obra esperada: uso apenas contextual.';
    downgrade = { from: 'approved_for_scene', to: 'visually_verified', reason };
    effectiveDecision = {
      ...decision,
      assemblyEligible: false,
      editorialStatus: visuallyVerified ? 'visually_verified' : 'candidate',
      correspondenceLevel: 'contextual_support',
      relevanceTier: 'same_universe_context',
      eligibleSegmentIds: [],
      reason: `${reason} ${decision.reason}`.trim(),
    };
  }

  const effectiveIntervals = toIntervals(effectiveDecision, scene.sceneId);
  const literal = isAssemblyEligibleDecision(effectiveDecision) && effectiveDecision.correspondenceLevel === 'exact_match' && effectiveIntervals.length > 0;
  const contextualEligible =
    !literal &&
    identityApproval !== 'rejected' &&
    visuallyVerified &&
    (effectiveDecision.correspondenceLevel === 'contextual_support' ||
      effectiveDecision.correspondenceLevel === 'universe_only_coincidence' ||
      effectiveDecision.correspondenceLevel === 'exact_match');

  const approval: SceneMediaApproval = {
    sceneId: scene.sceneId,
    mediaId: cand.mediaId,
    title: cand.title ?? cand.url,
    origin: cand.origin,
    sourceUrl: cand.providerItem?.pageUrl ?? cand.url,
    ...(cand.assessment
      ? {
          preDownload: {
            domain: cand.assessment.domain,
            mediaType: cand.assessment.mediaType,
            mediaTypeConfidence: cand.assessment.mediaTypeConfidence,
            maxEditorialRole: cand.assessment.maxEditorialRole,
            canProveScene: cand.assessment.canProveScene,
            identityStatus: cand.assessment.identity.status,
          },
        }
      : {}),
    visualVerificationStatus: decision.visualVerificationError ? 'pending' : (decision.visualVerificationStatus ?? 'unverified_metadata_only'),
    visualConfidence: decision.visualConfidence ?? 0,
    sampledTimestampsSec: decision.sampledTimestampsSec,
    identity: { ...identity, approval: identityApproval },
    literalCorrespondence: {
      status: literal ? 'proven' : 'not_proven',
      correspondenceLevel: effectiveDecision.correspondenceLevel ?? 'unverified',
      intervals: literal ? intervals : [],
      reason: literal ? effectiveDecision.reason : downgrade?.reason ?? effectiveDecision.reason,
    },
    contextualSupport: {
      status: contextualEligible ? 'eligible' : 'not_eligible',
      intervals: contextualEligible ? intervals : [],
      reason: contextualEligible
        ? 'Frames verificados mostram a obra/universo sem comprovar o acontecimento narrado.'
        : identityApproval === 'rejected'
          ? 'Identidade incompatível.'
          : visuallyVerified
            ? 'Sem correspondência visual suficiente.'
            : 'Sem verificação visual.',
    },
    usageAuthorization: usageOf(cand),
    editorialRole: literal ? 'literal_evidence' : contextualEligible ? 'contextual_broll' : null,
    ...(downgrade ? { downgrade } : {}),
  };
  return { approval, effectiveDecision };
}

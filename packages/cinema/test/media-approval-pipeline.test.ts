import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MediaProviderRegistry,
  probeRealMp4,
  resolveProjectDomain,
  runAutonomousMediaAcquisition,
  workReferenceForScene,
  buildSceneMediaApproval,
  YouTubeAdapter,
  type DistributedFrameAnalysis,
  type MediaCandidateAssessment,
  type MediaRelevanceDecision,
  type MediaProviderAdapter,
  type ScriptCoverageSegment,
} from '../src/index.js';
import { YOUTUBE_DESCRIPTOR } from '../src/analysis/media-providers/adapters/youtube.js';

/**
 * Integration through the real acquisition pipeline: real YouTube adapter (HTTP stubbed at the network boundary only),
 * real registry (routing, fidelity, license), real download delegate writing a real MP4 produced by ffmpeg, real
 * ffprobe, real Media Relevance Gate and the approval layer. Only the vision model is scripted, because it is an
 * external service; each scenario states what the "frames" show.
 */

const REFERENCE_ID = '6gNGCDYOvDs';
const REFERENCE_TITLE = 'Frieren & Fern vs Frieren | Full Fight';
const PROMPT = 'Os animes com os sistemas de magia mais criativos';

let root: string;
let sourceMp4: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'nb-approval-'));
  sourceMp4 = join(root, 'source.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24:duration=12', '-pix_fmt', 'yuv420p', sourceMp4]);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
function youtubeHttp(videos: Array<{ id: string; title: string; channel: string }>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/youtube/v3/search')) return json({ items: videos.map((v) => ({ id: { videoId: v.id } })) });
    if (url.includes('/youtube/v3/videos')) {
      return json({ items: videos.map((v) => ({ id: v.id, snippet: { title: v.title, channelTitle: v.channel }, contentDetails: { duration: 'PT6M12S', definition: 'hd' }, status: { license: 'youtube' } })) });
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
}

function spyAdapter(id: 'steam' | 'igdb', calls: string[]): MediaProviderAdapter {
  return {
    descriptor: { ...YOUTUBE_DESCRIPTOR, id, name: id, category: 'game_media' },
    isConfigured: () => true,
    search: async (r) => {
      calls.push(`${id}:${r.query}`);
      return { items: [], page: 1, perPage: 10, hasMore: false };
    },
    healthCheck: async () => ({ connectivity: 'ok', detail: '', checkedAt: '' }),
  };
}

const frames = (entities: string[], actions: string[], description: string, confidence = 0.88) =>
  (async (_uri: string, timestampsSec: number[]): Promise<DistributedFrameAnalysis[]> =>
    timestampsSec.map((timestampSec) => ({ timestampSec, visualCategory: 'anime_animation' as const, detectedEntities: entities, detectedActions: actions, description, confidence })));

async function runFrierenScene(opts: {
  videos?: Array<{ id: string; title: string; channel: string }>;
  analyzeFrames?: ReturnType<typeof frames>;
  requireVisualVerification?: boolean;
}) {
  const dir = mkdtempSync(join(root, 'run-'));
  const steamCalls: string[] = [];
  const downloads: string[] = [];
  const decupagemScene = {
    workTitle: 'Animes com Sistemas de Magia',
    works: ['Frieren'],
    expectedEvent: 'Frieren e Fern enfrentam a cópia de Frieren',
    visualKeywords: ['Fern', 'Zoltraak'],
    matchingCriteria: { requiredEntities: ['Frieren', 'Fern'], expectedActions: ['luta'], minVisualConfidence: 0.6 },
  };
  const domain = resolveProjectDomain({ promptDomain: 'gaming', prompt: PROMPT, workTitles: ['Frieren', 'Magi'], genre: 'gameplay_essay' });
  const work = workReferenceForScene(decupagemScene, { multiWork: true, language: 'pt-BR' });
  const segment: ScriptCoverageSegment = {
    segmentId: 'scene_frieren',
    subject: 'Frieren — Fern',
    narrationText: 'Em Frieren, Fern e Frieren enfrentam uma cópia mágica da própria Frieren.',
    entities: ['Frieren', 'Fern'],
    expectedDurationSec: 8,
    ...(work ? { work } : {}),
  };
  const registry = new MediaProviderRegistry({
    adapters: [
      spyAdapter('steam', steamCalls),
      spyAdapter('igdb', steamCalls),
      new YouTubeAdapter({ apiKey: () => 'test-key', fetchImpl: youtubeHttp(opts.videos ?? [{ id: REFERENCE_ID, title: REFERENCE_TITLE, channel: 'Some Clips' }]) }),
    ],
    externalAcquire: async (item, destDir) => {
      downloads.push(item.pageUrl);
      mkdirSync(destDir, { recursive: true });
      const out = join(destDir, `${item.providerItemId}.mp4`);
      copyFileSync(sourceMp4, out);
      return out;
    },
  });
  const audit = await runAutonomousMediaAcquisition({
    projectId: 'p-frieren',
    prompt: PROMPT,
    genre: 'gameplay_essay',
    projectDomain: domain.domain,
    mediaDir: dir,
    segments: [segment],
    probeDurationFn: async (fp) => (await probeRealMp4(fp)).durationSec,
    ...(opts.analyzeFrames ? { analyzeFrames: opts.analyzeFrames } : {}),
    requireVisualVerification: opts.requireVisualVerification ?? true,
    checkpointPath: false,
    licensePolicy: 'assemble_with_rights_review',
    limits: { maxRounds: 1, maxDurationMs: 60_000 },
    deps: { localMediaDirs: [], fetchImpl: (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch, mediaProviders: { registry, context: { jobId: 'p-frieren' } } },
  });
  return { audit, steamCalls, downloads, domain, work };
}

describe('anime scene through the real acquisition pipeline', () => {
  it('propagates the project domain and the work reference from the briefing/decupagem', () => {
    const domain = resolveProjectDomain({ promptDomain: 'gaming', prompt: PROMPT, workTitles: ['Frieren'], genre: 'gameplay_essay' });
    expect(domain.domain).toBe('anime');
    expect(domain.evidence.join(' ')).toMatch(/Interpretação do briefing indicou game/);
    const work = workReferenceForScene(
      { workTitle: 'Animes com Sistemas de Magia', works: ['Frieren'], expectedEvent: 'duelo', visualKeywords: ['Fern'], matchingCriteria: { requiredEntities: ['Frieren'], expectedActions: [], minVisualConfidence: 0.6 } },
      { multiWork: true, language: 'pt-BR' },
    );
    expect(work).toEqual({ canonicalTitle: 'Frieren', characters: ['Fern'], event: 'duelo', language: 'pt' });
    // Overview scene of a ranking: the list label is not a work.
    expect(workReferenceForScene({ workTitle: 'Animes com Sistemas de Magia', works: ['Frieren', 'Magi'], expectedEvent: '' }, { multiWork: true })?.canonicalTitle).toBeUndefined();
  });

  it('the reference video reaches visual analysis as a candidate, never Steam/IGDB, and frames decide', async () => {
    const { audit, steamCalls, downloads } = await runFrierenScene({
      analyzeFrames: frames(['Frieren', 'Fern'], ['luta', 'magia'], 'Frieren e Fern lançam magia contra a cópia de Frieren'),
    });
    expect(steamCalls).toEqual([]);
    expect(downloads).toEqual([`https://www.youtube.com/watch?v=${REFERENCE_ID}`]);
    const approval = audit.mediaApprovals.find((a) => a.sourceUrl.includes(REFERENCE_ID));
    expect(approval).toBeDefined();
    expect(approval!.sceneId).toBe('scene_frieren');
    expect(approval!.preDownload).toMatchObject({ mediaType: 'anime_footage', identityStatus: 'probable' });
    expect(approval!.visualVerificationStatus).toBe('visually_verified');
    expect(approval!.identity).toMatchObject({ approval: 'approved', status: 'confirmed_by_analysis' });
    // Literal evidence is bounded by the real 12 s file and carries the proving timestamps.
    expect(approval!.literalCorrespondence.status).toBe('proven');
    for (const iv of approval!.literalCorrespondence.intervals) {
      expect(iv.sceneId).toBe('scene_frieren');
      expect(iv.endSec).toBeLessThanOrEqual(12.1);
      expect(iv.provingTimestampsSec.length).toBeGreaterThan(0);
    }
    // Usage stays independent: third-party upload, unknown license → review, never "authorized".
    expect(approval!.usageAuthorization.status).toBe('pending_review');
    expect(audit.pendingLicenseReview?.some((p) => p.sourceUrl.includes(REFERENCE_ID))).toBe(true);
  });

  it('frames showing a different work reject it even though the title says Frieren', async () => {
    const { audit } = await runFrierenScene({ analyzeFrames: frames(['Naruto Uzumaki', 'Sasuke'], ['luta'], 'Naruto e Sasuke em combate') });
    const approval = audit.mediaApprovals.find((a) => a.sourceUrl.includes(REFERENCE_ID))!;
    expect(approval.identity.approval).not.toBe('approved');
    expect(approval.literalCorrespondence.status).toBe('not_proven');
    expect(approval.editorialRole).toBeNull();
    expect(audit.approvedMediaDetails.some((d) => d.sourceUrl.includes(REFERENCE_ID))).toBe(false);
  });

  it('without vision the title never approves: candidate analysed, kept unverified, no fabricated approval', async () => {
    const { audit } = await runFrierenScene({});
    const approval = audit.mediaApprovals.find((a) => a.sourceUrl.includes(REFERENCE_ID))!;
    expect(approval).toBeDefined();
    expect(approval.visualVerificationStatus).toBe('unverified_metadata_only');
    expect(approval.identity.approval).toBe('pending');
    expect(approval.literalCorrespondence.status).toBe('not_proven');
    expect(approval.contextualSupport.status).toBe('not_eligible');
    expect(audit.approvedForAssemblyCount).toBe(0);
    expect(audit.approvedMediaDetails).toEqual([]);
  });

  it('a game adaptation of the anime is never approved for the anime scene (triaged, with the reason recorded)', async () => {
    const { audit } = await runFrierenScene({
      videos: [{ id: 'game1', title: 'Frieren mobile game gameplay', channel: 'Mobile Gamer' }],
      analyzeFrames: frames(['Frieren', 'Fern'], ['luta', 'magia'], 'Frieren e Fern em combate (gráficos de jogo)'),
    });
    expect(audit.approvedMediaDetails.some((d) => d.sourceUrl.includes('game1'))).toBe(false);
    expect(audit.rejectedCandidates.find((r) => r.title === 'Frieren mobile game gameplay')?.rejectionCode).toBe('triage_irrelevant_metadata');
  });
});

describe('approval layer (unit): role ceiling and identity downgrade never upgrade the gate', () => {
  const exactDecision = (entities: string[]): MediaRelevanceDecision => ({
    mediaId: 'm1',
    accepted: true,
    score: 0.9,
    editorialStatus: 'approved_for_scene',
    assemblyEligible: true,
    correspondenceLevel: 'exact_match',
    visualVerificationStatus: 'visually_verified',
    visualConfidence: 0.9,
    visualEvidence: [3, 6, 9].map((t) => ({ timestampSec: t, description: 'combate', detectedEntities: entities, detectedActions: ['luta'], confidence: 0.9 })),
    matchedIntervals: [{ segmentId: 's1', startSec: 1.5, endSec: 10.5, provingTimestampsSec: [3, 6, 9] }],
    reason: 'exact',
    sampledTimestampsSec: [3, 6, 9],
    matchedEntities: ['frieren'],
    visualCategory: 'anime_animation',
  });
  const scene = { sceneId: 's1', entities: ['Frieren', 'Fern'], projectDomain: 'anime' as const };

  it('a game item (cannot prove the anime scene) is downgraded from literal to contextual', () => {
    const assessment = { domain: 'anime', mediaType: 'gameplay', mediaTypeConfidence: 0.5, maxEditorialRole: 'contextual_broll', canProveScene: false, identity: { status: 'probable' }, reasons: ['Jogo relacionado a anime não comprova cena do anime; apenas apoio contextual.'] } as unknown as MediaCandidateAssessment;
    const { approval, effectiveDecision } = buildSceneMediaApproval({ mediaId: 'm1', title: 'Frieren game', origin: 'youtube', url: 'u', assessment }, exactDecision(['Frieren']), scene);
    expect(effectiveDecision.assemblyEligible).toBe(false);
    expect(approval.literalCorrespondence.status).toBe('not_proven');
    expect(approval.editorialRole).toBe('contextual_broll');
    expect(approval.identity.approval).toBe('approved');
  });

  it('frames of another work turn a gate exact match into a rejection', () => {
    const { approval, effectiveDecision } = buildSceneMediaApproval({ mediaId: 'm1', title: 'Frieren fight', origin: 'youtube', url: 'u' }, exactDecision(['Black Clover Asta']), scene);
    expect(approval.identity.approval).toBe('rejected');
    expect(effectiveDecision.accepted).toBe(false);
    expect(effectiveDecision.rejectionCode).toBe('wrong_anime_or_entity');
    expect(approval.editorialRole).toBeNull();
  });

  it('confirmed identity keeps the gate decision unchanged (no upgrade, no downgrade)', () => {
    const decision = exactDecision(['Frieren', 'Fern']);
    const { approval, effectiveDecision } = buildSceneMediaApproval({ mediaId: 'm1', title: 'clip', origin: 'youtube', url: 'u' }, decision, scene);
    expect(effectiveDecision).toBe(decision);
    expect(approval.literalCorrespondence.intervals).toEqual([{ sceneId: 's1', startSec: 1.5, endSec: 10.5, provingTimestampsSec: [3, 6, 9], provingDescriptions: [] }]);
    expect(approval.usageAuthorization.status).toBe('unknown');
  });
});

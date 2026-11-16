/**
 * Real end-to-end check of the anime acquisition path with the regression video
 * https://www.youtube.com/watch?v=6gNGCDYOvDs ("Frieren & Fern vs Frieren | Full Fight").
 *
 * Real: briefing interpretation, project-domain resolution, decupagem work reference, provider registry (real Steam
 * adapter wrapped only to count calls; YouTube Data API without key → skipped), Wikimedia/Internet Archive searches,
 * yt-dlp search + section download, ffprobe, ffmpeg frame extraction, Media Relevance Gate and the approval layer.
 *
 * Vision: when no semantic vision provider is reachable the frame analyser extracts the real frames and then FAILS
 * explicitly, exactly like the desktop does when its vision chain is unavailable. No visual evidence is invented.
 *
 * Usage: npx tsx scripts/aethera-frieren-reference-e2e.ts <outDir>
 * Requires: python -m yt_dlp, ffmpeg/ffprobe on PATH (C:\ffmpeg\bin). Media stays in <outDir> (never in the repo).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  createDefaultMediaProviderAdapters,
  extractVerificationFrames,
  interpretProductionPrompt,
  MediaProviderRegistry,
  probeRealMp4,
  resolveProjectDomain,
  runAutonomousMediaAcquisition,
  workReferenceForScene,
  type MediaProviderAdapter,
} from '../packages/cinema/src/index.js';
import { acquireWithYtDlp, defaultYtDlp, ytDlpSearch } from '../packages/workspace/src/aethera-acquisition.js';

const REFERENCE_URL = 'https://www.youtube.com/watch?v=6gNGCDYOvDs';
const PROMPT = 'Os animes com os sistemas de magia mais criativos';

async function main(): Promise<void> {
  const outDir = process.argv[2];
  if (!outDir) throw new Error('usage: aethera-frieren-reference-e2e.ts <outDir>');
  mkdirSync(outDir, { recursive: true });
  const mediaDir = join(outDir, 'media');
  mkdirSync(mediaDir, { recursive: true });
  const ytDlp = defaultYtDlp();
  const startedAt = Date.now();

  const interpretation = interpretProductionPrompt(PROMPT);
  const domain = resolveProjectDomain({ promptDomain: interpretation.domain, prompt: PROMPT, workTitles: ['Frieren'], genre: 'gameplay_essay' });
  const work = workReferenceForScene(
    {
      workTitle: 'Animes com Sistemas de Magia',
      works: ['Frieren'],
      expectedEvent: 'Frieren e Fern enfrentam a cópia de Frieren',
      visualKeywords: ['Fern'],
      matchingCriteria: { requiredEntities: ['Frieren', 'Fern'], expectedActions: ['luta'], minVisualConfidence: 0.6 },
    },
    { multiWork: true, language: interpretation.language },
  );

  const providerCalls: string[] = [];
  const adapters: MediaProviderAdapter[] = createDefaultMediaProviderAdapters().map((a) => {
    const search = a.search.bind(a);
    a.search = async (r) => {
      providerCalls.push(`${a.descriptor.id}:${r.query}`);
      return search(r);
    };
    return a;
  });
  const registry = new MediaProviderRegistry({ adapters });

  const visionAttempts: Array<{ uri: string; timestampsSec: number[]; extractedFrames: number }> = [];
  const audit = await runAutonomousMediaAcquisition({
    projectId: 'e2e-frieren-reference',
    prompt: PROMPT,
    genre: 'gameplay_essay',
    projectDomain: domain.domain,
    format: 'analysis',
    mediaDir,
    segments: [
      {
        segmentId: 'scene_frieren',
        subject: 'Frieren — Fern',
        narrationText: 'Em Frieren, Fern e Frieren enfrentam uma cópia mágica da própria Frieren.',
        entities: ['Frieren', 'Fern'],
        expectedDurationSec: 8,
        preferredQueries: ['Frieren & Fern vs Frieren Full Fight'],
        ...(work ? { work } : {}),
      },
    ],
    probeDurationFn: async (fp) => (await probeRealMp4(fp)).durationSec,
    analyzeFrames: async (uri, timestampsSec) => {
      const frames = await extractVerificationFrames(uri, join(outDir, 'frames', basename(dirname(uri))), timestampsSec);
      visionAttempts.push({ uri, timestampsSec, extractedFrames: frames.length });
      throw new Error(`Visão semântica indisponível neste ambiente (Ollama offline; Claude/Codex exigem credenciais do app). ${frames.length} frames reais extraídos e não analisados.`);
    },
    requireVisualVerification: true,
    checkpointPath: false,
    licensePolicy: 'assemble_with_rights_review',
    limits: { maxRounds: 1, maxDurationMs: 420_000, perDownloadTimeoutMs: 180_000 },
    deps: {
      localMediaDirs: [],
      mediaProviders: { registry, context: { jobId: 'e2e-frieren-reference' } },
      ytDlpSearchFn: (q, count, sig) => ytDlpSearch(ytDlp, q, count, sig),
      ytDlpAcquireFn: async (targetUrl, idx, dir, sig, downloadSection) => {
        const relativeDir = `acq_${idx}`;
        mkdirSync(join(dir, relativeDir), { recursive: true });
        const out = await acquireWithYtDlp({
          ytDlp,
          url: targetUrl,
          root: dir,
          relativeDir,
          fileStem: 'source',
          maxHeight: 720,
          downloadSection: downloadSection ?? '*0:00-0:45',
          maxFilesize: '60M',
          ...(sig ? { signal: sig } : {}),
        });
        return out.relativePath ? join(dir, out.relativePath) : null;
      },
    },
  });

  const reference = audit.mediaApprovals.find((a) => a.sourceUrl.includes('6gNGCDYOvDs'));
  const report = {
    ranAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    referenceUrl: REFERENCE_URL,
    briefing: { interpretationDomain: interpretation.domain, resolvedDomain: domain, work },
    providerCalls,
    steamOrIgdbCalled: providerCalls.some((c) => c.startsWith('steam:') || c.startsWith('igdb:')),
    providerStatuses: audit.providerStatuses,
    queriesExecuted: audit.queriesExecuted,
    candidatesByProvider: audit.candidatesByProvider,
    rejectedCandidates: audit.rejectedCandidates,
    acquiredFilesCount: audit.acquiredFilesCount,
    visionAttempts,
    referenceReachedVisualAnalysis: Boolean(reference),
    referenceApproval: reference ?? null,
    mediaApprovals: audit.mediaApprovals,
    approvedForAssemblyCount: audit.approvedForAssemblyCount,
    approvedMediaDetails: audit.approvedMediaDetails.map((d) => ({ mediaId: d.mediaId, title: d.title, sourceUrl: d.sourceUrl, usefulIntervals: d.usefulIntervals })),
    pendingVerificationCount: audit.funnelMetrics,
    visionDiagnostics: (audit as { observability?: unknown }).observability,
    stoppedReason: audit.stoppedReason,
  };
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    steamOrIgdbCalled: report.steamOrIgdbCalled,
    resolvedDomain: domain.domain,
    interpretationDomain: interpretation.domain,
    candidates: audit.candidatesByProvider,
    acquired: audit.acquiredFilesCount,
    visionAttempts: visionAttempts.map((v) => ({ frames: v.extractedFrames, ts: v.timestampsSec })),
    referenceReachedVisualAnalysis: report.referenceReachedVisualAnalysis,
    reference: reference
      ? { visual: reference.visualVerificationStatus, identity: reference.identity.approval, identityStatus: reference.identity.status, literal: reference.literalCorrespondence.status, contextual: reference.contextualSupport.status, usage: reference.usageAuthorization.status, role: reference.editorialRole }
      : null,
    approvedForAssembly: audit.approvedForAssemblyCount,
    stoppedReason: audit.stoppedReason,
    elapsedMs: report.elapsedMs,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

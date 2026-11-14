import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import {
  acquisitionIdempotencyKey,
  candidateIdentity,
  classifyVideoKind,
  exceedsAcquirableDuration,
  isOfficialChannel,
  tooLongReason,
  normalizeGameTitle,
  recommendSelection,
  rightsStatusForUsage,
  scoreCandidate,
  sourceCandidateSchema,
  usageForCandidate,
  type CandidateKind,
  type SourceCandidate,
  type VerifiedSubject,
} from '@neuralbridge/shared';
import type { AetheraStudioRepository } from '@neuralbridge/database';
import { z } from 'zod';
import type { ProductionStageAdapter } from '../velix-production.js';
import type { IgdbClient } from './game-sources.js';
import { runCheckpointedItems } from './item-checkpoint.js';

/**
 * Media Hunter of the Aethera Studio (AS-04). Discovery finds trailers and gameplay for the games the research stage
 * verified, checks identity and scores them; acquisition downloads the sources the person kept selected, resumably,
 * deduplicated by source and by content, and leaves them ready for visual indexing (AS-05).
 */

/** What the hunter needs from a video page, whatever tool read it (yt-dlp today). */
export interface VideoInfo { url: string; title: string; channel: string; channelVerified: boolean; durationSeconds: number | null; maxHeight: number | null; uploadDate: string | null; license: string | null; thumbnail: string | null }
export interface MediaMetadata { duration: number; width: number; height: number; fps: number | null; codecs: string[] }

/** The existing media library (Velix discovery repository): references and local assets are reused, not duplicated. */
export interface MediaLibraryPort {
  referenceByUrl(projectId: string, url: string): { id: string } | null;
  saveReference(input: { projectId: string; url: string; kind: string; title: string; publisher: string; publishedAt: string | null; reviewStatus: string; retrievedAt: string }): { id: string };
  saveAsset(input: { projectId: string; path: string; bytes: number; sha256: string; rightsStatus: string }): { id: string };
}

const SEARCHES: Array<{ suffix: string; kind: CandidateKind }> = [{ suffix: 'official trailer', kind: 'trailer' }, { suffix: 'gameplay', kind: 'gameplay' }];
const slug = (value: string) => normalizeGameTitle(value).replace(/ /g, '-').slice(0, 48) || 'jogo';
const subjectRef = (subject: VerifiedSubject) => ({ id: subject.id, title: subject.title, aliases: subject.aliases, companies: subject.companies });

export const mediaDiscoveryInputSchema = z.object({ searchCount: z.number().int().min(1).max(10).optional(), search: z.boolean().optional() });

export interface MediaDiscoveryDeps {
  repository: AetheraStudioRepository;
  library: MediaLibraryPort;
  igdb: () => Pick<IgdbClient, 'gameVideos'> | null;
  videoInfo: (urls: string[], signal?: AbortSignal) => Promise<VideoInfo[]>;
  search: (query: string, count: number, signal?: AbortSignal) => Promise<VideoInfo[]>;
  now?: () => Date;
}

export function createMediaDiscoveryStageAdapter(deps: MediaDiscoveryDeps): ProductionStageAdapter {
  const now = deps.now ?? (() => new Date());
  return {
    kind: 'media_discovery',
    run: async (context) => {
      const input = mediaDiscoveryInputSchema.parse(context.input);
      const subjects = deps.repository.listSubjects(context.runId);
      if (!subjects.length) throw new Error('invalid: pesquise os jogos antes de descobrir mídia.');
      const igdb = deps.igdb();
      await runCheckpointedItems(context, subjects.map((subject) => ({ id: subject.id, subject })), async ({ subject }) => {
        const found = new Map<string, { info: VideoInfo; source: SourceCandidate['source']; hint: string }>();
        if (igdb && subject.externalIds.igdb) {
          const videos = await igdb.gameVideos(Number(subject.externalIds.igdb), context.signal);
          const names = new Map(videos.map((video) => [`https://www.youtube.com/watch?v=${video.videoId}`, video.name]));
          for (const info of await deps.videoInfo([...names.keys()], context.signal)) found.set(info.url, { info, source: 'igdb_video', hint: names.get(info.url) ?? '' });
        }
        if (input.search !== false) {
          for (const search of SEARCHES) {
            for (const info of await deps.search(`${subject.title} ${search.suffix}`, input.searchCount ?? 4, context.signal)) if (!found.has(info.url)) found.set(info.url, { info, source: 'youtube_search', hint: '' });
          }
        }
        const others = subjects.filter((other) => other.id !== subject.id).map(subjectRef);
        for (const { info, source, hint } of found.values()) {
          const official = isOfficialChannel(info.channel, subject.companies);
          const identity = candidateIdentity({ candidate: { source, title: info.title, official, channel: info.channel }, subject: subjectRef(subject), otherSubjects: others });
          const kindFromHint = classifyVideoKind(hint);
          const kind = kindFromHint !== 'other' ? kindFromHint : classifyVideoKind(info.title);
          const scored = scoreCandidate({ official, channelVerified: info.channelVerified, identity: identity.status, maxHeight: info.maxHeight, kind, durationSeconds: info.durationSeconds });
          const reference = deps.library.referenceByUrl(context.projectId, info.url) ?? deps.library.saveReference({ projectId: context.projectId, url: info.url, kind: 'video', title: info.title, publisher: info.channel || 'desconhecido', publishedAt: info.uploadDate, reviewStatus: 'pending', retrievedAt: now().toISOString() });
          const candidate = deps.repository.saveCandidate(sourceCandidateSchema.parse({
            schemaVersion: 1, id: randomUUID(), runId: context.runId, subjectId: subject.id, referenceId: reference.id, url: info.url, source, kind, title: info.title, channel: info.channel, channelVerified: info.channelVerified, official,
            durationSeconds: info.durationSeconds, maxHeight: info.maxHeight, publishedAt: info.uploadDate, license: info.license, thumbnailUrl: info.thumbnail, score: scored.score, reasons: scored.reasons, identity: identity.status, status: 'proposed', discoveredAt: now().toISOString(),
          }));
          deps.repository.logUsage({ runId: context.runId, candidateId: candidate.id, subjectId: subject.id, event: 'discovered', detail: `${source} · ${identity.status}` });
        }
        return { status: 'done', result: { found: found.size } };
      });
      // A recommendation, not a decision: proposed sources become selected; the person can still change them.
      const all = deps.repository.listCandidates(context.runId);
      for (const id of recommendSelection(all)) if (all.find((candidate) => candidate.id === id)?.status === 'proposed') deps.repository.setCandidateStatus(id, 'selected');
      return undefined;
    },
  };
}

export const mediaAcquisitionInputSchema = z.object({ candidateIds: z.array(z.string().min(1)).max(100).optional(), maxAttempts: z.number().int().min(1).max(5).optional(), autonomous: z.boolean().optional(), maxAutonomousPerSubject: z.number().int().min(1).max(10).optional() });

export interface MediaAcquisitionDeps {
  repository: AetheraStudioRepository;
  library: MediaLibraryPort;
  acquire: (input: { url: string; root: string; relativeDir: string; fileStem: string; signal: AbortSignal; onProgress: (progress: { bytesDone: number; bytesTotal: number | null }) => void }) => Promise<{ relativePath: string }>;
  probe: (input: { root: string; relativePath: string; signal: AbortSignal }) => Promise<MediaMetadata>;
  hashFile: (absolutePath: string) => Promise<{ sha256: string; bytes: number }>;
  projectRoot: (projectId: string) => string | null;
  formatId: string;
  adapterVersion: () => Promise<string>;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => Date;
}

const abortableSleep = (ms: number, signal: AbortSignal) => new Promise<void>((done, fail) => {
  const timer = setTimeout(done, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); fail(new Error('cancelled: aquisição interrompida.')); }, { once: true });
});
const errorCode = (message: string) => /^([a-z_]+):/.exec(message)?.[1] ?? 'network';
const RETRYABLE = new Set(['network', 'forbidden']);

/** Autonomously selects top non-rejected candidates per subject when no manual selection was provided. */
export function selectAutonomousMediaCandidates(candidates: readonly SourceCandidate[], maxPerSubject = 2): SourceCandidate[] {
  const bySubject = new Map<string, SourceCandidate[]>();
  for (const candidate of candidates) {
    if (candidate.identity === 'rejected' || candidate.status === 'skipped') continue;
    const list = bySubject.get(candidate.subjectId) ?? [];
    list.push(candidate);
    bySubject.set(candidate.subjectId, list);
  }
  const picked: SourceCandidate[] = [];
  for (const list of bySubject.values()) {
    list.sort((a, b) => b.score - a.score);
    picked.push(...list.slice(0, maxPerSubject));
  }
  return picked;
}

export function createMediaAcquisitionStageAdapter(deps: MediaAcquisitionDeps): ProductionStageAdapter {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? abortableSleep;
  return {
    kind: 'media_acquisition',
    run: async (context) => {
      const input = mediaAcquisitionInputSchema.parse(context.input);
      const root = deps.projectRoot(context.projectId);
      if (!root) throw new Error('not_found: projeto de vídeo sem pasta.');
      const allCandidates = deps.repository.listCandidates(context.runId);
      let chosen = (context.state['candidates'] as string[] | undefined) ?? allCandidates.filter((candidate) => (input.candidateIds ? input.candidateIds.includes(candidate.id) : candidate.status === 'selected')).map((candidate) => candidate.id);
      if (!chosen.length && !input.candidateIds && input.autonomous !== false) {
        const autoPicked = selectAutonomousMediaCandidates(allCandidates, input.maxAutonomousPerSubject ?? 2);
        for (const candidate of autoPicked) {
          deps.repository.setCandidateStatus(candidate.id, 'selected');
          deps.repository.logUsage({ runId: context.runId, candidateId: candidate.id, subjectId: candidate.subjectId, event: 'autonomous_selected', detail: `selecionado autonomamente (score=${candidate.score})` });
        }
        chosen = autoPicked.map((candidate) => candidate.id);
      }
      if (!chosen.length) throw new Error('invalid: selecione ao menos uma fonte para adquirir.');
      context.state['candidates'] = chosen;
      context.saveState({ ...context.state, candidates: chosen });
      const subjects = new Map(deps.repository.listSubjects(context.runId).map((subject) => [subject.id, subject]));
      const adapterVersion = await deps.adapterVersion().catch(() => 'desconhecida');
      const maxAttempts = input.maxAttempts ?? 3;
      await runCheckpointedItems(context, chosen.map((id) => ({ id })), async ({ id }) => {
        const candidate = deps.repository.candidate(id);
        const subject = candidate ? subjects.get(candidate.subjectId) : undefined;
        if (!candidate || !subject) return { status: 'skipped', reason: 'fonte ou jogo não encontrado' };
        // Identity is checked before anything is downloaded or attached to the project.
        if (candidate.identity === 'rejected') {
          deps.repository.setCandidateStatus(id, 'skipped');
          deps.repository.logUsage({ runId: context.runId, candidateId: id, subjectId: subject.id, event: 'identity_rejected', detail: 'não baixado: o vídeo parece ser de outro jogo' });
          return { status: 'skipped', reason: 'identidade rejeitada' };
        }
        // Checked against the duration known at discovery, before contacting the source: no tens of GB for nothing.
        if (exceedsAcquirableDuration(candidate.kind, candidate.durationSeconds)) {
          const reason = tooLongReason(candidate.kind);
          const stale = deps.repository.listAcquisitions(context.runId).filter((item) => item.idempotencyKey === acquisitionIdempotencyKey(candidate.url, deps.formatId) && item.status !== 'done');
          for (const item of stale) deps.repository.updateAcquisition(item.id, { status: 'failed', error: { code: 'format', message: `fonte ${reason}`, retryable: false } });
          deps.repository.setCandidateStatus(id, 'skipped');
          deps.repository.logUsage({ runId: context.runId, candidateId: id, subjectId: subject.id, event: 'too_long', detail: `não baixado: ${Math.round((candidate.durationSeconds ?? 0) / 60)} min, ${reason}` });
          return { status: 'skipped', reason };
        }
        const key = acquisitionIdempotencyKey(candidate.url, deps.formatId);
        const acquired = deps.repository.acquiredForKey(context.projectId, key);
        // A record is only reusable while its file is still on disk; a deleted file is downloaded again into the same asset.
        const reusedPath = acquired?.result ? deps.repository.assetBySha(context.projectId, acquired.result.contentHash)?.path : undefined;
        const reused = reusedPath && existsSync(context.resolvePath(reusedPath)) ? acquired : null;
        if (acquired?.result && !reused) deps.repository.logUsage({ runId: context.runId, assetId: acquired.result.assetId, candidateId: id, subjectId: subject.id, event: 'missing_file', detail: 'arquivo adquirido não está mais no disco; baixando de novo' });
        const job = deps.repository.enqueueAcquisition({ runId: context.runId, subjectId: subject.id, referenceId: candidate.referenceId ?? candidate.id, adapter: 'yt-dlp', idempotencyKey: key });
        if (reused?.result) {
          if (job.status !== 'done') deps.repository.updateAcquisition(job.id, { status: 'done', result: reused.result, bytesDone: job.bytesDone });
          deps.repository.setCandidateStatus(id, 'acquired');
          deps.repository.logUsage({ runId: context.runId, assetId: reused.result.assetId, candidateId: id, subjectId: subject.id, event: 'reused', detail: 'mesma origem já adquirida neste projeto' });
          return { status: 'done', result: { assetId: reused.result.assetId } };
        }
        let relativePath: string | null = null;
        // A new acquisition request after a final failure gets fresh attempts; an interrupted one keeps counting.
        const startAttempt = job.status === 'failed' || job.status === 'done' ? 0 : job.attempt;
        for (let attempt = startAttempt + 1; attempt <= maxAttempts && !relativePath; attempt += 1) {
          deps.repository.updateAcquisition(job.id, { status: 'running', attempt });
          let lastSaved = 0;
          try {
            ({ relativePath } = await deps.acquire({
              url: candidate.url, root, relativeDir: `media/aethera/${slug(subject.title)}`, fileStem: `${candidate.kind}-${slug(candidate.url.split(/[=/]/).at(-1) ?? id)}`, signal: context.signal,
              onProgress: (progress) => { const time = Date.now(); if (time - lastSaved < 1_000 && progress.bytesDone !== progress.bytesTotal) return; lastSaved = time; deps.repository.updateAcquisition(job.id, { bytesDone: progress.bytesDone, bytesTotal: progress.bytesTotal }); },
            }));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const code = context.signal.aborted ? 'cancelled' : errorCode(message);
            if (code === 'cancelled') { deps.repository.updateAcquisition(job.id, { status: 'paused' }); throw new Error('cancelled: aquisição interrompida; o arquivo parcial fica para a retomada.', { cause: error }); }
            const known = (['unavailable', 'forbidden', 'format', 'network', 'tool_missing', 'tool_outdated'] as const).find((item) => item === code) ?? 'network';
            const last = attempt >= maxAttempts || !RETRYABLE.has(code);
            if (last) {
              deps.repository.updateAcquisition(job.id, { status: 'failed', error: { code: known, message: message.slice(0, 500), retryable: RETRYABLE.has(code) } });
              deps.repository.setCandidateStatus(id, 'failed');
              deps.repository.logUsage({ runId: context.runId, candidateId: id, subjectId: subject.id, event: 'failed', detail: message.slice(0, 300) });
              if (code === 'tool_missing') throw new Error(message, { cause: error });
              return { status: 'skipped', reason: message.slice(0, 200) };
            }
            await sleep(1_000 * 2 ** (attempt - 1), context.signal);
          }
        }
        if (!relativePath) return { status: 'skipped', reason: 'sem arquivo' };
        const absolute = context.resolvePath(relativePath);
        let sha256: string;
        let bytes: number;
        let duplicate: ReturnType<typeof deps.repository.assetBySha>;
        let metadata: MediaMetadata;
        try {
          ({ sha256, bytes } = await deps.hashFile(absolute));
          duplicate = deps.repository.assetBySha(context.projectId, sha256);
          if (duplicate && duplicate.path !== relativePath) rmSync(absolute, { force: true });
          metadata = await deps.probe({ root, relativePath: duplicate?.path ?? relativePath, signal: context.signal });
        } catch (error) {
          // The file arrived but cannot be accepted: the job must say so instead of staying "running" forever.
          const message = error instanceof Error ? error.message : String(error);
          if (context.signal.aborted) { deps.repository.updateAcquisition(job.id, { status: 'paused' }); throw new Error('cancelled: aquisição interrompida durante a verificação do arquivo.', { cause: error }); }
          deps.repository.updateAcquisition(job.id, { status: 'failed', error: { code: 'format', message: `arquivo recusado após o download: ${message}`.slice(0, 500), retryable: false } });
          deps.repository.setCandidateStatus(id, 'failed');
          deps.repository.logUsage({ runId: context.runId, candidateId: id, subjectId: subject.id, event: 'failed', detail: `arquivo baixado em ${relativePath} foi recusado: ${message}`.slice(0, 300) });
          return { status: 'skipped', reason: message.slice(0, 200) };
        }
        const identity = candidateIdentity({ candidate: candidate, subject: subjectRef(subject), otherSubjects: [...subjects.values()].filter((other) => other.id !== subject.id).map(subjectRef) });
        const usage = usageForCandidate({ official: candidate.official, identity: candidate.identity });
        const assetId = duplicate?.id ?? deps.library.saveAsset({ projectId: context.projectId, path: relativePath, bytes, sha256, rightsStatus: rightsStatusForUsage(usage) }).id;
        const acquiredAt = now().toISOString();
        if (!deps.repository.provenance(assetId)) {
          deps.repository.saveProvenance({
            schemaVersion: 1, assetId, url: candidate.url, platform: new URL(candidate.url).hostname.replace(/^www\./, ''), publisher: candidate.channel || 'desconhecido', official: candidate.official, publishedAt: candidate.publishedAt, license: candidate.license,
            knownRestrictions: [...(candidate.license ? [`licença declarada: ${candidate.license}`] : ['licença não declarada pela fonte']), ...(candidate.official ? [] : ['canal não oficial']), ...(candidate.identity === 'verified' ? [] : ['identidade do jogo a revisar'])],
            adapter: 'yt-dlp', adapterVersion, acquiredAt, usage, legalClearance: 'unknown',
          });
          deps.repository.recordIdentity({ schemaVersion: 1, id: randomUUID(), assetId, segmentId: null, subjectId: subject.id, signals: identity.signals, status: identity.status, calibratedConfidence: Math.max(0, ...identity.signals.filter((signal) => signal.verdict === 'match').map((signal) => signal.score)), verifiedBy: 'rules' });
        }
        const video = metadata.codecs.find((codec) => !/aac|mp3|opus|vorbis/i.test(codec)) ?? 'desconhecido';
        const audio = metadata.codecs.find((codec) => /aac|mp3|opus|vorbis/i.test(codec)) ?? null;
        deps.repository.updateAcquisition(job.id, { status: 'done', bytesDone: bytes, bytesTotal: bytes, result: { assetId, contentHash: sha256, width: metadata.width, height: metadata.height, fps: metadata.fps ?? 30, durationMs: Math.max(1, Math.round(metadata.duration * 1_000)), vcodec: video, acodec: audio } });
        deps.repository.setCandidateStatus(id, 'acquired');
        deps.repository.logUsage({ runId: context.runId, assetId, candidateId: id, subjectId: subject.id, event: duplicate ? 'deduplicated' : 'acquired', detail: `${metadata.width}x${metadata.height} · ${usage}` });
        return { status: 'done', result: { assetId } };
      });
      writeIndexManifest(context, deps.repository);
      return undefined;
    },
  };
}

/** AS-05 hand-off: what was acquired for this run, per game, with metadata, editorial usage and identity. */
function writeIndexManifest(context: Parameters<ProductionStageAdapter['run']>[0], repository: AetheraStudioRepository): void {
  const subjects = repository.listSubjects(context.runId);
  const assets = repository.listAcquisitions(context.runId).filter((job) => job.status === 'done' && job.result).map((job) => {
    const provenance = job.result ? repository.provenance(job.result.assetId) : null;
    return { assetId: job.result?.assetId, subjectId: job.subjectId, sourceUrl: provenance?.url ?? null, usage: provenance?.usage ?? null, legalClearance: provenance?.legalClearance ?? 'unknown', metadata: job.result };
  }).filter((asset) => asset.usage !== 'blocked');
  context.writeArtifact({ kind: 'media-index-manifest', relativePath: 'media/aethera/manifest.json', mime: 'application/json', content: JSON.stringify({ schemaVersion: 1, runId: context.runId, games: subjects.map((subject) => ({ subjectId: subject.id, title: subject.title, verification: subject.verification, assets: assets.filter((asset) => asset.subjectId === subject.id) })) }, null, 2) });
}

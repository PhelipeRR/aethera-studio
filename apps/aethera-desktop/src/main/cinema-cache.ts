import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';

export interface CinemaCacheEntry {
  cacheId: string;
  sha256: string;
  url: string;
  origin: string;
  license: string;
  topic: string;
  query: string;
  filePath: string;
  width: number;
  height: number;
  durationSec: number;
  consumers: string[];
  createdAt: string;
  lastUsedAt: string;
}

interface CinemaCacheIndex {
  version: 1;
  entries: CinemaCacheEntry[];
}

export function isPathStrictlyInside(targetPath: string, rootDir: string): boolean {
  const absRoot = resolve(rootDir);
  const absTarget = resolve(targetPath);
  const rel = relative(absRoot, absTarget);
  return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel);
}

export function computeFileSha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function normalizeTextTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3),
  );
}

export function isTopicAdequate(expectedTopic: string, candidateTopic: string): boolean {
  const a = normalizeTextTokens(expectedTopic);
  const b = normalizeTextTokens(candidateTopic);
  if (a.size === 0 || b.size === 0) return false;
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }
  return overlap >= 1;
}

export class CinemaSmartCache {
  private readonly indexPath: string;
  private readonly filesDir: string;

  constructor(private readonly cacheDir: string) {
    this.indexPath = join(cacheDir, 'index.json');
    this.filesDir = join(cacheDir, 'files');
    mkdirSync(this.filesDir, { recursive: true });
  }

  private loadIndex(): CinemaCacheIndex {
    if (!existsSync(this.indexPath)) {
      return { version: 1, entries: [] };
    }
    try {
      const parsed = JSON.parse(readFileSync(this.indexPath, 'utf8')) as Partial<CinemaCacheIndex>;
      return {
        version: 1,
        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      };
    } catch {
      return { version: 1, entries: [] };
    }
  }

  private saveIndex(index: CinemaCacheIndex): void {
    mkdirSync(this.cacheDir, { recursive: true });
    writeFileSync(this.indexPath, JSON.stringify(index, null, 2), 'utf8');
  }

  listEntries(): CinemaCacheEntry[] {
    return this.loadIndex().entries;
  }

  /**
   * Finds a verified cache entry ONLY when URL matches and both file integrity (sha256)
   * and subject/topic adequacy are verified.
   */
  findVerifiedMatch(input: {
    url: string;
    topic: string;
    minWidth?: number;
    minDurationSec?: number;
  }): CinemaCacheEntry | null {
    const cleanUrl = input.url.trim();
    if (!cleanUrl) return null;
    const index = this.loadIndex();
    const candidate = index.entries.find((e) => e.url === cleanUrl);
    if (!candidate) return null;
    if (!existsSync(candidate.filePath) || !isPathStrictlyInside(candidate.filePath, this.cacheDir)) {
      return null;
    }
    try {
      const actualHash = computeFileSha256(candidate.filePath);
      if (actualHash !== candidate.sha256) return null;
    } catch {
      return null;
    }
    if (!isTopicAdequate(input.topic, `${candidate.topic} ${candidate.query}`)) {
      return null;
    }
    if (input.minWidth && candidate.width > 0 && candidate.width < input.minWidth) {
      return null;
    }
    if (input.minDurationSec && candidate.durationSec > 0 && candidate.durationSec < input.minDurationSec) {
      return null;
    }
    return candidate;
  }

  registerConsumer(input: {
    url: string;
    origin: string;
    license: string;
    topic: string;
    query: string;
    sourceFilePath: string;
    width: number;
    height: number;
    durationSec: number;
    projectId: string;
  }): CinemaCacheEntry {
    const sha256 = computeFileSha256(input.sourceFilePath);
    const ext = extname(input.sourceFilePath) || '.mp4';
    const cachedFilePath = join(this.filesDir, `${sha256.slice(0, 24)}${ext}`);
    if (!existsSync(cachedFilePath)) {
      copyFileSync(input.sourceFilePath, cachedFilePath);
    }

    const index = this.loadIndex();
    const now = new Date().toISOString();
    const existing = index.entries.find((e) => e.url === input.url && e.sha256 === sha256);
    if (existing) {
      if (!existing.consumers.includes(input.projectId)) {
        existing.consumers.push(input.projectId);
      }
      existing.lastUsedAt = now;
      this.saveIndex(index);
      return existing;
    }

    const entry: CinemaCacheEntry = {
      cacheId: `cache_${sha256.slice(0, 12)}`,
      sha256,
      url: input.url,
      origin: input.origin,
      license: input.license,
      topic: input.topic,
      query: input.query,
      filePath: cachedFilePath,
      width: input.width,
      height: input.height,
      durationSec: input.durationSec,
      consumers: [input.projectId],
      createdAt: now,
      lastUsedAt: now,
    };
    index.entries.push(entry);
    this.saveIndex(index);
    return entry;
  }

  /**
   * Releases a project's consumer reference. Only deletes cached files when
   * zero consumers remain AND the file is strictly inside cacheDir.
   */
  releaseConsumer(projectId: string): {
    removedCacheFiles: string[];
    preservedSharedEntries: number;
  } {
    const index = this.loadIndex();
    const removedCacheFiles: string[] = [];
    let preservedSharedEntries = 0;
    const keptEntries: CinemaCacheEntry[] = [];

    for (const entry of index.entries) {
      const hadConsumer = entry.consumers.includes(projectId);
      const nextConsumers = entry.consumers.filter((id) => id !== projectId);
      if (nextConsumers.length > 0) {
        if (hadConsumer) preservedSharedEntries += 1;
        keptEntries.push({ ...entry, consumers: nextConsumers });
      }
    }

    const stillReferencedFiles = new Set(keptEntries.map((e) => e.filePath));
    for (const entry of index.entries) {
      const hadConsumer = entry.consumers.includes(projectId);
      const nextConsumers = entry.consumers.filter((id) => id !== projectId);
      if (
        nextConsumers.length === 0 &&
        hadConsumer &&
        !stillReferencedFiles.has(entry.filePath) &&
        existsSync(entry.filePath) &&
        isPathStrictlyInside(entry.filePath, this.cacheDir)
      ) {
        try {
          unlinkSync(entry.filePath);
          removedCacheFiles.push(entry.filePath);
        } catch {
          // ignore unlink errors
        }
      }
    }

    index.entries = keptEntries;
    this.saveIndex(index);
    return { removedCacheFiles, preservedSharedEntries };
  }
}

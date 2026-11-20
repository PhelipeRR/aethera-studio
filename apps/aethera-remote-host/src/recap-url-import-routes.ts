/**
 * Standalone Remote Host HTTP + SSE routes for Aethera Recap URL Chapter Importer (Etapa 5).
 * Enforces SSRF validation, safe storage paths, authenticated scopes, and SSE real-time progress.
 */

import type { Express, RequestHandler } from 'express';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { isAbsolute, join, relative, resolve } from 'node:path';

interface RemoteImportItem {
  url: string;
  status: 'pending' | 'analyzing' | 'downloading' | 'packing_cbz' | 'completed' | 'failed' | 'cancelled';
  pagesDone: number;
  pagesTotal: number;
  cbzPath?: string;
  error?: string;
}

interface RemoteImportJob {
  id: string;
  status: 'queued' | 'running' | 'cancelled' | 'completed' | 'failed';
  items: RemoteImportItem[];
  createdAtIso: string;
  updatedAtIso: string;
}

function validateSsrfUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error('URL inválida.');
  }
  if (u.protocol !== 'https:') throw new Error('Apenas URLs HTTPS são permitidas.');
  if (u.username || u.password) throw new Error('Credenciais embutidas na URL são bloqueadas.');
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    throw new Error(`SSRF bloqueado: host interno (${host}).`);
  }
  if (isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && (b ?? 0) >= 16 && (b ?? 0) <= 31)) {
      throw new Error(`SSRF bloqueado: IP privado (${host}).`);
    }
  }
  return u;
}

function isSupportedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return ['asurascans.com', 'www.asurascans.com', 'asuracomic.net', 'www.asuracomic.net', 'asuracomics.com', 'www.asuracomics.com'].some(
    (s) => h === s || h.endsWith(`.${s}`),
  );
}

function extractPagesFromHtml(html: string, baseUrl: URL): Array<{ pageNumber: number; imageUrl: string }> {
  const found: Array<{ order: number; idx: number; url: string }> = [];
  const re = /<([a-z0-9]+)\b[^>]*\bdata-page\s*=\s*(?:"(\d+)"|'(\d+)'|(\d+))[^>]*>([\s\S]*?)<\/\1>|<img\b[^>]*\bdata-page\s*=\s*(?:"(\d+)"|'(\d+)'|(\d+))[^>]*\/?>/gi;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(html)) !== null) {
    idx++;
    const isImg = m[0].toLowerCase().startsWith('<img');
    const order = Number.parseInt((isImg ? (m[6] ?? m[7] ?? m[8]) : (m[2] ?? m[3] ?? m[4])) ?? String(idx), 10);
    const tag = isImg ? m[0] : (/<img\b[^>]*>/i.exec(m[5] ?? '')?.[0] ?? '');
    if (!tag) continue;
    const srcMatch = /\b(?:data-src|data-lazy-src|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const rawSrc = (srcMatch?.[1] ?? srcMatch?.[2] ?? '').trim();
    if (!rawSrc || rawSrc.startsWith('data:')) continue;
    try {
      const resolved = new URL(rawSrc, baseUrl);
      if (resolved.protocol === 'https:') found.push({ order, idx, url: resolved.toString() });
    } catch {
      // ignore invalid
    }
  }
  found.sort((a, b) => (a.order !== b.order ? a.order - b.order : a.idx - b.idx));
  const seen = new Set<string>();
  const pages: Array<{ pageNumber: number; imageUrl: string }> = [];
  for (const f of found) {
    if (seen.has(f.url)) continue;
    seen.add(f.url);
    pages.push({ pageNumber: pages.length + 1, imageUrl: f.url });
  }
  return pages;
}

async function safeFetch(rawUrl: string, referer?: string, signal?: AbortSignal): Promise<Response> {
  let current = validateSsrfUrl(rawUrl);
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(current.toString(), {
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        ...(referer ? { Referer: referer } : {}),
      },
      ...(signal ? { signal } : {}),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('Redirecionamento inválido sem Location.');
      current = validateSsrfUrl(new URL(loc, current).toString());
      continue;
    }
    return res;
  }
  throw new Error('Muitos redirecionamentos.');
}

export function registerRecapUrlImportRoutes(input: {
  app: Express;
  libraryRootDir: string;
  requireRead: RequestHandler;
  requireWrite: RequestHandler;
  requireControl: RequestHandler;
}): void {
  const { app, libraryRootDir, requireRead, requireWrite, requireControl } = input;
  const jobs = new Map<string, RemoteImportJob>();
  const controllers = new Map<string, AbortController>();
  const listeners = new Map<string, Set<(job: RemoteImportJob) => void>>();

  const emit = (job: RemoteImportJob) => {
    job.updatedAtIso = new Date().toISOString();
    const set = listeners.get(job.id);
    if (!set) return;
    const snap = structuredClone(job);
    for (const fn of set) fn(snap);
  };

  const runJob = async (jobId: string) => {
    const job = jobs.get(jobId);
    if (!job) return;
    const ctrl = new AbortController();
    controllers.set(jobId, ctrl);
    job.status = 'running';
    emit(job);

    const safeRoot = resolve(libraryRootDir);
    if (!existsSync(safeRoot)) mkdirSync(safeRoot, { recursive: true });

    try {
      for (const item of job.items) {
        if (ctrl.signal.aborted || (job.status as string) === 'cancelled') return;
        if (item.status === 'completed') continue;
        try {
          item.status = 'analyzing';
          emit(job);
          const u = validateSsrfUrl(item.url);
          if (!isSupportedHost(u.hostname)) throw new Error(`Domínio não suportado: ${u.hostname}`);
          const pageRes = await safeFetch(u.toString(), undefined, ctrl.signal);
          if (!pageRes.ok) throw new Error(`HTTP ${pageRes.status} ao carregar capítulo.`);
          const html = await pageRes.text();
          if (/cf-challenge|captcha|paywall/i.test(html)) {
            throw new Error('Acesso restrito pelo site (CAPTCHA/paywall). Nenhum bypass é realizado.');
          }
          const pages = extractPagesFromHtml(html, u);
          if (pages.length === 0) throw new Error('Nenhuma imagem [data-page] detectada no capítulo.');

          item.pagesTotal = pages.length;
          item.status = 'downloading';
          emit(job);

          const slug = createHash('sha256').update(u.toString()).digest('hex').slice(0, 12);
          const targetDir = resolve(safeRoot, 'remote-imports', slug);
          const rel = relative(safeRoot, targetDir);
          if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Caminho inseguro.');
          mkdirSync(targetDir, { recursive: true });

          for (const p of pages) {
            if (ctrl.signal.aborted) throw new Error('Cancelado.');
            const imgRes = await safeFetch(p.imageUrl, u.toString(), ctrl.signal);
            if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status} na página ${p.pageNumber}`);
            const buf = Buffer.from(await imgRes.arrayBuffer());
            if (buf.length < 128) throw new Error(`Imagem inválida na página ${p.pageNumber}`);
            writeFileSync(join(targetDir, `${String(p.pageNumber).padStart(3, '0')}.img`), buf);
            item.pagesDone++;
            emit(job);
          }

          item.cbzPath = targetDir;
          item.status = 'completed';
          emit(job);
        } catch (err) {
          item.status = ctrl.signal.aborted ? 'cancelled' : 'failed';
          item.error = err instanceof Error ? err.message : String(err);
          emit(job);
        }
      }
      if ((job.status as string) !== 'cancelled') {
        job.status = job.items.some((i) => i.status === 'failed') ? 'failed' : 'completed';
      }
      emit(job);
    } finally {
      controllers.delete(jobId);
    }
  };

  app.post('/api/recap/import/analyze', requireWrite, async (req, res) => {
    try {
      const rawUrl = String((req.body as { url?: string })?.url ?? '');
      const u = validateSsrfUrl(rawUrl);
      if (!isSupportedHost(u.hostname)) {
        res.status(400).json({ error: `Domínio "${u.hostname}" ainda não possui adaptador suportado.` });
        return;
      }
      const pageRes = await safeFetch(u.toString());
      if (!pageRes.ok) {
        res.status(502).json({ error: `Erro ao consultar página (HTTP ${pageRes.status}).` });
        return;
      }
      const html = await pageRes.text();
      if (/cf-challenge|captcha|paywall/i.test(html)) {
        res.status(403).json({ error: 'Acesso restrito pelo site (CAPTCHA/paywall). Nenhum bypass é realizado.' });
        return;
      }
      const pages = extractPagesFromHtml(html, u);
      res.json({ sourceUrl: u.toString(), adapterId: 'asurascans', pageCount: pages.length, pages });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/recap/import/jobs', requireWrite, (req, res) => {
    try {
      const body = req.body as { url?: string; urls?: string[] };
      const urls = Array.isArray(body.urls) && body.urls.length > 0 ? body.urls : body.url ? [body.url] : [];
      if (urls.length === 0) {
        res.status(400).json({ error: 'Informe url ou urls para importar.' });
        return;
      }
      for (const u of urls) validateSsrfUrl(u);
      const id = `rimp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const now = new Date().toISOString();
      const job: RemoteImportJob = {
        id,
        status: 'queued',
        items: urls.map((url) => ({ url, status: 'pending', pagesDone: 0, pagesTotal: 0 })),
        createdAtIso: now,
        updatedAtIso: now,
      };
      jobs.set(id, job);
      void runJob(id);
      res.status(201).json(job);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/recap/import/jobs/:id', requireRead, (req, res) => {
    const job = jobs.get(String(req.params.id));
    if (!job) {
      res.status(404).json({ error: 'Job de importação não encontrado.' });
      return;
    }
    res.json(job);
  });

  app.get('/api/recap/import/jobs/:id/events', requireRead, (req, res) => {
    const id = String(req.params.id);
    const job = jobs.get(id);
    if (!job) {
      res.status(404).json({ error: 'Job não encontrado.' });
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(`data: ${JSON.stringify(job)}\n\n`);
    const set = listeners.get(id) ?? new Set();
    const onUpdate = (snap: RemoteImportJob) => {
      res.write(`data: ${JSON.stringify(snap)}\n\n`);
    };
    set.add(onUpdate);
    listeners.set(id, set);
    req.on('close', () => {
      set.delete(onUpdate);
    });
  });

  app.post('/api/recap/import/jobs/:id/cancel', requireControl, (req, res) => {
    const id = String(req.params.id);
    const job = jobs.get(id);
    if (!job) {
      res.status(404).json({ error: 'Job não encontrado.' });
      return;
    }
    controllers.get(id)?.abort();
    job.status = 'cancelled';
    emit(job);
    res.json(job);
  });

  app.post('/api/recap/import/jobs/:id/retry', requireWrite, (req, res) => {
    const id = String(req.params.id);
    const job = jobs.get(id);
    if (!job) {
      res.status(404).json({ error: 'Job não encontrado.' });
      return;
    }
    for (const item of job.items) {
      if (item.status === 'failed' || item.status === 'cancelled') {
        item.status = 'pending';
        item.pagesDone = 0;
        delete item.error;
      }
    }
    job.status = 'queued';
    emit(job);
    void runJob(id);
    res.json(job);
  });
}

/**
 * Standalone Remote Host HTTP + SSE routes for Aethera Recap URL Chapter Importer (Etapa 5).
 * Enforces SSRF validation, safe storage paths, authenticated scopes, and SSE real-time progress.
 */

import type { Express, RequestHandler } from 'express';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { defaultSiteAdapterRegistry } from '@neuralbridge/cinema/recap';

interface RemoteImportItem {
  url: string;
  status: 'pending' | 'analyzing' | 'downloading' | 'packing_cbz' | 'completed' | 'failed' | 'cancelled';
  pagesDone: number;
  pagesTotal: number;
  cbzPath?: string;
  error?: string;
  blockedByProtection?: boolean;
}

interface RemoteImportJob {
  id: string;
  status: 'queued' | 'running' | 'cancelled' | 'completed' | 'failed';
  items: RemoteImportItem[];
  createdAtIso: string;
  updatedAtIso: string;
  blockedByProtection?: boolean;
  blockedUrl?: string;
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
      const blockedHosts = new Set<string>();
      for (const item of job.items) {
        if (ctrl.signal.aborted || (job.status as string) === 'cancelled') return;
        if (item.status === 'completed') continue;
        let itemHost = '';
        try {
          itemHost = new URL(item.url).hostname.toLowerCase();
        } catch {
          itemHost = '';
        }
        if (itemHost && blockedHosts.has(itemHost)) {
          item.status = 'failed';
          item.blockedByProtection = true;
          item.error = `Tentativa automática interrompida: "${itemHost}" protegido por Cloudflare/HTTP 403. Use a Importação Assistida pelo Navegador.`;
          emit(job);
          continue;
        }
        try {
          item.status = 'analyzing';
          emit(job);
          const u = validateSsrfUrl(item.url);
          const { adapter } = defaultSiteAdapterRegistry.resolveAdapterOrUniversal(u);
          const pageRes = await safeFetch(u.toString(), undefined, ctrl.signal);
          if (!pageRes.ok) throw new Error(`HTTP ${pageRes.status} ao carregar capítulo.`);
          const html = await pageRes.text();
          const restricted = adapter.detectAccessRestriction?.(html, u);
          if (restricted) {
            throw new Error(restricted);
          }
          const pages = adapter.extractPagesFromHtml(html, u);
          if (pages.length === 0) throw new Error('[content_not_recognized] Conteúdo não reconhecido: nenhuma sequência de imagens de capítulo detectada.');

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
          const errMsg = err instanceof Error ? err.message : String(err);
          item.error = errMsg;
          if (/cloudflare|captcha|challenge|403/i.test(errMsg)) {
            item.blockedByProtection = true;
            job.blockedByProtection = true;
            if (!job.blockedUrl) job.blockedUrl = item.url;
            if (itemHost) blockedHosts.add(itemHost);
          }
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
      const { adapter, acquisitionMethod } = defaultSiteAdapterRegistry.resolveAdapterOrUniversal(u);
      const pageRes = await safeFetch(u.toString());
      if (!pageRes.ok) {
        res.status(502).json({ error: `Erro ao consultar página (HTTP ${pageRes.status}).` });
        return;
      }
      const html = await pageRes.text();
      const restricted = adapter.detectAccessRestriction?.(html, u);
      if (restricted) {
        res.status(403).json({ error: restricted });
        return;
      }
      const pages = adapter.extractPagesFromHtml(html, u);
      if (pages.length === 0) {
        res.status(422).json({ error: '[content_not_recognized] Conteúdo não reconhecido: nenhuma sequência de imagens de capítulo encontrada.' });
        return;
      }
      res.json({
        sourceUrl: u.toString(),
        adapterId: adapter.id,
        adapterName: adapter.displayName,
        acquisitionMethod,
        pageCount: pages.length,
        pages,
      });
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

  // ─── Assisted Browser Import (Remote Host) ─────────────────────────────────
  app.post('/api/recap/import/open-browser', requireRead, (req, res) => {
    try {
      const rawUrl = String((req.body as { url?: string })?.url ?? '');
      const u = validateSsrfUrl(rawUrl);
      res.json({ openUrl: u.toString(), mode: 'assisted_browser' });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/recap/import/assisted', requireWrite, (req, res) => {
    try {
      const body = req.body as {
        workTitle?: string;
        chapterNumber?: string;
        sourceUrl?: string;
        seriesProjectId?: string;
        files?: Array<{ name?: string; contentBase64?: string }>;
      };
      const files = Array.isArray(body?.files) ? body.files : [];
      if (files.length === 0) {
        res.status(400).json({ error: 'Envie pelo menos uma imagem (WEBP/PNG/JPG) ou pacote (ZIP/CBZ/PDF).' });
        return;
      }

      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
      const workSlug = (body.workTitle || 'aethera-recap')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'aethera-recap';
      const chapterSlug = (body.chapterNumber || '1').replace(/[^a-zA-Z0-9._-]+/g, '-') || '1';

      const safeRoot = resolve(libraryRootDir);
      const targetDir = resolve(safeRoot, 'assisted-imports', workSlug, `cap-${chapterSlug}`);
      const rel = relative(safeRoot, targetDir);
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
        res.status(400).json({ error: 'Caminho de destino inválido.' });
        return;
      }
      mkdirSync(targetDir, { recursive: true });

      const sorted = [...files].sort((a, b) => collator.compare(String(a.name ?? ''), String(b.name ?? '')));
      const seenHashes = new Set<string>();
      const warnings: string[] = [];
      let pageCount = 0;
      let duplicatesRemoved = 0;
      let invalidSkipped = 0;

      for (const f of sorted) {
        const name = String(f.name ?? '').trim();
        const b64 = String(f.contentBase64 ?? '');
        if (!name || !b64) continue;
        const buf = Buffer.from(b64, 'base64');
        if (buf.length < 32) {
          invalidSkipped++;
          warnings.push(`Arquivo muito pequeno/inválido ignorado: ${name}`);
          continue;
        }
        // Detect magic bytes: PNG, JPEG, WEBP, PDF, ZIP/CBZ
        const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
        const isJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
        const isWebp = buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
        const isPdf = buf.subarray(0, 5).toString('ascii') === '%PDF-';
        const isZip = buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05);
        if (!isPng && !isJpg && !isWebp && !isPdf && !isZip) {
          invalidSkipped++;
          warnings.push(`Formato inválido ignorado: ${name}`);
          continue;
        }
        const hash = createHash('sha256').update(buf).digest('hex');
        if (seenHashes.has(hash)) {
          duplicatesRemoved++;
          continue;
        }
        seenHashes.add(hash);
        pageCount++;
        const ext = isPng ? '.png' : isJpg ? '.jpg' : isWebp ? '.webp' : isPdf ? '.pdf' : '.cbz';
        writeFileSync(join(targetDir, `${String(pageCount).padStart(4, '0')}${ext}`), buf);
      }

      if (pageCount === 0) {
        res.status(400).json({ error: 'Nenhum arquivo válido (WEBP, PNG, JPG, ZIP, CBZ ou PDF) encontrado.' });
        return;
      }

      writeFileSync(
        join(targetDir, 'aethera-source.json'),
        JSON.stringify(
          {
            schemaVersion: 1,
            importMode: 'assisted_browser_remote',
            workTitle: body.workTitle || 'Aethera Recap',
            chapterNumber: body.chapterNumber || '1',
            sourceUrl: body.sourceUrl || null,
            seriesProjectId: body.seriesProjectId || null,
            pageCount,
            duplicatesRemoved,
            invalidSkipped,
            createdAtIso: new Date().toISOString(),
          },
          null,
          2,
        ),
        'utf-8',
      );

      res.status(201).json({
        archivePath: targetDir,
        pageCount,
        duplicatesRemoved,
        invalidSkipped,
        warnings,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}

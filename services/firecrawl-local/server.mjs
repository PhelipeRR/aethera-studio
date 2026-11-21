/**
 * Aethera Firecrawl Local — Lightweight Firecrawl v1 API-compatible service
 *
 * Binds strictly to 127.0.0.1:3002 (loopback only).
 * Endpoints:
 *   GET  /          -> Health & status JSON
 *   GET  /health    -> Health & status JSON
 *   POST /v1/scrape -> Firecrawl v1 scrape ({ url, formats, waitFor })
 *
 * Security:
 * - Rejects private/loopback target URLs (SSRF protection)
 * - Never bypasses Cloudflare, Turnstile, or CAPTCHA challenges
 * - Reports upstream HTTP status codes honestly
 */

import { createServer } from 'node:http';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isIP } from 'node:net';

const HOST = '127.0.0.1';
const PORT = Number(process.env.FIRECRAWL_PORT || 3002);
const MAX_CONCURRENT_SCRAPES = 2;

const CHALLENGE_PATTERNS = [
  /cf-challenge/i,
  /challenge-platform/i,
  /just a moment\.\.\./i,
  /attention required!\s*\|\s*cloudflare/i,
  /cf-turnstile/i,
  /\bhcaptcha\b|\brecaptcha\b/i,
];

function isPrivateOrLocalHostname(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  const ipVer = isIP(h);
  if (ipVer === 4) {
    const parts = h.split('.').map(Number);
    if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
  }
  if (ipVer === 6) {
    if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80:')) return true;
  }
  return false;
}

function findInstalledChromiumExecutable() {
  if (process.env.CHROMIUM_EXECUTABLE_PATH && existsSync(process.env.CHROMIUM_EXECUTABLE_PATH)) {
    return process.env.CHROMIUM_EXECUTABLE_PATH;
  }
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const msPwDir = join(localAppData, 'ms-playwright');
    if (existsSync(msPwDir)) {
      const dirs = readdirSync(msPwDir)
        .filter((d) => d.startsWith('chromium-'))
        .sort()
        .reverse();
      for (const dir of dirs) {
        for (const sub of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) {
          const candidate = join(msPwDir, dir, sub);
          if (existsSync(candidate)) return candidate;
        }
      }
    }
  }
  for (const fallback of [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ]) {
    if (existsSync(fallback)) return fallback;
  }
  return null;
}

const CHROMIUM_EXE = findInstalledChromiumExecutable();
let browserInstance = null;
let playwrightMod = null;
let activeScrapes = 0;

async function getBrowser() {
  if (!CHROMIUM_EXE) return null;
  if (browserInstance && browserInstance.isConnected()) return browserInstance;
  if (!playwrightMod) {
    playwrightMod = await import('playwright-core');
  }
  browserInstance = await playwrightMod.chromium.launch({
    executablePath: CHROMIUM_EXE,
    headless: true,
    args: ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  browserInstance.on('disconnected', () => {
    browserInstance = null;
  });
  return browserInstance;
}

function htmlToMinimalMarkdown(html, baseUrl) {
  const imgs = [];
  const seen = new Set();
  const re = /<img\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const attr = (name) => {
      const am = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
      return am?.[1] ?? am?.[2] ?? '';
    };
    const src = attr('data-current-src') || attr('data-src') || attr('data-lazy-src') || attr('src');
    if (!src || src.startsWith('data:') || src.startsWith('blob:')) continue;
    try {
      const abs = new URL(src.trim(), baseUrl).toString();
      if (seen.has(abs)) continue;
      seen.add(abs);
      imgs.push(`![${attr('alt').trim()}](${abs})`);
    } catch {
      // ignore invalid URL
    }
  }
  return imgs.join('\n');
}

async function scrapeWithPlaywright(targetUrl, waitForMs) {
  const browser = await getBrowser();
  if (!browser) return null;

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  try {
    const response = await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 25_000,
    });
    const statusCode = response ? response.status() : 200;
    const initialHtml = await page.content();
    const title = await page.title().catch(() => '');

    // Stop immediately on 401/403 or challenge markers — never attempt bypass
    const hasChallenge = CHALLENGE_PATTERNS.some((p) => p.test(title) || p.test(initialHtml));
    if (statusCode === 401 || statusCode === 403 || hasChallenge) {
      return {
        statusCode,
        title,
        html: initialHtml,
        markdown: '',
      };
    }

    // Progressive scroll to trigger lazy-loaded images on accessible pages
    await page.evaluate(async () => {
      const step = Math.max(500, Math.floor(window.innerHeight * 0.85));
      const maxSteps = 30;
      let count = 0;
      for (let y = 0; y < document.body.scrollHeight + step && count < maxSteps; y += step) {
        window.scrollBy(0, step);
        count++;
        await new Promise((r) => setTimeout(r, 120));
      }
    });

    const boundedWait = Math.min(4000, Math.max(300, Number(waitForMs) || 1200));
    await page.waitForTimeout(boundedWait);

    const finalHtml = await page.content();
    const finalTitle = await page.title().catch(() => title);
    return {
      statusCode,
      title: finalTitle,
      html: finalHtml,
      markdown: htmlToMinimalMarkdown(finalHtml, targetUrl),
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function scrapeWithDirectFetch(targetUrl) {
  const res = await fetch(targetUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(20_000),
  });
  const html = await res.text();
  const titleMatch = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return {
    statusCode: res.status,
    title: titleMatch?.[1]?.trim() ?? '',
    html,
    markdown: res.ok ? htmlToMinimalMarkdown(html, targetUrl) : '',
  };
}

function sendJson(res, status, obj) {
  const payload = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    return sendJson(res, 200, {
      status: 'ok',
      service: 'aethera-firecrawl-local',
      port: PORT,
      chromiumReady: Boolean(CHROMIUM_EXE),
      activeScrapes,
    });
  }

  if (req.method === 'POST' && req.url === '/v1/scrape') {
    if (activeScrapes >= MAX_CONCURRENT_SCRAPES) {
      return sendJson(res, 429, { success: false, error: 'Too many concurrent scrape requests.' });
    }

    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 100_000) {
        return sendJson(res, 413, { success: false, error: 'Payload too large.' });
      }
    }

    let body;
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      return sendJson(res, 400, { success: false, error: 'Invalid JSON payload.' });
    }

    const rawUrl = typeof body.url === 'string' ? body.url.trim() : '';
    let parsedUrl;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      return sendJson(res, 400, { success: false, error: 'Invalid URL.' });
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return sendJson(res, 400, { success: false, error: 'Only http/https URLs are supported.' });
    }
    if (isPrivateOrLocalHostname(parsedUrl.hostname)) {
      return sendJson(res, 403, { success: false, error: 'SSRF blocked: private or local host not allowed.' });
    }

    activeScrapes++;
    try {
      let result = null;
      try {
        result = await scrapeWithPlaywright(parsedUrl.toString(), body.waitFor);
      } catch {
        result = null;
      }
      if (!result) {
        result = await scrapeWithDirectFetch(parsedUrl.toString());
      }

      return sendJson(res, 200, {
        success: true,
        data: {
          html: result.html,
          markdown: result.markdown,
          metadata: {
            title: result.title,
            statusCode: result.statusCode,
            sourceURL: parsedUrl.toString(),
          },
        },
      });
    } catch (err) {
      return sendJson(res, 502, {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      activeScrapes--;
    }
  }

  return sendJson(res, 404, { success: false, error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`[aethera-firecrawl-local] Listening on http://${HOST}:${PORT} (chromium=${Boolean(CHROMIUM_EXE)})`);
});

process.on('SIGINT', async () => {
  await browserInstance?.close().catch(() => {});
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await browserInstance?.close().catch(() => {});
  process.exit(0);
});

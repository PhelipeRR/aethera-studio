import { expect, test } from '@playwright/test';
import { launchApp } from './app';

// Lote 50.11: every main screen keeps the basics of accessibility. Named controls (including those named by a wrapping
// <label>), labelled fields, images with alt, unique ids, no positive tabindex and exactly one level-1 heading.
const ROUTES = ['/', '/chat', '/runs', '/projects', '/workflows', '/monitoring', '/mission-control', '/memory', '/memory/explore', '/memory/graph', '/memory/galaxy', '/memory/learning', '/memory/settings', '/skills', '/analytics', '/git-intelligence', '/azure-devops', '/agents', '/mcp', '/extensions', '/settings', '/design-system'];

test('the main screens pass the accessibility sweep', async () => {
  test.setTimeout(180_000);
  const { app, page } = await launchApp();
  const problems: string[] = [];
  for (const route of ROUTES) {
    await page.evaluate((target) => { window.location.hash = `#${target}`; }, route);
    await page.waitForTimeout(1200);
    const found = await page.evaluate(() => {
      const visible = (el: Element) => { const box = (el as HTMLElement).getBoundingClientRect(); const style = getComputedStyle(el); return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
      const labelledBy = (el: Element) => (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
      const name = (el: Element) => (el.getAttribute('aria-label') || labelledBy(el) || el.getAttribute('title') || (el as HTMLElement).innerText || el.closest('label')?.textContent || '').trim();
      const out: string[] = [];
      for (const el of document.querySelectorAll('button, a[href], [role="button"], [role="tab"], [role="radio"], [role="link"]')) if (visible(el) && !name(el)) out.push(`sem nome: ${el.outerHTML.slice(0, 100)}`);
      for (const el of document.querySelectorAll('input:not([type="hidden"]), select, textarea')) {
        if (!visible(el)) continue;
        const labelled = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el.id && document.querySelector(`label[for="${el.id}"]`)) || el.closest('label');
        if (!labelled) out.push(`campo sem rótulo: ${el.outerHTML.slice(0, 100)}`);
      }
      for (const img of document.querySelectorAll('img')) if (!img.hasAttribute('alt')) out.push(`imagem sem alt: ${img.outerHTML.slice(0, 100)}`);
      const ids = [...document.querySelectorAll('[id]')].map((el) => el.id).filter(Boolean);
      for (const id of new Set(ids.filter((id, index) => ids.indexOf(id) !== index))) out.push(`id duplicado: ${id}`);
      if ([...document.querySelectorAll('[tabindex]')].some((el) => Number(el.getAttribute('tabindex')) > 0)) out.push('tabindex positivo');
      const h1 = document.querySelectorAll('h1').length;
      if (h1 !== 1) out.push(`h1 = ${h1}`);
      return out;
    });
    problems.push(...found.map((problem) => `${route}: ${problem}`));
  }
  await app.close();
  expect(problems).toEqual([]);
});

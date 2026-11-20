// Run with the Playwright Chromium installation used by scripts/audit-traffic.mjs.
// node --test test/paper-refresh.browser.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { chromium } from 'playwright';

const item = (id, title, start, end) => ({
  id, title, start, end, district: 'downtown', category: 'event',
  platform: 'Fixture', url: 'https://example.test/' + id,
});

test('paper polls preserve the reading position, open disclosures, and link focus as data ages', { timeout: 25_000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME });
  try {
    const page = await browser.newPage({ reducedMotion: 'reduce', viewport: { width: 1280, height: 720 } });
    page.setDefaultTimeout(8_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const ending = item('ending', 'Event ending at five', '2026-11-13T21:00:00Z', '2026-11-13T22:00:00Z');
    let feed = { items: [ending, ...Array.from({ length: 16 }, (_, i) =>
      item('past-' + i, 'Earlier event ' + i, new Date(Date.UTC(2026, 10, 12, i)).toISOString()))] };
    const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
    await page.route('https://**', route => route.abort());
    await page.route('http://paper.test/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/data/items.json') return route.fulfill({ json: feed });
      if (pathname === '/data/civic.json') return route.fulfill({ json: { items: [] } });
      if (pathname.startsWith('/data/') && pathname !== '/data/map.json') return route.fulfill({ status: 404 });
      const body = await readFile(new URL('../public' + pathname, import.meta.url)).catch(() => null);
      return body ? route.fulfill({ body, contentType: contentTypes[extname(pathname)] }) : route.fulfill({ status: 404 });
    });
    await page.clock.install({ time: new Date('2026-11-13T21:57:00Z') });
    await page.goto('http://paper.test/index.html?time=day&weather=clear');
    const earlier = page.locator('#downtown details').filter({ has: page.locator('summary', { hasText: /^Earlier/ }) });
    const reader = earlier.locator('a[href="https://example.test/past-5"]');

    await page.getByRole('link', { name: 'Show me', exact: true }).click();
    await page.locator('#card .card').waitFor();
    await earlier.locator('summary').click();
    const before = await reader.evaluate(link => {
      const paper = document.getElementById('paper');
      const row = link.closest('li');
      link.focus({ preventScroll: true });
      paper.scrollTo({ top: paper.scrollTop + row.getBoundingClientRect().top - 2, behavior: 'instant' });
      return { top: paper.scrollTop, rowY: row.getBoundingClientRect().top };
    });
    assert.ok(before.top > 100);
    const state = () => reader.evaluate(link => ({
      top: document.getElementById('paper').scrollTop,
      rowY: link.closest('li').getBoundingClientRect().top,
      focused: link === document.activeElement,
      open: link.closest('details').open,
    }));

    // A metadata-only poll marks completion without changing any event.
    feed = { ...feed, generatedAt: '2026-11-13T21:58:00Z' };
    await page.clock.fastForward(61_000);
    await page.getByText(/Updated 4:58 PM/).waitFor();
    assert.deepEqual(await state(), { ...before, focused: true, open: true });

    // Insert a row above the reader and revise the focused row in the same poll.
    feed = { ...feed, items: [
      item('new', 'A newly listed past event', '2026-11-11T20:00:00Z'),
      ...feed.items.map(event => event.id === 'past-5' ? { ...event, title: 'Revised earlier event' } : event),
    ] };
    await page.clock.fastForward(61_000);
    await page.getByText('Revised earlier event', { exact: true }).waitFor();
    const changed = await state();
    assert.ok(changed.top > before.top);
    assert.ok(Math.abs(changed.rowY - before.rowY) <= 1, 'the same row stays in view after the insertion');
    assert.equal(changed.focused, true);
    assert.equal(changed.open, true);

    await earlier.locator('summary').click();
    await page.clock.fastForward(61_000);
    await earlier.locator('summary').getByText('Earlier (18)', { exact: true }).waitFor();
    assert.equal(await earlier.evaluate(details => details.open), false);
    assert.equal(await earlier.getByText(ending.title, { exact: true }).count(), 1);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

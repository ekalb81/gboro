// Run with the same Playwright Chromium installation as scripts/bench.mjs:
// node --test test/model-renderer.browser.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

test('crowd-only updates redraw a settled reduced-motion view once without rebuilding tiles', async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME });
  try {
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    await page.route('http://renderer.test/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/') return route.fulfill({ contentType: 'text/html',
        body: '<canvas id="map" style="width:640px;height:400px"></canvas>' });
      const body = await readFile(new URL('../public' + pathname, import.meta.url));
      await route.fulfill({ body, contentType: pathname.endsWith('.js') ? 'text/javascript' : 'application/json' });
    });
    await page.goto('http://renderer.test/?debug&bench&ahead=0&compose=canvas');
    const result = await page.evaluate(async () => {
      const { startModel } = await import('/model.js');
      const load = async name => (await fetch('/model/' + name + '.json')).json();
      const [map, trees] = await Promise.all(['downtown', 'trees'].map(load));
      // A second view can share the same source data, including the arrays of parking-lot coordinates.
      const freeze = o => { if (o && typeof o === 'object') { Object.freeze(o); Object.values(o).forEach(freeze); } };
      freeze(map);
      const queue = [];
      window.requestAnimationFrame = fn => queue.push(fn);
      const model = startModel({ canvas: document.querySelector('#map'), map, trees });
      for (let i = 0; !queue.length && i < 500; i++) await new Promise(resolve => setTimeout(resolve, 10));
      if (!queue.length) throw Error("the first model frame was never scheduled");
      for (let i = 0; queue.length && i < 10; i++) queue.shift()(performance.now());
      if (queue.length) throw Error("the initial reduced-motion scene never settled");
      const bm = window.__bench, first = bm.frames.length, actors = bm.frames.at(-1).n, tiles = bm.tiles, staticMs = bm.staticMs;
      const [gx, gy] = window.__audit.view().c;
      for (let i = 0; i < 2; i++) model.update({ crowds: [{ gx, gy, n: 4 }] });
      const scheduled = queue.length;
      if (scheduled) queue.shift()(performance.now());
      return { scheduled, pending: queue.length, frames: bm.frames.length-first, actors: bm.frames.at(-1).n-actors,
        tiles: bm.tiles-tiles, staticMs: bm.staticMs-staticMs };
    });
    assert.deepEqual(result, { scheduled: 1, pending: 0, frames: 1, actors: 4, tiles: 0, staticMs: 0 });
  } finally {
    await browser.close();
  }
});

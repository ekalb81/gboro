// Screenshots of the whole downtown model, close up, tile by tile, for a visual audit. Usage:
//   npm run audit:tiles -- --out dir [--z 3] [--time day,night] [--vw 1600 --vh 1000] [--only r03c05,r04c05] [--jobs 4]
//
// The view is stepped across the model in rows and columns with a small overlap; tiles with none of the map in them
// are skipped. ?flat turns the tilt-shift blur and the vignette off so the whole picture is sharp, and the paper and
// the buttons are hidden. index.json lists each tile: its file per time of day, the grid spot at its centre (usable as
// ?at=gx,gy) and at its corners. A pixel (px, py) of a tile is the grid spot
//   gx = cx + (a + b) / 2, gy = cy + (b - a) / 2   with a = (px - vw/2) / (16 z), b = (py - vh/2) / (8 z).
//
// Needs Playwright with Chromium (see scripts/bench.mjs).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const OUT = opt('--out', 'audit-tiles'), Z = +opt('--z', 3), VW = +opt('--vw', 1600), VH = +opt('--vh', 1000), JOBS = +opt('--jobs', 4);
const TIMES = opt('--time', 'day,night').split(','), ONLY = opt('--only', '').split(',').filter(Boolean);
const DATE = opt('--date', '2026-11-17'), EXTRA = opt('--query', '');
const SCENE = { day: 'time=day&clock=tue-12:30', dusk: 'time=dusk&clock=fri-17:20', night: 'time=night&clock=fri-21:30', dawn: 'time=dawn&clock=tue-06:50' };
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('playwright')); }

// the same projection as public/model.js
const MAP = JSON.parse(readFileSync(join(root, 'public/model/downtown.json'), 'utf8')), GX = MAP.GX, GY = MAP.GY, TW = 16, TH = 8;
const inv = (x, y) => { const a = x / TW, b = y / TH; return [(a + b) / 2, (b - a) / 2]; };
const vw = VW / Z, vh = VH / Z, sx = vw * .92, sy = vh * .9;
const x0 = -GY * TW, x1 = GX * TW, y1 = (GX + GY) * TH;
const inMap = ([gx, gy]) => gx > -1 && gy > -1 && gx < GX + 1 && gy < GY + 1;
const tiles = [];
for (let r = 0, y = vh * .35; y < y1 + vh * .4; r++, y += sy) for (let c = 0, x = x0 + vw * .4; x < x1 + vw * .5; c++, x += sx) {
  const pts = []; for (const u of [-.5, -.25, 0, .25, .5]) for (const v of [-.5, -.25, 0, .25, .5]) pts.push(inv(x + u * vw, y + v * vh));
  if (pts.filter(inMap).length < 3) continue;
  const id = 'r' + String(r).padStart(2, '0') + 'c' + String(c).padStart(2, '0'); if (ONLY.length && !ONLY.includes(id)) continue;
  const [gx, gy] = inv(x, y); tiles.push({ id, at: [+gx.toFixed(2), +gy.toFixed(2)], files: {} }); }

mkdirSync(OUT, { recursive: true });
const port = 8100 + Math.floor(Math.random() * 800);
const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs'), String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
const HIDE = '.app{grid-template-columns:minmax(0,1fr) 0 !important}aside,.float{display:none !important}';
let code = 0;
try {
  const browser = await chromium.launch();
  const jobs = tiles.flatMap((t) => TIMES.map((time) => ({ t, time })));
  console.log(`${tiles.length} tiles x ${TIMES.length} at z=${Z}, ${VW}x${VH}`);
  let done = 0;
  const worker = async () => { const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
    await ctx.addInitScript((css) => { const add = () => { const s = document.createElement('style'); s.textContent = css; document.documentElement.appendChild(s); }; if (document.documentElement) add(); else document.addEventListener('readystatechange', add, { once: true }); }, HIDE);
    for (let j; (j = jobs.shift());) { const page = await ctx.newPage(), file = `${j.t.id}-${j.time}.jpg`;
      await page.goto(`http://localhost:${port}/?at=${j.t.at.join(',')}&z=${Z}&${SCENE[j.time] || 'time=' + j.time}&date=${DATE}&flat&debug&bench${EXTRA ? '&' + EXTRA : ''}`);
      await page.waitForFunction(() => window.__audit && window.__bench && window.__bench.frames.length > 0, null, { timeout: 120000 });
      await page.waitForFunction(() => window.__bench.aheadLeft === 0, null, { timeout: 6000, polling: 250 }).catch(() => {});
      await page.waitForTimeout(2500); // cars and walkers settle in
      const v = await page.evaluate(() => window.__audit.view());
      j.t.shown = v.c.map((n) => +n.toFixed(2)); j.t.files[j.time] = file;
      await page.screenshot({ path: join(OUT, file), type: 'jpeg', quality: 90 }); await page.close();
      if (++done % 10 === 0) console.log(`${done}/${tiles.length * TIMES.length}`); }
    await ctx.close(); };
  await Promise.all([...Array(JOBS)].map(worker));
  await browser.close();
  // a tile near the model's edge shows the nearest view the page allows: 'shown' is the centre it really has
  writeFileSync(join(OUT, 'index.json'), JSON.stringify({ z: Z, vw: VW, vh: VH, date: DATE, note: 'pixel (px,py) of a tile -> grid: a=(px-vw/2)/(16z), b=(py-vh/2)/(8z); gx=shown[0]+(a+b)/2, gy=shown[1]+(b-a)/2', tiles }, null, 1));
  console.log(`wrote ${done} screenshots and index.json to ${OUT}`);
} catch (e) { console.error(e); code = 1; } finally { server.kill(); }
process.exit(code);

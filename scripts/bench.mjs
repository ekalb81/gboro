// Frame-rate benchmark for the downtown model. Usage: npm run bench [-- options]
//
// Starts scripts/serve.mjs on a spare port, opens the page in headless Chromium (Playwright) at a few fixed
// scenarios, and prints a table: frames per second, frame interval p50/p95/max, the time the model's own code
// takes per frame (from the ?bench timings in model.js), long tasks, JS heap, canvas memory, bytes loaded and the
// time to the first drawn frame. The view, date, time of day and wind are fixed so runs compare.
//
// Options:
//   --only name,name   run only these scenarios (see SCENARIOS below); 'steady' and 'interaction' name the two groups
//   --secs N           seconds to measure each scenario (default 8)
//   --json file        also write the results as JSON
//   --profile dir      also save a CPU profile (.cpuprofile, open in Chrome DevTools > Performance) per scenario
//   --warm             interaction scenarios start only once the model has finished drawing ahead (tiles around the
//                      view, the whole model small, the next zoom levels): a user who looked a while before dragging
//   --query a=b&c=d  extra URL parameters for every scenario (e.g. weather=rain, time=night)
//   --headed           show the browser window (real GPU, so raster costs look like a real machine's)
//   --swgpu            headless, but canvases go through the GPU path (SwiftShader): separates main-thread
//                      script time from drawing time; the frame rate itself is meaningless
//
// Needs Playwright with Chromium: npm install --no-save playwright && npx playwright install chromium
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const SECS = +opt('--secs', 8);
const ONLY = opt('--only', '');
const JSON_OUT = opt('--json', '');
const PROFILE = opt('--profile', '');
const HEADED = args.includes('--headed');
const WARM = args.includes('--warm');
const EXTRA = opt('--query', ''); // extra URL parameters, e.g. --query weather=rain

// Fixed scene: mid-November (fall colour, leaves dropping), a 18 mph south-west wind gusting 30, midday light.
// bench=flush: count a new tile's (lazy, software) drawing in the frame that makes it; not with a real GPU.
// --swgpu stands for a machine with a graphics card, so it gets the compositor layers and clipped cut-outs such a
// machine would use (the model itself keeps the old canvas compositing and scratch cards on a software renderer).
const FIXED = 'date=2026-11-13&wind=18-30@230&time=day&bench' + (HEADED || args.includes('--swgpu') ? '' : '=flush') + (args.includes('--swgpu') ? '&compose=layers&cut=clip' : '');
// at: a busy corner (Elm and Market); zoomed views use z (device pixels per model pixel).
const SCENARIOS = [
  { name: 'desktop', vw: 1920, vh: 1080, dpr: 1, q: '' },
  { name: 'desktop-dpr2', vw: 1920, vh: 1080, dpr: 2, q: '' },
  { name: 'zoomed-in', vw: 1920, vh: 1080, dpr: 1, q: '&z=6' },
  { name: 'zoomed-out', vw: 1920, vh: 1080, dpr: 1, q: '&z=0.5' },
  { name: 'retina', vw: 1335, vh: 805, dpr: 2, q: '' }, // a Retina MacBook window: the model about 1870x1610 device pixels
  { name: 'retina-night', vw: 1335, vh: 805, dpr: 2, q: '&time=night' },
  { name: 'pan-zoom', vw: 1920, vh: 1080, dpr: 1, q: '', gesture: 'mixed' },
  { name: 'laptop-4x', vw: 1366, vh: 768, dpr: 1, q: '', cpu: 4 },
  { name: 'phone-4x', vw: 390, vh: 844, dpr: 3, q: '', cpu: 4, mobile: true },
  // interaction: the stats in the second table cover only the frames while a gesture is going on (plus 0.3 s after)
  { name: 'drag', vw: 1920, vh: 1080, dpr: 1, q: '', gesture: 'drag' },
  { name: 'wheel', vw: 1920, vh: 1080, dpr: 1, q: '', gesture: 'wheel' },
  { name: 'trackpad', vw: 1920, vh: 1080, dpr: 1, q: '', gesture: 'trackpad' },
  { name: 'drag-dpr2', vw: 1920, vh: 1080, dpr: 2, q: '', gesture: 'drag' },
  { name: 'wheel-dpr2', vw: 1920, vh: 1080, dpr: 2, q: '', gesture: 'wheel' },
  { name: 'laptop-drag', vw: 1366, vh: 768, dpr: 1, q: '', cpu: 4, gesture: 'drag' },
  { name: 'laptop-wheel', vw: 1366, vh: 768, dpr: 1, q: '', cpu: 4, gesture: 'wheel' },
  { name: 'phone-touch', vw: 390, vh: 844, dpr: 3, q: '', cpu: 4, mobile: true, gesture: 'touch' },
];
const STEADY = ['desktop', 'desktop-dpr2', 'retina', 'retina-night', 'zoomed-in', 'zoomed-out', 'pan-zoom', 'laptop-4x', 'phone-4x'];

async function loadPlaywright() {
  try { return await import('playwright'); } catch {}
  try { const g = execSync('npm root -g', { encoding: 'utf8' }).trim(); return createRequire(join(g, 'x.js'))('playwright'); } catch {}
  console.error('Playwright is not installed. Run: npm install --no-save playwright && npx playwright install chromium');
  process.exit(1);
}

function startServer() {
  const port = 8700 + Math.floor(Math.random() * 200);
  const srv = spawn(process.execPath, [join(root, 'scripts', 'serve.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((res, rej) => {
    srv.stdout.on('data', (d) => { if (/localhost/.test(String(d))) res({ srv, base: `http://localhost:${port}/` }); });
    srv.on('exit', (c) => rej(new Error('server exited ' + c)));
  });
}

const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))] : NaN);
const sorted = (a) => a.slice().sort((x, y) => x - y);
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Gestures paced in real time, as a person would make them. Each gesture's start and end (page clock) is recorded so
// the frames during it can be picked out. Mouse moves go out about every 16 ms; when the page is busy they queue up and
// Chromium hands them over coalesced, as it does for a real mouse.
async function gesture(page, cdp, kind, secs) {
  const box = await page.locator('#village').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const now = () => page.evaluate(() => performance.now());
  const spans = [];
  const end = Date.now() + secs * 1000;
  const span = async (fn) => { const a = await now(); await fn(); spans.push([a, await now()]); };
  const drag = async (dx, dy, ms) => { // a steady drag of (dx, dy) css px over ms
    await page.mouse.move(cx, cy); await page.mouse.down();
    const t0 = Date.now();
    for (;;) { const k = Math.min(1, (Date.now() - t0) / ms); await page.mouse.move(cx + dx * k, cy + dy * k); if (k >= 1) break; await sleep(16); }
    await page.mouse.up();
  };
  const ctrlWheel = (dy) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: dy, modifiers: 2 });
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  let n = 0;
  while (Date.now() < end) {
    n++;
    if (kind === 'drag') { const a = (n * 1.7) % 6.283; await span(() => drag(Math.cos(a) * 700, Math.sin(a) * 380, 1500)); await sleep(250); }
    else if (kind === 'wheel') { // three notches in, three out, half a second apart, the pointer resting on the model
      await page.mouse.move(cx, cy);
      for (const d of [-120, -120, -120, 120, 120, 120]) { await span(async () => { await page.mouse.wheel(0, d); await sleep(500); }); }
    } else if (kind === 'trackpad') { // a pinch on a trackpad: many small ctrl+wheel events
      for (const d of [-1, 1]) await span(async () => { for (let i = 0; i < 45; i++) { await ctrlWheel(d * 4); await sleep(16); } await sleep(300); });
    } else if (kind === 'touch') { // one-finger drags, then a two-finger pinch out and back in
      await span(async () => {
        await touch('touchStart', [[cx, cy]]);
        for (let i = 1; i <= 40; i++) { await touch('touchMove', [[cx - i * 5, cy - i * 4]]); await sleep(16); }
        await touch('touchEnd', []);
      });
      for (const out of [1, -1]) await span(async () => {
        await touch('touchStart', [[cx - 40, cy], [cx + 40, cy]]);
        for (let i = 1; i <= 30; i++) { const d = 40 + (out > 0 ? i * 4 : 120 - i * 4); await touch('touchMove', [[cx - d, cy], [cx + d, cy]]); await sleep(16); }
        await touch('touchEnd', []);
        await sleep(300);
      });
    } else { // mixed: the old pan-zoom scenario
      await span(async () => {
        await page.mouse.move(cx, cy); await page.mouse.down();
        for (let i = 1; i <= 30; i++) await page.mouse.move(cx - i * 12, cy - i * 6);
        await page.mouse.up();
        await page.mouse.wheel(0, -120); await sleep(400);
        await page.mouse.move(cx, cy); await page.mouse.down();
        for (let i = 1; i <= 30; i++) await page.mouse.move(cx + i * 12, cy + i * 6);
        await page.mouse.up();
        await page.mouse.wheel(0, 120); await sleep(400);
      });
    }
  }
  return spans;
}

const PHASES = ['tiles', 'sim', 'dyn', 'blow', 'grade', 'tilt', 'sign', 'labels', 'ahead'];

async function run(browser, base, sc) {
  const ctx = await browser.newContext({ viewport: { width: sc.vw, height: sc.vh }, deviceScaleFactor: sc.dpr, isMobile: !!sc.mobile, hasTouch: !!sc.mobile });
  await ctx.addInitScript(() => {
    window.__long = [];
    // Canvas calls that are cheap in Chromium but costly elsewhere (WebKit above all), counted for every 2D canvas:
    // src = drawImage with a canvas as its source; dirty = of those, the source had been drawn on since it was last
    // used as a source (the browser must flush it and often copy it); full = draws, fills and clears covering at least
    // half of a canvas as big as the model's; clip = clip() calls; filter = draws with a canvas filter set.
    const ops = (window.__ops = { src: 0, dirty: 0, full: 0, clip: 0, filter: 0 });
    const P = CanvasRenderingContext2D.prototype, big = (c) => { const v = document.getElementById('village'); return v && c.width * c.height >= 0.9 * v.width * v.height; };
    const area = (ctx, w, h) => { const m = ctx.getTransform(); return Math.abs(w * h * (m.a * m.d - m.b * m.c)); };
    const full = (ctx, w, h) => { const c = ctx.canvas; if (big(c) && area(ctx, w, h) >= 0.5 * c.width * c.height) ops.full++; };
    for (const k of ['fill', 'stroke', 'fillText', 'strokeRect', 'putImageData']) { const f = P[k]; P[k] = function (...a) { this.canvas.__d = 1; return f.apply(this, a); }; }
    for (const k of ['fillRect', 'clearRect']) { const f = P[k]; P[k] = function (x, y, w, h) { this.canvas.__d = 1; full(this, w, h); return f.call(this, x, y, w, h); }; }
    const cl = P.clip; P.clip = function (...a) { ops.clip++; return cl.apply(this, a); };
    const di = P.drawImage; P.drawImage = function (...a) {
      const src = a[0]; this.canvas.__d = 1;
      if (src instanceof HTMLCanvasElement) { ops.src++; if (src.__d) { ops.dirty++; src.__d = 0; } }
      if (this.filter && this.filter !== 'none') ops.filter++;
      full(this, a.length >= 9 ? a[7] : a.length >= 5 ? a[3] : src.width, a.length >= 9 ? a[8] : a.length >= 5 ? a[4] : src.height);
      return di.apply(this, a);
    };
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ type: 'longtask', buffered: true }); } catch {}
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Performance.enable');
  if (sc.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: sc.cpu });
  let bytes = 0, gz = 0; const urls = new Map();
  cdp.on('Network.responseReceived', (e) => urls.set(e.requestId, { url: e.response.url, status: e.response.status }));
  cdp.on('Network.loadingFinished', (e) => {
    bytes += e.encodedDataLength;
    const u = urls.get(e.requestId); if (!u || u.status !== 200) return;
    const f = join(root, 'public', decodeURIComponent(new URL(u.url).pathname).replace(/\/$/, '/index.html'));
    try { gz += gzipSync(readFileSync(f)).length; } catch {}
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const t0 = Date.now();
  const qs = new URLSearchParams(FIXED);
  for (const [k, v] of new URLSearchParams(sc.q)) qs.set(k, v);
  for (const [k, v] of new URLSearchParams(EXTRA)) qs.set(k, v); // --query overrides the fixed defaults
  await page.goto(base + '?' + qs);
  await page.waitForFunction(() => window.__bench && window.__bench.frames.length > 0, null, { timeout: 120000 });
  const loadWall = Date.now() - t0;
  const firstFrame = await page.evaluate(() => window.__bench.frames[0].t);
  await page.waitForTimeout(3000); // settle: fonts, the first tiles, the live scene from app.js
  let warmS = 0; // --warm: also wait (up to 60 s) until the model has drawn ahead everything it wants to, as after a minute's look
  if (WARM && sc.gesture) { const w0 = Date.now(); await page.waitForFunction(() => window.__bench.aheadLeft === 0, null, { timeout: 60000, polling: 250 }).catch(() => {}); warmS = (Date.now() - w0) / 1000; }
  const tilesBefore = await page.evaluate(() => [window.__bench.tiles, window.__bench.tileMs]);
  const n0 = await page.evaluate(() => { window.__long.length = 0; window.__ops0 = { ...window.__ops }; return window.__bench.frames.length; });
  if (PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); }
  const tStart = Date.now();
  const spans = sc.gesture ? await gesture(page, cdp, sc.gesture, SECS) : (await page.waitForTimeout(SECS * 1000), []);
  const secs = (Date.now() - tStart) / 1000;
  if (PROFILE) {
    const { profile } = await cdp.send('Profiler.stop');
    mkdirSync(PROFILE, { recursive: true });
    writeFileSync(join(PROFILE, `${sc.name}.cpuprofile`), JSON.stringify(profile));
  }
  const r = await page.evaluate((n0) => ({ frames: window.__bench.frames.slice(n0), long: window.__long.slice(), tiles: window.__bench.tiles, tileMs: window.__bench.tileMs, mem: window.__bench.mem(), ops: Object.fromEntries(Object.keys(window.__ops).map((k) => [k, window.__ops[k] - window.__ops0[k]])) }), n0);
  const { metrics } = await cdp.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  await ctx.close();
  const iv = sorted(r.frames.slice(1).map((f, i) => f.t - r.frames[i].t));
  const work = sorted(r.frames.map((f) => PHASES.reduce((s, k) => s + (f[k] || 0), 0)));
  const phases = Object.fromEntries(PHASES.map((k) => [k, +mean(r.frames.map((f) => f[k] || 0)).toFixed(2)]));
  // frames during the gestures (and 0.3 s after each, while it settles)
  let inter = null;
  if (spans.length) {
    const fi = [];
    for (let i = 1; i < r.frames.length; i++) { const t = r.frames[i].t; if (spans.some(([a, b]) => t >= a && t <= b + 300)) fi.push(i); }
    const ivi = sorted(fi.map((i) => r.frames[i].t - r.frames[i - 1].t));
    const tl = fi.map((i) => r.frames[i - 1]); // tiles are drawn inside the frame that starts the interval
    const per = r.frames.filter((f) => f.nt).flatMap((f) => f.tl || []);
    inter = {
      frames: fi.length, p50: +pct(ivi, 0.5).toFixed(1), p95: +pct(ivi, 0.95).toFixed(1), p99: +pct(ivi, 0.99).toFixed(1), max: +pct(ivi, 1).toFixed(1),
      over50: ivi.filter((v) => v > 50).length, over100: ivi.filter((v) => v > 100).length,
      tiles: tl.reduce((s, f) => s + (f.nt || 0), 0), multi: tl.filter((f) => (f.nt || 0) >= 2).length, maxPerFrame: Math.max(0, ...tl.map((f) => f.nt || 0)),
      tileMean: +mean(per).toFixed(1), tileMax: +Math.max(0, ...per).toFixed(1), tileFrameMax: +Math.max(0, ...tl.map((f) => (f.tt || 0) + (f.tw || 0))).toFixed(1),
      fitMs: +Math.max(0, ...tl.map((f) => f.fit || 0)).toFixed(1),
      // frames that showed a missing tile stretched from another scale, and how long after a gesture's end the last one was
      standIn: r.frames.filter((f) => f.si && spans.some(([a, b]) => f.t >= a && f.t <= b + 300)).length,
      standInAfterMs: Math.round(Math.max(0, ...spans.map(([a, b], k) => { const e = k + 1 < spans.length ? spans[k + 1][0] : Infinity; const l = r.frames.filter((f) => f.si && f.t > b && f.t < e); return l.length ? l[l.length - 1].t - b : 0; }))),
      warmS,
    };
  }
  return {
    name: sc.name, viewport: `${sc.vw}x${sc.vh}@${sc.dpr}${sc.cpu > 1 ? ` cpu/${sc.cpu}` : ''}`,
    fps: +(r.frames.length / secs).toFixed(1),
    frameP50: +pct(iv, 0.5).toFixed(1), frameP95: +pct(iv, 0.95).toFixed(1), frameMax: +pct(iv, 1).toFixed(1),
    workP50: +pct(work, 0.5).toFixed(1), workP95: +pct(work, 0.95).toFixed(1),
    longTasks: r.long.length, longMs: Math.round(r.long.reduce((s, v) => s + v, 0)),
    tilesDrawn: r.tiles - tilesBefore[0], tileMs: Math.round(r.tileMs - tilesBefore[1]),
    heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), canvasMB: +r.mem.canvasMB.toFixed(1), canvas: `${r.mem.W}x${r.mem.H} vs${+r.mem.VS.toFixed(2)}`,
    loadKB: Math.round(bytes / 1024), gzipKB: Math.round(gz / 1024), firstFrameMs: Math.round(firstFrame), loadWallMs: loadWall,
    phases, errors, inter,
    ops: Object.fromEntries(Object.entries(r.ops).map(([k, v]) => [k, +(v / Math.max(1, r.frames.length)).toFixed(1)])),
  };
}

const { chromium } = await loadPlaywright();
const { srv, base } = await startServer();
const browser = await chromium.launch({ headless: !HEADED, args: args.includes('--swgpu') ? ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-accelerated-2d-canvas'] : [] });
const results = [];
try {
  for (const sc of SCENARIOS) {
    const want = ONLY.split(',').flatMap((n) => (n === 'steady' ? STEADY : n === 'interaction' ? SCENARIOS.filter((x) => x.gesture && x.name !== 'pan-zoom').map((x) => x.name) : [n]));
    if (ONLY && !want.includes(sc.name)) continue;
    process.stderr.write(`running ${sc.name}...\n`);
    results.push(await run(browser, base, sc));
  }
} finally {
  await browser.close();
  srv.kill();
}

const cols = [['name', 'scenario'], ['viewport', 'viewport'], ['fps', 'fps'], ['frameP50', 'frame p50'], ['frameP95', 'p95'], ['frameMax', 'max'],
  ['workP50', 'work p50'], ['workP95', 'work p95'], ['longTasks', 'long'], ['tilesDrawn', 'tiles'], ['heapMB', 'heap MB'], ['canvasMB', 'canvas MB'],
  ['loadKB', 'load KB'], ['gzipKB', 'gzip KB'], ['firstFrameMs', '1st frame ms']];
const w = cols.map(([k, h]) => Math.max(h.length, ...results.map((r) => String(r[k]).length)));
const row = (vals) => vals.map((v, i) => String(v).padStart(w[i])).join('  ');
console.log(row(cols.map((c) => c[1])));
for (const r of results) if (!r.inter || r.name === 'pan-zoom') console.log(row(cols.map(([k]) => r[k])));
console.log('\nmean ms per frame in each phase of model.js frame():');
console.log([''.padEnd(Math.max(8, w[0])), ...PHASES.map((k) => k.padStart(6))].join('  '));
for (const r of results) console.log([r.name.padEnd(Math.max(8, w[0])), ...PHASES.map((k) => String(r.phases[k]).padStart(Math.max(6, k.length)))].join('  '));
console.log('\ncanvas calls per frame (src = drawImage from a canvas; dirty = from a canvas drawn on since it was last a source;');
console.log('full = draws/fills/clears over half or more of a model-sized canvas; clip = clip() calls; filter = draws with a canvas filter):');
const OPS = ['src', 'dirty', 'full', 'clip', 'filter'];
console.log([''.padEnd(Math.max(8, w[0])), ...OPS.map((k) => k.padStart(7))].join('  '));
for (const r of results) console.log([r.name.padEnd(Math.max(8, w[0])), ...OPS.map((k) => String(r.ops[k]).padStart(7))].join('  '));
const IR = results.filter((r) => r.inter);
if (IR.length) {
  console.log('\nduring gestures only (frame interval ms; tiles = static tiles drawn whole within a frame; multi = frames that drew 2 or more; stand-in = frames showing a missing tile stretched from another scale):');
  const ic = [['name', 'scenario'], ['viewport', 'viewport'], ['frames', 'frames'], ['p50', 'p50'], ['p95', 'p95'], ['p99', 'p99'], ['max', 'max'], ['over50', '>50ms'], ['over100', '>100ms'],
    ['tiles', 'tiles'], ['multi', 'multi'], ['maxPerFrame', 'max/frame'], ['tileMean', 'ms/tile'], ['tileMax', 'tile max'], ['tileFrameMax', 'tiles in 1 frame ms'], ['fitMs', 'resize ms'], ['standIn', 'stand-in frames'], ['standInAfterMs', 'stand-in after ms']];
  const get = (r, k) => (k === 'name' || k === 'viewport' ? r[k] : r.inter[k]);
  const iw = ic.map(([k, h]) => Math.max(h.length, ...IR.map((r) => String(get(r, k)).length)));
  console.log(ic.map(([, h], i) => h.padStart(iw[i])).join('  '));
  for (const r of IR) console.log(ic.map(([k], i) => String(get(r, k)).padStart(iw[i])).join('  '));
}
for (const r of results) if (r.errors.length) console.log(`\n${r.name} page errors:`, r.errors);
console.log('\nframe = interval between frames (ms); work = time inside the model\'s frame() (ms); long = long tasks (>50 ms).');
console.log('Headless Chromium draws canvases in software; GPU machines spend far less on drawImage, filters and blur.');
if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify({ when: new Date().toISOString(), results }, null, 2)); console.log(`wrote ${JSON_OUT}`); }

// Frame-rate benchmark for the downtown model. Usage: npm run bench [-- options]
//
// Starts scripts/serve.mjs on a spare port, opens the page in headless Chromium (Playwright) at a few fixed
// scenarios, and prints a table: frames per second, frame interval p50/p95/max, the time the model's own code
// takes per frame (from the ?bench timings in model.js), long tasks, JS heap, canvas memory, bytes loaded and the
// time to the first drawn frame. The view, date, time of day and wind are fixed so runs compare.
//
// Options:
//   --only name,name   run only these scenarios (see SCENARIOS below)
//   --secs N           seconds to measure each scenario (default 8)
//   --json file        also write the results as JSON
//   --profile dir      also save a CPU profile (.cpuprofile, open in Chrome DevTools > Performance) per scenario
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
const EXTRA = opt('--query', ''); // extra URL parameters, e.g. --query weather=rain

// Fixed scene: mid-November (fall colour, leaves dropping), a 18 mph south-west wind gusting 30, midday light.
const FIXED = 'date=2026-11-13&wind=18-30@230&time=day&bench';
// at: a busy corner (Elm and Market); zoomed views use z (device pixels per model pixel).
const SCENARIOS = [
  { name: 'desktop', vw: 1920, vh: 1080, dpr: 1, q: '' },
  { name: 'desktop-dpr2', vw: 1920, vh: 1080, dpr: 2, q: '' },
  { name: 'zoomed-in', vw: 1920, vh: 1080, dpr: 1, q: '&z=6' },
  { name: 'zoomed-out', vw: 1920, vh: 1080, dpr: 1, q: '&z=0.5' },
  { name: 'pan-zoom', vw: 1920, vh: 1080, dpr: 1, q: '', interact: true },
  { name: 'laptop-4x', vw: 1366, vh: 768, dpr: 1, q: '', cpu: 4 },
  { name: 'phone-4x', vw: 390, vh: 844, dpr: 3, q: '', cpu: 4, mobile: true },
];

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
const PHASES = ['tiles', 'sim', 'dyn', 'blow', 'grade', 'tilt', 'sign', 'labels'];

async function run(browser, base, sc) {
  const ctx = await browser.newContext({ viewport: { width: sc.vw, height: sc.vh }, deviceScaleFactor: sc.dpr, isMobile: !!sc.mobile, hasTouch: !!sc.mobile });
  await ctx.addInitScript(() => {
    window.__long = [];
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
  await page.goto(base + '?' + FIXED + sc.q + (EXTRA ? '&' + EXTRA : ''));
  await page.waitForFunction(() => window.__bench && window.__bench.frames.length > 0, null, { timeout: 120000 });
  const loadWall = Date.now() - t0;
  const firstFrame = await page.evaluate(() => window.__bench.frames[0].t);
  await page.waitForTimeout(3000); // settle: fonts, the first tiles, the live scene from app.js
  const tilesBefore = await page.evaluate(() => [window.__bench.tiles, window.__bench.tileMs]);
  const n0 = await page.evaluate(() => { window.__long.length = 0; return window.__bench.frames.length; });
  if (PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); }
  const tStart = Date.now();
  if (sc.interact) {
    const box = await page.locator('#village').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    while (Date.now() - tStart < SECS * 1000) {
      await page.mouse.move(cx, cy); await page.mouse.down();
      for (let i = 1; i <= 30; i++) await page.mouse.move(cx - i * 12, cy - i * 6);
      await page.mouse.up();
      await page.mouse.wheel(0, -120); await page.waitForTimeout(400);
      await page.mouse.move(cx, cy); await page.mouse.down();
      for (let i = 1; i <= 30; i++) await page.mouse.move(cx + i * 12, cy + i * 6);
      await page.mouse.up();
      await page.mouse.wheel(0, 120); await page.waitForTimeout(400);
    }
  } else await page.waitForTimeout(SECS * 1000);
  const secs = (Date.now() - tStart) / 1000;
  if (PROFILE) {
    const { profile } = await cdp.send('Profiler.stop');
    mkdirSync(PROFILE, { recursive: true });
    writeFileSync(join(PROFILE, `${sc.name}.cpuprofile`), JSON.stringify(profile));
  }
  const r = await page.evaluate((n0) => ({ frames: window.__bench.frames.slice(n0), long: window.__long.slice(), tiles: window.__bench.tiles, tileMs: window.__bench.tileMs, mem: window.__bench.mem() }), n0);
  const { metrics } = await cdp.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  await ctx.close();
  const iv = sorted(r.frames.slice(1).map((f, i) => f.t - r.frames[i].t));
  const work = sorted(r.frames.map((f) => PHASES.reduce((s, k) => s + (f[k] || 0), 0)));
  const phases = Object.fromEntries(PHASES.map((k) => [k, +mean(r.frames.map((f) => f[k] || 0)).toFixed(2)]));
  return {
    name: sc.name, viewport: `${sc.vw}x${sc.vh}@${sc.dpr}${sc.cpu > 1 ? ` cpu/${sc.cpu}` : ''}`,
    fps: +(r.frames.length / secs).toFixed(1),
    frameP50: +pct(iv, 0.5).toFixed(1), frameP95: +pct(iv, 0.95).toFixed(1), frameMax: +pct(iv, 1).toFixed(1),
    workP50: +pct(work, 0.5).toFixed(1), workP95: +pct(work, 0.95).toFixed(1),
    longTasks: r.long.length, longMs: Math.round(r.long.reduce((s, v) => s + v, 0)),
    tilesDrawn: r.tiles - tilesBefore[0], tileMs: Math.round(r.tileMs - tilesBefore[1]),
    heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), canvasMB: +r.mem.canvasMB.toFixed(1), canvas: `${r.mem.W}x${r.mem.H} vs${+r.mem.VS.toFixed(2)}`,
    loadKB: Math.round(bytes / 1024), gzipKB: Math.round(gz / 1024), firstFrameMs: Math.round(firstFrame), loadWallMs: loadWall,
    phases, errors,
  };
}

const { chromium } = await loadPlaywright();
const { srv, base } = await startServer();
const browser = await chromium.launch({ headless: !HEADED, args: args.includes('--swgpu') ? ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-accelerated-2d-canvas'] : [] });
const results = [];
try {
  for (const sc of SCENARIOS) {
    if (ONLY && !ONLY.split(',').includes(sc.name)) continue;
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
for (const r of results) console.log(row(cols.map(([k]) => r[k])));
console.log('\nmean ms per frame in each phase of model.js frame():');
console.log([''.padEnd(Math.max(8, w[0])), ...PHASES.map((k) => k.padStart(6))].join('  '));
for (const r of results) console.log([r.name.padEnd(Math.max(8, w[0])), ...PHASES.map((k) => String(r.phases[k]).padStart(Math.max(6, k.length)))].join('  '));
for (const r of results) if (r.errors.length) console.log(`\n${r.name} page errors:`, r.errors);
console.log('\nframe = interval between frames (ms); work = time inside the model\'s frame() (ms); long = long tasks (>50 ms).');
console.log('Headless Chromium draws canvases in software; GPU machines spend far less on drawImage, filters and blur.');
if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify({ when: new Date().toISOString(), results }, null, 2)); console.log(`wrote ${JSON_OUT}`); }

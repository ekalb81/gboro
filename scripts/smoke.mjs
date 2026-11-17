// Open the built site in a headless Chrome and fail if a page throws, a file of ours is missing, or the
// village draws nothing. No dependencies: it talks to Chrome's debugging port directly.
//
// Usage: node scripts/smoke.mjs [page ...]      (default: every page)
//   CHROME   path to Chrome or Chromium (default: google-chrome, as on GitHub's runners)

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pages = process.argv.slice(2).length ? process.argv.slice(2) : ['index.html', 'house.html', 'classic.html', 'docs.html'];
const port = 8000 + Math.floor(Math.random() * 1000);
const debugPort = port + 1000;
const origin = `http://localhost:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, what, ms = 20_000) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(200);
  }
}

const profile = await mkdtemp(join(tmpdir(), 'smoke-'));
const server = spawn(process.execPath, [join(root, 'scripts', 'serve.mjs'), String(port)], { stdio: 'ignore' });
const chrome = spawn(process.env.CHROME || 'google-chrome', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--window-size=1280,800',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

const problems = [];
try {
  await until(() => fetch(origin).then((r) => r.ok), 'the local server');
  const tabs = await until(() => fetch(`http://localhost:${debugPort}/json`).then((r) => r.json()), 'Chrome');
  const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = () => bad(new Error('cannot reach Chrome')); });

  let seq = 0;
  let page = '';
  const waiting = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id) return waiting.get(m.id)?.(m);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      problems.push(`${page}: ${d.exception?.description?.split('\n')[0] || d.text} (${d.url || ''}:${d.lineNumber})`);
    }
    // A file of ours that is missing. Generated data files are allowed to be: the page falls back without them.
    if (m.method === 'Network.responseReceived') {
      const { url, status } = m.params.response;
      if (url.startsWith(origin) && status >= 400 && !url.includes('/data/') && !url.endsWith('/favicon.ico')) problems.push(`${page}: ${status} for ${url.slice(origin.length)}`);
    }
  };
  const send = (method, params = {}) => new Promise((ok) => {
    const id = ++seq;
    waiting.set(id, ok);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value;

  await send('Runtime.enable');
  await send('Network.enable');
  await send('Page.enable');
  for (page of pages) {
    await send('Page.navigate', { url: `${origin}/${page}` });
    await until(() => evaluate('document.readyState === "complete"'), `${page} to load`);
    await sleep(3000); // let the model load and a few frames draw
    // The village is drawn on canvases: at least one must have something other than blank pixels on it.
    const drawn = await evaluate(`(() => {
      const cs = [...document.querySelectorAll('canvas')];
      if (!cs.length) return 'none';
      return cs.some((c) => {
        try {
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          for (let i = 0; i < d.length; i += 4001) if (d[i] !== d[0]) return true;
        } catch {}
        return false;
      }) ? 'yes' : 'blank';
    })()`);
    if (page !== 'docs.html' && drawn !== 'yes') problems.push(`${page}: the village did not draw (canvas: ${drawn})`);
    console.log(`${page}: loaded${drawn === 'none' ? '' : `, canvas ${drawn === 'yes' ? 'drawn' : drawn}`}`);
  }
  ws.close();
} catch (e) {
  problems.push(e.message);
} finally {
  chrome.kill();
  server.kill();
  await sleep(300);
  await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
}

for (const p of problems) console.log(`::error::${p}`);
process.exit(problems.length ? 1 : 0);

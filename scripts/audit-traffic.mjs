// Replay the downtown traffic simulation. Usage: node scripts/audit-traffic.mjs (Playwright, as in bench.mjs).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('playwright')); }
const port = 8100 + Math.floor(Math.random() * 800);
const server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url)), String(port)]);
try {
  await new Promise((resolve, reject) => {
    server.stdout.once('data', resolve);
    server.once('error', reject);
    server.once('exit', (code) => reject(new Error(`Server exited with code ${code}`)));
  });
  const browser = await chromium.launch();
  try {
    for (const [clock, seed] of [['thu-17:20', 11], ['thu-22:45', 47]]) {
      const page = await browser.newPage({ reducedMotion: 'reduce' });
      await page.addInitScript((s) => {
        Math.random = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
      }, seed);
      await page.route('**/data/traffic-volumes.json', (route) => route.fulfill({ json: [] }));
      await page.goto(`http://localhost:${port}/index.html?debug&time=dusk&date=2026-11-19&weather=clear&clock=${clock}`);
      await page.waitForFunction(() => window.__tf?.step && window.__busy?.().act);
      const { peakStopped, stillStopped, retired } = await page.evaluate(() => {
        const { tcars, step } = window.__tf, stopped = new WeakMap(), firstCars = new Set(tcars);
        let peakStopped = 0, stillStopped = 0;
        for (let second = 0; second < 1800; second++) {
          for (let tick = 0; tick < 20; tick++) step(.05);
          stillStopped = 0;
          for (const car of tcars) {
            const duration = car.v < .05 ? (stopped.get(car) || 0) + 1 : 0;
            stopped.set(car, duration);
            if (duration >= 60) stillStopped++;
          }
          peakStopped = Math.max(peakStopped, stillStopped);
        }
        return { peakStopped, stillStopped, retired: firstCars.size - tcars.filter((car) => firstCars.has(car)).length };
      });
      assert.ok(retired > 0, `${clock} never retired a car`);
      assert.ok(peakStopped < 30 && stillStopped < 5, `${clock} had ${peakStopped} cars stopped for a minute, ${stillStopped} at the end`);
      console.log(`${clock}, seed ${seed}: ${peakStopped} cars stopped for a minute at peak, ${stillStopped} at the end, ${retired} initial cars retired`);
      await page.close();
    }
  } finally { await browser.close(); }
} finally { server.kill(); }

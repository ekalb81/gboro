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
      const page = await browser.newPage({ reducedMotion: 'reduce', viewport: { width: 630, height: 374 } });
      await page.addInitScript((s) => {
        Math.random = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
      }, seed);
      await page.route('**/data/traffic-volumes.json', (route) => route.fulfill({ json: [] }));
      await page.goto(`http://localhost:${port}/index.html?debug&time=dusk&date=2026-11-19&weather=clear&clock=${clock}&at=35.72,246.2`);
      await page.waitForFunction(() => window.__tf?.step && window.__busy?.().act);
      const { peakStopped, stillStopped, retired, roundaboutExits, repeatedLaps, reversals, longestRingStop } = await page.evaluate(() => {
        const { TF, tcars, step } = window.__tf, stopped = new WeakMap(), firstCars = new Set(tcars);
        const approaches = new Set(TF.lanes.filter(lane => !lane.ring && lane.to.out.some(next => next.ring)));
        const departures = new Set(TF.lanes.filter(lane => !lane.ring && lane.from.inn.some(prev => prev.ring)));
        const ringEntries = new WeakMap(), reversed = new Set();
        let peakStopped = 0, stillStopped = 0, roundaboutExits = 0, repeatedLaps = 0, longestRingStop = 0;
        for (let second = 0; second < 1800; second++) {
          for (let tick = 0; tick < 20; tick++) {
            step(.05);
            for (const car of tcars) {
              const entry = ringEntries.get(car);
              if (car.lane.ring) {
                if (!entry && approaches.has(car.from)) ringEntries.set(car, { lane: car.lane, repeated: false });
                else if (entry?.lane === car.lane && !entry.repeated && car.from?.ring) {
                  entry.repeated = true;
                  repeatedLaps++;
                }
              } else if (entry) {
                roundaboutExits++;
                ringEntries.delete(car);
              } else if (approaches.has(car.lane) && departures.has(car.from) && car.from.ch.n === car.lane.ch.n) {
                reversed.add(car);
              }
            }
          }
          stillStopped = 0;
          for (const car of tcars) {
            const duration = car.v < .05 ? (stopped.get(car) || 0) + 1 : 0;
            stopped.set(car, duration);
            if (car.lane.ring) longestRingStop = Math.max(longestRingStop, duration);
            if (duration >= 60) stillStopped++;
          }
          peakStopped = Math.max(peakStopped, stillStopped);
        }
        return { peakStopped, stillStopped, roundaboutExits, repeatedLaps, longestRingStop, reversals: reversed.size,
          retired: firstCars.size - tcars.filter((car) => firstCars.has(car)).length };
      });
      assert.ok(retired > 0, `${clock} never retired a car`);
      assert.ok(peakStopped < 30 && stillStopped < 5, `${clock} had ${peakStopped} cars stopped for a minute, ${stillStopped} at the end`);
      assert.ok(roundaboutExits > 0, `${clock} had no cars complete the roundabout`);
      assert.equal(repeatedLaps, 0, `${clock} had ${repeatedLaps} cars complete an extra lap of the roundabout`);
      assert.equal(reversals, 0, `${clock} had ${reversals} cars reverse from a roundabout exit into an approach`);
      assert.ok(longestRingStop < 60, `${clock} had a car stopped on the ring for ${longestRingStop} seconds`);
      console.log(`${clock}, seed ${seed}: ${peakStopped} cars stopped for a minute at peak, ${stillStopped} at the end, ` +
        `${retired} initial cars retired, ${roundaboutExits} roundabout exits without extra laps or immediate reversals, ` +
        `longest ring stop ${longestRingStop}s`);
      const closure = await page.evaluate(() => {
        const { TF, tcars, step } = window.__tf;
        let car = tcars.find(car => car.lane.ring);
        for (let i = 0; !car && i < 1200; i++) {
          step(.05);
          car = tcars.find(car => car.lane.ring);
        }
        if (!car) return null;
        const lane = car.lane, ring = lane.ring;
        const exits = TF.lanes.filter(l => !l.ring && l.from.inn.some(prev => prev.ring === ring));
        for (const exit of exits) exit.blocked = true;
        for (let i = 0; i < 200; i++) step(.05);
        const waited = tcars.includes(car) && car.lane === lane && car.v < .05;
        for (const exit of exits) exit.blocked = false;
        for (let i = 0; car.lane.ring && i < 1200; i++) step(.05);
        return { waited, usedExit: exits.includes(car.lane) && tcars.includes(car) };
      });
      assert.deepEqual(closure, { waited: true, usedExit: true }, `${clock} did not wait for a roundabout exit to reopen`);
      await page.close();
    }
  } finally { await browser.close(); }
} finally { server.kill(); }

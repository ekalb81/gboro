// Replay the downtown traffic simulation. AUDIT_URL can point to a published site (Playwright, as in bench.mjs).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('playwright')); }
const port = 8100 + Math.floor(Math.random() * 800);
const base = (process.env.AUDIT_URL || `http://localhost:${port}`).replace(/\/$/, '');
const server = process.env.AUDIT_URL ? null : spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url)), String(port)]);
try {
  if (server) await new Promise((resolve, reject) => {
    server.stdout.once('data', resolve);
    server.once('error', reject);
    server.once('exit', (code) => reject(new Error(`Server exited with code ${code}`)));
  });
  const browser = await chromium.launch({ executablePath: process.env.CHROME });
  try {
    for (const [clock, seed] of [['thu-17:20', 11], ['thu-22:45', 47], ['sat-14:15', 398], ['mon-08:10', 19]]) {
      const page = await browser.newPage({ reducedMotion: 'reduce', viewport: { width: 630, height: 374 } });
      await page.addInitScript((s) => {
        Math.random = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
      }, seed);
      await page.route('**/data/traffic-volumes.json', (route) => route.fulfill({ json: [] }));
      await page.goto(`${base}/index.html?debug&time=dusk&date=2026-11-19&weather=clear&clock=${clock}&at=35.72,246.2`);
      await page.waitForFunction(() => window.__tf?.step && window.__busy?.().act);
      const { peakStopped, stillStopped, retired, roundaboutExits, repeatedLaps, reversals, longestRingStop,
        turns, invalidTurns, invalidTracks, interiorExits } = await page.evaluate(() => {
        const { TF, tcars, step, turnAngle } = window.__tf, stopped = new WeakMap(), firstCars = new Set(tcars);
        const approaches = new Set(TF.lanes.filter(lane => !lane.ring && lane.to.out.some(next => next.ring)));
        const departures = new Set(TF.lanes.filter(lane => !lane.ring && lane.from.inn.some(prev => prev.ring)));
        const ringEntries = new WeakMap(), reversed = new Set(), lastLane = new WeakMap();
        const hasOnward = (from, to) => from.to.out.some(o => o !== to && o !== from.rev && !o.blocked &&
          (o.ch.n !== from.ch.n || Math.abs(turnAngle(from, o)) <= 2 * Math.PI / 3));
        let peakStopped = 0, stillStopped = 0, roundaboutExits = 0, repeatedLaps = 0, longestRingStop = 0;
        let turns = 0, invalidTurns = 0, invalidTracks = 0, interiorExits = 0;
        for (let second = 0; second < 1800; second++) {
          const present = tcars.slice();
          for (let tick = 0; tick < 20; tick++) {
            step(.05);
            for (const car of tcars) {
              const lane = car.lane, last = lastLane.get(car);
              if (lane !== last) {
                lastLane.set(car, lane);
                if (!lane.tracks[car.track]) invalidTracks++;
                if (last) {
                  turns++;
                  const from = car.from;
                  const reverses = lane === from.rev || (from.ch.n && lane.ch.n === from.ch.n && Math.abs(turnAngle(from, lane)) > 2 * Math.PI / 3);
                  if (from.to !== lane.from || (reverses && hasOnward(from, lane))) invalidTurns++;
                }
              }
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
          const active = new Set(tcars);
          for (const car of present) if (!active.has(car) && !car.lane.to.edge) interiorExits++;
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
          turns, invalidTurns, invalidTracks, interiorExits,
          retired: firstCars.size - tcars.filter((car) => firstCars.has(car)).length };
      });
      assert.ok(retired > 0, `${clock} never retired a car`);
      assert.ok(peakStopped < 30 && stillStopped < 5, `${clock} had ${peakStopped} cars stopped for a minute, ${stillStopped} at the end`);
      assert.ok(roundaboutExits > 0, `${clock} had no cars complete the roundabout`);
      assert.equal(repeatedLaps, 0, `${clock} had ${repeatedLaps} cars complete an extra lap of the roundabout`);
      assert.equal(reversals, 0, `${clock} had ${reversals} cars reverse from a roundabout exit into an approach`);
      assert.ok(longestRingStop < 60, `${clock} had a car stopped on the ring for ${longestRingStop} seconds`);
      assert.ok(turns > 0, `${clock} had no road transitions`);
      assert.deepEqual({ invalidTurns, invalidTracks, interiorExits }, { invalidTurns: 0, invalidTracks: 0, interiorExits: 0 }, `${clock} had a navigation failure`);
      console.log(`${clock}, seed ${seed}: ${peakStopped} cars stopped for a minute at peak, ${stillStopped} at the end, ` +
        `${retired} initial cars retired, ${roundaboutExits} roundabout exits without extra laps or immediate reversals, ` +
        `longest ring stop ${longestRingStop}s, ${turns} valid road transitions`);
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
      if (seed === 11) {
        const tracks = await page.evaluate(() => {
          const { TF, tcars, addCar, lanePos, step } = window.__tf;
          const { MAP, M, rideZ, along } = window.__audit;
          const wendover = TF.lanes.filter(l => l.ch.n === 'West Wendover Avenue' && l.tracks.length === 3);
          const straight = wendover.find(l => l.L > 6);
          const northElm = TF.lanes.find(l => l.ch.n === 'North Elm Street' && l.turns?.join('|') === 'left|through|right' &&
            l.to.out.some(o => o.ch.n === 'East Lindsay Street'));
          if (!straight || !northElm) return null;

          let elevated = 0, wrongHeight = 0;
          for (const lane of [...wendover, ...TF.lanes.filter(l => l.ch.n === 'South Eugene Street' && l.tracks.length >= 3)]) {
            for (let s = .2; s < lane.L; s += .2) {
              const [x, y, ux, uy] = along(lane.ch, s), center = rideZ('road', x, y, ux, uy, x, y);
              if (center < 2) continue;
              for (const track of [0, lane.tracks.length - 1]) {
                const pose = lanePos(lane, s, track);
                elevated++;
                if (Math.abs(rideZ('road', ...pose) - center) > 1) wrongHeight++;
              }
            }
          }
          for (const l of TF.lanes) l.cars.length = 0;
          tcars.length = 0;
          const start = 2, lead = addCar(straight, start + .65, 0);
          lead.v = 0;
          lead.v0 = .05;
          const followers = straight.tracks.map((_, track) => addCar(straight, start, track));
          const turnCars = northElm.tracks.map((_, track) => addCar(northElm, 0, track));
          for (let i = 0; i < 15; i++) step(.05);
          const poses = straight.tracks.map((_, k) => lanePos(straight, start, k));
          const spacing = poses.slice(1).map(([x, y], i) => Math.hypot(x - poses[i][0], y - poses[i][1]) * M);
          const segment = (a, b) => [a, b].map(p => p.map(v => v.toFixed(2)).join(',')).sort().join('/');
          const restricted = new Set(MAP.R.filter(r => r.noCars).flatMap(({ p }) =>
            p.filter((_, i) => i % 2 === 0 && i + 2 < p.length).map((_, i) => segment(p.slice(2 * i, 2 * i + 2), p.slice(2 * i + 2, 2 * i + 4)))));
          const restrictedInGraph = TF.lanes.filter(({ ch: { p } }) => p.some((q, i) => i > 0 && restricted.has(segment(p[i - 1], q)))).length;
          return { spacing, distances: followers.map(c => c.s - start), turns: turnCars.map(c => c.next?.ch.n), elevated, wrongHeight,
            restrictedSegments: restricted.size, restrictedInGraph };
        });
        assert.ok(tracks, 'missing the three mapped lanes on Wendover or North Elm');
        assert.ok(tracks.spacing.every(d => d > 3 && d < 4), `Wendover lane spacing was ${tracks.spacing}`);
        assert.ok(tracks.distances[0] < .18 && tracks.distances.slice(1).every(d => d > .4), 'a stopped car blocked an adjacent lane or its own follower drove through');
        assert.deepEqual(tracks.turns, ['East Lindsay Street', 'North Elm Street', 'West Lindsay Street'], 'cars ignored mapped turn lanes on North Elm');
        assert.ok(tracks.elevated > 0 && !tracks.wrongHeight, `${tracks.wrongHeight}/${tracks.elevated} outer bridge tracks had the wrong height`);
        assert.ok(tracks.restrictedSegments > 0 && !tracks.restrictedInGraph, 'an OSM motor-vehicle restriction is missing or its segment remains routable');

        const narrowing = await page.evaluate(() => {
          const { TF, tcars, addCar, lanePos, trafficPose, step } = window.__tf;
          const wide = TF.lanes.find(l => l.from.k === '12.35,238.43' && l.to.k === '12.59,235.62' && l.ch.n === 'South Eugene Street');
          const narrow = wide?.to.out.find(l => l.to.k === '13.59,224.25' && l.ch.n === wide.ch.n);
          if (!wide || !narrow || wide.width <= narrow.width) return null;
          for (const l of TF.lanes) l.cars.length = 0;
          tcars.length = 0;
          const cars = wide.tracks.map((_, track) => addCar(wide, wide.L - .5, track));
          step(.05);
          return cars.map((car, track) => {
            const [x, y] = trafficPose(car, wide.L), [nx, ny] = lanePos(narrow, 0, track);
            return car.next === narrow && car.nextTrack === track && Math.hypot(x - nx, y - ny) < .001;
          });
        });
        assert.deepEqual(narrowing, [true, true], 'the two South Eugene tracks jumped or merged at the width change');

        const greenLeft = await page.evaluate(() => {
          const { TF, tcars, addCar, light, step } = window.__tf;
          const { M } = window.__audit;
          const junction = TF.nodes.find(n => n.k === '61.76,31.13'); // North Elm and Bessemer
          const left = junction?.inn.find(l => l.ch.n === 'North Elm Street' && l.from.y > junction.y);
          const opposite = junction?.inn.find(l => l.ch.n === 'North Elm Street' && l.from.y < junction.y);
          const leftExit = junction?.out.find(l => l.ch.n === 'West Bessemer Avenue');
          if (!left || !opposite || !leftExit) return null;
          for (let i = 0; i < 600 && light(left) === 'g'; i++) step(.1);
          for (let i = 0; i < 600 && light(left) !== 'g'; i++) step(.1);
          if (light(left) !== 'g' || light(opposite) !== 'g') return null;
          for (const l of TF.lanes) l.cars.length = 0;
          tcars.length = 0;
          const line = (junction.width / 2 + 6.9) / M;
          const turning = addCar(left, left.L - line - .1, 0);
          const straight = addCar(opposite, opposite.L - line - .2, 0);
          Object.assign(turning, { next: leftExit, nextTrack: 0 });
          Object.assign(straight, { next: left.rev, nextTrack: 0, v: 1.4 });
          step(.05);
          const yielded = !turning.go && straight.go;
          for (let i = 0; i < 200 && turning.lane === left; i++) step(.05);
          return { yielded, exited: turning.lane === leftExit && straight.lane !== opposite };
        });
        assert.deepEqual(greenLeft, { yielded: true, exited: true }, 'the green left turn did not yield to opposing through traffic and then clear the intersection');
        const transfer = await page.evaluate(() => {
          const { TF, tcars, addCar, step } = window.__tf;
          for (const l of TF.lanes) l.cars.length = 0;
          tcars.length = 0;
          const lane = TF.lanes.find(l => !l.to.edge && l.to.out.some(q => q !== l.rev && q.id > l.id && q.L > 1));
          const next = lane.to.out.find(q => q !== lane.rev && q.id > lane.id && q.L > 1);
          const car = addCar(lane, lane.L - .01, 0);
          Object.assign(car, { v: 1, v0: 1, next, nextTrack: 0, go: true });
          step(.05);
          return car.lane === next && Math.abs(car.s - .04) < .0001;
        });
        assert.ok(transfer, 'a car advancing at one tile per second exceeded its 50 ms travel distance across a lane boundary');

        const merge = await page.evaluate(() => {
          const { TF, tcars, addCar, step } = window.__tf;
          const wide = TF.lanes.find(l => l.to.k === '20.53,224.53' && l.ch.n === 'West Washington Street' && l.tracks.length === 2);
          const narrow = wide?.to.out.find(l => l !== wide.rev && l.ch.n === wide.ch.n && l.tracks.length === 1);
          if (!wide || !narrow || wide.width <= narrow.width) return null;
          for (const l of TF.lanes) l.cars.length = 0;
          tcars.length = 0;
          const cars = wide.tracks.map((_, track) => Object.assign(addCar(wide, wide.L - .01, track),
            { ty: 2, v: 1, v0: 1, next: narrow, nextTrack: 0, go: true }));
          step(.05);
          const first = cars.find(c => c.lane === narrow);
          const second = cars.find(c => c.lane === wide);
          if (!first || !second) return null;
          const settled = first.off[2] <= narrow.spacing;
          const held = second.v === 0;
          for (let i = 0; i < 300 && second.lane === wide; i++) step(.05);
          return { settled, held, followed: second.lane === narrow && (first.lane !== narrow || first.s - second.s >= 5.31 / window.__audit.M) };
        });
        assert.deepEqual(merge, { settled: true, held: true, followed: true }, 'the two West Washington approach tracks did not merge one at a time');
      }
      await page.close();
    }
  } finally { await browser.close(); }
} finally { server?.kill(); }

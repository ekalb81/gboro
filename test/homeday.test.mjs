import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clockAt, parseWhen, planDay, nowDoing, weatherAllows, sayDoing, dayRand } from '../public/homeday.js';

const sat = { y: 2026, m: 6, d: 13, day: 5, min: 0 };
const at = (c, h, m = 0) => ({ ...c, min: h * 60 + m });
const sun = { rise: 360, set: 1230 };

test('clockAt reads the Greensboro clock', () => {
  const c = clockAt(new Date('2026-11-15T19:03:00Z'));
  assert.deepEqual([c.y, c.m, c.d, c.day, Math.floor(c.min)], [2026, 11, 15, 6, 14 * 60 + 3]);
});

test('parseWhen lays a weekday and time over the date', () => {
  const c = parseWhen('sat-10:15', sat);
  assert.equal(c.day, 5); assert.equal(c.min, 615); assert.equal(c.m, 6);
  assert.equal(parseWhen('nonsense', sat), null);
});

test('a Saturday in June: coffee, the lawn, a book, a walk, the fire', () => {
  const kinds = planDay(sat, sun).plan.map((p) => p.kind);
  assert.deepEqual(kinds, ['coffee', 'mow', 'read', 'walk', 'fire']);
  assert.equal(nowDoing(at(sat, 10, 20), {}, sun).kind, 'mow');
  assert.equal(nowDoing(at(sat, 20, 30), { tempF: 66 }, sun).kind, 'fire');
  assert.equal(nowDoing(at(sat, 3), {}, sun).kind, 'asleep');
  assert.equal(nowDoing(at(sat, 12), {}, sun).kind, 'inside');
});

test('plans never overlap and stay inside waking hours', () => {
  for (let d = 1; d <= 28; d++) for (const m of [1, 4, 7, 11]) {
    const c = { y: 2026, m, d, day: (d + m) % 7, min: 0 };
    const { wake, bed, plan } = planDay(c, { rise: 440, set: 1030 });
    plan.forEach((p, i) => { assert.ok(p.t0 >= wake && p.t1 <= bed && p.t1 > p.t0, `${m}/${d} ${p.kind}`); if (i) assert.ok(p.t0 >= plan[i - 1].t1, `${m}/${d} ${p.kind} overlaps`); });
  }
});

test('no mowing in winter, and the walk is fitted in before dark', () => {
  const jan = { y: 2026, m: 1, d: 10, day: 5, min: 0 };
  const { plan } = planDay(jan, { rise: 450, set: 1045 });
  assert.ok(!plan.some((p) => p.kind === 'mow'));
  assert.ok(plan.find((p) => p.kind === 'walk').t1 <= 1045);
});

test('weather calls things off', () => {
  assert.equal(nowDoing(at(sat, 10, 20), { precip: 'rain' }, sun).kind, 'inside');
  assert.equal(nowDoing(at(sat, 20, 30), { precip: 'storm' }, sun).kind, 'inside');
  assert.equal(weatherAllows('fire', { windMph: 25 }), false);
  assert.equal(weatherAllows('run', { tempF: 15 }), false);
  assert.equal(weatherAllows('walk', { precip: 'rain', intensity: 'light' }), true);
});

test('a forced preview runs from its own start', () => {
  const st = nowDoing(at(sat, 3), {}, sun, { kind: 'fire', t0: 120 });
  assert.equal(st.kind, 'fire'); assert.equal(st.t1, 315);
});

test('the line for the page names nobody', () => {
  for (const kind of ['run', 'walk', 'mow', 'garden', 'coffee', 'read', 'fire', 'asleep', 'inside']) {
    const s = sayDoing({ kind, t0: 600, t1: 660 }, sat);
    assert.ok(s.length > 3 && !/\b(she|her|he|his)\b/i.test(s), s);
  }
  assert.ok(dayRand(sat, 1) >= 0 && dayRand(sat, 1) < 1);
});

test('the house files give no address, street name or position', () => {
  for (const f of ['public/model/house.json', 'public/house.js', 'public/house.html', 'public/homeday.js']) {
    const s = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.ok(!/carolina|wendover|bessemer|fisher park|\b1013\b/i.test(s), f + ' names a place');
    if (f.endsWith('.json')) assert.ok(!/3[56]\.\d{3,}|-79\.\d{3,}/.test(s), f + ' has coordinates');
  }
});

test('the mowing round keeps clear of every trunk and the fire ring', async () => {
  const { mowRoute } = await import('../public/house.js');
  const lot = JSON.parse(readFileSync(new URL('../public/model/house.json', import.meta.url)));
  const { route, stripes } = mowRoute(lot);
  assert.ok(stripes.length > 20 && stripes.every((s) => s.d1 >= s.d0));
  const keep = [...lot.trees.map((t) => ({ x: t.x, y: t.y, r: 0.8 })), { x: lot.fire.x, y: lot.fire.y, r: lot.fire.r }];
  for (let d = 0; d <= route.len; d += 0.1) {
    const q = route.at(d);
    for (const o of keep) assert.ok(Math.hypot(q.x - o.x, q.y - o.y) >= o.r, `too close to (${o.x}, ${o.y}) at ${d.toFixed(1)} m`);
  }
});

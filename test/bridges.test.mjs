// The road bridges in the committed model (built by tools/model/bridges.py): ramps slope evenly from the span to
// the street, and every piece carries what the renderer needs to draw it and to put cars on it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const model = JSON.parse(readFileSync(new URL('../public/model/downtown.json', import.meta.url)));
const decks = model.DK.filter((d) => d.k === 'road');
const TOP = 7;

test('every road deck has an outline, centre lines and paint', () => {
  assert.ok(decks.length > 10);
  for (const d of decks) {
    assert.ok(d.p.length >= 6 && d.p.length % 2 === 0, 'outline');
    assert.ok(Array.isArray(d.cl) && d.cl.length >= 1 && d.cl.every((l) => Array.isArray(l) && l.length >= 4), 'centre lines');
    assert.ok(Array.isArray(d.gl) && Array.isArray(d.wl), 'paint lines');
    assert.ok(d.n, 'street name');
  }
});

test('Wendover has three marked lanes per carriageway and Bessemer has an offset directional divider', () => {
  const span = name => decks.find(d => d.sp && d.n === name);
  const wendover = span('West Wendover Avenue');
  assert.equal(wendover.cl.length, 2);
  assert.equal(wendover.wl.length, 4);
  const bessemer = span('East Bessemer Avenue');
  assert.equal(bessemer.wl.length, 2);
  const road = model.R.find(r => r.br && r.n === bessemer.n);
  assert.deepEqual([road.lf, road.lb].sort(), [1, 3]);
  assert.notDeepEqual(bessemer.gl[0], bessemer.cl[0]);
});

test('spans stand on open air, ramps and fill on the ground', () => {
  for (const d of decks) {
    if (d.sp) { assert.ok(d.z0 > 0 && d.z1 === TOP && !d.sl); } else assert.equal(d.z0, 0);
  }
});

test('ramps slope: each piece falls by a small, even step and the lowest ends on the street', () => {
  const ramps = decks.filter((d) => d.sl);
  assert.ok(ramps.length >= 20);
  for (const d of ramps) {
    const [ax, ay, za, bx, by, zb] = d.sl;
    assert.ok(za > zb && za <= TOP && zb >= 0, 'falls away from the bridge');
    assert.ok(za - zb <= 2.5, 'no big step');
    assert.equal(d.z1, za);
    assert.ok(Math.hypot(bx - ax, by - ay) > 0.5, 'has length');
  }
  for (const name of new Set(ramps.map((d) => d.n))) {
    const mine = ramps.filter((d) => d.n === name);
    assert.ok(mine.some((d) => d.sl[2] === TOP), `${name}: a ramp starts at the span`);
    assert.ok(mine.some((d) => d.sl[5] <= 3), `${name}: a ramp comes down`);
  }
});

test('no stepped ramps are left: nothing but spans, fill and ramps at full height is flat', () => {
  for (const d of decks) if (!d.sl) assert.equal(d.z1, TOP);
});

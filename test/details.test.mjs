// The small real things on the model (public/model/details.json, tools/model/details.py) stay inside the model and
// keep the ones people look for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { makeBalconyPlans, makeDetails } from '../public/details.js';

const load = async (f) => JSON.parse(await readFile(new URL(`../public/model/${f}`, import.meta.url), 'utf8'));
const map = await load('downtown.json');
const det = await load('details.json');
const G = map.GEO;
const grid = (lon, lat) => [(lon - G.west) * G.mPerDegLon / map.M, (G.north - lat) * G.mPerDegLat / map.M];
const mid = (p) => { let x = 0, y = 0; for (let i = 0; i < p.length; i += 2) { x += p[i]; y += p[i + 1]; } return [x / (p.length / 2), y / (p.length / 2)]; };

test('every detail sits on the model', () => {
  for (const a of det.A) { const [x, y] = mid(a.p); assert.ok(x > -1 && x < map.GX + 1 && y > -1 && y < map.GY + 1, `${a.k} at ${x},${y}`); }
  for (const [k, x, y] of det.P) assert.ok(x >= 0 && x <= map.GX && y >= 0 && y <= map.GY, `${k} at ${x},${y}`);
});

test('the apartment pool by the rail yard is there', () => {
  // OpenStreetMap way 414248821, just west of Murrow Boulevard: the pool that started this pass
  const [x, y] = grid(-79.784895, 36.068382);
  const pools = det.A.filter((a) => a.k === 'pool').map((a) => mid(a.p));
  assert.ok(pools.length >= 5, `${pools.length} pools`);
  assert.ok(pools.some(([px, py]) => Math.hypot(px - x, py - y) < 4), 'no pool within 36 m of the apartments');
});

test('the ballpark has its diamond and the model its brick paving', () => {
  assert.equal(det.D.length, 1);
  const [ux, uy] = det.D[0].d; assert.ok(Math.abs(Math.hypot(ux, uy) - 1) < 0.01);
  assert.ok(det.BK && det.BK.rows.length === det.BK.h);
  assert.equal(det.BK.w, Math.ceil(map.GX * det.BK.r));
});

test('rooftop details name a building that exists', () => {
  const ids = new Set(map.B.map((b) => b.id));
  for (const a of det.A) if (a.b) assert.ok(ids.has(a.b), `${a.k} on unknown building ${a.b}`);
});

test('CityView terraces fill the lower footprint and draw floors and rails at deck height', () => {
  const floors = [], rails = [];
  const plan = makeBalconyPlans(det);
  const details = makeDetails(det, {
    M: map.M, ZPM: 2, P: (x, y, z) => [x, y, z], mix: (color) => color, surf: (color) => color,
    line: (_canvas, a, b) => rails.push([a, b]),
    poly: (_canvas, q) => floors.push(q),
  });
  const area = (q) => q.reduce((a, [x, y], i) => {
    const [x1, y1] = q[(i + 1) % q.length];
    return a + x * y1 - y * x1;
  }, 0) / 2;
  for (const id of [414248814, 598164879]) {
    const { p } = map.B.find((b) => b.id === id);
    const pts = p.filter((_, i) => i % 2 === 0).map((x, i) => [x, p[2 * i + 1]]);
    const building = { id, pts, hpx: 28, lv: 4 };
    const balcony = building.balcony = plan(building);
    assert.equal(balcony.areas.length, 4);
    assert.equal(balcony.z, 21);
    for (const q of balcony.areas) {
      const [a, corner, b, recess] = q;
      const i = pts.findIndex(([x, y]) => x === recess[0] && y === recess[1]);
      assert.ok(i >= 0);
      assert.deepEqual(a, pts[(i + pts.length - 1) % pts.length]);
      assert.deepEqual(b, pts[(i + 1) % pts.length]);
      assert.deepEqual(balcony.lower[i], corner);
    }
    const deckArea = balcony.areas.reduce((a, q) => a + area(q), 0);
    assert.ok(Math.abs(area(balcony.lower) - area(pts) - deckArea) < 1e-8);
    for (const behind of [true, false]) {
      floors.length = rails.length = 0;
      details.balconies(null, building, behind);
      assert.equal(floors.length, behind ? 4 : 0);
      assert.ok(floors.flat().every(([, , z]) => z === 21));
      assert.ok(rails.every(([a, b]) => a[2] >= 21 && b[2] >= 21));
      const tops = rails.filter(([a, b]) => a[2] > 21 && b[2] > 21);
      assert.equal(tops.length, 4);
      for (const [[ax, ay], [bx, by]] of tops) assert.equal(by - ay <= bx - ax, behind);
    }
  }
});

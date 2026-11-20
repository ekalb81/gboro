// The small real things on the model (public/model/details.json, tools/model/details.py) stay inside the model and
// keep the ones people look for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { makeDetails } from '../public/details.js';

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

test('CityView decks fill the roof setbacks and render at the top-floor level', () => {
  const slabs = [], rails = [], windows = [];
  const details = makeDetails(det, {
    M: map.M, ZPM: 2, P: (x, y, z) => [x, y, z], mix: (color) => color,
    drawPrism: (_canvas, q, base, height) => slabs.push({ q, base, height }),
    line: (_canvas, a, b) => rails.push([a, b]),
    poly: (_canvas, q) => windows.push(q),
  });
  for (const id of [414248814, 598164879]) {
    const { p } = map.B.find((b) => b.id === id);
    const footprint = p.filter((_, i) => i % 2 === 0).map((x, i) => [x, p[2 * i + 1]]);
    const building = { id, hpx: 28, lv: 4 };
    slabs.length = rails.length = windows.length = 0;
    details.balconies(null, building, true);
    assert.ok(slabs.length > 0 && slabs.length < 4);
    details.roof(null, building);
    assert.equal(slabs.length, 4);
    for (const { q, base, height } of slabs) {
      const [a, corner, b, recess] = q;
      const i = footprint.findIndex(([x, y]) => x === a[0] && y === a[1]);
      assert.ok(i >= 0);
      assert.deepEqual(recess, footprint[(i + 1) % footprint.length]);
      assert.deepEqual(b, footprint[(i + 2) % footprint.length]);
      assert.notDeepEqual(corner, recess);
      assert.equal(base, 0);
      assert.equal(height, 21);
    }
    assert.ok(rails.every(([a, b]) => a[2] >= 21 && b[2] >= 21));
    assert.equal(rails.filter(([a, b]) => a[2] > 21 && b[2] > 21).length, 8);
    assert.ok(windows.length > 0 && windows.flat().every(([, , z]) => z > 0 && z < 21));
  }
});

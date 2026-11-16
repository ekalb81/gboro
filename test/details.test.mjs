// The small real things on the model (public/model/details.json, tools/model/details.py) stay inside the model and
// keep the ones people look for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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

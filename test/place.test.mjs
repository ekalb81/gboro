import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAddress, toGrid, inModel, makePlacer, nearestOnChain } from '../public/place.js';

const model = JSON.parse(readFileSync(new URL('../public/model/downtown.json', import.meta.url)));

// A few real downtown places (OpenStreetMap), as eats.json has them.
const EATS = [
  { id: 'a', name: 'No Rush', kind: 'cafe', address: '245 East Friendly Avenue', lat: 36.07484, lon: -79.78776 },
  { id: 'b', name: 'Sideline Social', kind: 'bar', address: '312 South Elm Street', lat: 36.06942, lon: -79.79068 },
  { id: 'c', name: 'Little Brother Brewing', kind: 'brewery', address: '348 South Elm Street', lat: 36.06862, lon: -79.79046 },
  { id: 'd', name: '913 Whiskey Bar', kind: 'bar', address: '913 South Chapman Street', lat: 36.06323, lon: -79.82363 },
];

test('parseAddress normalises directions, suffixes and suites', () => {
  assert.deepEqual(parseAddress('245 E. Friendly Ave, Greensboro, NC'), { num: 245, street: 'east friendly avenue' });
  assert.deepEqual(parseAddress('312 S Elm St Suite 200, Greensboro, NC 27401'), { num: 312, street: 'south elm street' });
  assert.deepEqual(parseAddress('221 Summit Ave'), { num: 221, street: 'summit avenue' });
  assert.equal(parseAddress('n/a'), null);
  assert.equal(parseAddress('LeBauer Park'), null);
});

test('model geo box: the corners map to the grid corners', () => {
  const g = model.GEO;
  const [x0, y0] = toGrid(model, g.north, g.west);
  const [x1, y1] = toGrid(model, g.south, g.east);
  assert.ok(Math.abs(x0) < 1e-6 && Math.abs(y0) < 1e-6);
  assert.ok(Math.abs(x1 - model.GX) < 0.05 && Math.abs(y1 - model.GY) < 0.05);
  assert.ok(inModel(model, ...toGrid(model, 36.0726, -79.792))); // Elm and Market
  assert.ok(!inModel(model, ...toGrid(model, 36.0593, -79.825))); // the Coliseum
});

test('items are placed by venue building, by known place, or by street address', () => {
  const P = makePlacer(model, EATS);
  const theatre = P.place({ venue: 'Carolina Theatre', address: null });
  assert.equal(theatre.how, 'building');
  const bar = P.place({ venue: 'Sideline Social', address: '312 S. Elm St' });
  assert.equal(bar.how, 'place');
  // Unknown venue, but between two known numbers on South Elm.
  const mid = P.place({ venue: 'Some Gallery', address: '330 S Elm St, Greensboro, NC' });
  assert.equal(mid.how, 'street');
  const [bx, by] = toGrid(model, 36.06942, -79.79068), [cx, cy] = toGrid(model, 36.06862, -79.79046);
  assert.ok(Math.hypot(mid.gx - (bx + cx) / 2, mid.gy - (by + cy) / 2) < 1);
  // Known place outside downtown, and an address far out on a downtown street: paper only.
  assert.equal(P.place({ venue: '913 Whiskey Bar', address: null }), null);
  assert.equal(P.place({ venue: 'Hole 19', address: '3606 N Elm St, Greensboro, NC 27455' }), null);
  assert.equal(P.place({ venue: 'Somewhere', address: null }), null);
  // A street with no direction prefix and no known addresses near the number: not guessed.
  assert.equal(P.place({ venue: 'Somewhere else', address: '5000 Summit Ave' }), null);
});

test('block numbering puts a downtown address on its street, inside the model', () => {
  const P = makePlacer(model, []);
  const p = P.place({ venue: 'Somewhere new', address: '260 N Elm St' });
  assert.ok(p && p.how === 'street');
  const elm = P.streets.get('north elm street');
  const near = Math.min(...elm.map(([x, y]) => Math.hypot(x - p.gx, y - p.gy)));
  assert.ok(near < 2, `within two tiles of North Elm (${near})`);
});

test('nearestOnChain finds the closest point and distance along', () => {
  const r = nearestOnChain([[0, 0], [10, 0], [10, 10]], 10.5, 4);
  assert.ok(Math.abs(r.dist - 0.5) < 1e-9);
  assert.ok(Math.abs(r.d - 14) < 1e-9);
});

test('most buildings have something to call them, and the data stays in shape', () => {
  const called = model.B.filter((b) => b.n || b.tn?.length || b.ad);
  assert.ok(called.length / model.B.length > 0.75, `${called.length} of ${model.B.length} buildings have a name, a tenant or an address`);
  for (const b of model.B) {
    assert.equal(typeof b.n, 'string');
    if (b.tn) assert.ok(b.tn.length > 0 && b.tn.length <= 8 && b.tn.every((t) => t && typeof t === 'string'));
    if (b.ad) assert.match(b.ad, /^\d+[A-Za-z]?(-\d+[A-Za-z]?)? \S/);
  }
  const books = model.B.find((b) => b.tn?.includes('Scuppernong Books'));
  assert.equal(books.ad, '304 S Elm St');
});

test('items are placed by a tenant of a building, or by the building at that address', () => {
  const P = makePlacer(model, []);
  const books = model.B.find((b) => b.tn?.includes('Scuppernong Books'));
  const reading = P.place({ venue: 'Scuppernong Books', address: 'n/a' });
  assert.equal(reading.how, 'building');
  assert.equal(reading.buildingId, books.id);
  // An unknown venue at a mapped address lands on that building, ranges included.
  const popup = P.place({ venue: 'Somebody New', address: '304 S. Elm St, Greensboro, NC' });
  assert.equal(popup.buildingId, books.id);
  const range = model.B.find((b) => b.ad === '346-348 S Elm St');
  assert.equal(P.place({ venue: 'Another One', address: '348 South Elm Street' }).buildingId, range.id);
});

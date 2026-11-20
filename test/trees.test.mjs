import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { look, windOn, dayOfYear, loadTrees, SPECIES } from '../public/trees.js';

test('day of year follows Greensboro time', () => {
  assert.equal(dayOfYear(new Date('2026-01-01T12:00:00Z')), 1);
  assert.equal(dayOfYear(new Date('2026-11-14T03:00:00Z')), 317); // still Nov 13 in Greensboro
});

test('each deciduous species has a year: bare in January, full in July, coloured in November', () => {
  for (const [k, sp] of Object.entries(SPECIES)) {
    if (sp.ever) { assert.equal(look(k, 15).leaf, 1); continue; }
    assert.ok(look(k, 15).leaf <= 0.3, `${k} in January`);
    assert.equal(look(k, 200).leaf, 1, `${k} in July`);
    assert.notEqual(look(k, 312).col, sp.green, `${k} in November`);
  }
});

test('spring flowers come at the right time', () => {
  assert.ok(look('pear', 77).bloomAmt > 0.5);   // mid March
  assert.ok(look('dogwood', 100).bloomAmt > 0.5); // about April 10
  assert.ok(look('crape', 205).bloomAmt > 0.5);  // late July
  assert.equal(look('dogwood', 200).bloomAmt, 0);
});

test('wind blows the right way on screen', () => {
  const sw = windOn(15, 25, 225); // from the south-west, so toward the north-east: up and to the right
  assert.ok(sw.vx > 0.9 && Math.abs(sw.vy) < 0.1);
  const n = windOn(10, 0, 0); // from the north, toward the south: down and to the left
  assert.ok(n.vx < 0 && n.vy > 0);
  assert.deepEqual(windOn(0, 0, null).lean, [0, 0]);
});

test('trees.json unpacks, and OSM-only trees are planted young', () => {
  const t = loadTrees({ SP: ['crape', 'willowoak'], SRC: ['lidar', 'osm'], T: [[1, 2, 14, 5, 1, 0], [3, 4, 5, 1.8, 0, 1]] });
  assert.equal(t.length, 2);
  assert.equal(t[0].sp, 'willowoak');
  assert.equal(t[0].h, 14);
  assert.ok(t[1].h < 7 && t[1].src === 'osm');
});

test('the published model keeps both Gorrell Street trees in their planting areas', () => {
  const data = JSON.parse(readFileSync(new URL('../public/model/trees.json', import.meta.url)));
  const roots = loadTrees(data);
  assert.deepEqual(roots.find(t => t.gx === 88.49 && t.gy === 268.32)?.pit, [1.6, 1.4]);
  assert.deepEqual(roots.find(t => t.gx === 89.95 && t.gy === 270.07)?.pit, [1.6, 1.4]);
  assert.ok(!roots.some(t => t.gx === 94.5 && t.gy === 262.83));
});

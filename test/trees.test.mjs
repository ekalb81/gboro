import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { drawTree, look, windOn, dayOfYear, loadTrees, treeOutlineParts, SPECIES } from '../public/trees.js';

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

test('crown textures stay on foliage on sparse, flowering, and wind-bent trees', () => {
  for (const [sp, h, r, seed, doy, lean, texture] of [
    ['holly', 6.4, 4.9, 0.6919883187656524, 323, [3, 1], '#d8302a'],
    ['redmaple', 7.7, 5.5, 0.7726628245909524, 323, [0, 0], 'fleck'],
    ['crape', 4.8, 4.2, 0.05370194048737176, 205, [0, 0], '#e8609a'],
    ['magnolia', 11.2, 4.7, 0.708529151892435, 150, [0, 0], '#fbf6e8'],
  ]) {
    const foliage = [], dots = [];
    drawTree({}, { sp, h, r, seed }, {
      P: () => [0, 0], doy, lean, SH: 'shade', HI: 'light',
      mix: (a, b, t) => t === 0.22 ? 'fleck' : a,
      surf: (col) => col,
      line: () => {},
      fr: (c, x, y, w, h, col) => { if (col === texture) dots.push([x + w / 2, y + h / 2]); },
      circ: (c, x, y, r) => foliage.push((px, py) => Math.hypot(px - x, py - y) <= r),
      poly: (c, points) => foliage.push((x, y) => {
        const sides = points.map(([ax, ay], i) => {
          const [bx, by] = points[(i + 1) % points.length];
          return (bx - ax) * (y - ay) - (by - ay) * (x - ax);
        });
        return sides.every(n => n >= 0) || sides.every(n => n <= 0);
      }),
    });
    assert.ok(dots.length > 0, `${sp} should have texture`);
    for (const [x, y] of dots) {
      assert.ok(foliage.some(contains => contains(x, y)), `${sp} texture floats at ${x}, ${y}`);
    }
  }
});

test('tree occlusion keeps winter branches and wind-bent leaf clumps, without haze or fallen leaves', () => {
  const tree = { sp: 'redmaple', h: 14, r: 6, seed: 0.5 };
  const winter = treeOutlineParts(tree, [0, 0], 15);
  assert.ok(winter.some(([kind, points]) => kind === 'p' && points.some(([x, y]) => x < -4 && y < -18)));
  assert.ok(winter.every(([kind]) => kind === 'p'), 'winter haze must not hide objects in the crown');

  const crowns = (lean, doy) => treeOutlineParts(tree, lean, doy).filter(([kind]) => kind === 'e');
  const autumn = crowns([5, -2], 326);
  assert.ok(autumn.length > 0 && autumn.length < crowns([5, -2], 200).length);
  const [ , stillX, stillY] = crowns([0, 0], 326)[0];
  const [ , bentX, bentY] = autumn[0];
  assert.ok(bentX > stillX + 2 && bentY < stillY - 1);

  const dropsLeaves = look(tree.sp, 326, tree.seed).litter > 0.5;
  const groundRects = treeOutlineParts(tree, [5, -2], 326).filter(([kind, , y]) => kind === 'r' && y > -5);
  assert.ok(dropsLeaves);
  assert.deepEqual(groundRects, []);
});

test('the published model keeps both Gorrell Street trees in their planting areas', () => {
  const data = JSON.parse(readFileSync(new URL('../public/model/trees.json', import.meta.url)));
  const roots = loadTrees(data);
  assert.deepEqual(roots.find(t => t.gx === 88.49 && t.gy === 268.32)?.pit, [1.6, 1.4]);
  assert.deepEqual(roots.find(t => t.gx === 89.95 && t.gy === 270.07)?.pit, [1.6, 1.4]);
  assert.ok(!roots.some(t => t.gx === 94.5 && t.gy === 262.83));
});

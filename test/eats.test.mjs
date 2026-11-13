import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHours, openAt, kindOf, isChain, placeOnMap, toPlace } from '../scripts/eats-lib.mjs';

const MO = 0, FR = 4, SA = 5, SU = 6;
const at = (h, m = 0) => h * 60 + m;

test('parses the common opening_hours shapes', () => {
  const w = parseHours('Mo-Fr 11:00-22:00; Sa,Su 10:00-23:00; PH off');
  assert.deepEqual(w[MO], [[at(11), at(22)]]);
  assert.deepEqual(w[SU], [[at(10), at(23)]]);
  assert.deepEqual(parseHours('24/7')[3], [[0, 1440]]);
  assert.deepEqual(parseHours('11:00-14:00,17:00-21:00')[2], [[at(11), at(14)], [at(17), at(21)]]);
});

test('later ";" rules replace days, ", " rules add to them', () => {
  const w = parseHours('Mo-Su 11:00-22:00; Mo off');
  assert.deepEqual(w[MO], []);
  const v = parseHours('Mo-Fr 07:00-10:00, Mo-Th 11:00-22:00');
  assert.deepEqual(v[MO], [[at(7), at(10)], [at(11), at(22)]]);
  assert.deepEqual(v[FR], [[at(7), at(10)]]);
  // a comma inside a day list is still a day list
  assert.deepEqual(parseHours('Mo-We,Su 09:00-17:00')[SU], [[at(9), at(17)]]);
});

test('bars open past midnight stay open into the next day', () => {
  const w = parseHours('Th-Sa 17:00-02:00');
  assert.equal(openAt(w, FR, at(23)), true);
  assert.equal(openAt(w, SA, at(1, 30)), true);   // Friday night, after midnight
  assert.equal(openAt(w, SU, at(1, 30)), true);   // Saturday night, after midnight
  assert.equal(openAt(w, MO, at(1, 30)), false);  // Sunday was closed
  assert.equal(openAt(w, SA, at(2)), false);
  assert.equal(openAt(w, SA, at(16)), false);
});

test('unknown syntax gives null rather than a wrong answer', () => {
  for (const s of ['Nov-Mar Mo-Fr 10:00-16:00', 'sunrise-sunset', 'Mo-Fr 11:00-22:00 "call ahead"', '', null]) {
    assert.equal(parseHours(s), null, String(s));
  }
  assert.equal(openAt(null, MO, 600), null);
});

test('kinds and chains', () => {
  assert.equal(kindOf({ amenity: 'pub' }), 'bar');
  assert.equal(kindOf({ amenity: 'restaurant', microbrewery: 'yes' }), 'brewery');
  assert.equal(kindOf({ amenity: 'nightclub' }), 'nightclub');
  assert.equal(kindOf({ amenity: 'bank' }), null);
  assert.equal(isChain({ brand: 'Starbucks' }), true);
  assert.equal(isChain({ name: 'Local Joe' }), false);
});

test('places land near the right part of the village map', () => {
  const elmAndMarket = placeOnMap(36.07248, -79.7903);
  assert.deepEqual(elmAndMarket, { hub: 'downtown', x: 49, y: 25 });
  const southElm = placeOnMap(36.0685, -79.7905); // just south of the tracks
  assert.equal(southElm.hub, 'downtown');
  assert.ok(southElm.y >= 33 && southElm.y <= 37, `y=${southElm.y}`);
  assert.equal(placeOnMap(36.0675, -79.8090).hub, 'uncg');
  assert.equal(placeOnMap(35.9, -79.5), null); // well outside town
});

test('toPlace keeps local food and drink and skips the rest', () => {
  const bar = toPlace({ type: 'node', id: 1, lat: 36.0718, lon: -79.7901, tags: { amenity: 'bar', name: 'Little Saloon', opening_hours: 'Mo-Su 16:00-02:00', website: 'http://example.com' } });
  assert.equal(bar.place.kind, 'bar');
  assert.equal(bar.place.hub, 'downtown');
  assert.equal(bar.place.website, 'https://example.com');
  assert.equal(bar.place.osm, 'https://www.openstreetmap.org/node/1');
  assert.equal(toPlace({ type: 'node', id: 2, lat: 36.07, lon: -79.79, tags: { amenity: 'cafe', name: 'Chain', brand: 'Chain' } }).skip, 'chain');
  assert.equal(toPlace({ type: 'way', id: 3, center: { lat: 36.07, lon: -79.79 }, tags: { amenity: 'restaurant' } }).skip, 'unnamed');
  assert.equal(toPlace({ type: 'way', id: 4, center: { lat: 36.07, lon: -79.79 }, tags: { amenity: 'restaurant', name: 'X' } }).place.id, 'w4');
});

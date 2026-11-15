import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickAadt, toStations, queryUrl, bestSet } from '../scripts/traffic-volumes-lib.mjs';

test('takes the newest year that has a count', () => {
  assert.deepEqual(pickAadt({ AADT_2019: 14000, AADT_2021: 12500, AADT_2023: null, ROUTE: 'US 220' }), { aadt: 12500, year: 2021 });
  assert.deepEqual(pickAadt({ AADT2022: '9,100' }), null); // not a number
  assert.deepEqual(pickAadt({ aadt2022: 9100.4 }), { aadt: 9100, year: 2022 });
  assert.deepEqual(pickAadt({ AADT: 7200, AADT_YEAR: 2024 }), { aadt: 7200, year: 2024 });
  assert.equal(pickAadt({ AADT_2021: 0, OBJECTID: 5 }), null);
});

test('reads stations from an ArcGIS answer and drops the ones without a count', () => {
  const json = { features: [
    { attributes: { ROUTE: ' W MARKET ST ', AADT_2021: 15500 }, geometry: { x: -79.7931234567, y: 36.0721234567 } },
    { attributes: { ROUTE: 'S ELM ST', AADT_2021: null }, geometry: { x: -79.79, y: 36.07 } },
    { attributes: { AADT_2021: 8000 } },
  ] };
  assert.deepEqual(toStations(json), [{ lat: 36.072123, lon: -79.793123, aadt: 15500, year: 2021, name: 'W MARKET ST' }]);
  assert.deepEqual(toStations(null), []);
});

test('asks for a box in plain latitude and longitude', () => {
  const u = new URL(queryUrl('https://example.test/FeatureServer/0', { west: -79.8, south: 36.06, east: -79.78, north: 36.08 }));
  assert.equal(u.pathname, '/FeatureServer/0/query');
  assert.equal(u.searchParams.get('geometry'), '-79.8,36.06,-79.78,36.08');
  assert.equal(u.searchParams.get('outSR'), '4326');
});

test('prefers the layer with the newest counts', () => {
  const a = { url: 'a', stations: [{ year: 2021 }, { year: 2021 }] }, b = { url: 'b', stations: [{ year: 2023 }] };
  assert.equal(bestSet([a, b, { url: 'c', stations: [] }]).url, 'b');
  assert.equal(bestSet([]), null);
});

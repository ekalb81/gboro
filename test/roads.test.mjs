import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseListDate, cleanText, kindOf, fromListRow, fromApiEvent, project, place, villageRoadFor, buildRoads, fetchRoads, ANCHORS } from '../scripts/roads.mjs';

const fx = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url)));
const map = fx('../../public/data/map.json');
const list = fx('drivenc-list.json');   // trimmed real rows from the DriveNC traffic list, Nov 2026
const icons = fx('drivenc-icons.json'); // their map locations
const NOW = Date.parse('2026-11-12T02:00:00Z');

test('parses DriveNC list dates as Eastern time', () => {
  assert.equal(parseListDate('5/11/26, 8:52 AM'), '2026-05-11T08:52:00-04:00');
  assert.equal(parseListDate('2/28/27, 7:00 PM'), '2027-02-28T19:00:00-05:00');
  assert.equal(parseListDate('12/1/26, 12:05 AM'), '2026-12-01T00:05:00-05:00');
  assert.equal(parseListDate(null), null);
});

test('cleans list descriptions', () => {
  assert.equal(cleanText("Construction on Randleman Rd. Lane Alternating. Id: 12495<div class='cellSpacer'><i>x</i></div>"), 'Construction on Randleman Rd. Lane Alternating.');
  assert.equal(cleanText('Rest area closed. Updated 8:56 am. ATMS ID -26051100030.'), 'Rest area closed. Updated 8:56 am.');
});

test('decides what to draw', () => {
  assert.equal(kindOf({ type: 'Incidents', subtype: 'vehicleCrash' }), 'crash');
  assert.equal(kindOf({ type: 'Upcoming Closures', subtype: 'sportingEvent', full: true }), 'event');
  assert.equal(kindOf({ type: 'Closures', subtype: 'construction', full: true }), 'closed');
  assert.equal(kindOf({ type: 'Road Work', subtype: 'maintenance' }), 'work');
});

test('projection puts the anchors on their tiles and keeps Greensboro on the grid', () => {
  for (const [lat, lon, x, y] of ANCHORS) assert.deepEqual(project(lat, lon).map(Math.round), [x, y]);
  const [x, y] = project(36.0726 + 0.003, -79.791); // a few blocks north of Elm and Market
  assert.ok(Math.abs(x - 48) < 3 && y < 24 && y > 14, `got ${x},${y}`);
});

test('snaps events on village roads onto that road', () => {
  assert.equal(villageRoadFor('S Elm St', map), 'Elm St');
  assert.equal(villageRoadFor('E Lee St', map), 'Gate City Blvd / Lee St');
  assert.equal(villageRoadFor('McConnell Rd', map), null);
  const p = place({ road: 'N Elm St', lat: 36.0800, lon: -79.7930 }, map);
  assert.equal(p.on, 'Elm St');
  assert.equal(p.tile[0], 48);
  assert.equal(p.dir, 'v');
  const side = place({ road: 'McConnell Rd', lat: 36.0600, lon: -79.7268 }, map);
  assert.equal(side.on, null);
  assert.ok(side.tile[0] > 64, 'McConnell Rd is east of Benbow');
});

test('keeps Greensboro events only, and drops ones that have ended', () => {
  const where = new Map(icons.item2.map((i) => [String(i.itemId), i.location]));
  const all = list.data.map((r) => fromListRow(r, where.get(String(r.id))));
  const out = buildRoads(all, map, { now: NOW });
  const roads = out.events.map((e) => e.road).sort();
  // McConnell Rd and Randleman Rd are in Greensboro. W Green Dr is High Point, I-26 is Polk County,
  // and the upcoming Randleman Rd and Hardie St events have no location and no village road.
  assert.deepEqual(roads, ['McConnell Rd', 'Randleman Rd']);
  const mc = out.events.find((e) => e.road === 'McConnell Rd');
  assert.deepEqual([mc.kind, mc.full, mc.upcoming], ['closed', true, false]);
  assert.ok(mc.tile);
  assert.equal(buildRoads(all, map, { now: Date.parse('2030-01-01') }).events.length, 0);
});

test('fetchRoads pages the public list and joins map locations', async () => {
  const calls = [];
  const fake = async (url, opts) => {
    calls.push(url);
    assert.ok(opts.headers['user-agent']);
    if (url.includes('/List/GetData/traffic')) return { ok: true, json: async () => list };
    if (url.includes('/map/mapIcons/Closures')) return { ok: true, json: async () => icons };
    if (url.includes('/map/mapIcons/')) return { ok: true, json: async () => ({ item2: [] }) };
    return { ok: false, status: 404 };
  };
  const out = await fetchRoads(map, { fetchImpl: fake, now: NOW });
  assert.equal(out.source, 'DriveNC public site');
  assert.equal(out.events.length, 2);
  assert.equal(calls.filter((u) => u.includes('GetData')).length, 1);
});

test('fetchRoads uses the Events API when given a key', async () => {
  const ev = { ID: 9, RoadwayName: 'S Elm St', Description: 'Crash on S Elm St. All lanes closed.', EventType: 'closures', OriginalEventType: 'accidentsAndIncidents', EventSubType: 'vehicleCrash', IsFullClosure: true, County: 'Guilford', Latitude: 36.065, Longitude: -79.789, StartDate: NOW / 1000 - 600, PlannedEndDate: null, LastUpdated: NOW / 1000 };
  const fake = async (url) => {
    assert.match(url, /\/api\/v2\/get\/event\?key=abc/);
    return { ok: true, json: async () => [ev, { ...ev, ID: 10, County: 'Wake', Latitude: 35.78, Longitude: -78.64 }] };
  };
  const out = await fetchRoads(map, { key: 'abc', fetchImpl: fake, now: NOW });
  assert.equal(out.events.length, 1);
  assert.deepEqual([out.events[0].kind, out.events[0].on, out.events[0].full], ['crash', 'Elm St', true]);
  assert.equal(fromApiEvent({ ...ev, StartDate: NOW / 1000 + 3600 }, NOW).upcoming, true);
});

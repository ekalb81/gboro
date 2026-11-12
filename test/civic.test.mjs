import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseICS, icsTime, eventsToItems, usualMeetings, mergeCivic, upcoming, classify, easternISO } from '../scripts/civic-lib.mjs';

const ics = await readFile(new URL('./fixtures/sample-city.ics', import.meta.url), 'utf8');
const config = {
  url: 'https://www.greensboro-nc.gov/government/city-council/council-meetings',
  venue: 'Katie Dorsett Council Chamber', address: '300 W. Washington St',
  usual: [{ title: 'City Council meeting', weekday: 'tue', weeks: [1, 3], time: '17:30', hours: 3 }],
  skip: [], extra: [],
};

test('parses VEVENTs with folded lines and escapes', () => {
  const evs = parseICS(ics);
  assert.equal(evs.length, 6);
  assert.equal(evs[0].LOCATION.value, 'Katie Dorsett Council Chamber, Melvin Municipal Office Building, 300 W. Washington St');
  assert.equal(evs[3].DESCRIPTION.value, 'Carolers, carriage rides\nand a tree lighting.');
});

test('converts times to Greensboro time across DST', () => {
  assert.deepEqual(icsTime({ value: '20261117T173000', params: { TZID: 'America/New_York' } }), { iso: '2026-11-17T17:30:00-05:00', allDay: false });
  assert.deepEqual(icsTime({ value: '20260704T210000', params: {} }), { iso: '2026-07-04T21:00:00-04:00', allDay: false });
  assert.deepEqual(icsTime({ value: '20261110T190000Z', params: {} }), { iso: '2026-11-10T14:00:00-05:00', allDay: false });
  assert.deepEqual(icsTime({ value: '20261121', params: { VALUE: 'DATE' } }), { iso: '2026-11-21', allDay: true });
  assert.equal(easternISO(2026, 3, 8, 3, 0), '2026-03-08T03:00:00-04:00'); // just after spring forward
});

test('classifies council, boards and events', () => {
  assert.equal(classify('City Council Meeting'), 'council');
  assert.equal(classify('City Council Work Session'), 'council');
  assert.equal(classify('Zoning Commission'), 'board');
  assert.equal(classify('Festival of Lights'), 'event');
});

test('turns events into village items in the right places', () => {
  const items = eventsToItems(parseICS(ics), { defaultUrl: config.url });
  assert.equal(items.length, 5); // cancelled one dropped
  const council = items.find((i) => i.title === 'City Council Meeting');
  assert.equal(council.district, 'downtown');
  assert.equal(council.category, 'government');
  assert.match(council.url, /Event\/1001$/);
  assert.equal(items.find((i) => i.kind === 'board').district, 'downtown'); // council chamber
  assert.equal(items.find((i) => i.title === 'Festival of Lights').district, 'south-elm');
  assert.equal(items.find((i) => i.title.startsWith('Fireworks')).district, 'coliseum');
  assert.equal(items.find((i) => i.title.endsWith('Work Session')).url, config.url); // no URL: falls back to council page
});

test('usual schedule: first and third Tuesdays, minus skipped dates', () => {
  const from = new Date('2026-11-12T12:00:00Z');
  const days = usualMeetings(config, from, 45).map((i) => i.start);
  assert.deepEqual(days, ['2026-11-17T17:30:00-05:00', '2026-12-01T17:30:00-05:00', '2026-12-15T17:30:00-05:00']);
  const skipped = usualMeetings({ ...config, skip: ['2026-12-01'], extra: [{ date: '2026-12-08', title: 'City Council special meeting', time: '14:00' }] }, from, 45);
  assert.deepEqual(skipped.map((i) => i.start), ['2026-11-17T17:30:00-05:00', '2026-12-15T17:30:00-05:00', '2026-12-08T14:00:00-05:00']);
});

test('calendar meetings replace the usual schedule on the same day; past items drop off', () => {
  const now = new Date('2026-11-12T12:00:00Z');
  const merged = upcoming(mergeCivic(eventsToItems(parseICS(ics)), usualMeetings(config, now, 45)), now, 45);
  const nov17 = merged.filter((i) => i.start.startsWith('2026-11-17'));
  assert.equal(nov17.length, 1);
  assert.equal(nov17[0].scheduled, undefined);
  assert.ok(!merged.some((i) => i.title.endsWith('Work Session'))); // Nov 10 is past
  assert.ok(!merged.some((i) => i.title.startsWith('Fireworks')));
  assert.ok(merged.some((i) => i.title === 'Festival of Lights'));
});

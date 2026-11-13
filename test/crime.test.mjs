import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucket, countWeek, weeksEndingBy, whereBetween, weeksToSkip, buildReport, fetchCrime, FIELDS } from '../scripts/crime.mjs';

test('sorts NIBRS codes into violent, property and other', () => {
  assert.equal(bucket('13A'), 'violent');
  assert.equal(bucket('120'), 'violent');
  assert.equal(bucket('23F'), 'property');
  assert.equal(bucket('290'), 'property');
  assert.equal(bucket('13B'), 'other');
  assert.equal(bucket('35A'), 'other');
  assert.equal(bucket(''), 'other');
});

test('counts each incident once, under its most serious offense', () => {
  const { byDivision, outside, city } = countWeek([
    { inci_id: 'a', district: 'GPD1', ibr_code: '290' },
    { inci_id: 'a', district: 'GPD1', ibr_code: '13A' },
    { inci_id: 'b', district: 'GPD1', ibr_code: '23C' },
    { inci_id: 'c', district: 'GPD4', ibr_code: '35A' },
    { inci_id: 'd', district: 'SD2', ibr_code: '23C' },
    { inci_id: 'e', district: '', ibr_code: '23C' },
  ]);
  assert.deepEqual(byDivision.GPD1, { total: 2, violent: 1, property: 1, other: 0 });
  assert.equal(byDivision.GPD4.total, 1);
  assert.equal(byDivision.GPD2.total, 0);
  assert.equal(outside.total, 2);
  assert.equal(city.total, 5);
});

test('weeks run Monday to Sunday and only full weeks count', () => {
  // Wednesday Nov 11 2026 -> last full week is Nov 2 to Nov 8.
  assert.deepEqual(weeksEndingBy(new Date('2026-11-11T15:00:00Z')), {
    thisWeek: { start: '2026-11-02', end: '2026-11-08' },
    lastWeek: { start: '2026-10-26', end: '2026-11-01' },
  });
  // Sunday evening in Greensboro (Monday in UTC) is still an unfinished week.
  assert.equal(weeksEndingBy(new Date('2026-11-09T02:00:00Z')).thisWeek.end, '2026-11-01');
});

test('steps back by calendar weeks across the spring DST change', () => {
  // Just after midnight Eastern on the Monday after DST starts (Mar 8 2026).
  const anchor = new Date('2026-03-09T04:30:00Z');
  assert.equal(weeksEndingBy(anchor).thisWeek.start, '2026-03-02');
  assert.deepEqual(weeksEndingBy(anchor, 1).thisWeek, { start: '2026-02-23', end: '2026-03-01' });
  assert.deepEqual(weeksEndingBy(anchor, 1).lastWeek, { start: '2026-02-16', end: '2026-02-22' });
});

test('date filter uses Greensboro midnight in UTC, across DST', () => {
  assert.equal(whereBetween('2026-11-02', '2026-11-08'),
    "date_rept >= timestamp '2026-11-02 05:00:00' AND date_rept < timestamp '2026-11-09 05:00:00'");
  assert.match(whereBetween('2025-09-22', '2025-09-28'), /'2025-09-22 04:00:00'/);
});

test('steps back past a half-filled newest week', () => {
  assert.equal(weeksToSkip([192, 543, 544, 480, 526, 575]), 1);
  assert.equal(weeksToSkip([520, 543, 544, 480, 526, 575]), 0);
  assert.equal(weeksToSkip([10, 20, 543, 544, 480, 526]), 2);
  assert.equal(weeksToSkip([0, 0, 0, 0, 0, 0]), 0);
});

test('flags a feed that stopped updating', () => {
  const weeks = weeksEndingBy(new Date('2025-10-06T12:00:00Z'));
  const r = buildReport({ thisRows: [], lastRows: [], weeks, latestReport: new Date('2025-10-06T12:00:00Z'), now: new Date('2026-11-12T00:00:00Z') });
  assert.equal(r.stale, true);
  const fresh = buildReport({ thisRows: [], lastRows: [], weeks, latestReport: new Date('2026-11-10T12:00:00Z'), now: new Date('2026-11-12T00:00:00Z') });
  assert.equal(fresh.stale, false);
});

test('never asks the City for addresses or locations', async () => {
  const urls = [];
  const fakeFetch = async (url) => {
    urls.push(url);
    const p = new URL(url).searchParams;
    const body = p.get('outStatistics') ? { features: [{ attributes: { latest: Date.parse('2026-11-10T12:00:00Z') } }] }
      : p.get('returnCountOnly') ? { count: 500 }
      : { features: [{ attributes: { inci_id: 'x', district: 'GPD2', ibr_code: '13A', address: '1 Secret St' } }] };
    return { ok: true, json: async () => body };
  };
  const r = await fetchCrime({ now: new Date('2026-11-11T15:00:00Z'), fetchImpl: fakeFetch });
  for (const u of urls) {
    const p = new URL(u).searchParams;
    if (p.get('outFields')) assert.deepEqual(p.get('outFields').split(','), FIELDS);
    if (p.get('outFields')) assert.equal(p.get('returnGeometry'), 'false');
  }
  assert.ok(!FIELDS.some((f) => /addr|coord|premise|vic|zone|tract/i.test(f)));
  assert.ok(!JSON.stringify(r).includes('Secret'));
  assert.equal(r.divisions.find((d) => d.id === 'GPD2').thisWeek.violent, 1);
  assert.deepEqual(r.thisWeek, { start: '2026-11-02', end: '2026-11-08' });
});

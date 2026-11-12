import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthKeys, agencySeries, newestCompleteMonth, buildMonthly, fetchFbiMonthly } from '../scripts/crime-fbi.mjs';

const resp = (series) => ({ offenses: { actuals: { 'North Carolina Offenses': { '09-2026': 1 }, 'Greensboro Police Department Offenses': series, 'Greensboro Police Department Clearances': {} } } });

test('lists months up to now, oldest first', () => {
  assert.deepEqual(monthKeys(new Date('2026-11-12T02:00:00Z'), 3), ['09-2026', '10-2026', '11-2026']);
  assert.deepEqual(monthKeys(new Date('2026-01-05T00:00:00Z'), 2), ['12-2025', '01-2026']);
});

test("finds Greensboro's offense series, not the state's or clearances", () => {
  assert.deepEqual(agencySeries(resp({ '09-2026': 166 })), { '09-2026': 166 });
  assert.equal(agencySeries({}), null);
});

test('skips a half-filled newest month and empty future months', () => {
  const keys = ['05-2026', '06-2026', '07-2026', '08-2026', '09-2026', '10-2026', '11-2026'];
  assert.equal(newestCompleteMonth(keys, [800, 820, 850, 840, 838, 280, null]), 4);
  assert.equal(newestCompleteMonth(keys, [800, 820, 850, 840, 838, 790, null]), 5);
});

test('builds this month next to the month before', () => {
  const keys = ['06-2026', '07-2026', '08-2026', '09-2026', '10-2026'];
  const m = buildMonthly({
    keys,
    violent: { '06-2026': 150, '07-2026': 170, '08-2026': 160, '09-2026': 166, '10-2026': 69 },
    property: { '06-2026': 650, '07-2026': 690, '08-2026': 700, '09-2026': 672, '10-2026': 211 },
  });
  assert.deepEqual(m.thisMonth, { month: '2026-09', violent: 166, property: 672, total: 838 });
  assert.deepEqual(m.lastMonth, { month: '2026-08', violent: 160, property: 700, total: 860 });
});

test('fetches both series with the key and the GPD agency code', async () => {
  const urls = [];
  const fakeFetch = async (url) => {
    urls.push(url);
    const v = url.includes('violent') ? 160 : 700;
    const series = Object.fromEntries(monthKeys(new Date('2026-11-12T00:00:00Z'), 8).map((k, i) => [k, i < 7 ? v : null]));
    return { ok: true, json: async () => resp(series) };
  };
  const m = await fetchFbiMonthly({ apiKey: 'k', now: new Date('2026-11-12T00:00:00Z'), fetchImpl: fakeFetch, wait: async () => {} });
  assert.equal(urls.length, 2);
  assert.ok(urls.every((u) => u.includes('/NC0410200/') && u.includes('API_KEY=k') && u.includes('from=04-2026') && u.includes('to=11-2026')));
  assert.equal(m.thisMonth.month, '2026-10');
  assert.equal(m.thisMonth.total, 860);
});

test('retries an FBI outage, then gives up with the last error', async () => {
  const { getJsonWithRetry: getWithRetry } = await import('../scripts/crime-fbi.mjs');
  const waits = [];
  const wait = async (ms) => { waits.push(ms); };
  let calls = 0;
  const flaky = async () => (++calls < 3 ? { ok: false, status: 503 } : { ok: true, status: 200, json: async () => ({ fine: 1 }) });
  assert.deepEqual(await getWithRetry('u', { fetchImpl: flaky, wait }), { fine: 1 });
  assert.deepEqual(waits, [5000, 10000]);

  calls = 0;
  const down = async () => { calls++; throw Object.assign(new Error('t'), { name: 'TimeoutError' }); };
  await assert.rejects(getWithRetry('u', { fetchImpl: down, wait, timeoutMs: 1000 }), /timed out after 1s/);
  assert.equal(calls, 3);

  // Headers arrive, then the body stalls past the time limit: that's retried too.
  calls = 0;
  const stall = async () => (++calls < 2
    ? { ok: true, status: 200, json: async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); } }
    : { ok: true, status: 200, json: async () => ({ fine: 2 }) });
  assert.deepEqual(await getWithRetry('u', { fetchImpl: stall, wait }), { fine: 2 });
  assert.equal(calls, 2);

  calls = 0;
  const badKey = async () => { calls++; return { ok: false, status: 403 }; };
  await assert.rejects(getWithRetry('u', { fetchImpl: badKey, wait }), /FBI CDE 403/);
  assert.equal(calls, 1);
});

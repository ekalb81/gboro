import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseDigest, parseWhen, locate, applyRules } from '../scripts/lib.mjs';

const sample = await readFile(new URL('./fixtures/sample-digest.txt', import.meta.url), 'utf8');

test('parses ITEM lines and ignores prose', () => {
  const { items, problems } = parseDigest(sample, 'sample');
  assert.equal(items.length, 4);
  assert.equal(problems.length, 1);
  const jazz = items.find((i) => i.venue === 'A Special Blend Coffee');
  assert.equal(jazz.start, '2026-11-14T14:00:00-05:00');
  assert.equal(jazz.platform, 'Facebook');
  assert.equal(jazz.verified, false);
  assert.equal(items.find((i) => i.category === 'news').venue, null); // "n/a" becomes null
});

test('reads every date style Muse uses', () => {
  assert.deepEqual(parseWhen('Nov 21, 2026 8:30 PM EST'), { iso: '2026-11-21T20:30:00-05:00', allDay: false });
  assert.deepEqual(parseWhen('Nov 13, 2026'), { iso: '2026-11-13', allDay: true });
  assert.deepEqual(parseWhen('2026-11-18'), { iso: '2026-11-18', allDay: true });
  assert.deepEqual(parseWhen('2026-11-11 2:01 PM EST'), { iso: '2026-11-11T14:01:00-05:00', allDay: false });
  assert.equal(parseWhen('Nov 26, 2026 12:00 AM EST').iso, '2026-11-26T00:00:00-05:00');
  assert.equal(parseWhen('n/a'), null);
  assert.equal(parseWhen('sometime soon'), null);
});

test('places items in districts', () => {
  const at = (address, extra = {}) => locate({ title: '', venue: null, address, ...extra });
  assert.equal(at('117 S Elm St, Greensboro, NC'), 'south-elm');
  assert.equal(at('3900 W Market St, Greensboro, NC'), 'westside');
  assert.equal(at('404 E Market St, Greensboro, NC 27401'), 'downtown');
  assert.equal(at('1601 E Market St, Greensboro, NC'), 'ncat');
  assert.equal(at('1000 West Friendly Ave, Greensboro, NC'), 'college-hill');
  assert.equal(at('3612 Spring Garden St, Suite A, Greensboro, NC 27407'), 'westside');
  assert.equal(at('South Benbow Road and Julian Street, Greensboro, NC'), 'southeast');
  assert.equal(at('Boiling Springs, NC'), 'away');
  assert.equal(at(null, { title: 'NC A and T athletics this week' }), 'ncat');
  assert.equal(at(null, { title: 'Mystery party' }), 'board');
});

test('hides individuals and holds unverified news and personal posts', () => {
  const base = { verified: false, accountType: 'organization', category: 'event', account: 'Org' };
  const { show, held } = applyRules([
    { ...base, id: 'a' },
    { ...base, id: 'b', accountType: 'individual', account: 'Jane Doe' },
    { ...base, id: 'c', category: 'news' },
    { ...base, id: 'd', category: 'news', verified: true },
    { ...base, id: 'e', category: 'community', accountType: 'individual', account: 'Jane Doe' },
  ]);
  assert.deepEqual(show.map((i) => i.id), ['a', 'b', 'd']);
  assert.equal(show.find((i) => i.id === 'b').account, null);
  assert.deepEqual(held.map((i) => i.heldBecause), ['unverified news', 'personal post']);
});

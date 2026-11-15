import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activity, clockOf, isHoliday, outside, parseClock, weatherEffect, driveLevel } from '../public/activity.js';

const at = (s) => parseClock(s);

test('a day of hourly shares adds up to about a day', () => {
  for (const [d, lo, hi] of [['tue', 1.0, 1.1], ['sat', 0.75, 0.85], ['sun', 0.58, 0.66]]) {
    let sum = 0;
    for (let hr = 0; hr < 24; hr++) sum += activity(at(`${d}-${hr}:30`)).hourShare;
    assert.ok(sum > lo && sum < hi, `${d}: ${sum}`);
  }
});

test('rush hour is far busier than the small hours, and weekends are quieter downtown', () => {
  const rush = activity(at('tue-17:15')), small = activity(at('tue-3:00')), sun = activity(at('sun-17:15'));
  assert.ok(rush.hourShare > 15 * small.hourShare);
  assert.ok(sun.hourShare < rush.hourShare * 0.7);
  assert.ok(driveLevel(rush.hourShare) > 0.9 && driveLevel(small.hourShare) < 0.08);
});

test('office lots fill on weekdays, church lots on Sunday morning, home lots overnight', () => {
  assert.ok(activity(at('wed-10:30')).park.office > 0.7);
  assert.ok(activity(at('sat-10:30')).park.office < 0.2);
  assert.ok(activity(at('holiday-10:30')).park.office < 0.15);
  assert.ok(activity(at('sun-10:30')).park.church > 0.8);
  assert.ok(activity(at('tue-10:30')).park.church < 0.2);
  assert.ok(activity(at('tue-3:00')).park.home > 0.8);
  assert.ok(activity(at('sat-20:00')).park.retail > activity(at('tue-15:00')).park.retail);
});

test('rain and cold keep people off the sidewalks more than off the road', () => {
  const dry = activity(at('fri-19:00'), { wx: 'clear', tempF: 65 }), wet = activity(at('fri-19:00'), { wx: 'rain', intensity: 'heavy', tempF: 50 });
  assert.ok(wet.walk < dry.walk * 0.25);
  assert.ok(wet.hourShare > dry.hourShare * 0.8 && wet.hourShare < dry.hourShare);
  assert.deepEqual(weatherEffect({}), { drive: 1, walk: 1 });
  assert.ok(weatherEffect({ wx: 'snow' }).drive < 0.8);
});

test('events add a little traffic and walking', () => {
  assert.ok(activity(at('thu-19:30'), {}, 2).hourShare > activity(at('thu-19:30'), {}, 0).hourShare);
});

test('people outside places follow each kind of place', () => {
  const sum = (kind, t, wx) => { let n = 0; for (let i = 0; i < 40; i++) n += outside(kind, at(t), wx, i); return n / 40; };
  assert.ok(sum('bar', 'sat-22:30') > 3);
  assert.ok(sum('bar', 'sun-0:30') > 3, 'Saturday night runs past midnight');
  assert.ok(sum('bar', 'tue-0:30') < 1);
  assert.ok(sum('cafe', 'tue-8:15') > sum('cafe', 'tue-16:30'));
  assert.ok(sum('restaurant', 'wed-12:15') > 2 && sum('restaurant', 'wed-15:30') < 1.2);
  assert.ok(sum('bar', 'sat-22:30', { wx: 'storm' }) < 1);
  assert.equal(outside('restaurant', at('wed-4:00')), 0);
});

test('holidays and the clock', () => {
  assert.ok(isHoliday(2026, 11, 26) && isHoliday(2026, 11, 27) && isHoliday(2026, 7, 4) && isHoliday(2026, 9, 7) && isHoliday(2026, 5, 25) && isHoliday(2027, 1, 18));
  assert.ok(!isHoliday(2026, 11, 25) && !isHoliday(2026, 11, 16));
  assert.deepEqual(clockOf(new Date('2026-11-15T17:53:00Z')), { day: 6, min: 12 * 60 + 53, holiday: false });
  assert.deepEqual(parseClock('Sat-21:30'), { day: 5, min: 1290, holiday: false });
  assert.equal(parseClock('someday'), null);
});

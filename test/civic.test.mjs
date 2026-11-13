import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseICS, icsTime, eventsToItems, expandRRule, parseYouTube, applyVideos, councilSignals, applySignals, checkRecordings, dateInText, timeInText, usualMeetings, mergeCivic, upcoming, classify, easternISO } from '../scripts/civic-lib.mjs';

const ics = await readFile(new URL('./fixtures/sample-city.ics', import.meta.url), 'utf8');
const config = {
  url: 'https://www.greensboro-nc.gov/government/city-council/council-meetings',
  venue: 'Katie Dorsett Council Chamber', address: '300 W. Washington St',
  usual: [{ title: 'City Council meeting', weekday: 'tue', weeks: [1, 3], time: '17:30', hours: 3 }],
  skip: [], extra: [],
};

test('parses VEVENTs with folded lines and escapes', () => {
  const evs = parseICS(ics);
  assert.equal(evs.length, 9);
  assert.equal(evs[6].EXDATES.length, 1);
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
  const items = eventsToItems(parseICS(ics), { defaultUrl: config.url, until: new Date('2026-12-31T00:00:00Z') }).filter((i) => !i.cancelled);
  assert.equal(items.filter((i) => !i.title.startsWith('Thursday Market')).length, 5);
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

test('expands recurring events, minus EXDATEs and overridden occurrences', () => {
  const items = eventsToItems(parseICS(ics), { until: new Date('2026-12-31T00:00:00Z') }).filter((i) => i.title.startsWith('Thursday Market'));
  assert.deepEqual(items.map((i) => i.start), [
    '2026-11-05T09:00:00-05:00', '2026-11-12T09:00:00-05:00', '2026-11-19T09:00:00-05:00',
    '2026-12-10T09:00:00-05:00', '2026-12-17T09:00:00-05:00', '2026-12-24T09:00:00-05:00',
    '2026-12-03T10:00:00-05:00', // the override entry
  ]);
  assert.equal(items[0].end, '2026-11-05T12:00:00-05:00');
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
  assert.ok(items.every((i) => i.district === 'downtown'));
  const now = new Date('2026-11-12T12:00:00Z');
  assert.ok(upcoming(mergeCivic(items, []), now, 45).some((i) => i.start === '2026-11-12T09:00:00-05:00'));
});

test('RRULE shapes: monthly by nth weekday, until, interval, DST', () => {
  const start = { iso: '2026-10-06T17:30:00-04:00', allDay: false };
  assert.deepEqual(expandRRule('FREQ=MONTHLY;BYDAY=1TU,3TU;UNTIL=20261201T120000Z', start, new Date('2027-01-01')),
    ['2026-10-06T17:30:00-04:00', '2026-10-20T17:30:00-04:00', '2026-11-03T17:30:00-05:00', '2026-11-17T17:30:00-05:00']);
  assert.deepEqual(expandRRule('FREQ=WEEKLY;INTERVAL=2', start, new Date('2026-11-04')),
    ['2026-10-06T17:30:00-04:00', '2026-10-20T17:30:00-04:00', '2026-11-03T17:30:00-05:00']);
  assert.deepEqual(expandRRule('FREQ=MONTHLY;BYDAY=-1FR;COUNT=2', start, new Date('2027-01-01')),
    ['2026-10-30T17:30:00-04:00', '2026-11-27T17:30:00-05:00']);
  assert.deepEqual(expandRRule('FREQ=HOURLY', start, new Date('2027-01-01')), [start.iso]); // unsupported: first only
});

test('a cancelled council meeting keeps the usual schedule from filling its day', () => {
  const now = new Date('2026-11-12T12:00:00Z');
  const merged = mergeCivic(eventsToItems(parseICS(ics)), usualMeetings(config, now, 45));
  assert.ok(!merged.some((i) => i.start.startsWith('2026-12-01')));
  assert.ok(!merged.some((i) => i.cancelled));
});

test('all-day events end the day before DTEND', () => {
  const fest = [{ start: '2026-11-21', end: '2026-11-22', allDay: true }];
  assert.equal(upcoming(fest, new Date('2026-11-21T17:00:00Z')).length, 1);
  assert.equal(upcoming(fest, new Date('2026-11-22T17:00:00Z')).length, 0);
  assert.equal(upcoming([{ start: '2026-11-21', end: null, allDay: true }], new Date('2026-11-21T23:00:00Z')).length, 1);
});

const published = {
  ...config,
  schedules: { 2026: {
    source: 'https://example.gov/schedule.pdf',
    council: ['2026-11-10', '2026-11-17', '2026-12-01', '2026-12-15'], councilTime: '17:30',
    subcommittees: ['2026-11-24'], subcommitteeTime: '10:30', subcommitteeHours: 6, subcommitteeTitle: 'City Council subcommittees', subcommitteeVenue: 'Plaza Level Conference Room',
  } },
};

test('published schedule beats the usual rule (Nov 10 moved for Election Day)', () => {
  const items = usualMeetings(published, new Date('2026-11-02T12:00:00Z'), 30);
  const council = items.filter((i) => i.kind === 'council').map((i) => i.start);
  assert.deepEqual(council, ['2026-11-10T17:30:00-05:00', '2026-11-17T17:30:00-05:00', '2026-12-01T17:30:00-05:00']);
  assert.ok(items.every((i) => i.scheduled === 'published'));
  const sub = items.find((i) => i.kind === 'board');
  assert.equal(sub.start, '2026-11-24T10:30:00-05:00');
  assert.equal(sub.end, '2026-11-24T16:30:00-05:00');
  assert.equal(sub.venue, 'Plaza Level Conference Room');
  assert.equal(sub.source, 'https://example.gov/schedule.pdf');
});

test('years without a published schedule fall back to the usual rule; back days reach into the past', () => {
  const jan = usualMeetings(published, new Date('2026-12-28T12:00:00Z'), 25).map((i) => i.start);
  assert.deepEqual(jan, ['2027-01-05T17:30:00-05:00', '2027-01-19T17:30:00-05:00']);
  const back = usualMeetings(published, new Date('2026-11-12T12:00:00Z'), 1, 7).map((i) => i.start);
  assert.deepEqual(back, ['2026-11-10T17:30:00-05:00']);
  assert.equal(usualMeetings({ ...published, skip: ['2026-11-17'] }, new Date('2026-11-12T12:00:00Z'), 10).length, 0);
});

test('reads the City YouTube feed', async () => {
  const videos = parseYouTube(await readFile(new URL('./fixtures/sample-youtube.xml', import.meta.url), 'utf8'));
  assert.equal(videos.length, 4);
  assert.equal(videos[2].title, 'GTN\'s "This is Greensboro" with a guest');
});

test('recordings attach to meetings, and the newest On the Town video becomes a week-long item', async () => {
  const videos = parseYouTube(await readFile(new URL('./fixtures/sample-youtube.xml', import.meta.url), 'utf8'));
  const now = new Date('2026-11-12T17:00:00Z');
  const items = applyVideos(usualMeetings(published, now, 30, 7), videos);
  const nov10 = items.find((i) => i.start.startsWith('2026-11-10'));
  assert.equal(nov10.recording, 'https://www.youtube.com/watch?v=AAA');
  assert.equal(nov10.url, nov10.recording);
  const town = items.filter((i) => i.title.startsWith('On the Town'));
  assert.equal(town.length, 1);
  assert.deepEqual([town[0].start, town[0].end, town[0].allDay, town[0].district], ['2026-11-09', '2026-11-16', true, 'board']);
  const shown = upcoming(items, now, 45, 7);
  assert.ok(shown.includes(nov10)); // past, but has a recording
  assert.ok(!upcoming(items, new Date('2026-11-20T17:00:00Z'), 45, 7).includes(nov10)); // more than a week ago
});

const news = (title, extra = {}) => ({ title, url: `https://news.example/${encodeURIComponent(title)}`, accountType: 'news', verified: true, account: 'Rhino Times', posted: '2026-11-13T15:00:00Z', start: null, allDay: false, ...extra });

test('reads dates and times out of headlines', () => {
  assert.equal(dateInText('Council cancels Dec. 1 meeting', new Date('2026-11-13T00:00:00Z')), '2026-12-01');
  assert.equal(dateInText('Council will meet January 5th', new Date('2026-12-20T00:00:00Z')), '2027-01-05');
  assert.equal(dateInText('No date here'), null);
  assert.equal(timeInText('special meeting at 3 p.m. Friday'), '15:00');
  assert.equal(timeInText('work session 10:30 AM'), '10:30');
});

test('finds council changes only in trusted items', () => {
  const { signals, undated } = councilSignals([
    news('Greensboro City Council cancels Dec. 1 meeting'),
    news('City Council to hold special meeting Nov. 20 at 4 p.m.'),
    news('City Council postpones its next meeting'),
    news('City Council cancels Dec. 15 meeting', { accountType: 'individual', verified: false }),
    news('Planning board cancels Nov. 16 meeting'),
    { ...news('City Council Work Session'), accountType: 'government', start: '2026-11-19T15:00:00-05:00' },
  ]);
  assert.deepEqual(signals.map((x) => [x.date, x.time, x.type]), [
    ['2026-12-01', null, 'cancel'], ['2026-11-20', '16:00', 'meeting'], ['2026-11-19', '15:00', 'meeting'],
  ]);
  assert.equal(undated.length, 1);
});

test('cancellations remove the meeting; reported meetings confirm, move or add', () => {
  const now = new Date('2026-11-13T15:00:00Z');
  const base = usualMeetings(published, now, 40);
  const notices = [];
  const out = applySignals(base, [
    { date: '2026-12-01', time: null, type: 'cancel', title: 'cancels Dec. 1', url: 'https://n/1' },
    { date: '2026-11-17', time: '16:00', type: 'meeting', title: 'meets Nov. 17 at 4 p.m.', url: 'https://n/2' },
    { date: '2026-11-20', time: '16:00', type: 'meeting', title: 'special meeting Nov. 20 at 4 p.m.', url: 'https://n/3' },
  ], published, notices);
  assert.ok(!out.some((i) => i.kind === 'council' && i.start.startsWith('2026-12-01')));
  const note = out.find((i) => i.kind === 'notice');
  assert.equal(note.start, '2026-12-01');
  const nov17 = out.find((i) => i.kind === 'council' && i.start.startsWith('2026-11-17'));
  assert.equal(nov17.start, '2026-11-17T16:00:00-05:00');
  assert.equal(nov17.end, '2026-11-17T19:00:00-05:00');
  assert.equal(nov17.confirmedBy, 'https://n/2');
  const special = out.find((i) => i.start.startsWith('2026-11-20'));
  assert.equal(special.title, 'City Council special meeting');
  assert.equal(special.scheduled, 'reported');
  assert.equal(notices.length, 3);
});

test('flags meetings with no recording, and recordings with no meeting', async () => {
  const videos = parseYouTube(await readFile(new URL('./fixtures/sample-youtube.xml', import.meta.url), 'utf8'));
  const sched = { ...published, schedules: { 2026: { ...published.schedules[2026], council: ['2026-11-03', '2026-11-17'] } } };
  const notices = [];
  const items = applyVideos(usualMeetings(sched, new Date('2026-11-12T17:00:00Z'), 10, 10), videos, notices);
  assert.equal(notices.length, 1); // Nov 10 recording, nothing scheduled that day
  const added = items.find((i) => i.recording);
  assert.deepEqual([added.start, added.scheduled, added.kind], ['2026-11-10', 'reported', 'council']);
  const warn = checkRecordings(items, new Date('2026-11-12T17:00:00Z'));
  assert.equal(warn.length, 1);
  assert.match(warn[0], /2026-11-03/);
});

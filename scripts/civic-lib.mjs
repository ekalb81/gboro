// City council meetings and official city events: iCalendar parsing, the usual
// council schedule, and conversion to village items. No dependencies.

import { createHash } from 'node:crypto';
import { locate } from './lib.mjs';

const TZ = 'America/New_York';
const pad = (n) => String(n).padStart(2, '0');

// ---------- iCalendar (RFC 5545) ----------

/** Unfold, split and unescape an .ics file into VEVENT property maps. */
export function parseICS(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const m = line.match(/^([A-Za-z-]+)((?:;[^:;]+=(?:"[^"]*"|[^:;]*))*):(.*)$/);
    if (!m) continue;
    const name = m[1].toUpperCase();
    const params = Object.fromEntries([...m[2].matchAll(/;([^=;]+)=("[^"]*"|[^:;]*)/g)].map(([, k, v]) => [k.toUpperCase(), v.replace(/^"|"$/g, '')]));
    const value = /^(DTSTART|DTEND|RRULE|URL)$/.test(name) ? m[3] : unescapeText(m[3]);
    if (name === 'EXDATE') (cur.EXDATES ||= []).push(...value.split(',').map((v) => ({ value: v, params })));
    else if (!(name in cur)) cur[name] = { value, params }; // first one wins
  }
  return events;
}

const unescapeText = (s) => s.replace(/\\([nN,;\\])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c)).trim();

/** Offset in minutes of Eastern time from UTC at a given instant (e.g. -300 or -240). */
export function easternOffset(utcMs) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((asUtc - utcMs) / 60000);
}

/** ISO string with Eastern offset for a wall-clock time in Greensboro. */
export function easternISO(y, mo, d, h = 0, mi = 0) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let off = easternOffset(guess - (-300) * 60000); // try EST first
  off = easternOffset(guess - off * 60000);
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:00${sign}${pad(a / 60 | 0)}:${pad(a % 60)}`;
}

/** Turn a DTSTART/DTEND property into { iso, allDay } in Eastern time. */
export function icsTime(prop) {
  if (!prop) return null;
  const m = prop.value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  if (m[4] == null || prop.params.VALUE === 'DATE') return { iso: `${m[1]}-${m[2]}-${m[3]}`, allDay: true };
  if (m[7]) { // UTC: convert to Eastern wall clock
    const ms = Date.UTC(y, mo - 1, d, +m[4], +m[5]);
    const off = easternOffset(ms);
    const e = new Date(ms + off * 60000);
    return { iso: easternISO(e.getUTCFullYear(), e.getUTCMonth() + 1, e.getUTCDate(), e.getUTCHours(), e.getUTCMinutes()), allDay: false };
  }
  // Floating or TZID: Greensboro feeds are Eastern; treat any TZID as Eastern wall time.
  return { iso: easternISO(y, mo, d, +m[4], +m[5]), allDay: false };
}

// ---------- classification ----------

/** What kind of civic thing is this? council | board | event */
export function classify(title) {
  if (/city council|council (meeting|work session|briefing)|work session|council retreat/i.test(title)) return 'council';
  if (/\b(board|commission|committee|authority|hearing|advisory)\b/i.test(title)) return 'board';
  return 'event';
}

const id = (s) => createHash('sha1').update(s).digest('hex').slice(0, 10);

/**
 * Convert parsed VEVENTs to village items. Recurring events (RRULE) are expanded up to `until`,
 * minus EXDATEs and occurrences that a RECURRENCE-ID entry overrides. Cancelled entries come back
 * with `cancelled: true` so mergeCivic can keep the usual schedule from filling their day; they are never shown.
 */
export function eventsToItems(events, { source = 'City of Greensboro calendar', defaultUrl, until = new Date(Date.now() + 60 * 864e5) } = {}) {
  const out = [];
  const overridden = new Set(events.filter((e) => e.UID && e['RECURRENCE-ID']).map((e) => `${e.UID.value}|${icsTime(e['RECURRENCE-ID'])?.iso}`));
  for (const ev of events) {
    const title = ev.SUMMARY?.value;
    const start = icsTime(ev.DTSTART);
    if (!title || !start) continue;
    const cancelled = /^CANCELLED$/i.test(ev.STATUS?.value || '') || /^cancel+ed\b/i.test(title);
    const end = icsTime(ev.DTEND);
    const kind = classify(title);
    const location = ev.LOCATION?.value || null;
    const [venue, ...rest] = (location || '').split(/\n|,(?=\s*\d)/);
    const url = /^https:\/\//.test(ev.URL?.value || '') ? ev.URL.value : defaultUrl || null;
    const base = {
      category: kind === 'event' ? 'event' : 'government',
      kind,
      title,
      venue: venue?.trim() || null,
      address: rest.join(',').trim() || (location && /\d/.test(location) ? location : null),
      allDay: start.allDay,
      url,
      platform: 'City of Greensboro',
      account: source,
      accountType: 'government',
      verified: true,
    };
    base.district = isCityHall(base) ? 'downtown' : locate({ ...base, address: base.address || location });
    const uid = ev.UID?.value || `${title}|${start.iso}`;
    const recurring = ev.RRULE && !ev['RECURRENCE-ID'];
    const exdates = new Set((ev.EXDATES || []).map((x) => icsTime(x)?.iso));
    const starts = recurring ? expandRRule(ev.RRULE.value, start, until) : [start.iso];
    const durMs = end && start ? isoMs(end.iso) - isoMs(start.iso) : null;
    for (const s of starts) {
      if (recurring && (exdates.has(s) || overridden.has(`${ev.UID?.value}|${s}`))) continue;
      const e = durMs == null ? null : start.allDay ? addDays(s, Math.round(durMs / 864e5)) : shiftISO(s, durMs);
      const item = { id: id(recurring ? `${uid}|${s}` : uid), ...base, start: s, end: e };
      if (cancelled) item.cancelled = true;
      out.push(item);
    }
  }
  return out;
}

// ---------- recurrence (the common RRULE shapes: DAILY, WEEKLY, MONTHLY, YEARLY) ----------

const isoMs = (iso) => (iso.length === 10 ? Date.parse(iso + 'T00:00:00Z') : Date.parse(iso));
const ymd = (iso) => iso.slice(0, 10).split('-').map(Number);
function addDays(isoDate, n) {
  const d = new Date(Date.UTC(...ymdArgs(isoDate)) + n * 864e5);
  return d.toISOString().slice(0, 10);
}
const ymdArgs = (iso) => { const [y, m, d] = ymd(iso); return [y, m - 1, d]; };
/** Add milliseconds to an Eastern ISO time, keeping wall-clock correctness across DST. */
function shiftISO(iso, ms) {
  const t = Date.parse(iso) + ms;
  const e = new Date(t + easternOffset(t) * 60000);
  return easternISO(e.getUTCFullYear(), e.getUTCMonth() + 1, e.getUTCDate(), e.getUTCHours(), e.getUTCMinutes());
}
const BYDAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** Start times (same wall-clock time as DTSTART) of each occurrence up to `until`. */
export function expandRRule(rule, start, until, maxCount = 500) {
  const r = Object.fromEntries(rule.split(';').map((kv) => kv.split('=')).map(([k, v]) => [k.toUpperCase(), v]));
  const freq = r.FREQ;
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq) || r.BYSETPOS || r.BYHOUR || r.BYWEEKNO || r.BYYEARDAY) return [start.iso];
  const interval = +(r.INTERVAL || 1);
  const count = r.COUNT ? +r.COUNT : Infinity;
  const untilMs = Math.min(until.getTime(), r.UNTIL ? isoMs(icsTime({ value: r.UNTIL, params: {} }).iso) + (/T/.test(r.UNTIL) ? 0 : 864e5 - 1) : Infinity);
  const [y0, m0, d0] = ymd(start.iso);
  const [hh, mi] = start.allDay ? [0, 0] : start.iso.slice(11, 16).split(':').map(Number);
  const day0 = Date.UTC(y0, m0 - 1, d0);
  const wd0 = new Date(day0).getUTCDay();
  const byday = (r.BYDAY || '').split(',').filter(Boolean).map((x) => { const m = x.match(/^([+-]?\d+)?([A-Z]{2})$/); return m && { n: m[1] ? +m[1] : null, wd: BYDAY[m[2]] }; }).filter(Boolean);
  const bymonthday = (r.BYMONTHDAY || '').split(',').filter(Boolean).map(Number);
  const bymonth = (r.BYMONTH || '').split(',').filter(Boolean).map(Number);
  const out = [];
  let n = 0;
  for (let i = 0; i < 3 * 366 && n < count; i++) {
    const dayMs = day0 + i * 864e5;
    const d = new Date(dayMs);
    const [y, m, dd, wd] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCDay()];
    const iso = start.allDay ? `${y}-${pad(m)}-${pad(dd)}` : easternISO(y, m, dd, hh, mi);
    if (isoMs(iso) > untilMs) break;
    let hit = false;
    if (freq !== 'YEARLY' && bymonth.length && !bymonth.includes(m)) hit = false;
    else if (freq === 'DAILY') hit = i % interval === 0 && (!byday.length || byday.some((b) => b.wd === wd));
    else if (freq === 'WEEKLY') {
      const week = Math.floor((i + ((wd0 + 6) % 7)) / 7); // weeks start Monday
      hit = week % interval === 0 && (byday.length ? byday.some((b) => b.wd === wd) : wd === wd0);
    } else {
      const stepOk = freq === 'MONTHLY'
        ? ((y - y0) * 12 + (m - m0)) % interval === 0
        : (y - y0) % interval === 0 && (bymonth.length ? bymonth.includes(m) : m === m0);
      if (stepOk) {
        const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
        if (byday.length) hit = byday.some((b) => b.wd === wd && (b.n == null || (b.n > 0 ? Math.ceil(dd / 7) === b.n : Math.ceil((dim - dd + 1) / 7) === -b.n)));
        else if (bymonthday.length) hit = bymonthday.some((x) => (x > 0 ? x : dim + x + 1) === dd);
        else hit = dd === d0;
      }
    }
    if (hit) { out.push(iso); n++; }
  }
  return out.length ? out : [start.iso];
}

// Melvin Municipal Office Building, where council meets.
const isCityHall = (it) => /council chamber|melvin municipal|300 w\.? washington|city hall/i.test(`${it.venue || ''} ${it.address || ''}`) || (it.kind === 'council' && !it.venue);

// ---------- council schedule ----------

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Council meetings from `back` days ago to `days` days ahead.
 * For a year listed in config.schedules, the City's published dates are used (scheduled: "published").
 * For any other year, config.usual fills in (e.g. 1st and 3rd Tuesday at 17:30; scheduled: "usual").
 * Dates in config.skip are left out; config.extra adds one-off meetings.
 */
export function usualMeetings(config, from = new Date(), days = 45, back = 0) {
  const out = [];
  const skip = new Set(config.skip || []);
  const today = new Date(from.toLocaleDateString('en-CA', { timeZone: TZ }) + 'T12:00:00Z');
  const first = new Date(today.getTime() - back * 864e5).toISOString().slice(0, 10);
  const pub = (sched, rule, date) => usualItem({ ...rule, scheduled: 'published', source: sched.source }, ...date.split('-').map(Number), config);
  for (let i = -back; i < days; i++) {
    const day = new Date(today.getTime() + i * 864e5);
    const [y, mo, d] = [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()];
    const date = `${y}-${pad(mo)}-${pad(d)}`;
    if (skip.has(date)) continue;
    const sched = config.schedules?.[y];
    if (sched) {
      if ((sched.council || []).includes(date)) out.push(pub(sched, { title: 'City Council meeting', time: sched.councilTime || '17:30', hours: 3 }, date));
      for (const r of (sched.retreat || []).filter((r) => r.date === date)) out.push(pub(sched, r, date));
      if ((sched.subcommittees || []).includes(date)) {
        out.push(pub({ source: sched.subcommitteeSource || sched.source }, { title: sched.subcommitteeTitle || 'City Council subcommittees', time: sched.subcommitteeTime || '10:30', hours: sched.subcommitteeHours || 6, venue: sched.subcommitteeVenue }, date));
      }
      continue;
    }
    const nth = Math.ceil(d / 7);
    for (const rule of config.usual || []) {
      if (WEEKDAYS[day.getUTCDay()] === rule.weekday && rule.weeks.includes(nth)) out.push(usualItem(rule, y, mo, d, config));
    }
  }
  for (const x of config.extra || []) {
    if (x.date >= first && !skip.has(x.date)) out.push(usualItem({ ...x, scheduled: 'published' }, ...x.date.split('-').map(Number), config));
  }
  return out;
}

function usualItem(rule, y, mo, d, config) {
  const [h, mi] = rule.time.split(':').map(Number);
  const start = easternISO(y, mo, d, h, mi);
  const end = shiftISO(start, (rule.hours ?? 3) * 3600e3);
  const scheduled = rule.scheduled || 'usual';
  return {
    id: id(`usual|${rule.title}|${start}`),
    category: 'government',
    kind: /subcommittee/i.test(rule.title) ? 'board' : classify(rule.title),
    title: rule.title,
    venue: rule.venue || config.venue,
    address: rule.address || config.address,
    start, end, allDay: false,
    url: config.url,
    ...(rule.source ? { source: rule.source } : {}),
    platform: 'City of Greensboro',
    account: scheduled === 'published' ? 'City Council meeting schedule' : 'Usual council schedule',
    accountType: 'government',
    verified: true,
    scheduled,
    district: 'downtown',
  };
}

// ---------- City YouTube channel ----------

/** Entries from a YouTube channel feed (Atom): { title, url, published }. */
export function parseYouTube(xml) {
  const dec = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    title: dec(e.match(/<title>([^<]*)<\/title>/)?.[1] || '').trim(),
    url: e.match(/<link rel="alternate" href="([^"]+)"/)?.[1] || null,
    published: e.match(/<published>([^<]+)<\/published>/)?.[1] || null,
  })).filter((v) => v.title && /^https:\/\/www\.youtube\.com\//.test(v.url || ''));
}

/**
 * Attach recordings ("Greensboro City Council Meeting 11/10/2026") to council meetings on that date,
 * and turn the newest "On the Town - Week of November 9, 2026" video into a week-long town-board item.
 */
export function applyVideos(items, videos, notices = []) {
  const out = items.map((it) => ({ ...it }));
  for (const v of videos) {
    const m = v.title.match(/city council (meeting|work session|special meeting)\D*(\d{1,2})[\/_.-](\d{1,2})[\/_.-](\d{2,4})/i);
    if (!m) continue;
    const y = m[4].length === 2 ? 2000 + +m[4] : +m[4];
    const date = `${y}-${pad(+m[2])}-${pad(+m[3])}`;
    const meeting = out.find((it) => it.kind === 'council' && it.start.slice(0, 10) === date && !it.recording);
    if (meeting) { meeting.recording = v.url; meeting.url = v.url; continue; }
    if (out.some((it) => it.recording === v.url)) continue;
    // A meeting the schedule didn't have (special meeting, moved date): add it so it shows, and say so.
    out.push({
      id: id(`video|${v.url}`), category: 'government', kind: 'council',
      title: /work session/i.test(m[1]) ? 'City Council work session' : 'City Council meeting',
      venue: null, address: null, start: date, end: addDays(date, 1), allDay: true,
      url: v.url, recording: v.url, platform: 'City of Greensboro', account: 'City of Greensboro YouTube',
      accountType: 'government', verified: true, scheduled: 'reported', district: 'downtown',
    });
    notices.push(`A council recording for ${date} ("${v.title}") matches no scheduled meeting. Added it; check whether the schedule changed.`);
  }
  const town = videos.map((v) => ({ v, m: v.title.match(/^On the Town\s*[-–]\s*Week of ([A-Za-z]+) (\d{1,2}), (\d{4})/i) })).find((x) => x.m);
  if (town) {
    const mo = new Date(`${town.m[1]} 1, 2000`).getMonth() + 1;
    if (mo) {
      const startDate = `${town.m[3]}-${pad(mo)}-${pad(+town.m[2])}`;
      out.push({
        id: id(`onthetown|${town.v.url}`),
        category: 'event', kind: 'event',
        title: "On the Town: this week's events around Greensboro",
        venue: 'Greensboro Television Network', address: null,
        start: startDate, end: addDays(startDate, 7), allDay: true,
        url: town.v.url, platform: 'City of Greensboro', account: 'GTN On the Town', accountType: 'government',
        verified: true, district: 'board',
      });
    }
  }
  return out;
}

/**
 * Feed items win; a usual-schedule meeting is dropped when the feed has a council meeting that day,
 * including a cancelled one. Cancelled items are left out of the result.
 */
export function mergeCivic(feedItems, usual) {
  const day = (it) => it.start.slice(0, 10);
  const councilDays = new Set(feedItems.filter((it) => it.kind === 'council').map(day));
  const byId = new Map();
  for (const it of [...feedItems.filter((it) => !it.cancelled), ...usual.filter((u) => !councilDays.has(day(u)))]) byId.set(it.id, it);
  return [...byId.values()].sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Keep things that haven't ended and start within `days` days. Meetings that ended in the last
 * `recentDays` days stay when they have a recording, so the page can link to it.
 */
export function upcoming(items, now = new Date(), days = 45, recentDays = 0) {
  const nowMs = now.getTime();
  const todayET = now.toLocaleDateString('en-CA', { timeZone: TZ });
  const horizon = nowMs + days * 864e5;
  return items.filter((it) => {
    const startMs = it.allDay ? Date.parse(it.start + 'T00:00:00Z') : Date.parse(it.start);
    if (startMs > horizon) return false;
    if (it.allDay) return it.end ? it.end > todayET : it.start >= todayET; // all-day DTEND is exclusive
    const endMs = it.end ? Date.parse(it.end) : startMs + 3 * 3600e3;
    return endMs >= nowMs || (it.recording && endMs >= nowMs - recentDays * 864e5);
  });
}

// ---------- schedule changes reported by news and the City's own posts ----------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const COUNCIL = /\b(city council|council (meeting|work session|retreat|special meeting))\b/i;
const CANCEL = /\b(cancel(?:led|ed|s)?|postpone[sd]?|called off|will not meet|won't meet|no meeting)\b/i;
const RESCHEDULE = /\b(reschedul\w*|moved to|new date|date change)\b/i;

/** "Nov. 17", "November 17th", "Tuesday, Dec 1" -> YYYY-MM-DD, picking the year nearest `ref`. */
export function dateInText(text, ref = new Date()) {
  const m = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i);
  if (!m) return null;
  const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
  const y0 = ref.getUTCFullYear();
  const best = [y0 - 1, y0, y0 + 1].map((y) => `${y}-${pad(mo)}-${pad(+m[2])}`)
    .sort((a, b) => Math.abs(Date.parse(a) - ref.getTime()) - Math.abs(Date.parse(b) - ref.getTime()))[0];
  return best;
}

/** "at 3 p.m.", "3:00 PM" -> "15:00", or null. */
export function timeInText(text) {
  const m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\b\.?/i);
  if (!m) return null;
  const h = (+m[1] % 12) + (/p/i.test(m[3]) ? 12 : 0);
  return `${pad(h)}:${m[2] || '00'}`;
}

/**
 * Council-meeting changes in digest and news items (Muse ITEM lines, news RSS): cancellations, new or
 * moved meetings, special meetings and work sessions. Only the City's own accounts and verified news count.
 * Returns { signals: [{ date, time, type: 'cancel'|'meeting', title, url, account }], undated: [...] }.
 */
export function councilSignals(items, ref = new Date()) {
  const signals = [];
  const undated = [];
  for (const it of items) {
    if (!COUNCIL.test(it.title || '')) continue;
    const trusted = it.accountType === 'government' || (it.verified && ['news', 'organization'].includes(it.accountType));
    if (!trusted) continue;
    const posted = it.posted ? new Date(it.posted) : ref;
    const textDate = dateInText(it.title, posted);
    const date = it.start ? it.start.slice(0, 10) : textDate;
    const time = it.start && !it.allDay ? it.start.slice(11, 16) : timeInText(it.title);
    const type = CANCEL.test(it.title) && !RESCHEDULE.test(it.title) ? 'cancel' : 'meeting';
    const s = { date, time, type, title: it.title, url: it.url, account: it.account };
    if (!date) { if (CANCEL.test(it.title) || RESCHEDULE.test(it.title)) undated.push(s); continue; }
    signals.push(s);
  }
  return { signals, undated };
}

/**
 * Apply signals to scheduled meetings. A cancellation removes that day's council meeting and shows a
 * "cancelled" notice instead (City Hall stays dark). A reported meeting on a day with one scheduled
 * confirms it (and fixes its time if the report gives one); on any other day it adds the meeting.
 */
export function applySignals(items, signals, config = {}, notices = []) {
  let out = items.map((it) => ({ ...it }));
  for (const sig of signals.filter((x) => x.type === 'cancel')) {
    const hit = out.filter((it) => it.kind === 'council' && it.start.slice(0, 10) === sig.date);
    out = out.filter((it) => !hit.includes(it));
    out.push({
      id: id(`cancel|${sig.date}`), category: 'government', kind: 'notice',
      title: `City Council meeting on ${sig.date.slice(5).replace('-', '/')} cancelled`,
      venue: config.venue || null, address: config.address || null,
      start: sig.date, end: addDays(sig.date, 1), allDay: true,
      url: sig.url, platform: 'City of Greensboro', account: sig.account || 'News report', accountType: 'government',
      verified: true, scheduled: 'reported', district: 'downtown',
    });
    notices.push(`Cancellation reported for ${sig.date}: "${sig.title}" (${sig.url}).`);
  }
  const cancelled = new Set(signals.filter((x) => x.type === 'cancel').map((x) => x.date));
  for (const sig of signals.filter((x) => x.type === 'meeting' && !cancelled.has(x.date))) {
    const same = out.find((it) => it.kind === 'council' && it.start.slice(0, 10) === sig.date);
    if (same) {
      same.confirmedBy = sig.url;
      if (sig.time && !same.allDay && same.start.slice(11, 16) !== sig.time) {
        const [y, mo, d] = ymd(sig.date); const [h, mi] = sig.time.split(':').map(Number);
        const dur = Date.parse(same.end) - Date.parse(same.start);
        same.start = easternISO(y, mo, d, h, mi); same.end = shiftISO(same.start, dur);
        notices.push(`Council meeting on ${sig.date} moved to ${sig.time} per "${sig.title}".`);
      }
      continue;
    }
    const work = /work session/i.test(sig.title);
    const [y, mo, d] = ymd(sig.date);
    const start = sig.time ? easternISO(y, mo, d, ...sig.time.split(':').map(Number)) : sig.date;
    out.push({
      id: id(`reported|${sig.date}|${work}`), category: 'government', kind: 'council',
      title: work ? 'City Council work session' : /special/i.test(sig.title) ? 'City Council special meeting' : 'City Council meeting',
      venue: config.venue || null, address: config.address || null,
      start, end: sig.time ? shiftISO(start, (work ? 2 : 3) * 3600e3) : addDays(sig.date, 1), allDay: !sig.time,
      url: sig.url, platform: 'City of Greensboro', account: sig.account || 'News report', accountType: 'government',
      verified: true, scheduled: 'reported', district: 'downtown',
    });
    notices.push(`Council meeting reported for ${sig.date} that isn't on the published schedule: "${sig.title}" (${sig.url}).`);
  }
  return out;
}

/** Warnings for the run log: past meetings with no recording, so a quiet change doesn't go unnoticed. */
export function checkRecordings(items, now = new Date(), graceDays = 3) {
  return items
    .filter((it) => it.kind === 'council' && it.scheduled === 'published' && !it.recording)
    .filter((it) => Date.parse(it.end || it.start) < now.getTime() - graceDays * 864e5)
    .map((it) => `No recording found for the ${it.start.slice(0, 10)} council meeting ${graceDays}+ days later. It may have been cancelled or moved.`);
}

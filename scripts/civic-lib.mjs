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

// ---------- usual schedule ----------

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Regular meetings from config.usual (e.g. 1st and 3rd Tuesday at 17:30), for `days` days from `from`.
 * Dates in config.skip are left out; config.extra adds one-off meetings. These are marked
 * `scheduled: "usual"` so the page can say they come from the usual schedule, not a posted agenda.
 */
export function usualMeetings(config, from = new Date(), days = 45) {
  const out = [];
  const skip = new Set(config.skip || []);
  const today = new Date(from.toLocaleDateString('en-CA', { timeZone: TZ }) + 'T12:00:00Z');
  for (let i = 0; i < days; i++) {
    const day = new Date(today.getTime() + i * 864e5);
    const [y, mo, d] = [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()];
    const date = `${y}-${pad(mo)}-${pad(d)}`;
    const nth = Math.ceil(d / 7);
    for (const rule of config.usual || []) {
      if (WEEKDAYS[day.getUTCDay()] !== rule.weekday || !rule.weeks.includes(nth) || skip.has(date)) continue;
      out.push(usualItem(rule, y, mo, d, config));
    }
  }
  for (const x of config.extra || []) {
    const [y, mo, d] = x.date.split('-').map(Number);
    if (x.date >= today.toISOString().slice(0, 10)) out.push(usualItem(x, y, mo, d, config));
  }
  return out;
}

function usualItem(rule, y, mo, d, config) {
  const [h, mi] = rule.time.split(':').map(Number);
  const start = easternISO(y, mo, d, h, mi);
  const end = easternISO(y, mo, d, h + (rule.hours ?? 3), mi);
  return {
    id: id(`usual|${rule.title}|${start}`),
    category: 'government',
    kind: classify(rule.title),
    title: rule.title,
    venue: rule.venue || config.venue,
    address: rule.address || config.address,
    start, end, allDay: false,
    url: config.url,
    platform: 'City of Greensboro',
    account: 'Usual council schedule',
    accountType: 'government',
    verified: true,
    scheduled: 'usual',
    district: 'downtown',
  };
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

/** Keep things that haven't ended and start within `days` days. */
export function upcoming(items, now = new Date(), days = 45) {
  const nowMs = now.getTime();
  const todayET = now.toLocaleDateString('en-CA', { timeZone: TZ });
  const horizon = nowMs + days * 864e5;
  return items.filter((it) => {
    const startMs = it.allDay ? Date.parse(it.start + 'T00:00:00Z') : Date.parse(it.start);
    if (startMs > horizon) return false;
    if (it.allDay) return it.end ? it.end > todayET : it.start >= todayET; // all-day DTEND is exclusive
    const endMs = it.end ? Date.parse(it.end) : startMs + 3 * 3600e3;
    return endMs >= nowMs;
  });
}

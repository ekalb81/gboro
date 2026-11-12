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
    if (!(name in cur)) cur[name] = { value, params }; // first one wins
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

/** Convert parsed VEVENTs to village items. Cancelled events and ones without a start are dropped. */
export function eventsToItems(events, { source = 'City of Greensboro calendar', defaultUrl } = {}) {
  const out = [];
  for (const ev of events) {
    const title = ev.SUMMARY?.value;
    const start = icsTime(ev.DTSTART);
    if (!title || !start) continue;
    if (/^CANCELLED$/i.test(ev.STATUS?.value || '') || /^cancel+ed\b/i.test(title)) continue;
    const end = icsTime(ev.DTEND);
    const kind = classify(title);
    const location = ev.LOCATION?.value || null;
    const [venue, ...rest] = (location || '').split(/\n|,(?=\s*\d)/);
    const url = /^https:\/\//.test(ev.URL?.value || '') ? ev.URL.value : defaultUrl || null;
    const item = {
      id: id(ev.UID?.value || `${title}|${start.iso}`),
      category: kind === 'event' ? 'event' : 'government',
      kind,
      title,
      venue: venue?.trim() || null,
      address: rest.join(',').trim() || (location && /\d/.test(location) ? location : null),
      start: start.iso,
      end: end?.iso ?? null,
      allDay: start.allDay,
      url,
      platform: 'City of Greensboro',
      account: source,
      accountType: 'government',
      verified: true,
    };
    item.district = isCityHall(item) ? 'downtown' : locate({ ...item, address: item.address || location });
    out.push(item);
  }
  return out;
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

/** Feed items win; a usual-schedule meeting is dropped when the feed has a council meeting that day. */
export function mergeCivic(feedItems, usual) {
  const day = (it) => it.start.slice(0, 10);
  const councilDays = new Set(feedItems.filter((it) => it.kind === 'council').map(day));
  const byId = new Map();
  for (const it of [...feedItems, ...usual.filter((u) => !councilDays.has(day(u)))]) byId.set(it.id, it);
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
    if (it.allDay) return (it.end || it.start) >= todayET;
    const endMs = it.end ? Date.parse(it.end) : startMs + 3 * 3600e3;
    return endMs >= nowMs;
  });
}

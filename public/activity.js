// How busy downtown is right now: an ESTIMATE, not a measurement.
//
// Nobody publishes live counts of cars, parked cars or people for downtown Greensboro. What is known:
//   - how many vehicles use each street on an average day (NCDOT's counts, see scripts/fetch-traffic-volumes.mjs),
//   - how a day's traffic, parking and foot traffic usually spread over the hours and the days of the week in the
//     middle of a US city of this size (the tables below; typical shapes, not Greensboro measurements),
//   - and the things this site already collects live: the weather, opening hours, events and closures.
// This module turns the clock and those live readings into a few numbers the model draws from. It has no DOM or
// network code, so it runs under node for the tests.

const TZ = 'America/New_York';

// ---- typical shapes over a day (index = hour of the day, local time) ----
// Share of a whole day's traffic in each hour, in percent. Weekdays have the two commuting peaks; weekends rise
// slowly to a long afternoon.
const DRIVE = {
  wk: [0.8, 0.5, 0.4, 0.4, 0.7, 1.8, 4.2, 6.6, 6.4, 5.2, 5.2, 5.7, 6.2, 6.0, 6.2, 7.0, 7.7, 7.9, 6.0, 4.5, 3.6, 2.9, 2.1, 1.3],
  fri: [0.8, 0.5, 0.4, 0.4, 0.7, 1.7, 3.9, 6.1, 6.0, 5.1, 5.3, 5.9, 6.4, 6.3, 6.5, 7.1, 7.5, 7.4, 6.1, 5.0, 4.2, 3.6, 2.9, 2.2],
  sat: [1.6, 1.1, 0.8, 0.6, 0.6, 1.0, 1.8, 2.9, 4.2, 5.4, 6.4, 7.0, 7.3, 7.2, 7.0, 6.9, 6.7, 6.4, 5.8, 5.0, 4.3, 3.8, 3.2, 2.4],
  sun: [1.8, 1.3, 0.9, 0.6, 0.5, 0.7, 1.2, 1.9, 3.0, 4.6, 6.0, 7.0, 7.8, 7.6, 7.3, 7.0, 6.7, 6.2, 5.5, 4.7, 3.9, 3.1, 2.3, 1.5],
};
for (const k of Object.keys(DRIVE)) { const sum = DRIVE[k].reduce((x, y) => x + y, 0); DRIVE[k] = DRIVE[k].map((v) => (v * 100) / sum); } // each adds up to one day
// A whole day against the yearly average day. A business district is quieter at the weekend than the average road.
const DAY_TOTAL = { wk: 1.06, fri: 1.1, sat: 0.8, sun: 0.62 };

// People on the sidewalks, 0 (nobody) to 1 (the busiest it usually gets: a weekday lunch hour or a Saturday night).
const WALK = {
  wk: [0.04, 0.03, 0.02, 0.02, 0.03, 0.06, 0.15, 0.35, 0.5, 0.45, 0.5, 0.7, 1, 0.85, 0.55, 0.5, 0.55, 0.7, 0.65, 0.55, 0.4, 0.25, 0.15, 0.08],
  fri: [0.04, 0.03, 0.02, 0.02, 0.03, 0.06, 0.15, 0.35, 0.5, 0.45, 0.5, 0.7, 1, 0.85, 0.55, 0.5, 0.6, 0.8, 0.85, 0.9, 0.85, 0.75, 0.6, 0.45],
  sat: [0.3, 0.2, 0.1, 0.04, 0.03, 0.04, 0.08, 0.15, 0.3, 0.45, 0.6, 0.7, 0.8, 0.75, 0.65, 0.6, 0.6, 0.7, 0.85, 0.95, 0.9, 0.8, 0.65, 0.5],
  sun: [0.3, 0.2, 0.08, 0.03, 0.02, 0.03, 0.05, 0.1, 0.2, 0.35, 0.5, 0.65, 0.7, 0.65, 0.55, 0.45, 0.4, 0.4, 0.4, 0.35, 0.25, 0.15, 0.1, 0.05],
};

// Share of a lot's stalls in use, by what the lot serves.
const PARK = {
  // offices, courts and City and County buildings: full in working hours, nearly empty otherwise
  office: {
    wk: [0.05, 0.05, 0.05, 0.05, 0.05, 0.07, 0.14, 0.36, 0.62, 0.74, 0.78, 0.78, 0.72, 0.75, 0.77, 0.74, 0.64, 0.42, 0.24, 0.15, 0.1, 0.08, 0.06, 0.05],
    sat: [0.05, 0.05, 0.04, 0.04, 0.04, 0.04, 0.05, 0.07, 0.1, 0.13, 0.15, 0.16, 0.16, 0.15, 0.14, 0.13, 0.12, 0.11, 0.1, 0.09, 0.08, 0.07, 0.06, 0.05],
    sun: [0.05, 0.04, 0.04, 0.04, 0.04, 0.04, 0.04, 0.05, 0.06, 0.08, 0.09, 0.1, 0.1, 0.1, 0.09, 0.08, 0.08, 0.07, 0.07, 0.06, 0.06, 0.05, 0.05, 0.05],
  },
  // shops, restaurants and bars: lunch, then the evening
  retail: {
    wk: [0.08, 0.05, 0.04, 0.03, 0.03, 0.04, 0.07, 0.14, 0.24, 0.32, 0.42, 0.6, 0.72, 0.6, 0.42, 0.38, 0.4, 0.52, 0.68, 0.7, 0.58, 0.42, 0.26, 0.15],
    fri: [0.08, 0.05, 0.04, 0.03, 0.03, 0.04, 0.07, 0.14, 0.24, 0.32, 0.42, 0.62, 0.74, 0.62, 0.45, 0.42, 0.48, 0.64, 0.82, 0.88, 0.84, 0.74, 0.58, 0.42],
    sat: [0.3, 0.18, 0.08, 0.04, 0.03, 0.03, 0.05, 0.1, 0.2, 0.34, 0.48, 0.6, 0.68, 0.64, 0.56, 0.52, 0.54, 0.66, 0.84, 0.9, 0.86, 0.76, 0.6, 0.44],
    sun: [0.3, 0.18, 0.07, 0.03, 0.03, 0.03, 0.04, 0.07, 0.14, 0.28, 0.46, 0.6, 0.64, 0.56, 0.44, 0.36, 0.32, 0.34, 0.36, 0.32, 0.24, 0.16, 0.1, 0.07],
  },
  // apartments and hotels: full overnight, half empty while people are at work
  home: {
    wk: [0.82, 0.83, 0.84, 0.84, 0.83, 0.8, 0.72, 0.6, 0.48, 0.42, 0.4, 0.4, 0.4, 0.4, 0.4, 0.42, 0.46, 0.54, 0.62, 0.68, 0.72, 0.76, 0.79, 0.81],
    sat: [0.78, 0.8, 0.82, 0.83, 0.83, 0.82, 0.8, 0.77, 0.72, 0.66, 0.6, 0.56, 0.54, 0.54, 0.54, 0.55, 0.56, 0.57, 0.56, 0.56, 0.58, 0.62, 0.68, 0.74],
    sun: [0.78, 0.8, 0.82, 0.83, 0.83, 0.82, 0.8, 0.78, 0.74, 0.68, 0.62, 0.6, 0.6, 0.6, 0.62, 0.64, 0.66, 0.7, 0.73, 0.76, 0.78, 0.8, 0.81, 0.82],
  },
  // churches: Sunday morning, a little on Wednesday evening, otherwise the weekday staff
  church: {
    wk: [0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.03, 0.06, 0.12, 0.15, 0.15, 0.15, 0.14, 0.14, 0.14, 0.12, 0.1, 0.08, 0.08, 0.07, 0.05, 0.03, 0.02, 0.02],
    wed: [0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.03, 0.06, 0.12, 0.15, 0.15, 0.15, 0.14, 0.14, 0.14, 0.12, 0.12, 0.25, 0.42, 0.4, 0.2, 0.05, 0.02, 0.02],
    sat: [0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.03, 0.05, 0.08, 0.1, 0.1, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.06, 0.05, 0.03, 0.02, 0.02, 0.02],
    sun: [0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.03, 0.1, 0.4, 0.75, 0.9, 0.88, 0.55, 0.2, 0.1, 0.08, 0.1, 0.18, 0.2, 0.12, 0.05, 0.03, 0.02, 0.02],
  },
};

// People standing outside or coming and going at an open place, 0 to 1 of the most it shows.
const BUSY = {
  restaurant: { wk: h([[11, 0.5], [12, 1], [13, 0.8], [14, 0.35], [16, 0.25], [17, 0.5], [18, 0.85], [19, 0.9], [20, 0.65], [21, 0.4], [22, 0.2]]), we: h([[10, 0.4], [11, 0.7], [12, 0.9], [13, 0.85], [14, 0.5], [16, 0.35], [17, 0.6], [18, 0.95], [19, 1], [20, 0.9], [21, 0.6], [22, 0.3]]) },
  takeout: { wk: h([[11, 0.5], [12, 1], [13, 0.7], [14, 0.3], [17, 0.5], [18, 0.8], [19, 0.6], [20, 0.3]]), we: h([[11, 0.4], [12, 0.8], [13, 0.7], [14, 0.4], [17, 0.5], [18, 0.8], [19, 0.7], [20, 0.4], [22, 0.3], [25, 0.5]]) },
  cafe: { wk: h([[7, 0.7], [8, 1], [9, 0.8], [10, 0.6], [12, 0.6], [14, 0.5], [16, 0.35], [18, 0.2]]), we: h([[8, 0.5], [9, 0.8], [10, 1], [11, 0.95], [12, 0.8], [14, 0.6], [16, 0.4], [18, 0.2]]) },
  bar: { wk: h([[16, 0.2], [17, 0.45], [18, 0.55], [20, 0.6], [21, 0.55], [22, 0.45], [23, 0.3], [25, 0.15]]), we: h([[14, 0.2], [16, 0.3], [17, 0.5], [19, 0.7], [21, 0.9], [22, 1], [24, 0.95], [25, 0.7], [26, 0.2]]) },
  brewery: { wk: h([[15, 0.2], [17, 0.5], [18, 0.65], [20, 0.55], [21, 0.35], [22, 0.15]]), we: h([[12, 0.3], [14, 0.6], [16, 0.8], [18, 1], [20, 0.9], [21, 0.6], [22, 0.3]]) },
  nightclub: { wk: h([[21, 0.2], [23, 0.4], [25, 0.3]]), we: h([[21, 0.3], [22, 0.6], [23, 0.9], [24, 1], [25, 0.9], [26, 0.4]]) },
};
// The most people drawn outside one place of each kind (the rest are indoors and not shown).
const OUTSIDE = { restaurant: 3, takeout: 2, cafe: 2, bar: 4, brewery: 4, nightclub: 6 };

/** A 28-hour table (so a Saturday night runs on past midnight) from a few [hour, level] points, straight lines between. */
function h(pts) {
  const out = new Array(28).fill(0);
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, va] = pts[i], [b, vb] = pts[i + 1];
    for (let x = a; x <= b; x++) out[x] = va + ((vb - va) * (x - a)) / (b - a || 1);
  }
  return out;
}
/** A table read at a time of day in minutes, sliding from one hour's value to the next. */
function read(table, min) {
  // an hour's figure belongs to the middle of that hour
  const x = ((((min - 30) / 60) % 24) + 24) % 24, i = Math.floor(x), f = x - i;
  return table[i] * (1 - f) + table[(i + 1) % 24] * f;
}

// ---- the calendar ----
const nth = (y, m, wd, n) => { const first = new Date(Date.UTC(y, m, 1)).getUTCDay(); return 1 + ((wd - first + 7) % 7) + 7 * (n - 1); };
const lastMon = (y, m) => { const d = new Date(Date.UTC(y, m + 1, 0)); return d.getUTCDate() - ((d.getUTCDay() + 6) % 7); };
/** US public holidays when downtown offices and courts are shut (month is 1 to 12). */
export function isHoliday(y, m, d) {
  const fixed = [[1, 1], [6, 19], [7, 4], [11, 11], [12, 25]];
  if (fixed.some(([fm, fd]) => fm === m && fd === d)) return true;
  if (m === 1 && d === nth(y, 0, 1, 3)) return true; // Martin Luther King Jr. Day
  if (m === 5 && d === lastMon(y, 4)) return true; // Memorial Day
  if (m === 9 && d === nth(y, 8, 1, 1)) return true; // Labor Day
  if (m === 11 && d === nth(y, 10, 4, 4)) return true; // Thanksgiving
  if (m === 11 && d === nth(y, 10, 4, 4) + 1) return true; // and the day after
  return false;
}
/** The clock in Greensboro: { day: 0 Monday to 6 Sunday, min: minutes since midnight, holiday }. */
export function clockOf(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: 'numeric', year: 'numeric', month: 'numeric', day: 'numeric', hour12: false })
    .formatToParts(date).map((x) => [x.type, x.value]));
  return { day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday), min: (+p.hour % 24) * 60 + +p.minute, holiday: isHoliday(+p.year, +p.month, +p.day) };
}
/** "sat-21:30" (a preview clock from the page address) as { day, min, holiday }, or null. */
export function parseClock(s) {
  const m = /^(mon|tue|wed|thu|fri|sat|sun|holiday)-(\d{1,2}):?(\d{2})?$/i.exec(s || '');
  if (!m) return null;
  const k = m[1].toLowerCase();
  return { day: k === 'holiday' ? 0 : ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(k), min: (+m[2] % 24) * 60 + +(m[3] || 0), holiday: k === 'holiday' };
}
// which table a day uses; a public holiday runs like a Sunday
const dayKey = ({ day, holiday }) => (holiday || day === 6 ? 'sun' : day === 5 ? 'sat' : day === 4 ? 'fri' : 'wk');
const pick = (tables, clock) => {
  const k = dayKey(clock);
  if (k === 'wk' && clock.day === 2 && tables.wed) return tables.wed;
  return tables[k] || (k === 'fri' ? tables.wk : tables.sat) || tables.wk;
};

// ---- the weather ----
/** How rain, snow, cold and heat change driving and walking (1 = no change). wx: 'clear' | 'rain' | 'storm' | 'snow'. */
export function weatherEffect({ wx = 'clear', intensity = null, tempF = null } = {}) {
  let drive = 1, walk = 1;
  if (wx === 'rain') { const k = intensity === 'light' ? 0 : intensity === 'heavy' ? 2 : 1; drive = [0.97, 0.93, 0.88][k]; walk = [0.6, 0.35, 0.15][k]; }
  else if (wx === 'storm') { drive = 0.85; walk = 0.12; }
  else if (wx === 'snow') { drive = 0.7; walk = 0.4; }
  if (tempF != null) walk *= tempF < 25 ? 0.4 : tempF < 35 ? 0.6 : tempF < 45 ? 0.8 : tempF > 95 ? 0.6 : tempF > 88 ? 0.8 : 1;
  return { drive, walk };
}

/**
 * Everything the model needs to know about how busy it is.
 * clock: { day, min, holiday }; weather: { wx, intensity, tempF }; events: how many events are on downtown right now.
 * Returns:
 *   hourShare  the fraction of an average day's traffic that passes in this hour (about 0.004 at 3 AM, 0.08 at 5 PM)
 *   walk       0 to 1, how many of the sidewalk walkers are out
 *   park       { office, retail, home, church }: the share of stalls in use in a lot of each kind
 */
export function activity(clock, weather = {}, events = 0) {
  const k = dayKey(clock), wx = weatherEffect(weather);
  const ev = Math.min(3, Math.max(0, events));
  const hourShare = (read(DRIVE[k], clock.min) / 100) * DAY_TOTAL[k] * wx.drive * (1 + 0.05 * ev);
  const walk = Math.min(1, read(WALK[k], clock.min) * wx.walk * (1 + 0.1 * ev));
  const park = {};
  for (const kind of Object.keys(PARK)) park[kind] = read(pick(PARK[kind], clock), clock.min);
  // fewer people drive in for lunch or a night out in bad weather; people who are already at work or at home stay put
  park.retail *= 0.5 + 0.5 * Math.min(1, wx.walk + 0.25);
  return { hourShare, walk, park, wx };
}

/** How many people to draw outside an open place of this kind right now (0 when it would be quiet). */
export function outside(kind, clock, weather = {}, salt = 0) {
  const t = BUSY[kind] || BUSY.restaurant, cap = OUTSIDE[kind] || 2;
  const k = dayKey(clock);
  // after midnight the night still belongs to the evening before
  const late = clock.min < 5 * 60;
  const prev = late ? dayKey({ day: (clock.day + 6) % 7, holiday: false }) : k;
  const table = (late ? prev === 'fri' || prev === 'sat' : k === 'fri' ? clock.min >= 16 * 60 : k === 'sat' || k === 'sun') ? t.we : t.wk;
  const x = clock.min / 60 + (late ? 24 : 0), i = Math.min(26, Math.floor(x)), f = x - i;
  const level = (table[i] * (1 - f) + table[i + 1] * f) * (k === 'sun' && !late && clock.min >= 17 * 60 ? 0.6 : 1);
  const n = cap * level * weatherEffect(weather).walk;
  // round so that a street of places at the same level doesn't all show the same number
  return Math.floor(n + (((salt * 0.618034) % 1) + 1) % 1);
}

/** In words, for the page: 'quiet' | 'light' | 'steady' | 'busy'. */
export const word = (x) => (x < 0.2 ? 'quiet' : x < 0.45 ? 'light' : x < 0.75 ? 'steady' : 'busy');
/** Traffic as a 0 to 1 level against the busiest hour of an ordinary week. */
export const driveLevel = (hourShare) => Math.min(1, hourShare / 0.084);

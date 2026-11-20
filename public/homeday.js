// A day at the house up the street: what its one resident is doing at any minute.
// Nothing here is measured or reported by anyone. It is a made-up routine, the same for everybody who looks, worked
// out from the date, the clock and the weather downtown: a run some mornings, a walk before dark, the lawn on
// Saturdays, friends round the fire on Friday and Saturday nights.
//
// Pure functions, no page needed (test/homeday.test.mjs).

const TZ = 'America/New_York';
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const clockFormat = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: 'numeric', second: 'numeric', year: 'numeric', month: 'numeric', day: 'numeric', hourCycle: 'h23' });

/** The clock in Greensboro: { y, m, d, day: 0 Monday to 6 Sunday, min: minutes since midnight (with a fraction) }. */
export function clockAt(date = new Date()) {
  const p = Object.fromEntries(clockFormat.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, day: DAYS.indexOf(p.weekday.toLowerCase()), min: (+p.hour % 24) * 60 + +p.minute + +p.second / 60 };
}

/** "sat-10:15" from the page address, laid over a real clock (which keeps the date, so the season). */
export function parseWhen(s, base = clockAt()) {
  const m = /^(mon|tue|wed|thu|fri|sat|sun)-(\d{1,2}):?(\d{2})?$/i.exec(s || '');
  if (!m) return null;
  return { ...base, day: DAYS.indexOf(m[1].toLowerCase()), min: (+m[2] % 24) * 60 + +(m[3] || 0) };
}

const frac = (x) => x - Math.floor(x);
/** A number from 0 to 1 that is the same all day for everyone: k picks which one. */
export const dayRand = (c, k = 0) => frac(Math.sin((c.y * 372 + c.m * 31 + c.d) * 12.9898 + k * 78.233) * 43758.5453);

const inSeason = (c, from, to) => { const v = c.m * 100 + c.d; return v >= from && v <= to; };

/**
 * Everything planned for the day, in order: [{ kind, t0, t1, friends? }] in minutes since midnight.
 * sun: { rise, set } in minutes; the walk is fitted in before dark.
 */
export function planDay(c, sun = { rise: 420, set: 1080 }) {
  const wk = c.day < 5;
  const wake = wk ? 390 : 465;
  const bed = c.day === 4 || c.day === 5 ? 1410 : 1365;
  const plan = [];
  if ([0, 2, 4].includes(c.day) && dayRand(c, 1) > 0.12) plan.push({ kind: 'run', t0: 410, t1: 455 });
  if (c.day === 6) plan.push({ kind: 'run', t0: 510, t1: 585 });
  if (!wk) plan.push({ kind: 'coffee', t0: wake + 12, t1: wake + 40 });
  if (c.day === 5 && inSeason(c, 315, 1130)) plan.push({ kind: 'mow', t0: 600, t1: 655 });
  if (!wk) plan.push({ kind: 'read', t0: 810, t1: 885 });
  if (c.day === 6 && inSeason(c, 401, 1031)) plan.push({ kind: 'garden', t0: 900, t1: 950 });
  const w0 = Math.round(wk ? Math.min(1065, sun.set - 45) : Math.min(990, sun.set - 50));
  plan.push({ kind: 'walk', t0: w0, t1: w0 + 35 });
  if (c.day === 4 || c.day === 5) plan.push({ kind: 'fire', t0: 1140, t1: 1335, friends: 2 + Math.floor(dayRand(c, 2) * 3) });
  plan.sort((a, b) => a.t0 - b.t0);
  return { wake, bed, plan };
}

/** Whether the weather lets a thing go ahead. wx: { precip: 'none'|'rain'|'storm'|'snow', tempF, windMph } (any may be missing). */
export function weatherAllows(kind, wx = {}) {
  const wet = !!wx.precip && wx.precip !== 'none';
  const t = wx.tempF ?? 62, wind = wx.windMph ?? 5;
  if (kind === 'run') return !wet && t >= 22;
  if (kind === 'walk') return wx.precip !== 'storm' && wx.precip !== 'snow' && !(wet && wx.intensity === 'heavy');
  if (kind === 'mow' || kind === 'garden') return !wet && t >= 40;
  if (kind === 'coffee') return !wet && t >= 48;
  if (kind === 'read') return !wet && t >= 58 && t <= 90;
  if (kind === 'fire') return !wet && wind < 20 && t <= 76;
  return true;
}

/**
 * What is going on at this minute: { kind, t0, t1, friends, next }.
 * kind is one of the planned things, or 'inside' (home, awake) or 'asleep'. force ({ kind, t0 }) shows a kind regardless of
 * the plan, as started at t0 (the page's ?do= preview).
 */
export function nowDoing(c, wx = {}, sun, force = null) {
  const { wake, bed, plan } = planDay(c, sun);
  if (force) {
    const len = { fire: 195, mow: 55, run: 45, walk: 35 }[force.kind] || 50;
    return { kind: force.kind, t0: force.t0, t1: force.t0 + len, friends: 3, forced: true, next: null };
  }
  const next = plan.find((p) => p.t0 > c.min && weatherAllows(p.kind, wx)) || null;
  const cur = plan.find((p) => c.min >= p.t0 && c.min < p.t1 && weatherAllows(p.kind, wx));
  if (cur) return { ...cur, next };
  if (c.min < wake || c.min >= bed) return { kind: 'asleep', t0: bed, t1: wake, next };
  return { kind: 'inside', t0: wake, t1: bed, next };
}

const clockText = (min) => { const h = Math.floor(min / 60) % 24, m = Math.round(min % 60); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };

/** One plain line for the page. No name: the house is not labelled. */
export function sayDoing(st, c, dark = false) {
  const till = st.forced ? '' : ` until about ${clockText(st.t1)}`;
  switch (st.kind) {
    case 'run': return `Out for a run${st.forced ? '' : `, back about ${clockText(st.t1)}`}`;
    case 'walk': return `Out for a walk${st.forced ? '' : `, back about ${clockText(st.t1)}`}`;
    case 'mow': return 'Mowing the lawn';
    case 'garden': return 'In the front beds';
    case 'coffee': return 'Coffee on the patio';
    case 'read': return 'Reading in the back yard';
    case 'fire': return `Friends over by the fire${till}`;
    case 'asleep': return 'Lights out';
    default: return dark ? 'Home, lights on' : 'At home';
  }
}

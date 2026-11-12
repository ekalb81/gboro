// Restaurants and bars from OpenStreetMap: normalizing, opening hours, and placement on the village map.
// No dependencies. Used by scripts/fetch-eats.mjs and test/eats.test.mjs.

// Kinds we keep, from OSM tags. Order matters: the first match wins.
const KINDS = [
  ['nightclub', (t) => t.amenity === 'nightclub'],
  ['brewery', (t) => t.craft === 'brewery' || t.microbrewery === 'yes' || t.craft === 'distillery' || t.craft === 'winery'],
  ['bar', (t) => t.amenity === 'bar' || t.amenity === 'pub' || t.amenity === 'biergarten'],
  ['cafe', (t) => t.amenity === 'cafe' || t.amenity === 'ice_cream'],
  ['restaurant', (t) => t.amenity === 'restaurant' || t.amenity === 'food_court'],
  ['takeout', (t) => t.amenity === 'fast_food'],
];
export const BAR_KINDS = new Set(['bar', 'nightclub', 'brewery']);

export function kindOf(tags = {}) {
  for (const [k, test] of KINDS) if (test(tags)) return k;
  return null;
}

// A chain has a brand tag (OSM's name-suggestion-index adds these). The village is about local places.
export const isChain = (tags = {}) => Boolean(tags.brand || tags['brand:wikidata']);

/**
 * Village "hubs": a spot on the hand-drawn 96x60 map tied to a real place, with a local scale.
 * The map is functional, not to scale, so each venue goes to its nearest hub and keeps its real
 * direction and rough distance from that hub. Far-flung places (outside every hub's radius) are skipped.
 */
export const HUBS = [
  // Elm & Market. Scale makes Elm & Gate City land on the map's Gate City Blvd and the tracks on the railroad.
  { id: 'downtown',     map: [49, 25], lat: 36.07248, lon: -79.79030, mPerTile: 46, radius: 1300, reach: [10, 20] },
  { id: 'college-hill', map: [40, 20], lat: 36.07100, lon: -79.80041, mPerTile: 60, radius: 500,  reach: [5, 5] },
  { id: 'uncg',         map: [36, 29], lat: 36.06750, lon: -79.80900, mPerTile: 60, radius: 800,  reach: [8, 6] },
  { id: 'ncat',         map: [76, 20], lat: 36.07710, lon: -79.77260, mPerTile: 70, radius: 1100, reach: [12, 8] },
  { id: 'coliseum',     map: [30, 48], lat: 36.05930, lon: -79.82500, mPerTile: 70, radius: 1100, reach: [10, 8] },
  { id: 'westside',     map: [16, 20], lat: 36.08600, lon: -79.83360, mPerTile: 80, radius: 1500, reach: [10, 8] },
  { id: 'north',        map: [27, 10], lat: 36.09539, lon: -79.81632, mPerTile: 80, radius: 1500, reach: [10, 7] },
  { id: 'southeast',    map: [70, 48], lat: 36.06300, lon: -79.76500, mPerTile: 70, radius: 1000, reach: [10, 8] },
];

const M_PER_DEG_LAT = 111320;
function metersFrom(hub, lat, lon) {
  const e = (lon - hub.lon) * M_PER_DEG_LAT * Math.cos((hub.lat * Math.PI) / 180);
  const n = (lat - hub.lat) * M_PER_DEG_LAT;
  return { e, n, d: Math.hypot(e, n) };
}

/** Nearest hub (relative to its radius) and the tile offset from it, or null if the place is too far from all of them. */
export function placeOnMap(lat, lon, hubs = HUBS) {
  let best = null;
  for (const h of hubs) {
    const m = metersFrom(h, lat, lon);
    const score = m.d / h.radius;
    if (score <= 1 && (!best || score < best.score)) best = { h, m, score };
  }
  if (!best) return null;
  const { h, m } = best;
  const clamp = (v, r) => Math.max(-r, Math.min(r, Math.round(v)));
  return { hub: h.id, x: h.map[0] + clamp(m.e / h.mPerTile, h.reach[0]), y: h.map[1] + clamp(-m.n / h.mPerTile, h.reach[1]) };
}

// ---------- opening hours ----------
// A subset of the OSM opening_hours syntax that covers most restaurants and bars:
//   "24/7", "Mo-Fr 11:00-22:00; Sa,Su 10:00-23:00", "Tu-Su 17:00-02:00; Mo off", "11:00-14:00,17:00-21:00".
// Returns a week as 7 lists (Mo..Su) of [startMinute, endMinute] where end can pass 1440 (open past midnight),
// or null when the value uses syntax we don't handle (months, holidays only, sunset, "open end", comments...).
const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function parseDays(s) {
  const out = new Set();
  for (const part of s.split(',')) {
    const m = part.trim().match(/^(Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(Mo|Tu|We|Th|Fr|Sa|Su))?$/);
    if (!m) return null;
    const a = DAYS.indexOf(m[1]), b = m[2] ? DAYS.indexOf(m[2]) : a;
    for (let i = a; ; i = (i + 1) % 7) { out.add(i); if (i === b) break; }
  }
  return out;
}

function parseTimes(s) {
  const out = [];
  for (const part of s.split(',')) {
    const m = part.trim().replace(/\+$/, '').match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const a = +m[1] * 60 + +m[2];
    let b = +m[3] * 60 + +m[4];
    if (a > 24 * 60 || b > 48 * 60) return null;
    if (b <= a) b += 24 * 60; // 17:00-02:00 runs past midnight
    out.push([a, b]);
  }
  return out;
}

export function parseHours(raw) {
  if (!raw) return null;
  const s = raw.trim().replace(/\s+/g, ' ');
  if (s === '24/7') return Array.from({ length: 7 }, () => [[0, 1440]]);
  const week = Array.from({ length: 7 }, () => []);
  let touched = false;
  // ";" starts a rule that replaces the days it names; ", " after a time adds to them instead.
  const rules = s.split(/(;|(?<=\d\+?),\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)\b))/);
  let additive = false;
  for (let rule of rules) {
    if (rule === ';') { additive = false; continue; }
    if (/^,\s*$/.test(rule)) { additive = true; continue; }
    rule = rule.trim();
    if (!rule) continue;
    if (/^PH\b/.test(rule)) continue; // public holidays: ignore, not worth guessing
    rule = rule.replace(/,\s*PH\b/, '');
    const m = rule.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?\s*,?\s*)+)?\s*(.*)$/);
    const days = m[1] ? parseDays(m[1].trim().replace(/,$/, '')) : new Set([0, 1, 2, 3, 4, 5, 6]);
    if (!days) return null;
    const rest = m[2].trim().replace(/\+$/, ''); // "21:00+" (open end): take the stated time
    let times;
    if (/^(off|closed)$/i.test(rest)) times = [];
    else if (/^24\/7$/.test(rest) || rest === '00:00-24:00') times = [[0, 1440]];
    else times = parseTimes(rest);
    if (!times) return null;
    for (const d of days) week[d] = additive ? [...week[d], ...times] : times;
    touched = true;
    additive = false;
  }
  return touched ? week : null;
}

/** Is a parsed week open at (dayIndex Mo=0, minute of day)? Also checks yesterday's past-midnight spill. */
export function openAt(week, day, minute) {
  if (!week) return null;
  if (week[day].some(([a, b]) => minute >= a && minute < b)) return true;
  const prev = week[(day + 6) % 7];
  return prev.some(([, b]) => b > 1440 && minute + 1440 < b);
}

// ---------- normalizing ----------
const httpsOnly = (u) => (u && /^https?:\/\//i.test(u) ? u.replace(/^http:/i, 'https:') : null);

/** One OSM element (from Overpass `out body center` or the OSM API) to a village place, or a reason it was skipped. */
export function toPlace(el, { keepChains = false } = {}) {
  const t = el.tags || {};
  if (!t.name) return { skip: 'unnamed' };
  const kind = kindOf(t);
  if (!kind) return { skip: 'not food or drink' };
  if (!keepChains && isChain(t)) return { skip: 'chain' };
  const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return { skip: 'no location' };
  const spot = placeOnMap(lat, lon);
  if (!spot) return { skip: 'outside the village' };
  return {
    place: {
      id: `${el.type[0]}${el.id}`,
      name: t.name,
      kind,
      cuisine: t.cuisine ? t.cuisine.split(';')[0].replace(/_/g, ' ') : null,
      ...spot,
      hours: parseHours(t.opening_hours),
      hoursText: t.opening_hours || null,
      address: [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') || null,
      website: httpsOnly(t.website || t['contact:website']),
      osm: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      lat: +lat.toFixed(5), lon: +lon.toFixed(5),
    },
  };
}

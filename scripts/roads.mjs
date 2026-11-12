// Greensboro road closures, roadwork and crashes from NCDOT's DriveNC, turned into the small
// roads.json the village reads.
//
// Two ways in, both free:
// - With a DriveNC developer key (DRIVENC_KEY), the documented Events API:
//   https://www.drivenc.gov/api/v2/get/event   (docs: https://www.drivenc.gov/help/endpoint/event)
// - Without a key, the same events the public DriveNC site shows: its traffic list
//   (/List/GetData/traffic) for the details, and its map layers (/map/mapIcons/<layer>) for where
//   each event is. These are the site's own feeds, not a published API, so they can change.

export const DRIVENC = {
  base: 'https://www.drivenc.gov',
  userAgent: 'gso-village (hobby community map)',
  county: 'Guilford',
  // Greensboro and its edges. Keeps High Point, Jamestown and the rural county out.
  bbox: { south: 35.98, north: 36.18, west: -79.97, east: -79.66 },
  pageSize: 100,
  layers: ['Incidents', 'Closures', 'Roadwork', 'WeatherIncidents', 'SpecialEvents'],
};

const TZ_OFFSET = (y, mo, d) =>
  // Rough US DST rule (same as the digest parser): EDT from mid-March to early November.
  (mo > 3 && mo < 11) || (mo === 3 && d >= 9) || (mo === 11 && d < 2) ? '-04:00' : '-05:00';

/** DriveNC list dates look like "5/11/26, 8:52 AM" in Eastern time. Returns ISO or null. */
export function parseListDate(s) {
  const m = (s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  const mo = +m[1], d = +m[2];
  const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  let h = +m[4] % 12;
  if (/pm/i.test(m[6])) h += 12;
  const p = (n) => String(n).padStart(2, '0');
  return `${y}-${p(mo)}-${p(d)}T${p(h)}:${m[5]}:00${TZ_OFFSET(y, mo, d)}`;
}

const unix = (n) => (n ? new Date(n * 1000).toISOString() : null);

/** Strip the list's HTML comment block and the trailing "Id: 123" / "ATMS ID ..." bookkeeping. */
export function cleanText(s) {
  return (s || '')
    .replace(/<div class='cellSpacer'>[\s\S]*$/i, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s*(Id:\s*\d+|ATMS ID\s*-?\d+)\.?\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * What the village draws for an event.
 * crash: smashed cars and flashing lights. event: barrels plus bunting (parades, races, festivals).
 * closed: barrels across the street. work: cones and a worker.
 */
export function kindOf({ type = '', subtype = '', full = false }) {
  const t = `${type} ${subtype}`.toLowerCase();
  if (/crash|collision|accident|disabled|vehicle/.test(t)) return 'crash';
  if (/parade|festival|special ?event|sporting|fair/.test(t)) return 'event';
  if (full || /closure/.test(t)) return 'closed';
  return 'work';
}

/** Normalize one row of the public traffic list (plus its map location, if it has one). */
export function fromListRow(r, location = null) {
  const type = r.type || '';
  const full = !!r.isFullClosure;
  return {
    id: String(r.id),
    kind: kindOf({ type, subtype: r.eventSubType, full }),
    full,
    upcoming: /^upcoming/i.test(type),
    road: r.roadwayName || null,
    where: (r.locationDescription || '').replace(/\s*\|\s*/g, ' to ') || null,
    text: cleanText(r.description),
    lanes: r.laneDescription || null,
    subtype: r.eventSubType || null,
    county: r.county || null,
    start: parseListDate(r.startDate),
    end: parseListDate(r.endDate),
    updated: parseListDate(r.lastUpdated),
    lat: location?.[0] ?? null,
    lon: location?.[1] ?? null,
  };
}

/** Normalize one event from the keyed Events API. */
export function fromApiEvent(e, now = Date.now()) {
  const full = !!e.IsFullClosure;
  const start = unix(e.StartDate);
  return {
    id: String(e.ID),
    kind: kindOf({ type: `${e.EventType || ''} ${e.OriginalEventType || ''}`, subtype: e.EventSubType, full }),
    full,
    upcoming: !!start && new Date(start).getTime() > now,
    road: e.RoadwayName || null,
    where: null,
    text: cleanText(e.Description),
    lanes: e.LanesAffected || null,
    subtype: e.EventSubType || null,
    county: e.County || null,
    start,
    end: unix(e.PlannedEndDate),
    updated: unix(e.LastUpdated),
    lat: e.Latitude ?? null,
    lon: e.Longitude ?? null,
  };
}

const inBox = (ev, b = DRIVENC.bbox) =>
  ev.lat != null && ev.lon != null && ev.lat >= b.south && ev.lat <= b.north && ev.lon >= b.west && ev.lon <= b.east;

/**
 * Keep Greensboro's events. Events with a location must be in the city box; upcoming events
 * have no location yet, so they are kept only if they are in Guilford County and on a road the
 * village knows (they show in the side list and, once they start, on the map).
 */
export function inGreensboro(ev, knownRoad = () => null) {
  if (!new RegExp(DRIVENC.county, 'i').test(ev.county || '')) return false;
  if (ev.lat != null) return inBox(ev);
  return !!knownRoad(ev.road);
}

// ---------- placing events on the village map ----------

// Real places and where they sit on the hand-drawn 96x60 village grid (public/data/map.json).
// The village is a schematic, not to scale, so placement is an affine fit to these points plus a
// smooth correction that pulls each anchor exactly onto its tile.
export const ANCHORS = [
  // [lat, lon, tileX, tileY, what]
  [36.0726, -79.7910, 48, 24, 'Elm St and Market St'],
  [36.0790, -79.7905, 48, 16, 'Elm St and Friendly Ave'],
  [36.0690, -79.7895, 48, 35, 'Elm St at the railroad'],
  [36.0626, -79.7880, 48, 44, 'S Elm St and Lee St'],
  [36.0770, -79.7630, 64, 24, 'Benbow Rd and E Market St'],
  [36.0560, -79.7610, 64, 44, 'Benbow Rd and E Lee St'],
  [36.0760, -79.7710, 76, 19, 'NC A&T'],
  [36.0745, -79.8115, 30, 24, 'Aycock St and W Market St'],
  [36.0800, -79.8120, 30, 16, 'Aycock St and Friendly Ave'],
  [36.0680, -79.8110, 30, 31, 'Aycock St and Spring Garden St'],
  [36.0595, -79.8250, 30, 48, 'Coliseum'],
  [36.0870, -79.8540, 16, 20, 'Friendly Center'],
  [36.1080, -79.8320, 27, 10, 'Battleground Ave and Cone Blvd'],
  [36.0720, -79.8800, 6, 24, 'W Market St, west end'],
  [36.0800, -79.7000, 90, 24, 'E Market St, east end'],
  [36.0500, -79.8700, 8, 44, 'W Gate City Blvd, west end'],
  [36.1800, -79.9700, 0, 0, 'NW corner'],
  [36.1800, -79.6600, 95, 0, 'NE corner'],
  [35.9800, -79.9700, 0, 59, 'SW corner'],
  [35.9800, -79.6600, 95, 59, 'SE corner'],
];

const KM_LAT = 111.0;
const KM_LON = 111.0 * Math.cos((36.07 * Math.PI) / 180);
const km = ([lat, lon]) => [lon * KM_LON, lat * KM_LAT];

// Least-squares affine fit tile = A * [x, y, 1], in km, solved once.
function fitAffine(anchors) {
  const rows = anchors.map(([lat, lon]) => [...km([lat, lon]), 1]);
  const solve = (target) => {
    // Normal equations (3x3), Cramer's rule is plenty here.
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
    rows.forEach((r, i) => { for (let a = 0; a < 3; a++) { v[a] += r[a] * target[i]; for (let b = 0; b < 3; b++) M[a][b] += r[a] * r[b]; } });
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(M);
    return [0, 1, 2].map((c) => det(M.map((row, i) => row.map((x, j) => (j === c ? v[i] : x)))) / D);
  };
  return [solve(anchors.map((a) => a[2])), solve(anchors.map((a) => a[3]))];
}
const AFFINE = fitAffine(ANCHORS);
const affine = (p) => { const [x, y] = km(p); return AFFINE.map(([a, b, c]) => a * x + b * y + c); };
const RESID = ANCHORS.map((a) => { const [x, y] = affine([a[0], a[1]]); return [a[2] - x, a[3] - y]; });

/** Real lat/lon to a (fractional) village tile. */
export function project(lat, lon) {
  const p = [lat, lon];
  const [ax, ay] = affine(p);
  const [px, py] = km(p);
  let wx = 0, wy = 0, ws = 0;
  for (let i = 0; i < ANCHORS.length; i++) {
    const [qx, qy] = km([ANCHORS[i][0], ANCHORS[i][1]]);
    const d2 = (px - qx) ** 2 + (py - qy) ** 2;
    if (d2 < 1e-9) return [ANCHORS[i][2], ANCHORS[i][3]];
    const w = 1 / d2;
    wx += w * RESID[i][0]; wy += w * RESID[i][1]; ws += w;
  }
  return [ax + wx / ws, ay + wy / ws];
}

// Real road names and the village road they belong to.
const ROAD_ALIASES = [
  [/\b(n|s|north|south)?\s*elm\s+st/i, 'Elm St'],
  [/\b(e|w|east|west)?\s*market\s+st/i, 'Market St'],
  [/\bfriendly\s+ave/i, 'Friendly Ave'],
  [/\bspring\s+garden/i, 'Spring Garden St'],
  [/\bgate\s+city\s+blvd|\b(e|w)?\s*lee\s+st\b/i, 'Gate City Blvd / Lee St'],
  [/\bbenbow\s+rd/i, 'Benbow Rd'],
  [/\bbattleground\s+ave/i, 'Battleground Ave'],
  [/\baycock\s+st/i, 'Aycock St'],
];

export function villageRoadFor(name, map) {
  if (!name) return null;
  for (const [re, road] of ROAD_ALIASES) if (re.test(name) && map.roads.some((r) => r.name === road)) return road;
  return null;
}

function nearestOnPolyline(points, [x, y]) {
  let best = null;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i];
    const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2));
    const q = [x0 + t * dx, y0 + t * dy];
    const d = Math.hypot(q[0] - x, q[1] - y);
    if (!best || d < best.d) best = { d, q, dir: Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v' };
  }
  return best;
}

/**
 * Give an event its spot in the village: { tile: [x, y], on: road name or null, dir: 'h' | 'v' }.
 * Events on a road the village draws snap onto that road. Others keep their projected spot and the
 * village draws a short side street there. Upcoming events with no location get no tile.
 */
export function place(ev, map) {
  const on = villageRoadFor(ev.road, map);
  if (ev.lat == null) return { tile: null, on, dir: null };
  let [x, y] = project(ev.lat, ev.lon);
  let dir = 'h';
  if (on) {
    const road = map.roads.find((r) => r.name === on);
    const n = nearestOnPolyline(road.points, [x, y]);
    [x, y] = n.q;
    dir = n.dir;
  }
  const clamp = (v, hi) => Math.max(1, Math.min(hi - 3, Math.round(v)));
  return { tile: [clamp(x, map.width), clamp(y, map.height)], on, dir };
}

// ---------- fetching ----------

function getter(fetchImpl) {
  return async (path, accept = 'application/json') => {
    const r = await fetchImpl(DRIVENC.base + path, { headers: { 'user-agent': DRIVENC.userAgent, accept, 'x-requested-with': 'XMLHttpRequest' } });
    if (!r.ok) throw new Error(`DriveNC ${path.split('?')[0]}: HTTP ${r.status}`);
    return r.json();
  };
}

async function fetchPublic(get) {
  const rows = [];
  for (let start = 0; start < 5000; start += DRIVENC.pageSize) {
    const q = encodeURIComponent(JSON.stringify({ columns: [], start, length: DRIVENC.pageSize }));
    const page = await get(`/List/GetData/traffic?query=${q}&lang=en-US`);
    rows.push(...(page.data || []));
    if (!page.data?.length || rows.length >= (page.recordsTotal ?? 0)) break;
  }
  const where = new Map();
  // A failed layer would silently drop its events' locations, so fail the whole fetch and keep the last file.
  for (const layer of DRIVENC.layers) {
    const icons = await get(`/map/mapIcons/${layer}`);
    for (const it of icons.item2 || []) where.set(String(it.itemId), it.location);
  }
  return rows.map((r) => fromListRow(r, where.get(String(r.id))));
}

async function fetchKeyed(get, key) {
  const events = await get(`/api/v2/get/event?key=${encodeURIComponent(key)}&format=json`);
  if (!Array.isArray(events)) throw new Error(`DriveNC API: ${events?.Message || 'unexpected response'}`);
  return events.map((e) => fromApiEvent(e));
}

/** Fetch, filter to Greensboro, and place every event on the village map. */
export async function fetchRoads(map, { key = null, fetchImpl = fetch, now = Date.now() } = {}) {
  const get = getter(fetchImpl);
  const all = key ? await fetchKeyed(get, key) : await fetchPublic(get);
  return buildRoads(all, map, { source: key ? 'DriveNC Events API' : 'DriveNC public site', now });
}

export function buildRoads(all, map, { source = 'DriveNC', now = Date.now() } = {}) {
  const known = (name) => villageRoadFor(name, map);
  const events = all
    .filter((ev) => inGreensboro(ev, known))
    .filter((ev) => !ev.end || new Date(ev.end).getTime() > now)
    .map((ev) => ({ ...ev, ...place(ev, map) }))
    .sort((a, b) => a.upcoming - b.upcoming || ['crash', 'closed', 'event', 'work'].indexOf(a.kind) - ['crash', 'closed', 'event', 'work'].indexOf(b.kind));
  return { generatedAt: new Date(now).toISOString(), source, sourceUrl: DRIVENC.base, events };
}

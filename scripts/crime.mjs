// Weekly reported-crime counts per Greensboro Police division, from the City of Greensboro's open data.
//
// Source: "GPD - Crime" points published by the City on its ArcGIS server (OpenData_ES_MS layer 4).
// Public-site rule: crime is only ever shown as a weekly count per police division. We never request
// addresses, coordinates, premises or victim fields, so they can't leak into the site even by accident.

export const SOURCE = {
  name: 'City of Greensboro open data, GPD crime',
  page: 'https://data.greensboro-nc.gov/datasets/gpd-crime',
  query: 'https://gis.greensboro-nc.gov/arcgis/rest/services/OpenGateCity/OpenData_ES_MS/MapServer/4/query',
};

// The only fields we ever ask for.
export const FIELDS = ['inci_id', 'district', 'ibr_code', 'date_rept'];

// GPD's four patrol divisions. The area words come from where each division's incidents cluster
// relative to downtown (worked out from the data's own coordinates), so treat them as rough.
export const DIVISIONS = [
  { id: 'GPD1', name: 'Division 1', area: 'west' },
  { id: 'GPD2', name: 'Division 2', area: 'south' },
  { id: 'GPD3', name: 'Division 3', area: 'southwest' },
  { id: 'GPD4', name: 'Division 4', area: 'north' },
];

// NIBRS offense codes -> three plain buckets. An incident with several offenses counts once,
// under its most serious bucket (violent, then property, then other).
const VIOLENT = new Set(['09A', '09B', '09C', '100', '11A', '11B', '11C', '11D', '120', '13A', '64A', '64B']);
const PROPERTY = /^(200|210|220|23[A-H]|240|250|26[A-H]|270|280|290|510)$/;
export function bucket(code) {
  const c = String(code || '').trim().toUpperCase();
  if (VIOLENT.has(c)) return 'violent';
  if (PROPERTY.test(c)) return 'property';
  return 'other';
}
const RANK = { violent: 0, property: 1, other: 2 };

// ---------- weeks (Monday to Sunday, Greensboro time) ----------
const TZ = 'America/New_York';

// UTC instant of midnight Eastern on a YYYY-MM-DD day.
export function etMidnight(day) {
  const guess = new Date(`${day}T05:00:00Z`); // EST midnight; fix up for EDT below
  const hour = +guess.toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }) % 24;
  return new Date(guess.getTime() - hour * 3600e3);
}
const etDay = (d) => d.toLocaleDateString('en-CA', { timeZone: TZ });
function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// The last full Monday-Sunday week that ended on or before `anchor`, and the week before it.
// `back` steps further back by whole Eastern calendar weeks (not fixed hours, so DST can't skip a week).
export function weeksEndingBy(anchor, back = 0) {
  const today = etDay(anchor);
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  // If the anchor is Sunday the week isn't finished yet, so step back to the Sunday before.
  const lastSunday = addDays(today, (dow === 0 ? -7 : -dow) - 7 * back);
  const thisStart = addDays(lastSunday, -6);
  const prevStart = addDays(thisStart, -7);
  return {
    thisWeek: { start: thisStart, end: lastSunday },
    lastWeek: { start: prevStart, end: addDays(thisStart, -1) },
  };
}

// ArcGIS wants UTC timestamps in its SQL dialect.
const sqlTime = (d) => `timestamp '${d.toISOString().slice(0, 19).replace('T', ' ')}'`;
export function whereBetween(startDay, endDayInclusive) {
  return `date_rept >= ${sqlTime(etMidnight(startDay))} AND date_rept < ${sqlTime(etMidnight(addDays(endDayInclusive, 1)))}`;
}

// ---------- counting ----------
// rows: [{ inci_id, district, ibr_code }]. Returns counts of distinct incidents per division.
export function countWeek(rows) {
  const incidents = new Map(); // inci_id -> { district, bucket }
  for (const r of rows) {
    if (!r.inci_id) continue;
    const b = bucket(r.ibr_code);
    const prev = incidents.get(r.inci_id);
    if (!prev) incidents.set(r.inci_id, { district: (r.district || '').trim(), bucket: b });
    else if (RANK[b] < RANK[prev.bucket]) prev.bucket = b;
  }
  const blank = () => ({ total: 0, violent: 0, property: 0, other: 0 });
  const byDivision = Object.fromEntries(DIVISIONS.map((d) => [d.id, blank()]));
  const outside = blank(); // sheriff, other towns' police, or no district recorded
  const city = blank();
  for (const { district, bucket: b } of incidents.values()) {
    const t = byDivision[district] || outside;
    t.total++; t[b]++;
    city.total++; city[b]++;
  }
  return { byDivision, outside, city };
}

export function buildReport({ thisRows, lastRows, weeks, latestReport, skipped = 0, now = new Date() }) {
  const a = countWeek(thisRows), b = countWeek(lastRows);
  const staleDays = latestReport ? Math.floor((now - latestReport) / 86400e3) : null;
  return {
    generatedAt: now.toISOString(),
    source: { name: SOURCE.name, url: SOURCE.page },
    note: 'Reported incidents per police division, counted once each. No addresses or locations.',
    latestReport: latestReport ? latestReport.toISOString() : null,
    // The City's feed sometimes stops updating. Anything older than two weeks is flagged so the page can say so.
    stale: staleDays == null || staleDays > 14,
    skippedIncompleteWeeks: skipped,
    thisWeek: weeks.thisWeek,
    lastWeek: weeks.lastWeek,
    divisions: DIVISIONS.map((d) => ({ ...d, thisWeek: a.byDivision[d.id], lastWeek: b.byDivision[d.id] })),
    outsideGPD: { thisWeek: a.outside, lastWeek: b.outside },
    city: { thisWeek: a.city, lastWeek: b.city },
  };
}

// counts: weekly totals, newest first. How many of the newest weeks look incomplete (0, 1 or 2).
export function weeksToSkip(counts, ratio = 0.6) {
  let skip = 0;
  while (skip < 2) {
    const base = counts.slice(skip + 1, skip + 5).filter((n) => n > 0).sort((a, b) => a - b);
    if (base.length < 2) break;
    const median = base[base.length >> 1];
    if (counts[skip] >= ratio * median) break;
    skip++;
  }
  return skip;
}

// ---------- fetching ----------
async function query(params, fetchImpl) {
  const url = `${SOURCE.query}?${new URLSearchParams({ f: 'json', ...params })}`;
  const r = await fetchImpl(url, { headers: { 'User-Agent': 'gso-village (community data map)' } });
  if (!r.ok) throw new Error(`City GIS ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`City GIS: ${j.error.message}`);
  return j;
}

async function rowsBetween(week, fetchImpl) {
  const rows = [];
  for (let offset = 0; ; offset += 2000) {
    const j = await query({
      where: whereBetween(week.start, week.end),
      outFields: FIELDS.join(','),
      returnGeometry: 'false',
      orderByFields: 'OBJECTID',
      resultOffset: String(offset),
      resultRecordCount: '2000',
    }, fetchImpl);
    rows.push(...j.features.map((f) => f.attributes));
    if (!j.exceededTransferLimit && j.features.length < 2000) return rows;
  }
}

export async function fetchCrime({ now = new Date(), fetchImpl = fetch } = {}) {
  const stats = await query({
    where: '1=1',
    outStatistics: JSON.stringify([{ statisticType: 'max', onStatisticField: 'date_rept', outStatisticFieldName: 'latest' }]),
  }, fetchImpl);
  const latestMs = stats.features?.[0]?.attributes?.latest;
  const latestReport = latestMs ? new Date(latestMs) : null;
  // Count the last full week the City has actually published, so a paused feed shows real numbers, labeled with their dates.
  const anchor = latestReport && latestReport < now ? latestReport : now;
  // Records arrive in batches, so the newest week can be half-filled. Step back past any week whose
  // count is well under the weeks before it (at most twice), rather than show a misleading drop.
  const count = async (w) => (await query({ where: whereBetween(w.start, w.end), returnCountOnly: 'true' }, fetchImpl)).count;
  const recent = [];
  for (let k = 0; k < 6; k++) recent.push(await count(weeksEndingBy(anchor, k).thisWeek));
  const skip = weeksToSkip(recent);
  const weeks = weeksEndingBy(anchor, skip);
  const [thisRows, lastRows] = await Promise.all([rowsBetween(weeks.thisWeek, fetchImpl), rowsBetween(weeks.lastWeek, fetchImpl)]);
  return buildReport({ thisRows, lastRows, weeks, latestReport, skipped: skip, now });
}

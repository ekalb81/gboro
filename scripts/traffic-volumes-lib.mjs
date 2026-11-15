// Reading NCDOT's annual average daily traffic (AADT) count stations from its public ArcGIS services.
// NCDOT publishes one figure per station per year: the vehicles passing in both directions on an average day.
// The services have changed names and added a field per year over time, so nothing here depends on one exact
// layer or field name: the newest year with a number wins.

export const ORG = 'https://services.arcgis.com/NuWFvHYDMVmmxMeM/ArcGIS/rest/services';
// Station layers seen under NCDOT's account; any others whose name mentions AADT are found from the service list.
export const KNOWN = ['NCDOT_AADT_Stations', 'NCDOT_AADT_Traffic_Segmentation', 'AADT'];

/** The newest AADT in a station's attributes: { aadt, year } or null. Handles AADT_2023, AADT2023, and AADT + a year field. */
export function pickAadt(attrs) {
  let best = null;
  for (const [k, v] of Object.entries(attrs || {})) {
    const m = /^AADT_?((?:19|20)\d{2})$/i.exec(k);
    const n = Number(v);
    if (!m || v == null || v === '' || !Number.isFinite(n) || n <= 0) continue;
    if (!best || +m[1] > best.year) best = { aadt: Math.round(n), year: +m[1] };
  }
  if (best) return best;
  const key = Object.keys(attrs || {}).find((k) => /^(AADT|CURRENT_AADT|AADT_CURRENT)$/i.test(k));
  const n = key ? Number(attrs[key]) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  const yk = Object.keys(attrs).find((k) => /^(AADT_?YEAR|YEAR_?|COUNT_?YEAR|YR)$/i.test(k));
  return { aadt: Math.round(n), year: yk && Number(attrs[yk]) > 1900 ? Number(attrs[yk]) : null };
}

const NAME_KEYS = /^(ROUTE|RTE_?NAME|ROUTE_?NAME|STREET|STREET_?NAME|LOCATION|LOC_?DESC|DESCRIPTION|ROAD_?NAME)$/i;
/** Stations from one ArcGIS query answer (f=json, outSR=4326, point geometry). Stations without a count are dropped. */
export function toStations(json) {
  const out = [];
  for (const f of json?.features || []) {
    const g = f.geometry, a = f.attributes || {};
    if (!g || !Number.isFinite(g.x) || !Number.isFinite(g.y)) continue;
    const c = pickAadt(a);
    if (!c) continue;
    const nk = Object.keys(a).find((k) => NAME_KEYS.test(k) && typeof a[k] === 'string' && a[k].trim());
    out.push({ lat: +g.y.toFixed(6), lon: +g.x.toFixed(6), aadt: c.aadt, year: c.year, name: nk ? a[nk].trim() : null });
  }
  return out;
}

/** The query for every station in a box, as a URL on a layer. */
export function queryUrl(layerUrl, { west, south, east, north }) {
  const q = new URLSearchParams({
    where: '1=1', geometry: `${west},${south},${east},${north}`, geometryType: 'esriGeometryEnvelope', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', outFields: '*', returnGeometry: 'true', outSR: '4326', f: 'json',
  });
  return `${layerUrl}/query?${q}`;
}

/** Of several layers' stations, the set with the newest counts (and, on a tie, the most stations). */
export function bestSet(sets) {
  const score = (s) => [Math.max(0, ...s.stations.map((x) => x.year || 0)), s.stations.length];
  return sets.filter((s) => s.stations.length).sort((a, b) => { const [ya, na] = score(a), [yb, nb] = score(b); return yb - ya || nb - na; })[0] || null;
}

// Fetch NCDOT's average daily traffic counts for the streets on the downtown model and write
// public/data/traffic-volumes.json. The model uses them to decide how many cars each street carries
// (public/activity.js spreads a day's traffic over the hours).
// Usage: node scripts/fetch-traffic-volumes.mjs [--if-older-than=HOURS]
//
// The counts are yearly figures, so the publish workflow refreshes them about once a week. No key is needed.
// If NCDOT doesn't answer, the previous file is left alone; with no file at all the model falls back to a
// figure typical of each street's class.

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORG, KNOWN, toStations, queryUrl, bestSet } from './traffic-volumes-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'data', 'traffic-volumes.json');
const maxAgeH = Number(process.argv.slice(2).find((a) => a.startsWith('--if-older-than='))?.split('=')[1]);
if (maxAgeH) {
  const prev = await readFile(out, 'utf8').then(JSON.parse, () => null);
  const ageH = prev ? (Date.now() - new Date(prev.generatedAt).getTime()) / 3600e3 : Infinity;
  if (ageH < maxAgeH) { console.log(`traffic-volumes.json is ${ageH.toFixed(0)}h old (${prev.stations.length} stations); refreshing after ${maxAgeH}h.`); process.exit(0); }
}

const UA = { 'user-agent': 'gso-village/0.1 (community map of Greensboro; github.com/ekalb81/gboro)' };
async function getJson(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30e3) });
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).pathname}`);
  const j = await r.json();
  if (j.error) throw new Error(`${j.error.message || 'error'} from ${new URL(url).pathname}`);
  return j;
}

// the model's box, with a margin so a station just past the edge still counts for its street
const G = JSON.parse(await readFile(join(root, 'public', 'model', 'downtown.json'), 'utf8')).GEO;
const box = { west: G.west - 0.002, east: G.east + 0.002, south: G.south - 0.002, north: G.north + 0.002 };

try {
  // every service under NCDOT's account that mentions AADT, the known ones first
  const listed = await getJson(`${ORG}?f=json`).then((j) => (j.services || []).filter((s) => /aadt/i.test(s.name) && /FeatureServer|MapServer/.test(s.type)).map((s) => `${s.name}/${s.type}`), () => []);
  const services = [...new Set([...KNOWN.map((n) => `${n}/FeatureServer`), ...listed])].slice(0, 12);
  const sets = [];
  for (const svc of services) {
    try {
      const info = await getJson(`${ORG}/${svc}?f=json`);
      for (const layer of (info.layers || []).filter((l) => !l.geometryType || l.geometryType === 'esriGeometryPoint').slice(0, 4)) {
        const url = `${ORG}/${svc}/${layer.id}`;
        const stations = toStations(await getJson(queryUrl(url, box)).catch(() => null));
        if (stations.length) sets.push({ url, layer: layer.name, stations });
      }
    } catch (e) { console.log(`  skipped ${svc}: ${e.message}`); }
  }
  const best = bestSet(sets);
  if (!best) throw new Error(`no AADT stations found in the downtown box (${services.length} services tried)`);
  const year = Math.max(0, ...best.stations.map((s) => s.year || 0)) || null;
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify({ generatedAt: new Date().toISOString(), source: 'NCDOT annual average daily traffic (AADT) stations', layer: best.url, year, stations: best.stations }, null, 1));
  console.log(`Traffic volumes: ${best.stations.length} NCDOT stations downtown from ${best.layer || best.url}${year ? `, counts to ${year}` : ''}.`);
} catch (e) {
  console.warn(`Traffic volumes fetch failed, keeping the last traffic-volumes.json if there is one: ${e.message}`);
  process.exitCode = 1;
}

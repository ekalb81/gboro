// Fetch Greensboro restaurants, bars, cafes and breweries from OpenStreetMap and write public/data/eats.json.
// Usage: node scripts/fetch-eats.mjs [--source=overpass|osm-api] [--keep-chains]
//
// overpass (default): one query to the Overpass API, the right tool for reading OSM data.
// osm-api: tiles of the main OSM API's /map call around each hub. Only for networks that block Overpass;
//          it downloads whole map tiles, so use it sparingly (it's OSM's editing API).

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HUBS, toPlace } from './eats-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const source = [...args].find((a) => a.startsWith('--source='))?.split('=')[1] || 'overpass';
const keepChains = args.has('--keep-chains');
const UA = { 'user-agent': 'gso-village/0.1 (community map of Greensboro; github.com/ekalb81/gboro)' };

// A box around every hub's radius.
const box = (() => {
  const pad = (h) => [h.radius / 111320, h.radius / (111320 * Math.cos((h.lat * Math.PI) / 180))];
  let s = 90, w = 180, n = -90, e = -180;
  for (const h of HUBS) { const [dl, dn] = pad(h); s = Math.min(s, h.lat - dl); n = Math.max(n, h.lat + dl); w = Math.min(w, h.lon - dn); e = Math.max(e, h.lon + dn); }
  return { s, w, n, e };
})();

async function fromOverpass() {
  const bb = `${box.s},${box.w},${box.n},${box.e}`;
  const q = `[out:json][timeout:90];(
    nwr["amenity"~"^(restaurant|food_court|fast_food|cafe|ice_cream|bar|pub|biergarten|nightclub)$"]["name"](${bb});
    nwr["craft"~"^(brewery|distillery|winery)$"]["name"](${bb});
  );out center tags;`;
  const mirrors = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  let last;
  for (const url of mirrors) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { ...UA, 'content-type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(120e3) });
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return (await r.json()).elements;
    } catch (e) { last = e; console.warn(`  ${url} failed: ${e.message}`); }
  }
  throw new Error(`Overpass unreachable (${last?.message}). On a network that blocks it, try --source=osm-api.`);
}

async function fromOsmApi() {
  const STEP = 0.012; // degrees; keeps each /map call well under the API's node limit downtown
  const tiles = new Set();
  for (const h of HUBS) {
    const dl = h.radius / 111320, dn = h.radius / (111320 * Math.cos((h.lat * Math.PI) / 180));
    for (let la = Math.floor((h.lat - dl) / STEP); la * STEP < h.lat + dl; la++)
      for (let lo = Math.floor((h.lon - dn) / STEP); lo * STEP < h.lon + dn; lo++) tiles.add(`${la},${lo}`);
  }
  const byId = new Map();
  let i = 0;
  for (const key of tiles) {
    const [la, lo] = key.split(',').map(Number);
    const url = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${(lo * STEP).toFixed(4)},${(la * STEP).toFixed(4)},${((lo + 1) * STEP).toFixed(4)},${((la + 1) * STEP).toFixed(4)}`;
    process.stdout.write(`\r  tile ${++i}/${tiles.size}`);
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(120e3) });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    const els = (await r.json()).elements;
    const nodes = new Map(els.filter((x) => x.type === 'node').map((x) => [x.id, x]));
    for (const el of els) {
      if (!el.tags?.name || byId.has(`${el.type}${el.id}`)) continue;
      if (el.type === 'way') {
        const pts = el.nodes.map((n) => nodes.get(n)).filter(Boolean);
        if (!pts.length) continue;
        el.center = { lat: pts.reduce((a, p) => a + p.lat, 0) / pts.length, lon: pts.reduce((a, p) => a + p.lon, 0) / pts.length };
      } else if (el.type !== 'node') continue;
      byId.set(`${el.type}${el.id}`, el);
    }
    await new Promise((res) => setTimeout(res, 1000)); // be polite
  }
  process.stdout.write('\n');
  return [...byId.values()];
}

const elements = source === 'osm-api' ? await fromOsmApi() : await fromOverpass();
const places = [];
const skipped = {};
const seen = new Set();
for (const el of elements) {
  const { place, skip } = toPlace(el, { keepChains });
  if (skip) { skipped[skip] = (skipped[skip] || 0) + 1; continue; }
  const key = `${place.name.toLowerCase()}|${place.x}|${place.y}`; // same place mapped as node and building
  if (seen.has(key)) continue;
  seen.add(key);
  places.push(place);
}
places.sort((a, b) => a.hub.localeCompare(b.hub) || a.name.localeCompare(b.name));

await mkdir(join(root, 'public', 'data'), { recursive: true });
await writeFile(join(root, 'public', 'data', 'eats.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  source,
  attribution: '© OpenStreetMap contributors, ODbL',
  places,
}, null, 1));

const kinds = places.reduce((m, p) => ((m[p.kind] = (m[p.kind] || 0) + 1), m), {});
const withHours = places.filter((p) => p.hours).length;
console.log(`${places.length} places (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')}); ${withHours} with readable hours.`);
console.log(`Skipped: ${Object.entries(skipped).map(([k, n]) => `${n} ${k}`).join(', ') || 'none'}.`);

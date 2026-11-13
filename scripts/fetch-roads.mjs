// Fetch Greensboro road closures, roadwork and crashes from NCDOT DriveNC and write public/data/roads.json.
// Usage: node scripts/fetch-roads.mjs
// Set DRIVENC_KEY to use the official DriveNC Events API; without it the public site's feeds are used.
// On failure the previous roads.json is left alone.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchRoads } from './roads.mjs';

const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
const out = join(pub, 'roads.json');

try {
  const map = JSON.parse(await readFile(join(pub, 'map.json'), 'utf8'));
  const roads = await fetchRoads(map, { key: process.env.DRIVENC_KEY || null });
  await mkdir(pub, { recursive: true });
  await writeFile(out, JSON.stringify(roads, null, 2));
  const live = roads.events.filter((e) => !e.upcoming);
  const count = (k) => live.filter((e) => e.kind === k).length;
  console.log(`Roads (${roads.source}): ${live.length} in Greensboro now (${count('closed') + count('event')} closed, ${count('work')} roadwork, ${count('crash')} crashes), ${roads.events.length - live.length} coming up.`);
} catch (e) {
  console.warn(`Roads fetch failed, keeping the last roads.json: ${e.message}`);
  process.exitCode = 1;
}

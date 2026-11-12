// Fetch weekly crime counts per GPD division and write public/data/crime.json.
// Usage: node scripts/fetch-crime.mjs
// On failure the previous crime.json is left alone.

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchCrime } from './crime.mjs';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'crime.json');

try {
  const c = await fetchCrime();
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(c, null, 2));
  const per = c.divisions.map((d) => `${d.name} ${d.thisWeek.total} (last week ${d.lastWeek.total})`).join(', ');
  console.log(`Crime, week of ${c.thisWeek.start}: ${c.city.thisWeek.total} incidents citywide. ${per}.`);
  if (c.stale) console.warn(`Note: the City's feed was last updated ${c.latestReport?.slice(0, 10) ?? 'never'}, so these are its latest published weeks.`);
} catch (e) {
  console.warn(`Crime fetch failed, keeping the last crime.json: ${e.message}`);
  process.exitCode = 1;
}

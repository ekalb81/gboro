// Fetch crime counts and write public/data/crime.json. Two independent parts:
//   - weekly counts per GPD division from the City's open data (no key)
//   - monthly citywide counts from the FBI Crime Data Explorer (needs FBI_API_KEY, a free api.data.gov key)
// Usage: node scripts/fetch-crime.mjs
// If one part fails, its last good copy in crime.json is kept and the other part still updates.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchCrime } from './crime.mjs';
import { fetchFbiMonthly } from './crime-fbi.mjs';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'crime.json');
let previous = {};
try { previous = JSON.parse(await readFile(out, 'utf8')); } catch { /* first run */ }

let city = null, monthly = previous.monthly ?? null, failures = 0;

try {
  city = await fetchCrime();
  const per = city.divisions.map((d) => `${d.name} ${d.thisWeek.total} (week before ${d.lastWeek.total})`).join(', ');
  console.log(`City, week of ${city.thisWeek.start}: ${city.city.thisWeek.total} incidents. ${per}.`);
  if (city.stale) console.warn(`  The City's feed was last updated ${city.latestReport?.slice(0, 10) ?? 'never'}.`);
} catch (e) {
  console.warn(`City crime fetch failed, keeping the last copy: ${e.message}`);
  failures++;
}

if (process.env.FBI_API_KEY) {
  try {
    monthly = await fetchFbiMonthly({ apiKey: process.env.FBI_API_KEY });
    if (monthly) console.log(`FBI, ${monthly.thisMonth.month}: ${monthly.thisMonth.total} offenses (month before ${monthly.lastMonth.total}).`);
    else console.warn('FBI: no complete month found, keeping the last copy.');
    monthly ??= previous.monthly ?? null;
  } catch (e) {
    console.warn(`FBI crime fetch failed, keeping the last copy: ${e.message}`);
    failures++;
  }
} else {
  console.warn('FBI_API_KEY is not set, skipping monthly citywide counts.');
}

const report = { ...(city ?? previous), generatedAt: new Date().toISOString(), monthly };
if (report.divisions || report.monthly) {
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2));
}
if (failures) process.exitCode = 1;

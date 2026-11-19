// Fetch crime counts and write public/data/crime.json. Two independent parts:
//   - weekly counts per GPD division from the City's open data (no key)
//   - monthly citywide counts from the FBI Crime Data Explorer (needs FBI_API_KEY, a free api.data.gov key)
// Usage: node scripts/fetch-crime.mjs [--if-older-than=HOURS]
// If one part fails, its last good copy in crime.json is kept and the other part still updates.
//
// --if-older-than: do nothing if both parts were last fetched without a failure less than HOURS ago. The City
// counts by the week and the FBI by the month, so the publish run, which starts several times an hour, asks a
// few times a day. A run where a part failed does not count, so the next run tries again.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchCrime } from './crime.mjs';
import { fetchFbiMonthly } from './crime-fbi.mjs';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'crime.json');
let previous = {};
try { previous = JSON.parse(await readFile(out, 'utf8')); } catch { /* first run */ }

const maxAgeH = Number(process.argv.slice(2).find((a) => a.startsWith('--if-older-than='))?.split('=')[1]);
if (maxAgeH) {
  const ageH = previous.fetchedAt ? (Date.now() - new Date(previous.fetchedAt).getTime()) / 3600e3 : Infinity;
  if (ageH >= 0 && ageH < maxAgeH) {
    console.log(`crime.json was fetched ${ageH.toFixed(1)}h ago; asking again after ${maxAgeH}h.`);
    process.exit(0);
  }
}

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

// fetchedAt marks the last run where nothing failed; --if-older-than goes by it.
const now = new Date().toISOString();
const report = { ...(city ?? previous), generatedAt: now, fetchedAt: failures ? previous.fetchedAt : now, monthly };
if (report.divisions || report.monthly) {
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2));
}
if (failures) process.exitCode = 1;

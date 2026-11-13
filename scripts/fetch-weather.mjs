// Fetch Greensboro's current weather and active alerts from the NWS and write public/data/weather.json.
// Usage: node scripts/fetch-weather.mjs
// On failure the previous weather.json is left alone, so the village keeps its last known sky.

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchWeather } from './weather.mjs';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'weather.json');

try {
  const w = await fetchWeather();
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(w, null, 2));
  console.log(`Weather: ${w.tempF ?? '?'}°F, ${w.text ?? 'no description'} (${w.sky}, ${w.precip}), ${w.alerts.length} alert(s).`);
} catch (e) {
  console.warn(`Weather fetch failed, keeping the last weather.json: ${e.message}`);
  process.exitCode = 1;
}

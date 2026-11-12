// Council meetings and city events -> public/data/civic.json.
// Reads iCalendar files saved in data/civic/*.ics, fetches any feed URLs in data/civic-config.json,
// and fills in the usual council schedule. Usage: node scripts/civic.mjs [extra.ics ...]

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseICS, eventsToItems, usualMeetings, mergeCivic, upcoming } from './civic-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(join(root, 'data', 'civic-config.json'), 'utf8'));
const icsDir = join(root, 'data', 'civic');
await mkdir(icsDir, { recursive: true });

const sources = [];
const files = [...(await readdir(icsDir)).filter((f) => f.endsWith('.ics')).map((f) => join(icsDir, f)), ...process.argv.slice(2)];
for (const f of files) sources.push({ name: basename(f), text: await readFile(f, 'utf8') });
for (const url of config.feeds || []) {
  try {
    const r = await fetch(url, { headers: { accept: 'text/calendar' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    sources.push({ name: url, text: await r.text() });
  } catch (e) {
    console.warn(`  ${url}: ${e.message}. Skipping it; saved .ics files and the usual schedule still count.`);
  }
}

let feedItems = [];
for (const s of sources) {
  const events = parseICS(s.text);
  const items = eventsToItems(events, { defaultUrl: config.url });
  console.log(`  ${s.name}: ${events.length} events, ${items.length} usable`);
  feedItems.push(...items);
}

const usual = usualMeetings(config);
const items = upcoming(mergeCivic(feedItems, usual));
const fromUsual = items.filter((it) => it.scheduled === 'usual').length;

await mkdir(join(root, 'public', 'data'), { recursive: true });
await writeFile(join(root, 'public', 'data', 'civic.json'), JSON.stringify({ generatedAt: new Date().toISOString(), sources: sources.length, items }, null, 2));
console.log(`${items.length} upcoming civic items (${items.length - fromUsual} from calendars, ${fromUsual} from the usual council schedule).`);

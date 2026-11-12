// Council meetings and city events -> public/data/civic.json. Runs unattended (publish workflow).
// - Council and subcommittee dates from the City's published yearly schedule in data/civic-config.json
//   (the usual 1st/3rd Tuesday rule only for years the City hasn't published yet).
// - The City's YouTube feed: meeting recordings and the weekly "On the Town" events video.
// - Optional extra calendars: .ics files in data/civic/ and feed URLs in the config.
// Usage: node scripts/civic.mjs [extra.ics ...]

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseICS, eventsToItems, usualMeetings, mergeCivic, upcoming, parseYouTube, applyVideos } from './civic-lib.mjs';

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

let videos = [];
if (config.youtube) {
  try {
    const r = await fetch(config.youtube);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    videos = parseYouTube(await r.text());
    console.log(`  City YouTube: ${videos.length} videos`);
  } catch (e) {
    console.warn(`  City YouTube: ${e.message}. Carrying on without recordings.`);
  }
}

const RECENT = 7;
const scheduled = usualMeetings(config, new Date(), 45, RECENT);
const items = upcoming(applyVideos(mergeCivic(feedItems, scheduled), videos), new Date(), 45, RECENT);
const count = (k) => items.filter((it) => it.scheduled === k).length;
const year = new Date().getFullYear();
if (!config.schedules?.[year + 1] && new Date().getMonth() >= 11) {
  console.log(`::notice title=Council schedule::The City's ${year + 1} council schedule isn't in data/civic-config.json yet; using the usual 1st and 3rd Tuesday rule for ${year + 1}.`);
}

await mkdir(join(root, 'public', 'data'), { recursive: true });
await writeFile(join(root, 'public', 'data', 'civic.json'), JSON.stringify({ generatedAt: new Date().toISOString(), sources: sources.length, items }, null, 2));
console.log(`${items.length} civic items: ${count('published')} from the City's published schedule, ${count('usual')} from the usual rule, ${items.filter((it) => it.recording).length} with recordings, ${items.length - count('published') - count('usual')} from calendars and videos.`);

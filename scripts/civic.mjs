// Council meetings and city events -> public/data/civic.json. Runs unattended (publish workflow).
// - Council and subcommittee dates from the City's published yearly schedule in data/civic-config.json
//   (the usual 1st/3rd Tuesday rule only for years the City hasn't published yet).
// - The City's YouTube feed: meeting recordings and the weekly "On the Town" events video.
// - Changes during the year: cancelled, moved, special meetings and work sessions reported by the City's
//   own posts (Muse digest) and verified local news (RSS), read from data/raw/ after those collectors run.
// - Checks: a scheduled meeting with no recording a few days later, or a recording with no scheduled
//   meeting, is reported as a warning in the run log.
// - Optional extra calendars: .ics files in data/civic/ and feed URLs in the config.
// Usage: node scripts/civic.mjs [extra.ics ...]

import { readdir, readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseICS, eventsToItems, usualMeetings, mergeCivic, upcoming, parseYouTube, applyVideos, councilSignals, applySignals, checkRecordings } from './civic-lib.mjs';
import { parseDigest } from './lib.mjs';

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

// YouTube's feeds sometimes answer 404 for a while, so retry, and fall back to the last good copy
// (data/civic/youtube.xml, kept between runs by the publish workflow's cache; public videos only).
let videos = [];
let videosFresh = false;
const ytCache = join(icsDir, 'youtube.xml');
if (config.youtube) {
  let xml = null;
  const urls = [].concat(config.youtube);
  for (let i = 0; i < 3 * urls.length && !xml; i++) {
    try {
      const r = await fetch(urls[i % urls.length], { signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      xml = await r.text();
      videosFresh = true;
      await writeFile(ytCache, xml);
    } catch (e) {
      console.warn(`  City YouTube try ${i + 1}: ${e.message}`);
      if (i < 3 * urls.length - 1) await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
    }
  }
  if (!xml) {
    try { xml = await readFile(ytCache, 'utf8'); console.warn('  City YouTube: using the last good copy.'); } catch { console.warn('  City YouTube: no copy yet; carrying on without recordings.'); }
  }
  if (xml) {
    videos = parseYouTube(xml);
    console.log(`  City YouTube: ${videos.length} videos${videosFresh ? '' : ' (last good copy)'}`);
  }
}

// Digest and news items already collected this run (ITEM lines in data/raw/).
const rawDir = join(root, 'data', 'raw');
const reported = [];
try {
  for (const f of (await readdir(rawDir)).filter((f) => f.endsWith('.txt'))) reported.push(...parseDigest(await readFile(join(rawDir, f), 'utf8')).items);
} catch { /* no digests or news this run */ }
const { signals, undated } = councilSignals(reported);
console.log(`  Digests and news: ${reported.length} items, ${signals.length} about council meeting dates`);

const RECENT = 7;
const notices = [];
const scheduled = usualMeetings(config, new Date(), 45, RECENT);
const all = applyVideos(applySignals(mergeCivic(feedItems, scheduled), signals, config, notices), videos, notices);
if (videosFresh) notices.push(...checkRecordings(all, new Date())); // only trust "no recording" when the feed answered
for (const u of undated) notices.push(`Possible council schedule change with no date in the headline: "${u.title}" (${u.url}).`);
const items = upcoming(all, new Date(), 45, RECENT);
const count = (k) => items.filter((it) => it.scheduled === k).length;
const year = new Date().getFullYear();
if (!config.schedules?.[year + 1] && new Date().getMonth() >= 11) {
  console.log(`::notice title=Council schedule::The City's ${year + 1} council schedule isn't in data/civic-config.json yet; using the usual 1st and 3rd Tuesday rule for ${year + 1}.`);
}

await mkdir(join(root, 'public', 'data'), { recursive: true });
await writeFile(join(root, 'public', 'data', 'civic.json'), JSON.stringify({ generatedAt: new Date().toISOString(), sources: sources.length, items }, null, 2));
for (const n of notices) console.log(`::warning title=Council schedule::${n}`);
if (notices.length && process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Council schedule checks\n\n${notices.map((n) => `- ${n}`).join('\n')}\n`);
console.log(`${items.length} civic items: ${count('published')} from the City's published schedule, ${count('usual')} from the usual rule, ${items.filter((it) => it.recording).length} with recordings, ${count('reported')} reported by news, the City or its videos, ${notices.length} warnings.`);

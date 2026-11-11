// Read saved Muse digests from data/raw/*.txt and write public/data/items.json.
// Usage: node scripts/ingest.mjs [rawDir]

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDigest, locate, applyRules } from './lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = process.argv[2] || join(root, 'data', 'raw');

await mkdir(rawDir, { recursive: true });
const files = (await readdir(rawDir)).filter((f) => f.endsWith('.txt')).sort();
if (!files.length) console.warn(`No digests in ${rawDir}. Save Muse digest emails there as .txt files.`);
const byUrl = new Map();
let problems = 0;

for (const f of files) {
  const { items, problems: p } = parseDigest(await readFile(join(rawDir, f), 'utf8'), basename(f, '.txt'));
  for (const x of p) console.warn(`  ${f}: skipped line (${x.reason})`);
  problems += p.length;
  for (const it of items) byUrl.set(it.url, { ...it, district: locate(it) }); // later digests win
}

const { show, held } = applyRules([...byUrl.values()]);
show.sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999'));

await mkdir(join(root, 'public', 'data'), { recursive: true });
await writeFile(
  join(root, 'public', 'data', 'items.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), digests: files.length, items: show }, null, 2),
);
// Held items stay out of public/ so they never get served.
await writeFile(join(root, 'data', 'held.json'), JSON.stringify(held, null, 2));

console.log(`${files.length} digests, ${byUrl.size} unique items: ${show.length} shown, ${held.length} held, ${problems} bad lines.`);

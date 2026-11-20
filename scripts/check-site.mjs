// Check that public/ is fit to publish: every page and data file the site needs is there and parses, and
// nothing private is in it. Used by the publish workflow just before the deploy, and by the pull request checks.
//
// Usage: node scripts/check-site.mjs [publicDir]

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const REQUIRED = ['index.html', 'village.js', 'data/map.json', 'data/items.json', 'model/downtown.json'];

// Held items and raw digests name private people and must never be published.
export const isPrivate = (name) => name === 'held.json' || name.endsWith('.txt');

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

// Problems stop the deploy. Warnings do not: one source's broken file should not hold back the others.
export async function checkSite(pub = join(root, 'public')) {
  const problems = [];
  const warnings = [];
  for (const f of REQUIRED) {
    const size = await stat(join(pub, f)).then((s) => s.size, () => 0);
    if (!size) problems.push(`${f} is missing or empty`);
  }
  for (const p of await walk(pub).catch(() => [])) {
    const rel = relative(pub, p).replaceAll('\\', '/');
    if (isPrivate(rel.split('/').pop())) problems.push(`private data in public/: ${rel}`);
    if (rel.endsWith('.json')) {
      try {
        JSON.parse(await readFile(p, 'utf8'));
      } catch (e) {
        (REQUIRED.includes(rel) ? problems : warnings).push(`${rel} is not valid JSON (${e.message})`);
      }
    }
  }
  return { problems, warnings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { problems, warnings } = await checkSite(process.argv[2]);
  for (const w of warnings) console.log(`::warning::${w}`);
  for (const p of problems) console.log(`::error::${p}`);
  if (problems.length) process.exit(1);
  console.log('public/ has its files and nothing private.');
}

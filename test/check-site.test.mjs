import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSite, REQUIRED } from '../scripts/check-site.mjs';

async function site(extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'site-'));
  const files = { ...Object.fromEntries(REQUIRED.map((f) => [f, f.endsWith('.json') ? '{}' : 'x'])), ...extra };
  for (const [f, text] of Object.entries(files)) {
    await mkdir(join(dir, f, '..'), { recursive: true });
    await writeFile(join(dir, f), text);
  }
  return dir;
}

test('a complete site passes, and a missing or empty page stops the deploy', async () => {
  const good = await site();
  const bad = await site({ 'index.html': '' });
  try {
    assert.deepEqual(await checkSite(good), { problems: [], warnings: [] });
    assert.deepEqual((await checkSite(bad)).problems, ['index.html is missing or empty']);
  } finally {
    await rm(good, { recursive: true });
    await rm(bad, { recursive: true });
  }
});

test('held items or raw digests in public/ stop the deploy', async () => {
  const dir = await site({ 'data/held.json': '[]', 'data/raw/2026-11-17T1002Z.txt': 'ITEM | a' });
  try {
    assert.equal((await checkSite(dir)).problems.length, 2);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('broken JSON stops the deploy only in a file the site cannot do without', async () => {
  const dir = await site({ 'data/weather.json': '{', 'data/items.json': '{' });
  try {
    const { problems, warnings } = await checkSite(dir);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /^data\/items\.json is not valid JSON/);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /weather\.json/);
  } finally {
    await rm(dir, { recursive: true });
  }
});

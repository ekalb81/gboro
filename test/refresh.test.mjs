import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, plan } from '../scripts/refresh.mjs';

test('collectors.json is valid and ingest is configured', async () => {
  const cfg = await loadConfig();
  assert.ok(cfg.collectors.length > 0);
  assert.equal(cfg.ingest.script, 'scripts/ingest.mjs');
  for (const c of cfg.collectors) assert.ok(!c.args || Array.isArray(c.args), `${c.name}: args must be an array`);
});

test('a collector whose script is not in the branch is skipped', async () => {
  const p = await plan({ name: 'x', script: 'scripts/does-not-exist.mjs' });
  assert.equal(p.action, 'skip');
});

test('a collector missing a secret is skipped, not failed', async () => {
  const p = await plan({ name: 'x', script: 'scripts/ingest.mjs', env: ['A', 'B'] }, { A: '1' });
  assert.deepEqual(p, { action: 'skip', why: 'missing B' });
});

test('a collector with its script and secrets runs', async () => {
  const p = await plan({ name: 'x', script: 'scripts/ingest.mjs', env: ['A'] }, { A: '1' });
  assert.equal(p.action, 'run');
});

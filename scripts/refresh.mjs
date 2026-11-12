// Run every collector in scripts/collectors.json, then ingest. Used by the publish workflow and locally.
//
// Usage: node scripts/refresh.mjs [--only=name,name] [--list]
//
// One collector failing (bad credentials, a site down) never stops the others: it is reported and the
// run carries on, so the site still updates with whatever came through. Only an ingest failure fails the run.

import { readFile, access, appendFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const only = argv.find((a) => a.startsWith('--only='))?.slice(7).split(',').map((s) => s.trim().toLowerCase());
const exists = (p) => access(p).then(() => true, () => false);

export async function loadConfig(file = join(root, 'scripts', 'collectors.json')) {
  const cfg = JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(cfg.collectors)) throw new Error('collectors.json: "collectors" must be an array');
  for (const c of cfg.collectors) {
    if (!c.name || !c.script) throw new Error(`collectors.json: every collector needs "name" and "script" (${JSON.stringify(c)})`);
  }
  return cfg;
}

// Decide what to do with one collector without running it.
export async function plan(c, env = process.env, base = root) {
  if (!(await exists(join(base, c.script)))) return { action: 'skip', why: `${c.script} not in this branch yet` };
  const missing = (c.env || []).filter((k) => !env[k]);
  if (missing.length) return { action: 'skip', why: `missing ${missing.join(', ')}` };
  return { action: 'run' };
}

function run(script, args = [], timeoutMin = 5) {
  const t = Date.now();
  const r = spawnSync(process.execPath, [join(root, script), ...args], { cwd: root, stdio: 'inherit', timeout: timeoutMin * 60_000 });
  const secs = ((Date.now() - t) / 1000).toFixed(1);
  if (r.error) return { ok: false, why: r.error.code === 'ETIMEDOUT' ? `timed out after ${timeoutMin} min` : r.error.message, secs };
  return { ok: r.status === 0, why: r.status === 0 ? '' : `exit ${r.status ?? r.signal}`, secs };
}

async function main() {
  const cfg = await loadConfig();
  if (argv.includes('--list')) {
    for (const c of cfg.collectors) {
      const p = await plan(c);
      console.log(`${c.name}: ${p.action === 'run' ? 'ready' : p.why}`);
    }
    return;
  }
  const rows = [];
  for (const c of cfg.collectors) {
    if (only && !only.some((o) => c.name.toLowerCase().includes(o))) continue;
    const p = await plan(c);
    if (p.action === 'skip') {
      console.log(`\n-- ${c.name}: skipped (${p.why})`);
      rows.push([c.name, 'skipped', p.why]);
      continue;
    }
    console.log(`\n-- ${c.name}`);
    const r = run(c.script, c.args, c.timeoutMinutes);
    if (!r.ok) console.log(`::warning title=${c.name} failed::${r.why}`);
    rows.push([c.name, r.ok ? 'ok' : 'failed', r.ok ? `${r.secs}s` : r.why]);
  }

  console.log('\n-- Ingest');
  const ing = run(cfg.ingest.script, cfg.ingest.args);
  rows.push(['Ingest', ing.ok ? 'ok' : 'failed', ing.ok ? `${ing.secs}s` : ing.why]);

  const table = ['| Step | Result | Note |', '|---|---|---|', ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
  console.log(`\n${table}`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Data refresh\n\n${table}\n`);
  if (!ing.ok) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

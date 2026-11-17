// Geometry audit of the downtown model: things standing where they cannot be. Usage: npm run audit:geometry [-- out.json]
//
// Opens the page headless with ?debug and reads the model's own lists (window.__audit in public/model.js), so the
// checks see what the renderer really places, after its own rules have run. Each finding is one line: the check, where
// (grid units, usable as ?at=gx,gy), and what was measured. Checks are cheap and exact; what only an eye can judge
// (colour, shape, clutter) is for scripts/audit-tiles.mjs.
//
// Needs Playwright with Chromium (see scripts/bench.mjs).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || '';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('playwright')); }

const port = 8100 + Math.floor(Math.random() * 800);
const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs'), String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));

/* The checks, run inside the page. */
function checks() {
  const A = window.__audit, { MAP, blds, pts0, chains, TF, XWALK, ST, RW, M, GX, GY, DECKS, DT, along, pip } = A;
  const F = [], add = (check, gx, gy, detail) => F.push({ check, gx: +gx.toFixed(2), gy: +gy.toFixed(2), detail });
  const pairs = (a) => { const r = []; for (let i = 0; i < a.length; i += 2) r.push([a[i], a[i + 1]]); return r; };
  const segD = (x, y, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy; let t = L ? ((x - a[0]) * dx + (y - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t); };
  // a coarse grid of line segments, so "how far is the nearest street" is quick
  const grid = (lines) => { const g = new Map(), key = (i, j) => i * 4096 + j;
    lines.forEach((ln, li) => { for (let k = 0; k < ln.q.length - 1; k++) { const a = ln.q[k], b = ln.q[k + 1];
      for (let i = Math.floor(Math.min(a[0], b[0]) / 2) - 1; i <= Math.floor(Math.max(a[0], b[0]) / 2) + 1; i++) for (let j = Math.floor(Math.min(a[1], b[1]) / 2) - 1; j <= Math.floor(Math.max(a[1], b[1]) / 2) + 1; j++) { const kk = key(i, j); if (!g.has(kk)) g.set(kk, []); g.get(kk).push([li, k]); } } });
    return (x, y) => { let best = null, bd = 1e9; for (const [li, k] of g.get(key(Math.floor(x / 2), Math.floor(y / 2))) || []) { const ln = lines[li], d = segD(x, y, ln.q[k], ln.q[k + 1]) * M - ln.hw; if (d < bd) { bd = d; best = ln; } } return best ? { d: bd, ln: best } : null; }; };
  // d: metres from the edge of the carriageway (negative = on it)
  const streets = MAP.R.filter((r) => !r.ar && r.c <= 4).map((r) => ({ q: pairs(r.p), hw: RW[r.c] / 2, n: r.n, c: r.c }));
  const service = MAP.R.filter((r) => !r.ar && r.c === 5).map((r) => ({ q: pairs(r.p), hw: RW[5] / 2, n: r.n, c: 5 }));
  const rails = MAP.RL.map((r) => ({ q: pairs(r.p), hw: 1.1, n: r.n }));
  const nearStreet = grid(streets), nearService = grid(service), nearRail = grid(rails);
  const solid = blds.filter((b) => !b.deck && !b.canopy);
  const bgrid = new Map(); for (const b of solid) for (let i = Math.floor(b.minx / 4); i <= Math.floor(b.maxx / 4); i++) for (let j = Math.floor(b.miny / 4); j <= Math.floor(b.maxy / 4); j++) { const k = i * 4096 + j; if (!bgrid.has(k)) bgrid.set(k, []); bgrid.get(k).push(b); }
  const inBld = (x, y) => { for (const b of bgrid.get(Math.floor(x / 4) * 4096 + Math.floor(y / 4)) || []) if (x > b.minx && x < b.maxx && y > b.miny && y < b.maxy && pip(x, y, b.pts)) return b; return null; };
  const onDeck = (x, y, kind) => DECKS.find((b) => (!kind || b.deck === kind) && x > b.minx && x < b.maxx && y > b.miny && y < b.maxy && pip(x, y, b.pts));
  const bname = (b) => b.name || (b.tn && b.tn[0]) || b.ad || b.t + ' ' + b.id;

  // 1. things standing on a street, on the tracks or inside a building
  const what = (o) => (o.kind === 'prop' ? o.what : o.kind === 'car' ? 'parked car' : o.kind);
  for (const o of pts0) { if (o.gx == null || o.kind === 'string') continue; const w = what(o);
    const s = nearStreet(o.gx, o.gy); if (s && s.d < -0.6) add(`${w} on a street`, o.gx, o.gy, `${(-s.d).toFixed(1)} m inside the carriageway of ${s.ln.n || 'an unnamed street'}`);
    const sv = nearService(o.gx, o.gy); if (sv && sv.d < -0.5 && o.kind !== 'car') add(`${w} on a service road`, o.gx, o.gy, `${(-sv.d).toFixed(1)} m inside ${sv.ln.n || 'a driveway or lot aisle'}`);
    const r = nearRail(o.gx, o.gy); if (r && r.d < 0) add(`${w} on the tracks`, o.gx, o.gy, `${(r.d + 1.1).toFixed(1)} m from the centre of ${r.ln.n || 'a track'}`);
    const b = inBld(o.gx, o.gy); if (b) add(`${w} inside a building`, o.gx, o.gy, bname(b));
    if (o.kind === 'car') { const c = o.r.find((q) => inBld(q[0], q[1])); if (c && !b) add('parked car cut by a building', o.gx, o.gy, bname(inBld(c[0], c[1]))); } }

  // 2. parked cars and trees on top of each other
  const cells = new Map(), cell = (o) => Math.floor(o.gx) * 4096 + Math.floor(o.gy);
  for (const o of pts0) if (o.kind === 'car' || o.kind === 'tree' || o.kind === 'lamp') { const k = cell(o); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(o); }
  const around = (o) => { const r = []; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) r.push(...(cells.get((Math.floor(o.gx) + i) * 4096 + Math.floor(o.gy) + j) || [])); return r; };
  for (const o of pts0) { if (o.kind !== 'car' && o.kind !== 'tree') continue;
    for (const p of around(o)) { if (p === o) continue; const d = Math.hypot(p.gx - o.gx, p.gy - o.gy) * M;
      if (o.kind === 'car' && p.kind === 'car' && d < 1.5 && (o.gx + o.gy < p.gx + p.gy)) add('two parked cars overlap', o.gx, o.gy, `${d.toFixed(1)} m apart`);
      if (o.kind === 'car' && p.kind === 'tree' && d < 1.2) add('tree growing through a parked car', o.gx, o.gy, `${d.toFixed(1)} m apart`);
      if (o.kind === 'car' && p.kind === 'lamp' && d < 1.0) add('lamp standing in a parked car', o.gx, o.gy, `${d.toFixed(1)} m apart`);
      if (o.kind === 'tree' && p.kind === 'tree' && d < 1.0 && (o.gx + o.gy < p.gx + p.gy)) add('two trees on one spot', o.gx, o.gy, `${d.toFixed(1)} m apart`);
      if (o.kind === 'tree' && p.kind === 'lamp' && d < 0.8) add('lamp inside a tree trunk', o.gx, o.gy, `${d.toFixed(1)} m apart`); } }

  // 3. buildings overlapping each other (sampled at 0.9 m)
  for (let i = 0; i < solid.length; i++) { const a = solid[i]; for (let j = i + 1; j < solid.length; j++) { const b = solid[j];
    const x0 = Math.max(a.minx, b.minx), x1 = Math.min(a.maxx, b.maxx), y0 = Math.max(a.miny, b.miny), y1 = Math.min(a.maxy, b.maxy); if (x0 >= x1 || y0 >= y1) continue;
    let n = 0, sx = 0, sy = 0; for (let x = x0 + .05; x < x1; x += .1) for (let y = y0 + .05; y < y1; y += .1) if (pip(x, y, a.pts) && pip(x, y, b.pts)) { n++; sx += x; sy += y; }
    const m2 = n * .81; if (m2 >= 6) add('buildings overlap', sx / n, sy / n, `${Math.round(m2)} m2 shared by ${bname(a)} (${a.hm.toFixed(0)} m) and ${bname(b)} (${b.hm.toFixed(0)} m)`); } }

  // 4. streets, service roads and tracks running through buildings
  const through = (lines, label) => { for (const ln of lines) { let run = null; const flush = () => { if (run && run.len * M >= 4) add(label, run.x / run.n, run.y / run.n, `${(run.len * M).toFixed(0)} m of ${ln.n || 'an unnamed way'} under ${bname(run.b)}`); run = null; };
    for (let k = 0; k < ln.q.length - 1; k++) { const a = ln.q[k], b = ln.q[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let d = 0; d < L; d += .15) { const x = a[0] + (b[0] - a[0]) * d / L, y = a[1] + (b[1] - a[1]) * d / L, bb = inBld(x, y);
      if (bb && run && run.b === bb) { run.len += .15; run.x += x; run.y += y; run.n++; } else { flush(); if (bb) run = { b: bb, len: .15, x, y, n: 1 }; } } } flush(); } };
  through(streets, 'street through a building'); through(service, 'service road through a building'); through(rails, 'track through a building');

  // 5. where the walkers go: both sidewalks of every walked street, a step at a time
  for (const ch of chains) for (const side of [-1, 1]) { let run = null; const flush = () => { if (run && run.len * M >= 3) add(run.label, run.x / run.n, run.y / run.n, `${(run.len * M).toFixed(0)} m of the ${side > 0 ? 'right' : 'left'} sidewalk of ${ch.n || 'a street'}: ${run.detail}`); run = null; };
    for (let d = ch.d0 || 0; d < (ch.d1 || ch.L); d += .15) { const [gx, gy, ux, uy] = along(ch, d), off = (A.walkOff ? A.walkOff(ch, d, side) : (RW[ch.c] / 2 + 2) / M) * side, x = gx - uy * off, y = gy + ux * off; let label = '', detail = '';
      const b = inBld(x, y), r = nearRail(x, y), w = DT.wet(x, y);
      if (b) { label = 'walkers pass through a building'; detail = bname(b); } else if (w) { label = 'walkers cross a pool or fountain'; detail = ''; } else if (r && r.d < 0 && !onDeck(x, y)) { label = 'walkers on the tracks'; detail = r.ln.n || ''; }
      if (label && run && run.label === label && run.detail === detail) { run.len += .15; run.x += x; run.y += y; run.n++; } else { flush(); if (label) run = { label, detail, len: .15, x, y, n: 1 }; } } flush(); }

  // 6. paint where there is no street surface: crosswalks and stop bars on bridges or in buildings
  for (const [x, y] of XWALK.cw) { const dk = onDeck(x, y), b = inBld(x, y); if (dk) add('crosswalk on a bridge deck', x, y, dk.deck + ' deck'); if (b) add('crosswalk inside a building', x, y, bname(b)); }
  for (const [x0, y0, x1, y1] of XWALK.bars) { const x = (x0 + x1) / 2, y = (y0 + y1) / 2, dk = onDeck(x, y), b = inBld(x, y); if (dk) add('stop bar on a bridge deck', x, y, dk.deck + ' deck'); if (b) add('stop bar inside a building', x, y, bname(b)); }

  // 7. parking stalls on a street or under a building, and signals far from any junction
  for (const st of ST) { const s = nearStreet(st[0], st[1]); if (s && s.d < -1) add('parking stall on a street', st[0], st[1], `${(-s.d).toFixed(1)} m inside ${s.ln.n || 'a street'}`); }
  for (const [x, y, k] of MAP.SIG || []) { if (k !== 's') continue; if (!TF.nodes.some((n) => n.signal && Math.hypot(n.x - x, n.y - y) < 3.2)) add('signal with no junction', x, y, 'no junction of three streets within 29 m'); }

  // signal and stop sign posts, placed as the renderer does (model.js, "the lights themselves"), standing in a carriageway
  for (const l of TF.lanes) { if (!(l.to.signal && !l.inner) && l.sign !== 'stop') continue; if (l.post === null) continue; const s_ = Math.max(0, l.L - Math.min((RW[l.to.cls] / 2 + 4.3) / M, l.L * .45)), [gx, gy, ux, uy] = along(l.ch, s_), off = (RW[l.c] / 2 + 1.4) / M, [x, y] = l.post || [gx - uy * off, gy + ux * off];
    const s = nearStreet(x, y); if (s && s.d < -0.6) add(l.sign === 'stop' ? 'stop sign in a carriageway' : 'signal post in a carriageway', x, y, `${(-s.d).toFixed(1)} m inside ${s.ln.n || 'a street'}; its approach (${l.ch.n || 'unnamed'}) is ${(l.L * M).toFixed(0)} m long`);
    const b = inBld(x, y); if (b) add('signal or stop sign inside a building', x, y, bname(b)); }

  // 8. street graph oddities that show as cars doing strange things
  for (const l of TF.lanes) if (l.L * M < 1 && (!l.rev || l.id < l.rev.id)) { const [x, y] = along(l.ch, l.L / 2); add('lane under 1 m long', x, y, `${(l.L * M).toFixed(2)} m of ${l.ch.n || 'a street'}`); }
  for (const n of TF.nodes) if (n.out.length === 0 && n.inn.length && n.x > 1 && n.y > 1 && n.x < GX - 1 && n.y < GY - 1) add('one-way street with no way out', n.x, n.y, n.inn.map((l) => l.ch.n).join(', '));

  // 9. small details (benches, bins, hydrants...) on a street or in a building
  for (const o of DT.points) { /* covered by 1 (they are in pts0) */ }
  for (const p of DT.all || []) { const { k, gx: x, gy: y } = p; if (k === 'gate') continue; const s = nearStreet(x, y); if (s && s.d < -0.6) add(`${k} on a street`, x, y, `${(-s.d).toFixed(1)} m inside ${s.ln.n || 'a street'}`); const b = inBld(x, y); if (b) add(`${k} inside a building`, x, y, bname(b)); }
  return { findings: F, counts: { buildings: solid.length, points: pts0.length, streets: streets.length, lanes: TF.lanes.length, stalls: ST.length, crosswalks: XWALK.cw.length } };
}

let code = 0;
try {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(`http://localhost:${port}/?debug&bench&time=day&date=2026-11-17`);
  await page.waitForFunction(() => window.__audit && window.__bench && window.__bench.frames.length > 0, null, { timeout: 120000 });
  const res = await page.evaluate(checks);
  await browser.close();
  const seen = new Set(); res.findings = res.findings.filter((f) => { const k = f.check + f.gx + ',' + f.gy; if (seen.has(k)) return false; seen.add(k); return true; });
  const by = {}; for (const f of res.findings) (by[f.check] ||= []).push(f);
  console.log(`Checked ${JSON.stringify(res.counts)}`);
  for (const [k, v] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) console.log(String(v.length).padStart(5), k, ' e.g. ?at=' + v[0].gx + ',' + v[0].gy, '(' + v[0].detail + ')');
  console.log(`${res.findings.length} findings`);
  if (out) writeFileSync(out, JSON.stringify(res, null, 1));
} catch (e) { console.error(e); code = 1; } finally { server.kill(); }
process.exit(code);

// Geometry audit of the downtown model: things standing where they cannot be. Usage: npm run audit:geometry [-- out.json]
//
// Opens the page headless with ?debug and reads the model's own lists (window.__audit in public/model.js), so the
// checks see what the renderer really places, after its own rules have run. Each finding is one line: the check, where
// (grid units, usable as ?at=gx,gy), and what was measured. Checks are cheap and exact; what only an eye can judge
// (colour, shape, clutter) is for scripts/audit-tiles.mjs.
//
// Needs Playwright with Chromium (see scripts/bench.mjs).
// AUDIT_URL can point to a published site instead of the local server. BRIDGE_CUT can be clip or card.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || '';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('playwright')); }

const port = 8100 + Math.floor(Math.random() * 800);
const base = (process.env.AUDIT_URL || `http://localhost:${port}`).replace(/\/$/, '');
const server = process.env.AUDIT_URL ? null :
  spawn(process.execPath, [join(root, 'scripts/serve.mjs'), String(port)], { stdio: 'ignore' });
if (server) await new Promise((r) => setTimeout(r, 700));

/* The checks, run inside the page. */
function checks() {
  const A = window.__audit, { MAP, blds, pts0, chains, TF, XWALK, ST, RW, M, GX, GY, DECKS, DT, along, pip, roadWidth } = A;
  const F = [], add = (check, gx, gy, detail) => F.push({ check, gx: +gx.toFixed(2), gy: +gy.toFixed(2), detail });
  const pairs = (a) => { const r = []; for (let i = 0; i < a.length; i += 2) r.push([a[i], a[i + 1]]); return r; };
  const segD = (x, y, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy; let t = L ? ((x - a[0]) * dx + (y - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t); };
  // a coarse grid of line segments, so "how far is the nearest street" is quick
  const grid = (lines) => { const g = new Map(), key = (i, j) => i * 4096 + j;
    lines.forEach((ln, li) => { for (let k = 0; k < ln.q.length - 1; k++) { const a = ln.q[k], b = ln.q[k + 1];
      for (let i = Math.floor(Math.min(a[0], b[0]) / 2) - 1; i <= Math.floor(Math.max(a[0], b[0]) / 2) + 1; i++) for (let j = Math.floor(Math.min(a[1], b[1]) / 2) - 1; j <= Math.floor(Math.max(a[1], b[1]) / 2) + 1; j++) { const kk = key(i, j); if (!g.has(kk)) g.set(kk, []); g.get(kk).push([li, k]); } } });
    return (x, y, ux, uy) => { let best = null, bd = 1e9; for (const [li, k] of g.get(key(Math.floor(x / 2), Math.floor(y / 2))) || []) {
      const ln = lines[li], a = ln.q[k], b = ln.q[k + 1];
      if (ux != null) {
        const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
        if (ln.br || !length || Math.abs(ux * dx + uy * dy) < .8 * length) continue;
      }
      const d = segD(x, y, a, b) * M - ln.hw;
      if (d < bd) { bd = d; best = ln; }
    } return best ? { d: bd, ln: best } : null; }; };
  // d: metres from the edge of the carriageway (negative = on it)
  const streets = MAP.R.filter((r) => !r.ar && r.c <= 4).map((r) => ({ q: pairs(r.p), hw: roadWidth(r) / 2, n: r.n, c: r.c, br: r.br }));
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

  // 5. where the walkers can actually go, sampled more finely than the route construction
  for (const ch of chains) for (const { side, d0, d1 } of ch.walks) { let run = null; const flush = () => { if (run) add(run.label, run.x / run.n, run.y / run.n, `${side > 0 ? 'right' : 'left'} sidewalk of ${ch.n || 'a street'}: ${run.detail}`); run = null; };
    const n = Math.ceil((d1 - d0) / .05);
    for (let i = 0; i <= n; i++) { const [x, y, ux, uy, gx, gy] = A.walkPos(ch, d0 + (d1 - d0) * i / n, side); let label = '', detail = '';
      const b = inBld(x, y), r = nearRail(x, y), w = DT.wet(x, y), s = nearStreet(x, y, ux, uy), z = A.rideZ('road', x, y, ux, uy, gx, gy);
      const onOwnSpan = DECKS.some((deck) => deck.dk.sp && deck.dk.n === ch.n && pip(gx, gy, deck.pts));
      if (b) { label = 'walkers pass through a building'; detail = bname(b); } else if (w) { label = 'walkers cross a pool or fountain'; }
      else if (!z && onOwnSpan) { label = 'walkers drop below a bridge'; }
      else if (!z && s && s.d < -.2) { label = 'walkers follow a carriageway'; detail = s.ln.n || 'an unnamed street'; }
      else if (r && r.d < 0 && !z && !onDeck(x, y, 'rail')) { label = 'walkers on the tracks'; detail = r.ln.n || ''; }
      if (label && run && run.label === label && run.detail === detail) { run.x += x; run.y += y; run.n++; } else { flush(); if (label) run = { label, detail, x, y, n: 1 }; } } flush(); }

  // 6. paint where there is no street surface: crosswalks and stop bars on bridges or in buildings
  for (const [x, y] of XWALK.cw) { const dk = onDeck(x, y), b = inBld(x, y); if (dk) add('crosswalk on a bridge deck', x, y, dk.deck + ' deck'); if (b) add('crosswalk inside a building', x, y, bname(b)); }
  for (const [x0, y0, x1, y1] of XWALK.bars) { const x = (x0 + x1) / 2, y = (y0 + y1) / 2, dk = onDeck(x, y), b = inBld(x, y); if (dk) add('stop bar on a bridge deck', x, y, dk.deck + ' deck'); if (b) add('stop bar inside a building', x, y, bname(b)); }

  // 7. parking stalls on a street or under a building, and signals far from any junction
  for (const st of ST) { const s = nearStreet(st[0], st[1]); if (s && s.d < -1) add('parking stall on a street', st[0], st[1], `${(-s.d).toFixed(1)} m inside ${s.ln.n || 'a street'}`); }
  for (const [x, y, k] of MAP.SIG || []) { if (k !== 's') continue; if (!TF.nodes.some((n) => n.signal && Math.hypot(n.x - x, n.y - y) < 3.2)) add('signal with no junction', x, y, 'no junction of three streets within 29 m'); }

  // signal and stop sign posts, placed as the renderer does (model.js, "the lights themselves"), standing in a carriageway
  for (const l of TF.lanes) { if (!(l.to.signal && !l.inner) && l.sign !== 'stop') continue; if (l.post === null) continue; const s_ = Math.max(0, l.L - Math.min((l.to.width / 2 + 4.3) / M, l.L * .45)), [gx, gy, ux, uy] = along(l.ch, s_), off = (l.width / 2 + 1.4) / M, [x, y] = l.post || [gx - uy * off, gy + ux * off];
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

// Probe each deck piece using the real lane and vehicle renderer. Fixed fixtures cover regressions at
// the narrow ramp seams and exercise every below-deck street accessible to simulated cars.
const bridgeFixtures = [
  ['West Wendover Avenue', 'North Elm Street', '62.78,14.99', '64.24,0.45', 7.35, 0],
  ['North Murrow Boulevard', 'North Church Street', '89.83,107.93', '87.74,116.17', 5.615, 0],
  ['South Eugene Street', 'Spring Garden Street', '24.02,258.84', '10.49,258.20', 2.195, 0],
  ['South Eugene Street', 'Federal Place', '23.90,261.41', '23.63,267.22', 2.735, 0],
  ['North Murrow Boulevard', 'western ramp seam', '79.97,118.77', '85.69,115.71', 1.295, 155],
  ['East Bessemer Avenue', 'western ramp seam', '109.17,34.21', '105.38,33.92', 1.475, 150],
];

async function checkBridgeCars(page) {
  const groups = await page.evaluate(() => {
    const byStreet = new Map();
    for (const { deck, dk, pts } of window.__audit.DECKS) {
      if (deck !== 'road') continue;
      const p = byStreet.get(dk.n) || [];
      p.push(...pts);
      byStreet.set(dk.n, p);
    }
    return [...byStreet.entries()];
  });
  await page.setViewportSize({ width: 2200, height: 1660 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [name, pts] of groups) {
    const xs = pts.map(([x]) => x), ys = pts.map(([, y]) => y);
    const lo = Math.min(...xs), hi = Math.max(...xs), y = (Math.min(...ys) + Math.max(...ys)) / 2;
    const count = Math.ceil((hi - lo) / 24);
    const covered = new Set();
    let pieces, checkedSamples = 0, checkedTracks = 0;
    for (let i = 0; i < count; i++) {
      const min = lo + (hi - lo) * i / count, max = lo + (hi - lo) * (i + 1) / count;
      const fixtures = bridgeFixtures.filter(([n]) => n === name);
      const cut = process.env.BRIDGE_CUT || 'clip';
      await page.goto(`${base}/index.html?at=${(min + max) / 2},${y}&z=4&flat&debug&bench&compose=canvas&mode=sharp&time=day&weather=clear&date=2026-11-19&cut=${cut}`);
      await page.waitForFunction(() => window.__audit?.lanePos && window.__bench?.frames.length);
      const data = await page.evaluate(async ({ name, min, max, fixtures }) => {
        const { paintFrame, TF, DECKS, lanePos, pip, rideZ, people, view, chains, walkPos } = window.__audit;
        const { tcars } = window.__tf;
        const pieces = DECKS.filter(b => b.deck === 'road' && b.dk.n === name);
        const candidates = new Map();
        let checked = 0;
        const faults = [];
        // A true deck lane follows the surveyed centerline. Federal Place intersects on a shallow angle.
        const follows = (piece, x, y, ux, uy) => piece.cls.some(line => line.slice(1).some(([qx, qy], i) => {
          const [px, py] = line[i], dx = qx - px, dy = qy - py, len = Math.hypot(dx, dy);
          if (len < .05 || Math.abs(dx * ux + dy * uy) < .98 * len) return false;
          const t = Math.max(0, Math.min(1, ((x - px) * dx + (y - py) * dy) / len ** 2));
          return Math.hypot(x - px - t * dx, y - py - t * dy) < 1;
        }));
        for (const lane of TF.lanes) for (const track of lane.tracks.keys()) {
          let prior;
          for (let s = .035; s < lane.L; s += .18) {
            const [x, y, , , rx, ry, ux, uy] = lanePos(lane, s, track);
            if (x < min || x > max) { prior = null; continue; }
            const decks = pieces.filter(b => x > b.minx && x < b.maxx && y > b.miny && y < b.maxy && pip(x, y, b.pts));
            const on = decks.filter(b => follows(b, x, y, ux, uy));
            if (!on.length && !prior && !decks.some(b => b.dk.sp)) continue;
            const z = rideZ('road', x, y, ux, uy, rx, ry);
            const expected = Math.max(0, ...on.map(b => b.zf ? b.zf(x, y) : b.hpx));
            if (Math.abs(z - expected) > .25 || (prior && Math.abs(prior.z - z) > .95)) {
              faults.push(`${lane.ch.n || lane.from.k} at ${x.toFixed(3)},${y.toFixed(3)}: height ${z.toFixed(2)}, expected ${expected.toFixed(2)}, previous ${prior?.z.toFixed(2)}`);
            }
            prior = on.length ? { z } : null;
            checked++;
            if (z > 0) for (const b of on) {
              const list = candidates.get(b.id) || [];
              list.push({ lane, track, s, x, y, z });
              candidates.set(b.id, list);
            }
          }
        }
        const canvas = document.querySelector('#village'), ctx = canvas.getContext('2d');
        const { tl, vs } = view();
        const inView = ({ x, y, z }) => {
          const px = ((x - y) - (tl[0] - tl[1])) * 16 * vs;
          const py = (((x + y) - (tl[0] + tl[1])) * 8 - z) * vs;
          return px > 18 && px < canvas.width - 18 && py > 18 && py < canvas.height - 18;
        };
        const pixels = () => ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        tcars.length = 0;
        people.length = 0;
        await paintFrame();
        const background = pixels();
        const magentaPixels = async () => {
          await paintFrame();
          const rgb = pixels();
          let count = 0;
          for (let i = 0; i < rgb.length; i += 4) {
            if (rgb[i] - rgb[i + 1] > 40 && rgb[i + 2] - rgb[i + 1] > 40 &&
                (rgb[i] !== background[i] || rgb[i + 1] !== background[i + 1] || rgb[i + 2] !== background[i + 2])) count++;
          }
          return count;
        };
        const visible = ({ lane, track, s }) => {
          tcars[0] = { lane, track, s, col: '#ff00ff', ty: 0, stopped: false };
          return magentaPixels();
        };
        const hasVisibleCar = async (options) => {
          for (const fraction of [.5, .25, .75]) {
            if (options.length && await visible(options[Math.floor(fraction * options.length)]) > 25) return true;
          }
          return false;
        };
        const covered = [];
        let tracks = 0;
        for (const [id, options] of candidates) {
          const samples = options.filter(inView);
          if (await hasVisibleCar(samples)) covered.push(id);
          if (name !== 'West Wendover Avenue' && name !== 'South Eugene Street') continue;
          const perTrack = new Map();
          for (const sample of samples) {
            if (sample.lane.tracks.length < 2) continue;
            const key = sample.lane.id + ':' + sample.track;
            const list = perTrack.get(key) || [];
            list.push(sample);
            perTrack.set(key, list);
          }
          for (const laneSamples of perTrack.values()) {
            if (laneSamples.length < 2) continue;
            const { lane, track } = laneSamples[0];
            if (await hasVisibleCar(laneSamples)) tracks++;
            else faults.push(`Deck ${id}: no visible car on track ${track + 1} of ${lane.from.k} → ${lane.to.k}`);
          }
        }
        for (const [, label, from, to, s, minPixels] of fixtures) {
          const lane = TF.lanes.find(l => l.from.k === from && l.to.k === to);
          if (!lane || lane.L <= s) { faults.push(`Missing fixture lane ${from} → ${to}`); continue; }
          const [x, y, , , rx, ry, ux, uy] = lanePos(lane, s);
          if (x < min || x > max) continue;
          const z = rideZ('road', x, y, ux, uy, rx, ry);
          const count = await visible({ lane, s });
          if (minPixels ? count < minPixels || z <= 0 : count !== 0 || z !== 0) {
            faults.push(`${label} at ${x.toFixed(3)},${y.toFixed(3)}: ${count} pixels, height ${z.toFixed(2)}`);
          }
        }
        if (name === 'South Eugene Street' && min < 17 && max > 17) {
          tcars.length = 0;
          const ch = chains.find(ch => ch.n === name), walkers = new Map();
          for (const run of ch.walks) for (let d = run.d0; d <= run.d1; d += .3) {
            const [x, y, ux, uy, gx, gy] = walkPos(ch, d, run.side);
            const near = x + y >= gx + gy;
            if (Math.abs(y - (near ? 249.71 : 250.37)) >= .025) continue;
            const z = rideZ('road', x, y, ux, uy, gx, gy);
            if (z > 6 && z < 8 && inView({ x, y, z })) walkers.set(near, { ch, ...run, d, rk: -1, skin: '#ff00ff', shirt: '#ff00ff' });
          }
          for (const near of [false, true]) {
            people[0] = walkers.get(near);
            if (!people[0] || await magentaPixels() <= 20) faults.push(`Walker on the ${near ? 'near' : 'far'} sidewalk of the South Eugene ramp should be visible`);
          }
        }
        return { covered, pieces: pieces.map(b => b.id), checked, tracks, faults };
      }, { name, min, max, fixtures });
      assert.equal(data.faults.length, 0, `${name}: ${data.faults.slice(0, 8).join('; ')}`);
      for (const id of data.covered) covered.add(id);
      pieces = data.pieces;
      checkedSamples += data.checked;
      checkedTracks += data.tracks;
    }
    assert.deepEqual(pieces.filter(id => !covered.has(id)), [], `${name}: deck pieces without a visible car`);
    console.log(`Checked ${name}: ${covered.size} rendered deck pieces, ${checkedSamples} lane samples, ${checkedTracks} painted multi-lane tracks`);
  }
}

let code = 0, browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(`${base}/index.html?debug&bench&time=day&date=2026-11-17`);
  await page.waitForFunction(() => window.__audit && window.__bench && window.__bench.frames.length > 0, null, { timeout: 120000 });
  const res = await page.evaluate(checks);
  await checkBridgeCars(page);
  assert.deepEqual(res.findings.filter((f) => ['walkers pass through a building', 'walkers cross a pool or fountain', 'walkers follow a carriageway', 'walkers drop below a bridge'].includes(f.check)), [], 'Expected sidewalk routes to stay clear and on their decks');
  const seen = new Set(); res.findings = res.findings.filter((f) => { const k = f.check + f.gx + ',' + f.gy; if (seen.has(k)) return false; seen.add(k); return true; });
  const by = {}; for (const f of res.findings) (by[f.check] ||= []).push(f);
  console.log(`Checked ${JSON.stringify(res.counts)}`);
  for (const [k, v] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) console.log(String(v.length).padStart(5), k, ' e.g. ?at=' + v[0].gx + ',' + v[0].gy, '(' + v[0].detail + ')');
  console.log(`${res.findings.length} findings`);
  if (out) writeFileSync(out, JSON.stringify(res, null, 1));
} catch (e) { console.error(e); code = 1; } finally { await browser?.close(); server?.kill(); }
process.exit(code);

// The house up the street: one lot north of downtown, as a close-up model in the same manner as the downtown one,
// with the one person who lives there going about a made-up day (homeday.js): mowing, a run, a walk, friends round
// the back-yard fire. Plain canvas, no build step. The house is deliberately not named or placed: model/house.json
// holds only metres from the corner of the lot.
//
//   const h = startHouse({ canvas, lot, weather, onSay });
//   h.rotate() / h.zoom(±1) / h.home()
//
// Previews: ?do=mow|run|walk|fire|coffee|read|garden|asleep|inside, ?clock=sat-10:20, ?speed=30 (minutes run 30x),
// ?time=day|dusk|night, ?date=2026-06-13 (the season), ?view=0..3 (which corner you look from).

import { clockAt, parseWhen, nowDoing, sayDoing, planDay, dayRand } from './homeday.js';
import { dist, makeRoute, mowRoute } from './house-routes.js';
export { mowRoute } from './house-routes.js';

const C = { lawn: '#6fb650', rough: '#8fbf5f', clay: '#cf5a36', clayD: '#a84528', mortar: '#f5dba6', asphalt: '#57566a', gravel: '#d9c9a8', paver: '#c9b79c', mulch: '#7a4a35', wood: '#9a744e', woodD: '#7d5c3c', glass: '#7fa9c9', glow: '#ffd75e', plum: '#2c2147', hi: '#fff6e4', stone: '#a8a39a', pine: '#2b7448', night: '#1f1d44' };
const rad = Math.PI / 180;
const LAT = 36.0726, LON = -79.792; // downtown, as in model.js: near enough for the sun
const TW = 12, TH = 6, ZP = 13.5; // model pixels per metre: across, down, up

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mixCache = new Map();
function mix(a, b, t) {
  if (t <= 0) return a; const k = a + b + (t * 64 | 0); let v = mixCache.get(k); if (v) return v;
  const A = hex(a), B = hex(b); t = (t * 64 | 0) / 64;
  v = '#' + A.map((x, i) => Math.max(0, Math.min(255, Math.round(x + (B[i] - x) * t))).toString(16).padStart(2, '0')).join('');
  mixCache.set(k, v); return v;
}
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const hash = (a, b = 0) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };

function sunPos(d) {
  const n = d.getTime() / 86400000 + 2440587.5 - 2451545.0; const L = (280.46 + 0.9856474 * n) % 360, g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad, eps = (23.439 - 4e-7 * n) * rad;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)), dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const gmst = ((18.697374558 + 24.06570982441908 * n) % 24 + 24) % 24; const ha = (gmst * 15 + LON) * rad - ra; const la = LAT * rad;
  const alt = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha));
  const A = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(la) - Math.tan(dec) * Math.cos(la));
  return { alt: alt / rad, az: ((A / rad + 180) % 360 + 360) % 360 };
}

export function startHouse({ canvas, lot, weather = null, onSay = () => {} }) {
  const Q = new URLSearchParams(location.search);
  let ctx = canvas.getContext('2d'), sheet = null;
  const H = lot.house, F = lot.fire;
  let rot = Q.has('view') ? (+Q.get('view') & 3) : 1; // 1: from the south-west, the back yard in front
  const CX = (lot.base[0] + lot.base[2]) / 2, CY = (lot.base[1] + lot.base[3]) / 2;
  const uv = (x, y) => { const a = x - CX, b = y - CY; return rot === 0 ? [a, b] : rot === 1 ? [b, -a] : rot === 2 ? [-a, -b] : [-b, a]; };
  const P = (x, y, z = 0) => { const [u, v] = uv(x, y); return [(u - v) * TW, (u + v) * TH - z * ZP]; };
  const VIS = () => [['E', 'S'], ['W', 'S'], ['W', 'N'], ['E', 'N']][rot];
  const FACE = { S: 1, W: 0.9, E: 0.8, N: 0.68 };

  // ---------- the clock ----------
  const speed = +Q.get('speed') || 1, t00 = performance.now();
  const dateQ = Q.get('date') && !isNaN(new Date(Q.get('date') + 'T12:00:00-05:00')) ? new Date(Q.get('date') + 'T12:00:00-05:00') : null;
  const base0 = clockAt(dateQ || new Date()); if (dateQ) base0.min = clockAt().min;
  const PRE = { dawn: 6 * 60 + 50, day: 12 * 60 + 30, dusk: 17 * 60 + 15, night: 22 * 60 }[Q.get('time')];
  const FORCE = Q.get('do'), DBG = Q.has('debug');
  const FMIN = { fire: 20 * 60 + 30, mow: 10 * 60 + 5, run: 7 * 60, walk: 16 * 60 + 30, coffee: 8 * 60, read: 14 * 60, garden: 15 * 60 + 10, asleep: 2 * 60, inside: 20 * 60 }[FORCE];
  const start = parseWhen(Q.get('clock'), base0) || (PRE != null ? { ...base0, min: PRE } : FMIN != null ? { ...base0, min: FMIN, day: FORCE === 'mow' || FORCE === 'fire' ? 5 : base0.day } : base0);
  const live = !Q.get('clock') && PRE == null && FMIN == null && !dateQ && speed === 1;
  const FORCED = FORCE ? { kind: FORCE, t0: start.min - (FORCE === 'fire' ? 60 : FORCE === 'mow' ? 3 : 0.1) } : null;
  function clock() {
    if (live) return clockAt();
    const el = (performance.now() - t00) / 60000 * speed; const c = { ...start, min: start.min + el };
    while (c.min >= 1440) { c.min -= 1440; c.day = (c.day + 1) % 7; c.d += 1; }
    return c;
  }
  // the moment as a Date, for the sun
  const nyMidnight = (() => { const n = dateQ || new Date(); const c = clockAt(n); return n.getTime() - c.min * 60000; })();
  const dateOf = (c) => new Date(nyMidnight + c.min * 60000);
  const sunT = (() => { let rise = 420, set = 1080, prev = sunPos(new Date(nyMidnight)).alt; for (let m = 2; m < 1440; m += 2) { const a = sunPos(new Date(nyMidnight + m * 60000)).alt; if (prev < -0.833 && a >= -0.833) rise = m; if (prev >= -0.833 && a < -0.833) set = m; prev = a; } return { rise, set }; })();
  const doy = (() => { const c = start; return Math.floor((Date.UTC(c.y, c.m - 1, c.d) - Date.UTC(c.y, 0, 0)) / 86400000); })();
  const wx = () => weather || {};
  const wet = () => !!wx().precip && wx().precip !== 'none';

  // ---------- light ----------
  let NIGHT = 0, SUN = { alt: 40, az: 180 };
  const T = (col) => (NIGHT > 0 ? mix(col, C.night, NIGHT * 0.74) : col);
  const shade = (col, f) => T(mix(col, C.plum, (1 - f) * 0.62));

  // ---------- season ----------
  // leaves: how much crown the leafy trees carry, and its colour
  const leafAmt = doy < 80 ? 0 : doy < 125 ? (doy - 80) / 45 : doy < 290 ? 1 : doy < 340 ? 1 - (doy - 290) / 50 * 0.86 : 0.06;
  const leafCol = (k, i) => {
    if (doy < 140) return mix('#9fd66a', '#3d9a4f', clamp((doy - 85) / 55));
    if (doy < 275) return k === 'maple' ? '#4aa34c' : '#3d9a4f';
    const f = clamp((doy - 275) / 40); return mix('#3d9a4f', k === 'maple' ? (i % 2 ? '#e0662a' : '#d93f2b') : (i % 2 ? '#c98a2b' : '#b5652a'), f);
  };
  const lawnCol = doy < 60 || doy > 345 ? mix(C.lawn, '#b5a86a', 0.45) : doy > 180 && doy < 245 ? mix(C.lawn, '#a9b85c', 0.3) : C.lawn;
  const growing = doy >= 74 && doy <= 334;

  // ---------- drawing bits ----------
  function poly(pts, fill, stroke = null, lw = 1) { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); } }
  function line(a, b, col, lw = 1) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.stroke(); }
  const ground = (r, col) => poly([P(r[0], r[1]), P(r[2], r[1]), P(r[2], r[3]), P(r[0], r[3])], col);
  const ground3 = (r, z, col) => poly([P(r[0], r[1], z), P(r[2], r[1], z), P(r[2], r[3], z), P(r[0], r[3], z)], col);
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const P3 = (p) => P(p[0], p[1], p[2]);
  function disc(x, y, z, r, col) { const p = P(x, y, z); ctx.beginPath(); ctx.ellipse(p[0], p[1], r * TW * 1.414, r * TH * 1.414, 0, 0, 7); ctx.fillStyle = col; ctx.fill(); }
  // the four corners of one face of a box, bottom first, in the order that reads left to right on screen
  function faceQuad(f, b, z0, z1, a0 = null, a1 = null) {
    const [x0, y0, x1, y1] = b;
    if (f === 'E') return [[x1, a0 ?? y0, z0], [x1, a1 ?? y1, z0], [x1, a1 ?? y1, z1], [x1, a0 ?? y0, z1]];
    if (f === 'W') return [[x0, a0 ?? y0, z0], [x0, a1 ?? y1, z0], [x0, a1 ?? y1, z1], [x0, a0 ?? y0, z1]];
    if (f === 'S') return [[a0 ?? x0, y1, z0], [a1 ?? x1, y1, z0], [a1 ?? x1, y1, z1], [a0 ?? x0, y1, z1]];
    return [[a0 ?? x0, y0, z0], [a1 ?? x1, y0, z0], [a1 ?? x1, y0, z1], [a0 ?? x0, y0, z1]];
  }
  function box(b, z0, z1, col, top = null, raw = false) {
    for (const f of VIS()) poly(faceQuad(f, b, z0, z1).map(P3), raw ? col : shade(col, FACE[f]));
    poly([P(b[0], b[1], z1), P(b[2], b[1], z1), P(b[2], b[3], z1), P(b[0], b[3], z1)], raw ? (top || col) : T(top || mix(col, C.hi, 0.18)));
  }

  // ---------- the house ----------
  let LIT = () => false; // which windows are lit, set each frame
  function drawOpen(o, b, i) {
    const door = o.k === 'door', gar = o.k === 'garage', pic = o.k === 'pic', w = o.w || (gar ? 2.6 : pic ? 2.5 : door ? 1.0 : o.hi ? 0.8 : 1.15), f = FACE[o.f];
    const z0 = o.z ?? (gar ? 0.02 : door ? (o.f === 'E' ? 0.45 : 0.2) : pic ? 0.95 : o.hi ? 1.55 : 1.05), z1 = gar ? 2.15 : door ? z0 + 2.1 : pic ? 2.6 : o.z != null ? z0 + 0.9 : 2.45;
    const q = (a0, a1, za, zb) => faceQuad(o.f, b, za, zb, a0, a1).map(P3);
    poly(q(o.a - w / 2 - 0.12, o.a + w / 2 + 0.12, z0 - (door || gar ? 0 : 0.1), z1 + 0.12), shade(H.trim, f));
    if (gar) { // a panelled garage door
      poly(q(o.a - w / 2, o.a + w / 2, z0, z1), shade(mix(H.trim, C.plum, 0.06), f)); const m = shade(mix(H.trim, C.plum, 0.3), f);
      for (let k = 1; k < 4; k++) { const h = q(o.a - w / 2, o.a + w / 2, z0 + (z1 - z0) * k / 4, z0 + (z1 - z0) * k / 4); line(h[0], h[1], m, 0.6); }
      for (const sd of [-1, 1]) { poly(q(o.a + sd * 0.1, o.a + sd * (w / 2 - 0.22), z1 - 0.5, z1 - 0.2), shade(mix(C.glass, C.plum, 0.25), f)); // two long panes over the panels, and the black strap handles
        const hd = q(o.a + sd * 0.14, o.a + sd * 0.14, z0 + 0.75, z0 + 1.0); line(hd[0], hd[3], T('#2a2630'), 0.7); }
      if (o.lamp) lantern(q(o.a + w / 2 + 0.42, o.a + w / 2 + 0.42, 1.75, 1.75)[0]);
      return;
    }
    if (door) {
      poly(q(o.a - w / 2, o.a + w / 2, z0, z1), shade(o.c || '#2f5d50', f)); const lit = LIT(i);
      if (o.wreath) { const c = q(o.a, o.a, z1 - 0.62, z1 - 0.62)[0]; ctx.beginPath(); ctx.arc(c[0], c[1], 2.4, 0, 7); ctx.strokeStyle = T('#3f8a4c'); ctx.lineWidth = 1.5; ctx.stroke(); }
      else poly(q(o.a - 0.28, o.a + 0.28, z1 - 0.75, z1 - 0.2), lit ? C.glow : shade(C.glass, f));
      if (o.lamps) for (const sd of [-1, 1]) lantern(q(o.a + sd * 0.88, o.a + sd * 0.88, z0 + 1.7, z0 + 1.7)[0]); // a black lantern either side
      if (o.plaque) { poly(q(o.a - 1.75, o.a - 1.3, z0 + 1.45, z0 + 1.68), T('#27314a')); poly(q(o.a - 1.42, o.a - 1.18, z0 + 1.12, z0 + 1.3), T('#c9b06a')); } // the dark number plate (kept blank) and the brass letterbox
      return;
    }
    const lit = LIT(i);
    poly(q(o.a - w / 2, o.a + w / 2, z0, z1), lit ? (i % 3 === 0 ? '#ffe9a8' : C.glow) : shade(mix(C.glass, C.plum, 0.25), f));
    const m = shade(H.trim, f);
    if (pic) { // the big front window: a wide pane between two narrow ones, a row of small panes over them
      for (const d of [-w / 2 + 0.55, w / 2 - 0.55]) { const v = q(o.a + d, o.a + d, z0, z1); line(v[0], v[3], m, 1); }
      const h = q(o.a - w / 2, o.a + w / 2, z1 - 0.4, z1 - 0.4); line(h[0], h[1], m, 1);
    } else { const a = q(o.a, o.a, z0, z1), h = q(o.a - w / 2, o.a + w / 2, (z0 + z1) / 2, (z0 + z1) / 2); line(a[0], a[3], m, 0.7); line(h[0], h[1], m, 0.7); }
    if (o.s) for (const sd of [-1, 1]) poly(q(o.a + sd * (w / 2 + 0.14), o.a + sd * (w / 2 + 0.5), z0, z1), shade(H.shutter || '#2f4f45', f)); // shutters
  }
  function lantern(p) { ctx.fillStyle = NIGHT > 0.35 ? C.glow : T('#2a2630'); ctx.fillRect(p[0] - 0.9, p[1] - 3.2, 1.8, 3.2); ctx.fillStyle = T('#2a2630'); ctx.fillRect(p[0] - 1.2, p[1] - 3.9, 2.4, 0.8); }
  function roofFace(e0, e1, r1, r0, f) {
    const col = shade(mix(H.roof, C.hi, f === 'S' || f === 'W' ? 0.1 : 0), FACE[f] * 0.5 + 0.5);
    poly([e0, e1, r1, r0].map(P3), col);
    ctx.globalAlpha = 0.16; for (let t = 0.2; t < 1; t += 0.2) line(P3(lerp3(e0, r0, t)), P3(lerp3(e1, r1, t)), T(C.plum), 0.6); ctx.globalAlpha = 1;
    if (VIS().includes(f)) line(P3(e0), P3(e1), T(H.trim), 1.3);
  }
  // one face of a box as a wall with its openings, or only the stretch of it from a0 to a1
  function wallFace(f, b, name, a0 = null, a1 = null, e = H.eave) {
    poly(faceQuad(f, b, 0, e, a0, a1).map(P3), shade(H.wall, FACE[f]));
    poly(faceQuad(f, b, 0, 0.4, a0, a1).map(P3), shade(H.found, FACE[f]));
    if ((H.batten || []).includes(name)) { // upright boards with battens over the joints
      const ns = f === 'E' || f === 'W', lo = a0 ?? (ns ? b[1] : b[0]), hi = a1 ?? (ns ? b[3] : b[2]);
      ctx.globalAlpha = 0.16; for (let a = lo + 0.3; a < hi; a += 0.3) { const q = faceQuad(f, b, 0.4, e, a, a).map(P3); line(q[0], q[3], T(C.plum), 0.5); } ctx.globalAlpha = 1;
    } else { ctx.globalAlpha = 0.1; for (let z = 0.8; z < e; z += 0.4) { const q = faceQuad(f, b, z, z, a0, a1).map(P3); line(q[0], q[1], T(C.plum), 0.5); } ctx.globalAlpha = 1; }
    H.open.forEach((o, i) => { if (o.b === name && o.f === f) drawOpen(o, b, i); });
  }
  const OV = 0.35, see = (f) => VIS().includes(f);
  // The front porch sits under the main roof: its floor and steps, the planter under the big window, the posts, and
  // the two little clipped trees in pots by the door.
  // The roof comes further down over the porch than over the part that stands forward: PE is the porch's eave.
  const PE = H.pwall && H.bay ? H.eave - H.pitch * (H.main[2] - H.bay[2]) : H.eave;
  function porchBits(part = 'all') {
    const x = H.pwall[2], b = H.main, pf = H.pfloor, pl = H.planter;
    const posts = () => { for (const q of H.posts || []) box([q[0] - 0.08, q[1] - 0.08, q[0] + 0.08, q[1] + 0.08], q[2] ?? 0.45, PE, H.trim); };
    if (part === 'posts') return posts();
    box([x, pf[0], b[2], pf[1]], 0, 0.45, H.found, '#eef0f0');
    { const nx = Math.round((b[2] - x) / 0.35), ny = Math.round((pf[1] - pf[0]) / 0.35), dx = (b[2] - x) / nx, dy = (pf[1] - pf[0]) / ny; // grey and white tiles
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) if ((i + j) % 2) ground3([x + i * dx, pf[0] + j * dy, x + (i + 1) * dx, pf[0] + (j + 1) * dy], 0.45, T('#7f8b94')); }
    for (const y of H.topiary || []) { box([x + 0.14, y - 0.2, x + 0.54, y + 0.2], 0.45, 0.85, '#f4f2ec'); line(P(x + 0.34, y, 0.85), P(x + 0.34, y, 1.9), T('#6a5040'), 0.7);
      for (const [z, r] of [[1.12, 2.9], [1.56, 2.4], [1.96, 1.9]]) { const p = P(x + 0.34, y, z); ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7); ctx.fillStyle = T(mix('#3f8a4c', C.plum, 0.1)); ctx.fill(); ctx.beginPath(); ctx.arc(p[0] - r * 0.25, p[1] - r * 0.3, r * 0.5, 0, 7); ctx.fillStyle = T('#5aa85e'); ctx.fill(); } }
    box(pl, 0, 0.75, H.found, C.mulch);
    for (let k = 0; k < 11; k++) { const p = P(pl[0] + 0.25 + 0.4 * hash(k, 3), pl[1] + 0.3 + k * (pl[3] - pl[1] - 0.6) / 10, 0.8 + 0.25 * hash(k, 4)); ctx.fillStyle = T(growing ? ['#4aa34c', '#e2607a', '#4aa34c', '#f2c94c', '#3f8a4c'][k % 5] : '#7d8a5a'); ctx.fillRect(p[0] - 1, p[1] - 1.6, 2, 2.4); }
    if (part === 'all') posts();
  }
  function drawMain() {
    const b = H.main, pw = H.pwall, bay = H.bay, e = H.eave;
    const X0 = b[0] - OV, Y0 = b[1] - OV, Y1 = b[3] + OV, XB = (bay || b)[2] + OV, XP = b[2] + OV, hw = (XB - X0) / 2, zr = e + H.pitch * hw, cx = (X0 + XB) / 2, g = H.gable;
    // the south wall runs the whole depth of the house and closes the porch's end; it is lower under the porch roof
    const south = () => { if (!pw) return wallFace('S', b, 'main'); wallFace('S', b, 'main', b[0], bay[2]); poly(faceQuad('S', b, 0, PE + 0.2, bay[2], b[2]).map(P3), shade(H.wall, FACE.S)); poly(faceQuad('S', b, 0, 0.4, bay[2], b[2]).map(P3), shade(H.found, FACE.S)); };
    if (!pw) for (const f of VIS()) wallFace(f, b, 'main');
    else { // the front wall steps back behind the porch (pwall) south of the part that stands forward (bay)
      if (!see('E')) { porchBits(); if (see('S')) wallFace('S', bay, 'bay', pw[2], bay[2]); }
      if (see('W')) wallFace('W', b, 'main');
      if (see('E')) {
        if (!see('S')) poly(faceQuad('S', b, 0, PE, pw[2], b[2]).map(P3), shade(H.wall, FACE.N)); // the inside of the porch's end wall
        wallFace('E', pw, 'pwall');
        if (see('S')) { wallFace('S', bay, 'bay', pw[2], bay[2]); wallFace('E', bay, 'bay'); porchBits('floor'); south(); porchBits('posts'); }
        else { porchBits(); wallFace('N', b, 'main', b[0], bay[2]); wallFace('E', bay, 'bay'); }
      } else { if (see('N')) wallFace('N', b, 'main', b[0], bay[2]); if (see('S')) south(); }
    }
    const R1 = [cx, g ? Y0 : Y0 + hw, zr], R2 = [cx, g ? Y1 : Y1 - hw, zr], ys = pw ? bay[3] : Y1, RM = [cx, ys, zr];
    const east = pw ? [[[XB, Y0, e], [XB, ys, e], RM, R1], [[XP, ys, PE], [XP, Y1, PE], R2, RM]] : [[[XB, Y0, e], [XB, Y1, e], R2, R1]];
    const faces = { W: [[[X0, Y1, e], [X0, Y0, e], R1, R2]], E: east, N: [[[X0, Y0, e], [XB, Y0, e], R1, R1]], S: [[[XB, Y1, e], [X0, Y1, e], R2, R2]] };
    const roof = (f) => { for (const q of faces[f]) roofFace(...q, f); if (f === 'E' && pw) { line(P(XB, ys, e), P(XP, ys, PE), T(H.trim), 1.2); // the step where the porch roof runs on
      if (H.vent) { const v = H.vent, z = zr - H.pitch * (v[0] - cx); line(P(v[0], v[1], z), P(v[0], v[1], z + 0.45), T('#b5673f'), 1.2); } } };
    const vis = VIS();
    if (g) { // a ridge from end to end: the two ends are wall up to the peak
      for (const f of ['W', 'E']) if (!see(f)) roof(f);
      for (const f of ['N', 'S']) if (see(f)) { const y = f === 'N' ? b[1] : b[3]; poly([P(X0, y, e), P(XB, y, e), P(cx, y, zr)], shade(H.wall, FACE[f])); }
      for (const f of ['W', 'E']) if (see(f)) roof(f);
      for (const f of ['N', 'S']) if (see(f)) { const y = f === 'N' ? Y0 : Y1, lowS = f === 'S' && pw; line(P(X0, y, e), P(cx, y, zr), T(H.trim), 1.2); line(P(cx, y, zr), P(lowS ? XP : XB, y, lowS ? PE : e), T(H.trim), 1.2); }
    } else { for (const f of ['N', 'E', 'W', 'S'].filter((k) => !vis.includes(k))) roof(f); for (const f of vis) roof(f); }
    const c = H.chimney, zc = zr - H.pitch * (cx - c[0]) - 0.3; box([c[0], c[1], c[2], c[3]], zc, c[4], H.chim || '#9a4633'); box([c[0] - 0.08, c[1] - 0.08, c[2] + 0.08, c[3] + 0.08], c[4], c[4] + 0.12, H.chim || C.stone); box([c[0] + 0.15, c[1] + 0.35, c[2] - 0.15, c[3] - 0.35], c[4] + 0.12, c[4] + 0.42, '#3a3640');
  }
  // The garage: lower than the house, its ridge running back from the street, a wall up to the peak at the yard end.
  function drawWing() {
    const b = H.wing, m = H.main, e = H.wingEave || H.eave;
    if (see('W')) wallFace('W', b, 'wing', null, null, e);
    if (see('N')) wallFace('N', b, 'wing', b[0], Math.min(b[2], m[0]), e);
    if (see('S')) wallFace('S', b, 'wing', null, null, e);
    if (see('E')) wallFace('E', b, 'wing', Math.max(b[1], m[3]), b[3], e);
    const X0 = b[0] - OV, Y0 = b[1] - OV, X1 = b[2] + OV, Y1 = b[3] + OV, hw = (Y1 - Y0) / 2, zr = e + H.pitch * hw, cy = (Y0 + Y1) / 2;
    const A = [X0, cy, zr], X = H.wingCross, B = [X1 - hw, cy, zr];
    // crossed: at the street end a second ridge runs across the first, so the roof slopes down to the garage door and
    // the south side has a peak of its own. Otherwise the street end is hipped.
    const NN = [X1 - hw, Y0, zr], SS = [X1 - hw, Y1, zr], xv = X1 - 2 * hw;
    const faces = X ? { S: [[[xv, Y1, e], [X0, Y1, e], A, B]], N: [[[X0, Y0, e], [xv, Y0, e], B, A]], E: [[[X1, Y0, e], [X1, Y1, e], SS, NN]], W: [[[xv, Y1, e], [xv, Y1, e], B, SS], [[xv, Y0, e], [xv, Y0, e], NN, B]] }
      : { S: [[[X1, Y1, e], [X0, Y1, e], A, B]], N: [[[X0, Y0, e], [X1, Y0, e], B, A]], E: [[[X1, Y0, e], [X1, Y1, e], B, B]], W: [] };
    const roof = (f) => { for (const q of faces[f]) { if (f === 'W') poly(q.map(P3), shade(mix(H.roof, C.hi, 0.1), FACE.W * 0.5 + 0.5)); else roofFace(...q, f); } };
    for (const f of ['N', 'E', 'S', 'W']) if (!see(f)) roof(f);
    if (see('W')) poly([P(b[0], Y0, e), P(b[0], Y1, e), P(b[0], cy, zr)], shade(H.wall, FACE.W));
    if (X) for (const f of ['N', 'S']) if (see(f)) { const y = f === 'N' ? b[1] : b[3]; poly([P(xv, y, e), P(X1, y, e), P(X1 - hw, y, zr)], shade(H.wall, FACE[f])); }
    for (const f of see('W') ? ['N', 'S', 'E', 'W'] : ['N', 'S', 'W', 'E']) if (see(f)) roof(f);
    if (see('W')) { line(P(X0, Y0, e), P(X0, cy, zr), T(H.trim), 1.2); line(P(X0, cy, zr), P(X0, Y1, e), T(H.trim), 1.2); }
    if (X) for (const f of ['N', 'S']) if (see(f)) { const y = f === 'N' ? Y0 : Y1; line(P(xv, y, e), P(X1 - hw, y, zr), T(H.trim), 1.2); line(P(X1 - hw, y, zr), P(X1, y, e), T(H.trim), 1.2); }
  }
  // The covered back porch, raised on its brick base, and the steps down to the patio.
  function drawBackPorch() {
    const k = H.back, b = k.box, fl = k.floor, top = H.eave - 0.3, st = k.stairs;
    box(b, 0, fl, H.found, '#cfd2d2');
    const rail = (x0, y0, x1, y1) => { line(P(x0, y0, fl + 0.9), P(x1, y1, fl + 0.9), T(H.trim), 1.1); line(P(x0, y0, fl + 0.15), P(x1, y1, fl + 0.15), T(H.trim), 0.7);
      const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 0.3)); for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n; line(P(x, y, fl + 0.15), P(x, y, fl + 0.9), T(H.trim), 0.5); } };
    const posts = () => { for (const y of [b[1] + 0.1, st[1] - 0.05, st[3] + 0.05, (st[3] + b[3]) / 2, b[3] - 0.1]) box([b[0] + 0.02, y - 0.07, b[0] + 0.16, y + 0.07], fl, top, H.trim); };
    const rails = () => { if (see('N')) rail(b[0] + 0.09, b[1] + 0.1, b[2], b[1] + 0.1); rail(b[0] + 0.09, b[1] + 0.1, b[0] + 0.09, st[1]); rail(b[0] + 0.09, st[3], b[0] + 0.09, b[3] - 0.1); if (see('S')) rail(b[0] + 0.09, b[3] - 0.1, b[2], b[3] - 0.1); };
    posts(); rails();
    box([b[0] - 0.3, b[1] - 0.25, b[2], b[3] + 0.25], top, top + 0.16, k.roof || H.trim, mix(k.roof || H.trim, C.hi, 0.3));
  }
  function drawBackSteps() {
    const k = H.back, st = k.stairs, fl = k.floor, n = 5, dx = (st[2] - st[0]) / n, order = [...Array(n).keys()]; if (!see('W')) order.reverse();
    for (const i of order) box([st[2] - (i + 1) * dx, st[1], st[2] - i * dx, st[3]], 0, fl * (1 - (i + 1) / (n + 1)), '#c9ccce', '#b5babd');
    for (const y of [st[1], st[3]]) { line(P(st[2], y, fl + 0.9), P(st[0], y, 0.95), T(H.trim), 1.1); line(P(st[0], y, 0), P(st[0], y, 0.95), T(H.trim), 1.3); }
  }

  // ---------- trees and shrubs ----------
  function drawTree(t, i, time) {
    const sway = Math.sin(time * 0.8 + i * 1.7) * 0.06 * Math.min(3, (wx().windMph ?? 5) / 6);
    const p0 = P(t.x, t.y), top = P(t.x + sway, t.y, t.h);
    if (t.k === 'cedar') return drawCedar(t, i, sway);
    if (t.k === 'crape') return drawCrape(t, i, sway);
    if (t.k === 'pine') {
      line(p0, P(t.x, t.y, 1.2), T('#5a4030'), 2.2);
      for (let k = 0; k < 4; k++) { const z0 = 1 + k * (t.h - 1) / 4.6, z1 = z0 + (t.h - 1) / 3, r = t.r * (1 - k * 0.21); const a = P(t.x + sway * k / 4, t.y, z0), b = P(t.x + sway, t.y, z1);
        poly([[a[0] - r * TW * 1.2, a[1]], [a[0], a[1] + r * TH * 1.1], [a[0] + r * TW * 1.2, a[1]], b], T(mix(C.pine, k % 2 ? '#1f5a3a' : '#35875a', 0.4)));
        poly([[a[0] - r * TW * 1.2, a[1]], [a[0], a[1] + r * TH * 1.1], b], T(mix(C.pine, C.plum, 0.25))); }
      return;
    }
    const trunkTop = P(t.x + sway * 0.4, t.y, t.h * 0.45); ctx.lineCap = 'round';
    line(p0, trunkTop, T('#6a5040'), Math.max(2, t.r * 0.75));
    for (let k = 0; k < 7; k++) { // branches
      const a = k * 0.9 + i, r = t.r * (0.55 + 0.4 * hash(i, k)), z = t.h * (0.62 + 0.36 * hash(k, i));
      const e = P(t.x + Math.cos(a) * r + sway, t.y + Math.sin(a) * r, z); const mid = [(trunkTop[0] + e[0]) / 2 + 2 * Math.cos(a), (trunkTop[1] + e[1]) / 2 + 3];
      ctx.beginPath(); ctx.moveTo(trunkTop[0], trunkTop[1]); ctx.quadraticCurveTo(mid[0], mid[1], e[0], e[1]); ctx.strokeStyle = T('#6a5040'); ctx.lineWidth = 1.5; ctx.stroke();
      if (leafAmt < 0.5) { const e2 = P(t.x + Math.cos(a + 0.5) * r * 1.2 + sway, t.y + Math.sin(a + 0.5) * r * 1.2, z + 1.2); line(e, e2, T('#7a6050'), 0.8); }
    }
    ctx.lineCap = 'butt';
    if (leafAmt > 0.02) {
      const n = Math.round(26 * leafAmt) + 3;
      for (let k = 0; k < n; k++) { const a = k * 2.4 + i, rr = t.r * 0.85 * Math.sqrt(hash(i + 3, k)), z = t.h * (0.58 + 0.36 * hash(k + 9, i)) + (k % 3) * 0.5;
        const p = P(t.x + Math.cos(a) * rr + sway, t.y + Math.sin(a) * rr, z); const r = t.r * TW * (0.24 + 0.14 * hash(k, i + 5)) * (0.7 + 0.3 * leafAmt);
        ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7); ctx.fillStyle = T(mix(leafCol(t.k, k), k % 3 === 0 ? C.hi : C.plum, k % 3 === 0 ? 0.12 : 0.14)); ctx.fill(); }
    }
    void top;
  }
  // The big cedar by the street: a trunk a metre thick, long level limbs, and foliage hanging from them in flat
  // layers that get shorter toward a blunt top. Nothing like a Christmas tree.
  const EVER = (k) => k === 'pine' || k === 'cedar';
  function drawCedar(t, i, sway) {
    ctx.lineCap = 'round';
    const bark = T('#6b5546'), base = P(t.x, t.y), fork = P(t.x + sway * 0.2, t.y, t.h * 0.5), tip = P(t.x + sway, t.y, t.h * 0.9);
    poly([[base[0] - 4.6, base[1]], [base[0] + 4.6, base[1]], [fork[0] + 2.6, fork[1]], [fork[0] - 2.6, fork[1]]], bark); line(fork, tip, bark, 3.2);
    const [du, dv] = uv(CX + 1, CY), [eu, ev] = uv(CX, CY + 1), pads = [];
    for (let k = 0; k < 58; k++) { const f = 0.2 + 0.78 * Math.pow(k / 57, 0.85), z = t.h * f, a = k * 2.399 + i, reach = t.r * (f < 0.42 ? 0.78 + 0.27 * (f - 0.2) / 0.22 : 1.05 - 0.92 * Math.pow((f - 0.42) / 0.58, 1.2)) * (0.6 + 0.4 * hash(k, i + 2));
      const ox = Math.cos(a) * reach, oy = Math.sin(a) * reach; pads.push({ z, ox, oy, reach, d: ox * (du + dv) + oy * (eu + ev), k }); }
    pads.sort((p, q) => p.d - q.d || p.z - q.z);
    for (const q of pads) { const s2 = sway * q.z / t.h, a0 = P(t.x + s2 * 0.5, t.y, q.z + 0.6), c = P(t.x + q.ox * 0.7 + s2, t.y + q.oy * 0.7, q.z - 0.2), w = Math.max(11, q.reach * TW * 0.62), h = w * 0.46;
      line(a0, c, bark, q.z < t.h * 0.5 ? 2.4 : 1.3);
      const blob = (dx, dy, kw, col) => { ctx.beginPath(); ctx.ellipse(c[0] + dx, c[1] + dy, w * kw, h * kw, 0, 0, 7); ctx.fillStyle = T(col); ctx.fill(); };
      blob(0, h * 0.55, 0.9, '#2c5a4b'); blob(-w * 0.55, h * 0.5, 0.5, '#2c5a4b'); blob(w * 0.5, h * 0.6, 0.45, '#2c5a4b'); // the hanging underside
      blob(0, 0, 1, q.k % 3 ? '#3f7a62' : '#38705a'); blob(-w * 0.2, -h * 0.3, 0.6, '#4f8c72'); blob(w * 0.25, -h * 0.42, 0.34, '#66a088'); }
    ctx.lineCap = 'butt';
    if (t.flag) { const [fu] = uv(CX + 1, CY), [, fv] = uv(CX + 1, CY), sd = fu - fv >= 0 ? 1 : -1, a = P(t.x, t.y, 3.3), b2 = [a[0] + sd * 9, a[1] - 6]; line(a, b2, T('#d8d4cc'), 0.8); // the flag on a pole from the trunk, toward the street
      ctx.save(); ctx.translate(b2[0], b2[1]); ctx.rotate(sd * 0.25 + Math.sin(sway * 9) * 0.05); for (let r = 0; r < 5; r++) { ctx.fillStyle = T(r % 2 ? '#f4ecda' : '#b5372c'); ctx.fillRect(sd > 0 ? -7.5 : 0, 0.4 + r, 7.5, 1); } ctx.fillStyle = T('#2f4a86'); ctx.fillRect(sd > 0 ? -7.5 : 4.5, 0.4, 3, 2.6); ctx.restore(); }
  }
  // A crape myrtle: several smooth pale stems leaning out from the ground, a loose head, pink flowers in high summer.
  function drawCrape(t, i, sway) {
    ctx.lineCap = 'round'; const p0 = P(t.x, t.y), ends = [];
    for (let k = 0; k < 5; k++) { const a = k * 1.257 + i, e = P(t.x + Math.cos(a) * t.r * 0.55 + sway, t.y + Math.sin(a) * t.r * 0.55, t.h * (0.6 + 0.1 * hash(k, i))); ends.push(e);
      ctx.beginPath(); ctx.moveTo(p0[0] + (k - 2) * 0.7, p0[1]); ctx.quadraticCurveTo(p0[0] + (e[0] - p0[0]) * 0.25, (p0[1] + e[1]) / 2, e[0], e[1]); ctx.strokeStyle = T(k % 2 ? '#b99b80' : '#a5886e'); ctx.lineWidth = 1.5; ctx.stroke(); }
    ctx.lineCap = 'butt';
    const n = Math.round(16 * leafAmt) + (leafAmt > 0.02 ? 2 : 0), bloom = doy > 170 && doy < 262;
    for (let k = 0; k < n; k++) { const e = ends[k % 5], a = k * 2.4 + i, rr = t.r * 0.5 * Math.sqrt(hash(i + 3, k)), r = t.r * TW * (0.2 + 0.1 * hash(k, i + 5)) * (0.7 + 0.3 * leafAmt);
      const x = e[0] + Math.cos(a) * rr * TW, y = e[1] - 3 + Math.sin(a) * rr * TH - (k % 3) * 3;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = T(mix(bloom && k % 3 === 0 ? '#e2607a' : leafCol('maple', k), k % 3 === 0 ? C.hi : C.plum, k % 3 === 0 ? 0.12 : 0.14)); ctx.fill(); }
  }
  function drawShrub(s, i) { if (s[3]) { const q = P(s[0], s[1], s[3] * 0.72); ctx.beginPath(); ctx.arc(q[0], q[1], s[2] * TW * 0.8, 0, 7); ctx.fillStyle = T(mix('#3f9458', C.plum, 0.08)); ctx.fill(); } // a tall one has a head above its skirt
    const p = P(s[0], s[1], s[2] * 0.6); for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(p[0] + (k - 1) * s[2] * TW * 0.5, p[1] + (k === 1 ? -2 : 1), s[2] * TW * 0.62, 0, 7); ctx.fillStyle = T(mix('#35875a', k === 1 ? C.hi : C.plum, k === 1 ? 0.1 : 0.15 + 0.05 * (i % 2))); ctx.fill(); } }

  // ---------- people ----------
  // A little figure about 22 model pixels tall, feet at (X, Y). o: { pose, face: ±1 on screen, away, t, look, hold }
  function figure(X, Y, o) {
    const L = o.look, f = o.face || 1, t = o.t || 0, run = o.pose === 'run', sit = o.pose === 'sit' || o.pose === 'kneel';
    ctx.save(); ctx.translate(X, Y); ctx.lineCap = 'round';
    ctx.fillStyle = 'rgba(44,33,71,.22)'; ctx.beginPath(); ctx.ellipse(0, 0.5, 5, 2, 0, 0, 7); ctx.fill();
    const moving = o.pose === 'walk' || run || o.pose === 'push';
    const sw = moving ? Math.sin(t) : 0, amp = run ? 4.6 : 2.8, bob = moving ? Math.abs(Math.cos(t)) * (run ? 1.6 : 0.7) : 0;
    const hipY = sit ? (o.pose === 'kneel' ? -4 : -6.5) : -9.5 - bob, lean = run ? 1.6 * f : o.pose === 'push' ? 1 * f : 0;
    const leg = (s, col) => { ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(s * 1.1, hipY);
      if (sit) { ctx.lineTo(s * 1.1 + f * 4.2, hipY + (o.pose === 'kneel' ? 3.6 : 0.4)); ctx.lineTo(s * 1.1 + f * (o.pose === 'kneel' ? 0.5 : 4.6), 0); }
      else { const a = s * sw; const kx = s * 1.1 + a * amp * 0.55 * f + (run ? f * 0.8 : 0), fx = s * 1.1 + a * amp * f, fy = -Math.max(0, -a) * (run ? 3.2 : 1.2); ctx.lineTo(kx, hipY / 2 + fy * 0.3); ctx.lineTo(fx, fy); ctx.stroke();
        ctx.strokeStyle = T(L.shoes); ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx + f * 1.3, fy); }
      ctx.stroke(); };
    leg(-1, T(mix(L.bottom, C.plum, 0.25))); leg(1, T(L.bottom));
    const sh = hipY - 8.2; // shoulders
    ctx.fillStyle = T(L.top); ctx.beginPath(); ctx.roundRect(-3 + lean * 0.5, sh, 6, hipY - sh + 1.2, 2.2); ctx.fill();
    const arm = (s, col) => { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(s * 2.6 + lean, sh + 1.2);
      if (o.pose === 'push') ctx.lineTo(f * 5.6, sh + 5);
      else if (o.hold && s === (f > 0 ? 1 : -1)) ctx.lineTo(f * 4.2, sh + 4.4);
      else if (sit) ctx.lineTo(s * 2.6 + f * 2.6, sh + 6);
      else if (run) { ctx.lineTo(s * 2.6 + lean - s * sw * 2.2 * f, sh + 4.2); ctx.lineTo(s * 2.6 + lean - s * sw * 3.4 * f + f * 1.6, sh + 2.6); }
      else ctx.lineTo(s * 2.6 - s * sw * 2.4 * f, sh + 6.4);
      ctx.stroke(); };
    arm(-1, T(mix(L.top, C.plum, 0.25))); arm(1, T(mix(L.top, C.hi, 0.1)));
    const hx = lean * 1.2, hy = sh - 2.9;
    ctx.fillStyle = T(L.skin); ctx.beginPath(); ctx.arc(hx, hy, 2.9, 0, 7); ctx.fill();
    ctx.fillStyle = T(L.hair); ctx.beginPath();
    if (o.away) ctx.arc(hx, hy, 3.05, 0, 7); else { ctx.arc(hx, hy, 3.05, Math.PI * (f > 0 ? 0.95 : 1.25), Math.PI * (f > 0 ? 1.75 : 2.05)); ctx.lineTo(hx - f * 2.6, hy + 1.4); }
    ctx.fill();
    if (L.style === 'pony') { ctx.strokeStyle = T(L.hair); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(hx - f * 2.4, hy - 0.8); ctx.quadraticCurveTo(hx - f * (5 + (moving ? sw * 0.8 : 0)), hy - 0.5, hx - f * 4.4, hy + 3.6 + (moving ? Math.cos(t * 2) * (run ? 1.3 : 0.5) : 0)); ctx.stroke(); }
    else if (L.style === 'long') { ctx.fillRect(hx - f * 3.1 - 1, hy, 2.2, 4.6); }
    else if (L.style === 'cap') { ctx.fillStyle = T(L.cap || '#a63d2a'); ctx.beginPath(); ctx.arc(hx, hy - 0.6, 3.1, Math.PI, 0); ctx.fill(); ctx.fillRect(hx + (f > 0 ? 0 : -4.4), hy - 1, 4.4, 1); }
    if (o.hold === 'mug') { ctx.fillStyle = T('#fff6e4'); ctx.fillRect(f * 4.2 - 0.7, sh + 3.4, 1.4, 1.6); }
    if (o.hold === 'book') { ctx.fillStyle = T('#fff6e4'); ctx.fillRect(f * 3.2, sh + 3.2, f * 2.6, 2.4); ctx.fillStyle = T('#a63d2a'); ctx.fillRect(f * 3.2, sh + 5.4, f * 2.6, 0.6); }
    if (o.hold === 'stick') { ctx.strokeStyle = T('#5a4030'); ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(f * 4.2, sh + 4.4); ctx.lineTo(f * 8.5, sh + 9); ctx.stroke(); }
    if (wet() && !sit && o.out) { ctx.fillStyle = T(o.umb || '#a63d2a'); ctx.beginPath(); ctx.ellipse(hx, hy - 6, 8, 3.2, 0, Math.PI, 0); ctx.fill(); ctx.strokeStyle = T(C.plum); ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(hx, hy - 6); ctx.lineTo(f * 3, sh + 4); ctx.stroke(); }
    ctx.restore();
  }
  // which way a heading in the yard points on screen
  const facing = (hx, hy) => { const [u, v] = [uv(CX + hx, CY + hy)[0], uv(CX + hx, CY + hy)[1]]; return { face: u - v >= 0 ? 1 : -1, away: u + v < -0.2 }; };
  const HER = lot.her;
  const FRIENDS = [
    { skin: '#c68a5e', hair: '#1c1616', style: 'short', top: '#c98a2b', bottom: '#3a3f55', shoes: '#f4ecda' },
    { skin: '#f0c8a6', hair: '#c9a25a', style: 'long', top: '#a63d2a', bottom: '#2c2147', shoes: '#57566a' },
    { skin: '#8a5a3c', hair: '#1c1616', style: 'cap', cap: '#4a68b0', top: '#f4ecda', bottom: '#4a5d3a', shoes: '#f4ecda' },
    { skin: '#e2b08a', hair: '#7a3a22', style: 'short', top: '#4a68b0', bottom: '#57566a', shoes: '#2c2147' },
  ];
  const CARS = ['#4a68b0', '#f4ecda', '#a63d2a'];

  // ---------- where everyone is ----------
  const chairAt = (i) => { const a = lot.chairs[i].a * rad; return [F.x + Math.cos(a) * 1.95, F.y + Math.sin(a) * 1.95]; };
  const D = lot.doors, SX = lot.street[0] + 0.7;
  const MOW = mowRoute(lot);
  const rFront = makeRoute([...lot.walk, [SX, lot.walk[lot.walk.length - 1][1]]]);
  const outRoute = (north) => makeRoute([...rFront.pts, [SX, north ? lot.base[1] - 1 : lot.base[3] + 1]]);
  const YARD = D.yard || [D.back[0] - 1, D.back[1]]; // the way out of the back door and onto the grass
  const backTo = (p) => makeRoute([D.back, YARD, p]);
  const toPatio = makeRoute([D.back, lot.patioChair]);
  const NEAR = [F.x + 0.9, F.y - 1.1]; // where she stands to tend the fire
  const mowAll = makeRoute([D.back, YARD, [lot.shed.box[2] + 0.8, lot.shed.box[3] - 1.5], ...MOW.route.pts, D.gateOut, D.gateIn, [lot.shed.box[2] + 0.8, lot.shed.box[3] - 1.5]]);
  const mowLead = dist(D.back, YARD) + dist(YARD, [lot.shed.box[2] + 0.8, lot.shed.box[3] - 1.5]) + dist([lot.shed.box[2] + 0.8, lot.shed.box[3] - 1.5], MOW.route.pts[0]);
  const carY = (i) => D.gateOut[1] - 5 - i * 6.2;
  const friendRoute = (i, car) => makeRoute([[SX - 0.5, carY(car)], [SX - 0.5, D.gateOut[1]], D.gateOut, D.gateIn, ...(D.gateYard ? [D.gateYard] : []), ...(lot.chairs[i + 1].via ? [lot.chairs[i + 1].via] : []), chairAt(i + 1)]);
  const bedSpots = (lot.gardenBeds ? lot.gardenBeds.map((k) => lot.beds[k]) : lot.beds).flatMap((b) => [[b[2] + 0.5, b[1] + 1.2], [b[2] + 0.5, (b[1] + b[3]) / 2], [b[2] + 0.5, b[3] - 1.2]]).sort((p, q) => p[1] - q[1]);

  /** Everyone and everything that moves, for this minute: { people: [...], mower, cars, fire: 0..1, mown: metres, away } */
  function cast(c, st, time) {
    const out = { people: [], mower: null, cars: [], fire: 0, mown: null, away: false };
    const t = (c.min - st.t0) * 60, Tt = (st.t1 - st.t0) * 60; // seconds in, seconds long
    const walkT = time * 7.2, look = HER;
    const her = (q, pose, extra = {}) => out.people.push({ x: q.x, y: q.y, ...facing(q.hx ?? 0, q.hy ?? 1), pose, t: pose === 'run' ? time * 11 : walkT, look: extra.look || look, ...extra });
    // go somewhere, stay, come back: the route out, and what to do there
    const errand = (route, pose, extra, focus, v = 1.25) => {
      const d = route.len / v;
      if (t < d) her(route.at(t * v), 'walk'); else if (t > Tt - d) { const q = route.at((Tt - t) * v); her({ ...q, hx: -q.hx, hy: -q.hy }, 'walk'); }
      else { const e = route.at(route.len); her({ x: e.x, y: e.y, hx: focus[0] - e.x, hy: focus[1] - e.y }, pose, extra); }
    };
    if (st.kind === 'run' || st.kind === 'walk') {
      const v = st.kind === 'run' ? 3.1 : 1.3, north = dayRand(c, 5) > 0.5, ro = outRoute(north), rb = outRoute(!north);
      const lookOut = st.kind === 'run' ? { ...look, top: look.runTop, bottom: look.runBottom } : look, pose = st.kind;
      if (t * v < ro.len) her(ro.at(t * v), pose, { look: lookOut, out: true });
      else if ((Tt - t) * v < rb.len) { const q = rb.at((Tt - t) * v); her({ ...q, hx: -q.hx, hy: -q.hy }, pose, { look: lookOut, out: true }); }
      else out.away = true;
    } else if (st.kind === 'mow') {
      const lead = 40, v = mowAll.len / Math.max(60, Tt - lead), d = clamp((t - lead / 2) * v, 0, mowAll.len), q = mowAll.at(d);
      her(q, d > 0 && d < mowAll.len ? 'push' : 'stand'); out.mower = { x: q.x + q.hx * 0.75, y: q.y + q.hy * 0.75, hx: q.hx, hy: q.hy, on: d > 0 && d < mowAll.len };
      out.mown = d - mowLead;
    } else if (st.kind === 'garden') {
      const n = bedSpots.length, each = Tt / n, k = Math.min(n - 1, Math.floor(t / each)), p = bedSpots[k];
      const from = k ? bedSpots[k - 1] : D.front, r = makeRoute([from, p]), tt = t - k * each;
      if (tt * 1.2 < r.len) her(r.at(tt * 1.2), 'walk'); else her({ x: p[0], y: p[1], hx: -1, hy: 0 }, Math.sin(time * 0.5 + k) > -0.3 ? 'kneel' : 'stand');
    } else if (st.kind === 'coffee') errand(toPatio, 'sit', { hold: 'mug', seat: true }, [lot.patioChair[0] - 3, lot.patioChair[1] + 1]);
    else if (st.kind === 'read') errand(backTo(chairAt(0)), 'sit', { hold: 'book' }, [F.x, F.y]);
    else if (st.kind === 'fire') {
      const r = backTo(chairAt(0)), d = r.len / 1.25, tend = 7 * 60;
      const near = NEAR, rn = backTo(near);
      if (t < rn.len / 1.25) her(rn.at(t * 1.25), 'walk');
      else if (t < tend) her({ x: near[0], y: near[1], hx: F.x - near[0], hy: F.y - near[1] }, 'stand', { hold: 'stick' });
      else if (t > Tt - d) { const q = r.at((Tt - t) * 1.25); her({ ...q, hx: -q.hx, hy: -q.hy }, 'walk'); }
      else { const e = chairAt(0), up = Math.sin(time * 0.05) > 0.93; her({ x: up ? near[0] : e[0], y: up ? near[1] : e[1], hx: F.x - e[0], hy: F.y - e[1] }, up ? 'stand' : 'sit', up ? { hold: 'stick' } : { hold: Math.sin(time * 0.3) > 0.4 ? 'mug' : null }); }
      out.fire = clamp((t - 150) / 240) * clamp((Tt - 60 - t) / 300);
      const n = Math.min(st.friends || 3, FRIENDS.length);
      for (let i = 0; i < n; i++) {
        const car = n > 2 ? i % 2 : 0, fr = friendRoute(i, car), fd = fr.len / 1.25, ta = (12 + i * 6) * 60, tl = Tt - (15 - i * 3) * 60;
        const base = { look: FRIENDS[i], t: walkT + i * 1.3, out: true, umb: CARS[i % 3] };
        if (t > ta - 60 && t < tl + fd + 40 && !out.cars.some((k) => k.i === car)) out.cars.push({ i: car, y: carY(car), col: CARS[car] });
        if (t < ta || t > tl + fd) continue;
        if (t < ta + fd) { const q = fr.at((t - ta) * 1.25); out.people.push({ x: q.x, y: q.y, ...facing(q.hx, q.hy), pose: 'walk', ...base }); }
        else if (t > tl) { const q = fr.at(fr.len - (t - tl) * 1.25); out.people.push({ x: q.x, y: q.y, ...facing(-q.hx, -q.hy), pose: 'walk', ...base }); }
        else { const e = chairAt(i + 1); out.people.push({ x: e[0], y: e[1], ...facing(F.x - e[0], F.y - e[1]), pose: 'sit', ...base, hold: Math.sin(time * 0.21 + i * 2) > 0.2 ? 'mug' : null }); }
      }
    }
    return out;
  }

  // ---------- the view ----------
  let Wc = 800, Hc = 450, dpr = 1, zoom = +Q.get('z') || 1, fit = 1, panX = +(Q.get('pan') || '').split(',')[0] || 0, panY = +(Q.get('pan') || '').split(',')[1] || 0;
  function extent() { const b = lot.base, pts = [P(b[0], b[1]), P(b[2], b[1]), P(b[2], b[3]), P(b[0], b[3])]; const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys) - Math.max(15, ...lot.trees.map((t) => t.h + 2)) * ZP, y1: Math.max(...ys) + 1.6 * ZP }; }
  function resize() {
    const r = canvas.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1); Wc = Math.max(50, r.width); Hc = Math.max(50, r.height);
    canvas.width = Math.round(Wc * dpr); canvas.height = Math.round(Hc * dpr);
    const e = extent(); fit = Math.min(Wc / (e.x1 - e.x0 + 30), Hc / (e.y1 - e.y0 + 30));
  }
  new ResizeObserver(resize).observe(canvas); resize();
  const clampView = () => { zoom = clamp(zoom, 0.8, 7); const e = extent(), s = fit * zoom, mx = Math.max(0, (e.x1 - e.x0) * s / 2), my = Math.max(0, (e.y1 - e.y0) * s / 2); panX = clamp(panX, -mx, mx); panY = clamp(panY, -my, my); };
  function zoomAt(k, px = Wc / 2, py = Hc / 2) { const z0 = zoom; zoom = clamp(zoom * k, 0.8, 7); const r = zoom / z0; panX = (panX - (px - Wc / 2)) * r + (px - Wc / 2); panY = (panY - (py - Hc / 2)) * r + (py - Hc / 2); clampView(); }
  const ptrs = new Map(); let pinch = 0;
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); pinch = 0; });
  canvas.addEventListener('pointermove', (e) => { const p = ptrs.get(e.pointerId); if (!p) return;
    if (ptrs.size === 1) { panX += e.clientX - p[0]; panY += e.clientY - p[1]; clampView(); }
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) { const r = canvas.getBoundingClientRect(); zoomAt(d / pinch, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top); } pinch = d; } });
  const up = (e) => { ptrs.delete(e.pointerId); pinch = 0; }; canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); const r = canvas.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  canvas.addEventListener('keydown', (e) => { const k = e.key; if (k === '+' || k === '=') zoomAt(1.3); else if (k === '-') zoomAt(1 / 1.3); else if (k === 'r' || k === 'R') api.rotate(); else if (k.startsWith('Arrow')) { panX += k === 'ArrowLeft' ? 60 : k === 'ArrowRight' ? -60 : 0; panY += k === 'ArrowUp' ? 60 : k === 'ArrowDown' ? -60 : 0; clampView(); } else return; e.preventDefault(); });

  // ---------- draw order ----------
  // Everything that stands up has a box on the ground. A thing is drawn before another when it lies wholly behind it
  // along either ground axis as seen from this corner; only pairs that can overlap on screen are compared.
  function sortObjs(objs) {
    for (const o of objs) { const c = [uv(o.x0, o.y0), uv(o.x1, o.y0), uv(o.x1, o.y1), uv(o.x0, o.y1)]; o.u0 = Math.min(...c.map((p) => p[0])); o.u1 = Math.max(...c.map((p) => p[0])); o.v0 = Math.min(...c.map((p) => p[1])); o.v1 = Math.max(...c.map((p) => p[1]));
      const pad = o.pad || 0; o.sx0 = (o.u0 - o.v1) * TW - pad; o.sx1 = (o.u1 - o.v0) * TW + pad; o.sy0 = (o.u0 + o.v0) * TH - (o.h || 0) * ZP - pad; o.sy1 = (o.u1 + o.v1) * TH + 2; o.n = 0; o.after = []; }
    const E = 0.01;
    for (let i = 0; i < objs.length; i++) for (let j = i + 1; j < objs.length; j++) {
      const a = objs[i], b = objs[j]; if (a.sx1 < b.sx0 || b.sx1 < a.sx0 || a.sy1 < b.sy0 || b.sy1 < a.sy0) continue;
      const ab = a.u1 <= b.u0 + E || a.v1 <= b.v0 + E, ba = b.u1 <= a.u0 + E || b.v1 <= a.v0 + E;
      let first = ab && !ba ? a : ba && !ab ? b : null;
      if (!first && !ab && !ba) first = a.u0 + a.v0 + a.u1 + a.v1 <= b.u0 + b.v0 + b.u1 + b.v1 ? a : b; // overlapping footprints: nearer middle last
      if (!first) continue; const second = first === a ? b : a; first.after.push(second); second.n++;
    }
    const out = [], ready = objs.filter((o) => !o.n), left = new Set(objs);
    const key = (o) => o.u0 + o.v0 + o.u1 + o.v1;
    while (left.size) {
      if (!ready.length) { let m = null; for (const o of left) if (!m || key(o) < key(m)) m = o; m.n = 0; ready.push(m); }
      ready.sort((a, b) => key(b) - key(a)); const o = ready.pop(); if (!left.has(o)) continue; left.delete(o); out.push(o);
      for (const k of o.after) if (--k.n === 0 && left.has(k)) ready.push(k);
    }
    return out;
  }

  // the parts that never move
  const FENCE = lot.fence || C.wood, CEDAR = lot.cedar || FENCE, GRAVEL = lot.gravel || C.gravel, PAVER = lot.paver || C.paver;
  const fixed = [];
  const obj = (x0, y0, x1, y1, h, draw, pad = 0) => fixed.push({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), h, draw, pad });
  obj(...H.main, 8, drawMain); obj(...H.wing, 6, drawWing);
  if (H.back) { obj(...H.back.box, H.eave, drawBackPorch); obj(...H.back.stairs, H.back.floor + 1, drawBackSteps); }
  if (lot.gazebo) { const g = lot.gazebo, b = g.box, cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, o = 0.3, e = g.h, top = [cx, cy, e + 0.75];
    obj(...b, e + 1, () => { // four posts, a hard roof coming to a point, the table under it
      for (const [a, c] of [[-0.95, 0], [0.95, 0], [0, -0.75], [0, 0.75]]) { box([cx + a - 0.22, cy + c - 0.22, cx + a + 0.22, cy + c + 0.22], 0.3, 0.45, '#5b5560'); } box([cx - 0.65, cy - 0.45, cx + 0.65, cy + 0.45], 0.66, 0.74, '#5a4a40'); for (const [a, c] of [[-0.5, -0.3], [0.5, -0.3], [-0.5, 0.3], [0.5, 0.3]]) line(P(cx + a, cy + c, 0), P(cx + a, cy + c, 0.66), T('#3a3340'), 1);
      for (const [x, y] of [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]]) box([x - 0.07, y - 0.07, x + 0.07, y + 0.07], 0, e, g.post);
      const c = { W: [[b[0] - o, b[3] + o, e], [b[0] - o, b[1] - o, e]], E: [[b[2] + o, b[1] - o, e], [b[2] + o, b[3] + o, e]], N: [[b[0] - o, b[1] - o, e], [b[2] + o, b[1] - o, e]], S: [[b[2] + o, b[3] + o, e], [b[0] - o, b[3] + o, e]] };
      for (const f of ['N', 'E', 'W', 'S'].filter((q) => !see(q)).concat(VIS())) poly([...c[f], top].map(P3), shade(mix(g.roof, C.hi, see(f) && (f === 'S' || f === 'W') ? 0.12 : 0), FACE[f] * 0.5 + 0.5));
      const u = 0.62, z0 = e + 0.6, t2 = [cx, cy, e + 1.12], c2 = { W: [[cx - u, cy + u, z0], [cx - u, cy - u, z0]], E: [[cx + u, cy - u, z0], [cx + u, cy + u, z0]], N: [[cx - u, cy - u, z0], [cx + u, cy - u, z0]], S: [[cx + u, cy + u, z0], [cx - u, cy + u, z0]] };
      for (const f of ['N', 'E', 'W', 'S'].filter((q) => !see(q)).concat(VIS())) poly([...c2[f], t2].map(P3), shade(mix(g.roof, C.hi, see(f) && (f === 'S' || f === 'W') ? 0.2 : 0.06), FACE[f] * 0.5 + 0.5));
    }, 6); }
  for (const g of lot.grills || []) obj(...g.box, g.h + 0.1, () => { const r = g.box; for (const [x, y] of [[r[0] + 0.08, r[1] + 0.08], [r[2] - 0.08, r[3] - 0.08]]) line(P(x, y, 0), P(x, y, 0.5), T('#2a2630'), 1); box(r, 0.4, g.h, g.c, mix(g.c, C.hi, 0.2)); }); // under their covers
  for (const [x, y] of lot.bins || []) obj(x - 0.3, y - 0.35, x + 0.3, y + 0.35, 1.1, () => { box([x - 0.3, y - 0.35, x + 0.3, y + 0.35], 0, 1.0, '#4d5a52', '#3f4a44'); });
  { const s = H.stoop; obj(s[0], s[1], s[2], s[3], s[4], () => { box([s[0], s[1], s[2], s[3]], 0, s[4], H.found, '#eef0f0');
    const nx = 2, ny = Math.round((s[3] - s[1]) / 0.33), dx = (s[2] - s[0]) / nx, dy = (s[3] - s[1]) / ny; for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) if ((i + j) % 2) ground3([s[0] + i * dx, s[1] + j * dy, s[0] + (i + 1) * dx, s[1] + (j + 1) * dy], s[4], T('#7f8b94')); }); }
  { const s = lot.shed, b = s.box; obj(...b, s.h + 1, () => { box(b, 0, s.h, s.wall);
    const cx = (b[0] + b[2]) / 2, e = s.h, zr = e + 0.75, o = 0.15, tr = s.trim || C.hi; const A = [cx, b[1] - o, zr], B = [cx, b[3] + o, zr];
    for (const f of VIS()) if (f === 'S' || f === 'N') { const y = f === 'S' ? b[3] : b[1]; poly([P(b[0], y, e), P(b[2], y, e), P(cx, y, zr)], shade(s.wall, FACE[f])); }
    if (see('E')) { const cy = (b[1] + b[3]) / 2 - 0.35, q = (a0, a1, z0, z1) => faceQuad('E', b, z0, z1, a0, a1).map(P3), m = shade(tr, FACE.E); // double doors with their braces, and a small window
      const d = q(cy - 0.8, cy + 0.8, 0.12, 1.85); poly(d, shade(mix(s.wall, C.hi, 0.08), FACE.E), m, 0.7); const md = q(cy, cy, 0.12, 1.85); line(md[0], md[3], m, 0.7);
      for (const [a0, a1] of [[cy - 0.8, cy], [cy, cy + 0.8]]) { const h = q(a0, a1, 0.12, 1.85); line(h[0], h[2], m, 0.5); }
      poly(q(b[3] - 1.0, b[3] - 0.4, 1.0, 1.6), shade(mix(C.glass, C.plum, 0.25), FACE.E), m, 0.7); }
    const fw = [[b[0] - o, b[3] + o, e], [b[0] - o, b[1] - o, e], A, B], fe = [[b[2] + o, b[1] - o, e], [b[2] + o, b[3] + o, e], B, A];
    if (VIS().includes('W')) { roofFace(...fe, 'E'); roofFace(...fw, 'W'); } else { roofFace(...fw, 'W'); roofFace(...fe, 'E'); } }); }
  const panel = (a, b, col, i, brace) => { const r = [Math.min(a[0], b[0]) - 0.05, Math.min(a[1], b[1]) - 0.05, Math.max(a[0], b[0]) + 0.05, Math.max(a[1], b[1]) + 0.05];
    box(r, 0.05, 1.6, i % 2 ? col : mix(col, C.plum, 0.12)); box([a[0] - 0.09, a[1] - 0.09, a[0] + 0.09, a[1] + 0.09], 0, 1.75, mix(col, C.plum, 0.3));
    if (brace) { const m = T(mix(col, C.plum, 0.38)); line(P(a[0], a[1], 0.25), P(b[0], b[1], 1.45), m, 0.8); line(P(a[0], a[1], 0.25), P(b[0], b[1], 0.25), m, 0.6); line(P(a[0], a[1], 1.45), P(b[0], b[1], 1.45), m, 0.6); } };
  for (const f of lot.fences) { const L = Math.hypot(f[2] - f[0], f[3] - f[1]), n = Math.ceil(L / 1.5), col = f[4] ? CEDAR : FENCE;
    for (let i = 0; i < n; i++) { const a = [f[0] + (f[2] - f[0]) * i / n, f[1] + (f[3] - f[1]) * i / n], b = [f[0] + (f[2] - f[0]) * (i + 1) / n, f[1] + (f[3] - f[1]) * (i + 1) / n];
      obj(Math.min(a[0], b[0]) - 0.05, Math.min(a[1], b[1]) - 0.05, Math.max(a[0], b[0]) + 0.05, Math.max(a[1], b[1]) + 0.05, 1.7, () => panel(a, b, col, i)); } }
  // A gate is two braced leaves between posts. One that people use swings open while someone is passing.
  for (const g of lot.gates || []) { const col = g.new ? CEDAR : FENCE, a = g.a, b = g.b, m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], L = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2;
    for (const q of [a, b]) obj(q[0] - 0.1, q[1] - 0.1, q[0] + 0.1, q[1] + 0.1, 1.8, () => box([q[0] - 0.1, q[1] - 0.1, q[0] + 0.1, q[1] + 0.1], 0, 1.8, mix(col, C.plum, 0.3)));
    const leaf = (q, k) => () => { const open = g.opens && GATE_OPEN(m), to = open ? [q[0] + g.opens[0] * L, q[1] + g.opens[1] * L] : m; panel(q, to, col, k, true); };
    const ox = g.opens ? g.opens[0] * L : 0, oy = g.opens ? g.opens[1] * L : 0;
    [a, b].forEach((q, k) => obj(Math.min(q[0], m[0], q[0] + ox) - 0.05, Math.min(q[1], m[1], q[1] + oy) - 0.05, Math.max(q[0], m[0], q[0] + ox) + 0.05, Math.max(q[1], m[1], q[1] + oy) + 0.05, 1.7, leaf(q, k))); }
  let PEOPLE = []; const GATE_OPEN = (m) => PEOPLE.some((p) => Math.hypot(p.x - m[0], p.y - m[1]) < 2.2);
  lot.trees.forEach((t, i) => fixed.push({ x0: t.x - 0.4, y0: t.y - 0.4, x1: t.x + 0.4, y1: t.y + 0.4, h: t.h, pad: t.r * TW * 1.3, tree: t, draw: (time) => drawTree(t, i, time) }));
  if (lot.ac) obj(...lot.ac, 0.9, () => { box(lot.ac, 0, 0.8, '#b9bcb8', '#8f9390'); });
  (lot.hedge || []).forEach((s, i) => obj(s[0] - s[2], s[1] - s[2], s[0] + s[2], s[1] + s[2], 2.2, () => { // a row of small upright evergreens
    const a = P(s[0], s[1], 0.2), t = P(s[0], s[1], 2.1), w = s[2] * TW * 1.1; poly([[a[0] - w, a[1]], [a[0], a[1] + w * 0.45], [a[0] + w, a[1]], t], T(i % 2 ? '#2f6f4a' : '#2b7448')); poly([[a[0] - w, a[1]], [a[0], a[1] + w * 0.45], t], T(mix('#2b7448', C.plum, 0.22))); }, 4));
  lot.shrubs.forEach((s, i) => obj(s[0] - s[2], s[1] - s[2], s[0] + s[2], s[1] + s[2], s[3] || s[2] * 1.4, () => drawShrub(s, i), 4));
  function drawChair(x, y, col, fx, fy) { // a low wooden chair turned toward (fx, fy)
    const d = Math.hypot(fx - x, fy - y) || 1, bx = x - (fx - x) / d * 0.38, by = y - (fy - y) / d * 0.38;
    box([x - 0.33, y - 0.33, x + 0.33, y + 0.33], 0.25, 0.42, col); for (const [a, b] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) line(P(x + a, y + b, 0), P(x + a, y + b, 0.3), T(mix(col, C.plum, 0.4)), 1);
    box([bx - 0.3, by - 0.3, bx + 0.3, by + 0.3].map((v, i) => (Math.abs(fx - x) > Math.abs(fy - y) ? (i % 2 ? v : (i ? bx + 0.07 : bx - 0.07)) : (i % 2 ? (i > 1 ? by + 0.07 : by - 0.07) : v))), 0.3, 1.05, col);
  }
  lot.chairs.forEach((ch, i) => { const [x, y] = chairAt(i); obj(x - 0.4, y - 0.4, x + 0.4, y + 0.4, 1.1, () => drawChair(x, y, ch.c, F.x, F.y)); });
  { const [x, y] = lot.patioChair; obj(x - 0.4, y - 0.4, x + 0.4, y + 0.4, 1.1, () => drawChair(x, y, '#f4ecda', x - 3, y + 0.5)); obj(x - 1.5, y + 0.9, x - 0.7, y + 1.7, 0.6, () => { box([x - 1.5, y + 0.9, x - 0.7, y + 1.7], 0.5, 0.58, '#f4ecda'); line(P(x - 1.1, y + 1.3, 0), P(x - 1.1, y + 1.3, 0.5), T(C.stone), 1.4); }); }
  let FIRE = 0;
  obj(F.x - 0.6, F.y - 0.6, F.x + 0.6, F.y + 0.6, 1.4, (time) => {
    disc(F.x, F.y, 0, 0.62, T(mix(C.stone, C.plum, 0.35))); disc(F.x, F.y, 0.32, 0.62, T(C.stone)); disc(F.x, F.y, 0.32, 0.46, FIRE > 0.05 ? mix('#3a2a26', '#ff7426', FIRE * 0.6) : T('#3a2a26'));
    for (const a of [0.3, 1.9, 3.6]) line(P(F.x + Math.cos(a) * 0.34, F.y + Math.sin(a) * 0.34, 0.36), P(F.x - Math.cos(a) * 0.3, F.y - Math.sin(a) * 0.3, 0.52), FIRE > 0.05 ? mix('#5a4030', '#ff9a3c', FIRE * 0.5) : T('#5a4030'), 2);
    if (FIRE <= 0.02) return;
    const p = P(F.x, F.y, 0.45);
    for (const [k, col, w, hh] of [[0, '#ff7426', 5.2, 15], [1, '#ffb13c', 3.6, 11], [2, '#ffe9a8', 1.9, 6.5]]) {
      const fl = (0.75 + 0.25 * Math.sin(time * (7 + k * 2.3) + k) + 0.12 * Math.sin(time * 17.3 + k * 4)) * FIRE, sx = Math.sin(time * (3.1 + k)) * 1.6;
      ctx.beginPath(); ctx.moveTo(p[0] - w, p[1]); ctx.quadraticCurveTo(p[0] - w * 0.9, p[1] - hh * fl * 0.5, p[0] + sx, p[1] - hh * fl); ctx.quadraticCurveTo(p[0] + w * 0.9, p[1] - hh * fl * 0.5, p[0] + w, p[1]); ctx.closePath(); ctx.fillStyle = col; ctx.fill();
    }
  }, 14);
  // the wood pile by the shed
  { const b = lot.shed.box, r = [b[0] + 0.3, b[1] - 0.6, b[2] - 0.3, b[1] - 0.1]; obj(...r, 0.8, () => { box(r, 0, 0.75, '#8a6a4a', '#b08a62'); }); }

  // Does this tree's crown cover the house from here? Only then is it thinned.
  function veils(o) { const t = o.tree, hb = [Math.min(H.main[0], H.wing[0], H.back ? H.back.box[0] : 1e9), Math.min(H.main[1], H.wing[1]), Math.max(H.main[2], H.wing[2]), Math.max(H.main[3], H.wing[3])];
    const [tu, tv] = uv(t.x, t.y), c = [[hb[0], hb[1]], [hb[2], hb[1]], [hb[2], hb[3]], [hb[0], hb[3]]].map((q) => uv(q[0], q[1])); if (tu + tv <= (c[0][0] + c[0][1] + c[2][0] + c[2][1]) / 2) return false; // behind its middle
    const xs = c.map((q) => (q[0] - q[1]) * TW), ys = c.map((q) => (q[0] + q[1]) * TH), R = t.r * TW * 1.25, tx = (tu - tv) * TW, ty = (tu + tv) * TH;
    return tx + R > Math.min(...xs) && tx - R < Math.max(...xs) && ty > Math.min(...ys) - 7 * ZP && ty - t.h * ZP < Math.max(...ys); }

  // ---------- one frame ----------
  let lastSay = '', lastKey = '';
  function frame(now) {
    const time = now / 1000, c = clock(), st = nowDoing(c, wx(), sunT, FORCED);
    SUN = sunPos(dateOf(c)); NIGHT = clamp((5 - SUN.alt) / 13);
    const overcast = wet() || wx().sky === 'cloudy';
    const who = cast(c, st, time); FIRE = who.fire; PEOPLE = who.mower ? [...who.people, who.mower] : who.people;
    if (DBG) window.__who = { ...who, min: c.min, kind: st.kind };
    const dark = NIGHT > 0.35, home = !who.away;
    const litSet = st.kind === 'asleep' ? 0 : !dark ? 0 : st.kind === 'inside' ? 0.62 : home ? 0.3 : 0.12;
    LIT = (i) => litSet > 0 && hash(i * 3.7, c.d) < litSet;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const skyTop = mix(overcast ? '#9aa6b5' : '#8ec3e6', '#141233', NIGHT), skyLow = mix(mix(overcast ? '#c5ccd3' : '#f3e2c0', '#f0965a', clamp(1 - Math.abs(SUN.alt - 2) / 9) * (overcast ? 0.2 : 0.7)), '#2c2147', NIGHT);
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height); g.addColorStop(0, skyTop); g.addColorStop(1, skyLow); ctx.fillStyle = g; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (NIGHT > 0.5 && !overcast) { ctx.fillStyle = `rgba(255,246,228,${(NIGHT - 0.5) * 1.4})`; for (let i = 0; i < 70; i++) ctx.fillRect(hash(i, 11) * canvas.width, hash(i, 12) * canvas.height * 0.6, hash(i, 13) > 0.8 ? 2 * dpr : dpr, hash(i, 13) > 0.8 ? 2 * dpr : dpr); }
    const e = extent(), s = fit * zoom * dpr;
    ctx.setTransform(s, 0, 0, s, canvas.width / 2 + panX * dpr - (e.x0 + e.x1) / 2 * s, canvas.height / 2 + panY * dpr - (e.y0 + e.y1) / 2 * s);
    ctx.lineJoin = 'round';

    // the model's base and the ground
    const b = lot.base; box(b, -1.3, 0, C.clay, mix(C.rough, lawnCol, 0.4));
    for (const r of lot.lawns) ground(r, T(lawnCol));
    // stripes where the mower has been
    let mown = who.mown, fade = 1;
    if (mown == null && growing) { const since = c.day === 5 ? (c.min > 655 ? 0 : 7) : (c.day + 2) % 7; if (since <= 3 && (c.day !== 5 || c.min > 655)) { mown = 1e9; fade = [1, 0.75, 0.5, 0.28][since]; } }
    if (mown != null && mown > 0) for (const sp of MOW.stripes) {
      if (mown <= sp.d0) continue; const k = clamp((mown - sp.d0) / Math.max(0.01, sp.d1 - sp.d0)), yb = sp.ya + (sp.yb - sp.ya) * k;
      ctx.globalAlpha = fade; ground([sp.x - MOW.W / 2, Math.min(sp.ya, yb), sp.x + MOW.W / 2, Math.max(sp.ya, yb)], T(mix(lawnCol, sp.par ? '#2f7a3a' : '#c9f08a', 0.28))); ctx.globalAlpha = 1;
    }
    for (const r of lot.beds) ground(r, T(C.mulch));
    for (const r of lot.paths) ground(r, T(GRAVEL));
    for (const r of lot.pavers || []) { ground(r, T(PAVER)); ctx.globalAlpha = 0.2; for (let y = r[1] + 0.6; y < r[3]; y += 0.6) line(P(r[0], y), P(r[2], y), T(C.plum), 0.5); ctx.globalAlpha = 1; }
    for (const r of lot.pads || []) ground(r, T('#cfc6b3'));
    for (const pt of lot.patios || [lot.patio]) { ground(pt, T(PAVER)); ctx.globalAlpha = 0.18; for (let x = pt[0] + 0.8; x < pt[2]; x += 0.8) line(P(x, pt[1]), P(x, pt[3]), T(C.plum), 0.5); for (let y = pt[1] + 0.8; y < pt[3]; y += 0.8) line(P(pt[0], y), P(pt[2], y), T(C.plum), 0.5); ctx.globalAlpha = 1; }
    if (lot.patios) { const pt = lot.patios[0], k = T('#c9b48c'); line(P(pt[0], pt[1]), P(pt[0], pt[3]), k, 1.8); line(P(pt[0], pt[1]), P(pt[2], pt[1]), k, 1.8); line(P(pt[0], pt[3]), P(pt[2], pt[3]), k, 1.8); } // the row of blocks that edges the patio
    if (F.bare) disc(F.x, F.y, 0, 1.05, T(mix(lawnCol, '#b8a888', 0.4))); // a ring of stones on the grass
    else { disc(F.x, F.y, 0, F.r, T(C.gravel)); disc(F.x, F.y, 0, F.r - 0.25, T(mix(C.gravel, '#b8a888', 0.5))); }
    // fallen leaves in autumn
    if (doy > 285 && doy < 350) for (let i = 0; i < 90; i++) { const t = lot.trees[i % lot.trees.length]; if (EVER(t.k)) continue; const a = hash(i, 1) * 7, r = t.r * 1.3 * Math.sqrt(hash(i, 2)), x = t.x + Math.cos(a) * r, y = t.y + Math.sin(a) * r; if (x < b[0] || x > lot.street[0] || y < b[1] || y > b[3]) continue; const p = P(x, y); ctx.fillStyle = T(leafCol(t.k, i)); ctx.fillRect(p[0], p[1], 1.6, 1); }
    // the street
    ground([lot.street[0], b[1], b[2], b[3]], T(wet() ? '#434862' : C.asphalt)); ground([lot.street[0] - 0.25, b[1], lot.street[0], b[3]], T(C.mortar));
    // shadows from the real sun
    if (SUN.alt > 3) {
      const L = Math.min(3.2, 1 / Math.tan(SUN.alt * rad)), az = (SUN.az + 180) * rad, sx = Math.sin(az) * L, sy = -Math.cos(az) * L;
      ctx.save(); ctx.beginPath(); for (const q of [P(b[0], b[1]), P(b[2], b[1]), P(b[2], b[3]), P(b[0], b[3])]) ctx.lineTo(q[0], q[1]); ctx.clip(); // shadows stay on the model
      ctx.fillStyle = `rgba(44,33,71,${overcast ? 0.1 : 0.24})`;
      const cast2 = (r, h) => { const pts = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]; const all = [...pts, ...pts.map((p) => [p[0] + sx * h, p[1] + sy * h])].map((p) => P(p[0], p[1])); poly(hull(all), ctx.fillStyle); };
      cast2(H.main, H.eave + 1.4); cast2(H.wing, (H.wingEave || H.eave) + 0.6); if (H.back) cast2(H.back.box, H.eave); if (lot.gazebo) cast2(lot.gazebo.box, lot.gazebo.h + 0.4); cast2(lot.shed.box, lot.shed.h + 0.3);
      for (const f of lot.fences) cast2([Math.min(f[0], f[2]), Math.min(f[1], f[3]), Math.max(f[0], f[2]) + 0.05, Math.max(f[1], f[3]) + 0.05], 1.6);
      for (const t of lot.trees) { const k = EVER(t.k) ? 1 : 0.3 + 0.7 * leafAmt; ctx.globalAlpha = k; const p = P(t.x + sx * t.h * 0.75, t.y + sy * t.h * 0.75); ctx.beginPath(); ctx.ellipse(p[0], p[1], t.r * TW * 1.2, t.r * TH * 1.2, 0, 0, 7); ctx.fill(); line(P(t.x, t.y), p, ctx.fillStyle, 2); ctx.globalAlpha = 1; }
      ctx.restore();
    }

    // everything standing, back to front
    const objs = fixed.slice();
    for (const car of who.cars) { const x = lot.street[0] + 1.5, y = car.y; objs.push({ x0: x - 0.9, y0: y - 2.2, x1: x + 0.9, y1: y + 2.2, h: 1.6, draw: () => {
      box([x - 0.9, y - 2.2, x + 0.9, y + 2.2], 0.25, 0.95, car.col); box([x - 0.8, y - 1.1, x + 0.8, y + 1.3], 0.95, 1.5, mix(C.glass, C.plum, 0.35), mix(car.col, C.hi, 0.15));
      for (const yy of [y - 1.4, y + 1.4]) for (const xx of [x - 0.9, x + 0.9]) disc(xx, yy, 0.2, 0.22, T('#26232e')); } }); }
    if (who.mower) { const m = who.mower; objs.push({ x0: m.x - 0.3, y0: m.y - 0.3, x1: m.x + 0.3, y1: m.y + 0.3, h: 0.5, draw: () => {
      box([m.x - 0.28, m.y - 0.28, m.x + 0.28, m.y + 0.28], 0.08, 0.32, '#c0321f'); box([m.x - 0.13, m.y - 0.13, m.x + 0.13, m.y + 0.13], 0.32, 0.46, '#2a2630');
      line(P(m.x - m.hx * 0.25, m.y - m.hy * 0.25, 0.3), P(m.x - m.hx * 0.72, m.y - m.hy * 0.72, 0.95), T('#2a2630'), 1.2);
      if (m.on) for (let i = 0; i < 5; i++) { const a = (time * 3 + i / 5) % 1, q = P(m.x - m.hy * (0.3 + a * 0.6), m.y + m.hx * (0.3 + a * 0.6), 0.1 + Math.sin(a * 3.1) * 0.3); ctx.fillStyle = T('#8ad05a'); ctx.fillRect(q[0], q[1], 1.2, 1.2); } } }); }
    for (const p of who.people) objs.push({ x0: p.x - 0.25, y0: p.y - 0.25, x1: p.x + 0.25, y1: p.y + 0.25, h: 1.8, pad: 8, draw: () => { const q = P(p.x, p.y, p.pose === 'sit' && !p.kneel ? 0.0 : 0); figure(q[0], q[1], p); } });
    const night0 = NIGHT;
    // strings of bulbs from the back porch out to the trees: on when it is dark and someone is up
    const bulbs = () => { const on = dark && litSet > 0;
      for (const [a, z] of lot.lights || []) { const n = Math.max(4, Math.round(Math.hypot(z[0] - a[0], z[1] - a[1]) / 1.1)), at = (t) => P(a[0] + (z[0] - a[0]) * t, a[1] + (z[1] - a[1]) * t, a[2] + (z[2] - a[2]) * t - Math.sin(Math.PI * t) * 0.8);
        ctx.beginPath(); for (let i = 0; i <= 14; i++) { const q = at(i / 14); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); } ctx.strokeStyle = T('#3a3340'); ctx.lineWidth = 0.45; ctx.stroke();
        for (let i = 1; i < n; i++) { const q = at(i / n); if (on) { ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(255,190,80,.16)'; ctx.beginPath(); ctx.arc(q[0], q[1] + 0.9, 3.2, 0, 7); ctx.fill(); ctx.globalCompositeOperation = 'source-over'; } ctx.fillStyle = on ? '#ffe9a8' : T('#efe6cf'); ctx.fillRect(q[0] - 0.7, q[1], 1.4, 1.7); } } };
    if (!see('W')) bulbs(); // from the street side the house stands in front of them
    for (const o of sortObjs(objs)) { // things round the fire are lit by it
      const d = Math.hypot((o.x0 + o.x1) / 2 - F.x, (o.y0 + o.y1) / 2 - F.y); NIGHT = d < 3.4 && !o.tree ? night0 * (1 - 0.7 * FIRE * (1 - d / 5)) : night0;
      if (o.tree && veils(o)) { // a tree between you and the house: drawn on its own sheet, then laid over thinly
        if (!sheet) sheet = document.createElement('canvas'); if (sheet.width !== canvas.width || sheet.height !== canvas.height) { sheet.width = canvas.width; sheet.height = canvas.height; }
        const main = ctx, m = ctx.getTransform(); ctx = sheet.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, sheet.width, sheet.height); ctx.setTransform(m); ctx.lineJoin = 'round';
        o.draw(time); ctx = main; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 0.4; ctx.drawImage(sheet, 0, 0); ctx.restore();
        const t = o.tree; line(P(t.x, t.y), P(t.x, t.y, Math.min(t.h * 0.3, 4)), T(EVER(t.k) ? '#6b5546' : '#6a5040'), EVER(t.k) ? 6 : Math.max(2, t.r * 0.75)); // its foot stays solid
        continue;
      }
      o.draw(time);
    }
    NIGHT = night0;
    if (see('W')) bulbs();

    // smoke, sparks and the warm light, over everything
    if (FIRE > 0.02) {
      const wind = clamp((wx().windMph ?? 4) / 14, 0.1, 1.4);
      for (let i = 0; i < 9; i++) { const a = (time * 0.11 + i / 9) % 1, p = P(F.x + a * a * 3.4 * wind + Math.sin(time * 0.7 + i) * 0.2, F.y - a * 1.2 * wind, 1 + a * 6.5); ctx.beginPath(); ctx.arc(p[0], p[1], 3 + a * 11, 0, 7); ctx.fillStyle = `rgba(${NIGHT > 0.5 ? '170,160,190' : '235,230,225'},${(1 - a) * 0.2 * FIRE})`; ctx.fill(); }
      for (let i = 0; i < 7; i++) { const a = (time * 0.6 + hash(i, 7)) % 1, p = P(F.x + Math.sin(i * 2.4 + a * 5) * 0.4 * (0.5 + a), F.y, 0.8 + a * 3.2); ctx.fillStyle = `rgba(255,${180 + (i * 9) % 60},90,${(1 - a) * FIRE})`; ctx.fillRect(p[0], p[1], 1.1, 1.1); }
      const p = P(F.x, F.y, 0.6), R = (95 + 8 * Math.sin(time * 9) + 5 * Math.sin(time * 23)) * (0.5 + 0.5 * FIRE); const gl = ctx.createRadialGradient(p[0], p[1], 2, p[0], p[1], R);
      const k = (0.1 + 0.42 * NIGHT) * FIRE; gl.addColorStop(0, `rgba(255,170,70,${k})`); gl.addColorStop(0.4, `rgba(255,120,40,${k * 0.4})`); gl.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gl; ctx.save(); ctx.translate(p[0], p[1]); ctx.scale(1, 0.62); ctx.translate(-p[0], -p[1]); ctx.beginPath(); ctx.arc(p[0], p[1], R, 0, 7); ctx.fill(); ctx.restore(); ctx.globalCompositeOperation = 'source-over';
    }
    // the porch light, and light spilling from lit windows
    if (dark) { ctx.globalCompositeOperation = 'lighter';
      const spill = (p, R, a) => { const gl = ctx.createRadialGradient(p[0], p[1], 1, p[0], p[1], R); gl.addColorStop(0, `rgba(255,215,94,${a})`); gl.addColorStop(1, 'rgba(255,215,94,0)'); ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(p[0], p[1], R, 0, 7); ctx.fill(); };
      if (VIS().includes('E')) spill(P((H.pwall || H.main)[2] + 0.1, D.front[1] - 0.9, 2.3), 30, 0.5 * NIGHT);
      H.open.forEach((o, i) => { if (o.k === 'win' && LIT(i) && VIS().includes(o.f)) { const bx = H[o.b]; spill(P3(faceQuad(o.f, bx, 1.2, 1.2, o.a, o.a)[0]), 22, 0.2 * NIGHT); } });
      ctx.globalCompositeOperation = 'source-over'; }
    // rain
    if (wet()) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.strokeStyle = wx().precip === 'snow' ? 'rgba(255,255,255,.8)' : 'rgba(200,215,240,.45)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 0; i < 140; i++) { const x = hash(i, 3) * Wc, sp = wx().precip === 'snow' ? 60 : 620, y = (hash(i, 4) * Hc + time * sp * (0.7 + 0.6 * hash(i, 5))) % Hc; ctx.moveTo(x, y); ctx.lineTo(x - (wx().precip === 'snow' ? 1 : 3), y + (wx().precip === 'snow' ? 1.5 : 11)); } ctx.stroke(); }

    const say = sayDoing(st, c, dark), key = say + '|' + Math.floor(c.min);
    if (key !== lastKey) { lastKey = key; lastSay = say; onSay({ say, clock: c, state: st, night: NIGHT, away: who.away, next: st.next }); }
    requestAnimationFrame(frame);
  }
  function hull(p) { p = p.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const lo = [], up2 = [];
    for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up2.length >= 2 && cr(up2[up2.length - 2], up2[up2.length - 1], q) <= 0) up2.pop(); up2.push(q); }
    up2.pop(); lo.pop(); return lo.concat(up2); }

  const api = {
    rotate() { rot = (rot + 1) & 3; panX = panY = 0; resize(); },
    zoom(d) { zoomAt(d > 0 ? 1.35 : 1 / 1.35); },
    home() { zoom = 1; panX = panY = 0; },
    setWeather(w) { weather = w; },
    plan: () => planDay(clock(), sunT),
  };
  requestAnimationFrame(frame);
  void lastSay;
  return api;
}

// The small real things on the downtown model: pools, fountains, courts, playgrounds, brick paving, the ballpark's
// diamond, fences, benches, hydrants, statues and so on.
//
// Where they are comes from public/model/details.json (tools/model/details.py: OpenStreetMap, plus a short list checked
// by eye against the aerial). Everything here is drawn once into the model's static tiles, never per frame: flat things
// in the ground pass (under the streets, or on top of them), low things as a few pixels standing on the ground, tall
// things as static points that take their place among the buildings, and rooftop pools on the roof they sit on.
//
//   const DT = makeDetails(details, env)       env: the model's own drawing helpers (see startModel)
//   DT.under(c) / DT.over(c)                   inside the ground pass, c already in ground-plane units
//   DT.low(c)                                  after the ground pass, c in model pixels
//   DT.points                                  [{kind:'prop', what, gx, gy, ph (height, px), pr (radius, m)}]
//   DT.drawProp(c, o)                          draws one of those
//   DT.roof(c, b)                              rooftop details of building b, called right after b is drawn
//   DT.wet(gx, gy)                             is this spot in a pool or fountain (no trees or parked cars there)

const WATER = '#49b4e4', WATER_HI = '#9fdcf2', COPING = '#ece6da';
const SURF = {
  court: '#3f78b4', turf: '#58b34c', play: '#c9a070', sand: '#ecdba6', dogpark: '#b9a27a', platform: '#d7d1c4',
  brick: '#bb6a4e', pavers: '#cdbfa9', seating: '#cdbfa9',
};
const pairs = (a) => { const r = []; for (let i = 0; i < a.length; i += 2) r.push([a[i], a[i + 1]]); return r; };
const bbOf = (q, m = 1) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of q) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return [x0 - m, y0 - m, x1 + m, y1 + m]; };
const trace = (c, q, close = true) => { c.beginPath(); q.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); if (close) c.closePath(); };
const mid = (q) => [q.reduce((a, p) => a + p[0], 0) / q.length, q.reduce((a, p) => a + p[1], 0) / q.length];

export function makeDetails(DET, env) {
  const { P, M, mix, gcol, hash, pip, fr, poly, line, circ, eq, mk, inTG, lampsOn, snowy, HI, SH } = env;
  const none = { under() {}, over() {}, low() {}, points: [], drawProp() {}, roof() {}, wet: () => false, has: false };
  if (!DET) return none;
  const m = (v) => v / M; // metres to grid units
  const areas = (DET.A || []).map((a) => { const q = pairs(a.p); return { ...a, q, bb: bbOf(q), c: mid(q) }; });
  const lines = (DET.L || []).map((l) => { const q = pairs(l.p); return { ...l, q, bb: bbOf(q) }; });
  const ground = areas.filter((a) => !a.b), roofs = new Map();
  for (const a of areas) if (a.b) { if (!roofs.has(a.b)) roofs.set(a.b, []); roofs.get(a.b).push(a); }
  const wetAreas = ground.filter((a) => a.k === 'pool' || a.k === 'fountain');
  const diamonds = (DET.D || []).map((d) => { const q = pairs(d.p); return { ...d, q, bb: bbOf(q) }; });

  // brick paving read from the aerial: a small texture, one texel per cell, laid down like the ground texture
  let BK = null;
  const brickTex = () => {
    const v = DET.BK; if (!v) return null;
    const key = gcol(SURF.brick, 'walk'); if (BK && BK.key === key) return BK;
    const cnv = mk(v.w, v.h), g = cnv.getContext('2d'), img = g.createImageData(v.w, v.h), d = img.data;
    const A = parseInt(key.slice(1, 3), 16), B = parseInt(key.slice(3, 5), 16), Cc = parseInt(key.slice(5, 7), 16);
    v.rows.forEach((row, j) => {
      if (!row) return; let i = 0, on = false;
      for (const t of row.split(',')) {
        const n = parseInt(t, 16);
        if (on) for (let k = i; k < i + n; k++) { const o = (j * v.w + k) * 4, e = (hash(k * 0.37 + 2, j * 0.71 + 9) - 0.5) * 16; d[o] = A + e; d[o + 1] = B + e; d[o + 2] = Cc + e; d[o + 3] = 255; }
        i += n; on = !on;
      }
    });
    g.putImageData(img, 0, 0); BK = { c: cnv, R: v.r, key }; return BK;
  };

  // ---- flat things, ground-plane units ----
  function water(c, a) {
    c.lineJoin = 'round';
    trace(c, a.q); c.strokeStyle = gcol(COPING, 'walk'); c.lineWidth = m(a.k === 'pool' ? 3.2 : 1.6); c.stroke();    // the deck or rim
    trace(c, a.q); c.fillStyle = WATER; c.fill();
    c.save(); trace(c, a.q); c.clip();                                                                              // a lighter shallow edge
    trace(c, a.q); c.strokeStyle = WATER_HI; c.lineWidth = m(1.1); c.stroke(); c.restore();
  }
  function court(c, a) {
    const q = a.q; trace(c, q); c.fillStyle = gcol(SURF.court, 'walk'); c.fill();
    c.save(); trace(c, q); c.clip(); c.strokeStyle = gcol('#f4f1ea', 'walk'); c.lineWidth = m(0.5);
    trace(c, q); c.stroke();
    // a centre line across the longer way
    let best = 0, bi = 0; for (let i = 0; i < q.length; i++) { const b = q[(i + 1) % q.length], L = Math.hypot(b[0] - q[i][0], b[1] - q[i][1]); if (L > best) { best = L; bi = i; } }
    const a0 = q[bi], a1 = q[(bi + 1) % q.length], ux = (a1[0] - a0[0]) / best, uy = (a1[1] - a0[1]) / best, [cx, cy] = a.c;
    c.lineWidth = m(0.25); c.beginPath(); c.moveTo(cx + uy * 9, cy - ux * 9); c.lineTo(cx - uy * 9, cy + ux * 9); c.stroke();
    c.beginPath(); c.arc(cx, cy, m(1.8), 0, 7); c.stroke(); c.restore();
  }
  function surface(c, a) {
    const col = a.k === 'play' && /tartan|rubber|artificial/.test(a.s || '') ? '#4d9fd0' : SURF[a.k];
    trace(c, a.q); c.fillStyle = gcol(col, a.k === 'turf' ? 'grass' : 'walk'); c.fill();
    if (a.k === 'turf' || a.k === 'dogpark' || a.k === 'play') { c.strokeStyle = gcol(a.k === 'turf' ? '#f4f1ea' : mix(col, SH, 0.35), 'walk'); c.lineWidth = m(0.35); c.stroke(); }
    if (a.k === 'platform') { c.save(); trace(c, a.q); c.clip(); c.strokeStyle = gcol('#e8c33a', 'walk'); c.lineWidth = m(0.9); trace(c, a.q); c.stroke(); c.restore(); }
  }
  function diamond(c, d) {
    const [hx, hy] = d.h, [ux, uy] = d.d, vx = -uy, vy = ux;            // u: home plate to centre field, v: toward first base side
    const at = (a, b) => [hx + (ux * a + vx * b) / M, hy + (uy * a + vy * b) / M];
    const dirt = gcol('#c98a5a', 'grass'), grass = gcol('#63bd4f', 'grass'), grass2 = gcol('#57b046', 'grass'), chalk = gcol('#f6f3ea', 'grass');
    c.save(); trace(c, d.q); c.clip();
    trace(c, d.q); c.fillStyle = grass; c.fill();
    // mowing stripes, square to the line from home plate to centre field
    c.strokeStyle = grass2; c.lineWidth = m(5); c.lineCap = 'butt';
    for (let s = 5; s < 150; s += 10) { const a = at(s, -130), b = at(s, 130); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
    trace(c, d.q); c.strokeStyle = dirt; c.lineWidth = m(9); c.lineJoin = 'round'; c.stroke();                      // warning track
    const S2 = Math.SQRT1_2, B = 27.43, first = at(B * S2, B * S2), second = at(B * 2 * S2, 0), third = at(B * S2, -B * S2), mound = at(18.44, 0), home = at(0, 0);
    // the skinned infield: within 29 m of the pitcher's rubber, between the foul lines
    c.save(); trace(c, [at(-2, 0), at(70, 72), at(70, -72)]); c.clip();
    c.fillStyle = dirt; c.beginPath(); c.arc(mound[0], mound[1], m(29), 0, 7); c.fill(); c.restore();
    c.fillStyle = dirt;
    c.beginPath(); c.arc(home[0], home[1], m(4), 0, 7); c.fill();
    // infield grass inside the base paths
    const g0 = at(3.2 * Math.SQRT2, 0), g1 = at(B * S2, B * S2 - 3.2 * Math.SQRT2), g2 = at(B * 2 * S2 - 3.2 * Math.SQRT2, 0), g3 = at(B * S2, -(B * S2 - 3.2 * Math.SQRT2));
    trace(c, [g0, g1, g2, g3]); c.fillStyle = grass; c.fill();
    c.fillStyle = dirt; c.beginPath(); c.arc(mound[0], mound[1], m(2.7), 0, 7); c.fill();
    // foul lines and bases
    c.strokeStyle = chalk; c.lineWidth = m(0.35);
    for (const s of [-1, 1]) { const e = at(140 * S2, s * 140 * S2); c.beginPath(); c.moveTo(home[0], home[1]); c.lineTo(e[0], e[1]); c.stroke(); }
    c.fillStyle = chalk; for (const b of [first, second, third, home]) { c.beginPath(); c.arc(b[0], b[1], m(0.6), 0, 7); c.fill(); }
    c.fillRect(mound[0] - m(0.4), mound[1] - m(0.15), m(0.8), m(0.3));
    c.restore();
  }
  function under(c) {
    const tex = brickTex();
    if (tex) { c.imageSmoothingEnabled = false; c.drawImage(tex.c, 0, 0, tex.c.width / tex.R, tex.c.height / tex.R); c.imageSmoothingEnabled = true; }
    for (const d of diamonds) if (inTG(d.bb)) diamond(c, d);
    for (const a of ground) { if (!inTG(a.bb) || a.k === 'pool' || a.k === 'fountain') continue; if (a.k === 'court') court(c, a); else surface(c, a); }
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const l of lines) {
      if (!inTG(l.bb)) continue;
      if (l.k === 'brickpath') { trace(c, l.q, false); c.strokeStyle = gcol(SURF.brick, 'walk'); c.lineWidth = m(2.2); c.stroke(); }
      else if (l.k === 'stream') { trace(c, l.q, false); c.strokeStyle = gcol('#6f9a4a', 'grass'); c.lineWidth = m(5); c.stroke(); trace(c, l.q, false); c.strokeStyle = WATER; c.lineWidth = m(2.2); c.stroke(); }
    }
  }
  function over(c) {
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const a of wetAreas) if (inTG(a.bb)) water(c, a);
    for (const l of lines) {
      if (!inTG(l.bb) || (l.k !== 'fence' && l.k !== 'wall')) continue;
      trace(c, l.q, false); c.strokeStyle = l.k === 'wall' ? gcol('#a49b8d', 'walk') : mix('#6b6259', SH, 0.2); c.lineWidth = m(l.k === 'wall' ? 0.6 : 0.3); c.stroke();
    }
  }

  // ---- low things: a few pixels standing on the ground (model pixels) ----
  const LOW = { bench: 1, table: 1, hydrant: 1, bin: 1, bike: 1, postbox: 1, bbq: 1, bookcase: 1, gate: 1 };
  const pts = (DET.P || []).map(([k, gx, gy, x]) => ({ k, gx, gy, x }));
  const lowPts = pts.filter((p) => LOW[p.k]);
  function low(c) {
    for (const o of lowPts) {
      if (!inTG([o.gx - 1, o.gy - 1, o.gx + 1, o.gy + 1])) continue;
      const [px, py] = P(o.gx, o.gy), x = Math.round(px), y = Math.round(py);
      switch (o.k) {
        case 'bench': fr(c, x - 1, y - 2, 3, 1, '#6e4a34'); fr(c, x - 1, y - 1, 3, 1, '#9a6a46'); break;
        case 'table': fr(c, x - 1, y - 2, 3, 1, '#b08458'); fr(c, x - 1, y - 1, 1, 1, '#6e4a34'); fr(c, x + 1, y - 1, 1, 1, '#6e4a34'); break;
        case 'hydrant': fr(c, x, y - 2, 1, 2, '#d8362c'); break;
        case 'bin': fr(c, x, y - 2, 1, 2, '#3d5a4a'); break;
        case 'bike': fr(c, x - 1, y - 1, 2, 1, '#8a8f99'); break;
        case 'postbox': fr(c, x, y - 3, 1, 3, '#2452c4'); break;
        case 'bbq': fr(c, x, y - 2, 1, 2, '#2c2c34'); break;
        case 'bookcase': fr(c, x, y - 3, 2, 3, '#c8673f'); fr(c, x, y - 3, 2, 1, HI); break;
        case 'gate': fr(c, x - 2, y - 3, 5, 1, '#f4f1ea'); fr(c, x, y - 3, 1, 1, '#d8362c'); fr(c, x - 2, y - 3, 1, 3, '#55555c'); break;
      }
    }
  }

  // ---- tall things: static points among the buildings ----
  const TALL = { art: [9, 1.2], memorial: [10, 1.5], busstop: [7, 0.8], play: [8, 2], fountain: [8, 1.6], tower: [94, 17] };
  const points = pts.filter((p) => TALL[p.k]).map((p) => ({ kind: 'prop', what: p.k, gx: p.gx, gy: p.gy, x: p.x, ph: TALL[p.k][0], pr: TALL[p.k][1] }));
  // a jet for each fountain basin
  for (const a of wetAreas) if (a.k === 'fountain') points.push({ kind: 'prop', what: 'jet', gx: a.c[0], gy: a.c[1], ph: 8, pr: 0.8 });
  const ARTC = ['#e0563c', '#f7a823', '#37a6dc', '#8a8f99', '#2b7448', '#b9714f', '#d9d2c4'];
  function drawProp(c, o) {
    const [px, py] = P(o.gx, o.gy), x = Math.round(px), y = Math.round(py), h = hash(o.gx * 3.1, o.gy * 7.7);
    switch (o.what) {
      case 'art': { const col = ARTC[Math.floor(h * ARTC.length)]; fr(c, x - 1, y - 2, 3, 2, '#bdb7ab'); fr(c, x - 1, y - 6, 2, 4, col); fr(c, x, y - 8, 2, 4, mix(col, HI, 0.25)); break; }
      case 'memorial': fr(c, x - 1, y - 4, 3, 4, '#cfc6b3'); fr(c, x - 1, y - 4, 3, 1, HI); fr(c, x, y - 9, 1, 5, '#5c6a5c'); fr(c, x - 1, y - 8, 3, 1, '#5c6a5c'); break;
      case 'busstop': fr(c, x, y - 7, 1, 7, '#55555c'); fr(c, x - 1, y - 7, 3, 2, '#2452c4'); break;
      case 'play': { const cs = ['#e0563c', '#f7a823', '#37a6dc']; fr(c, x - 3, y - 6, 1, 6, cs[0]); fr(c, x + 2, y - 6, 1, 6, cs[0]); fr(c, x - 3, y - 6, 6, 1, cs[1]); fr(c, x - 1, y - 4, 2, 4, cs[2]); break; }
      case 'fountain': case 'jet':
        if (o.what === 'fountain') { poly(c, [P(o.gx - 0.2, o.gy), P(o.gx, o.gy + 0.2), P(o.gx + 0.2, o.gy), P(o.gx, o.gy - 0.2)], WATER, gcol(COPING, 'walk')); }
        if (!snowy()) { fr(c, x, y - 7, 1, 7, '#e9f6fc'); fr(c, x - 1, y - 5, 3, 1, '#e9f6fc'); fr(c, x - 2, y - 2, 5, 1, WATER_HI); }
        break;
      case 'tower': {            // a spheroid water tank on a fluted column
        const top = 90, r = 30;
        poly(c, [[x - 5, y], [x + 5, y], [x + 3, y - top + 26], [x - 3, y - top + 26]], '#e6e3dc'); poly(c, [[x, y], [x + 5, y], [x + 3, y - top + 26], [x, y - top + 26]], '#cfccc4');
        c.fillStyle = '#f1efe9'; c.beginPath(); c.ellipse(x, y - top + 18, r, 18, 0, 0, 7); c.fill();
        c.fillStyle = '#d6d3cb'; c.beginPath(); c.ellipse(x + 3, y - top + 22, r - 4, 13, 0, 0.1, 2.6); c.fill();
        c.fillStyle = HI; c.beginPath(); c.ellipse(x - 8, y - top + 9, 11, 5, -0.3, 0, 7); c.fill();
        fr(c, x, y - top - 3, 1, 4, '#8a8f99'); break;
      }
    }
  }

  // ---- rooftop pools and courts ----
  function roof(c, b) {
    const list = roofs.get(b.id); if (!list) return;
    for (const a of list) {
      let z = b.hpx; if (b.tiers) for (const t of b.tiers) if (pip(a.c[0], a.c[1], t.pts)) z = Math.max(z, Math.min(250, t.h * env.ZPM));
      env.onPlane(c, z, b.pts, () => { if (a.k === 'pool') water(c, a); else court(c, a); });
    }
  }
  // at night the pools are lit from below
  function glow() {
    if (!lampsOn()) return;
    for (const a of wetAreas) if (a.k === 'pool' && inTG(a.bb)) eq(a.q.map((p) => P(p[0], p[1])), '#8fe6ff', 0.55);
  }
  const wet = (gx, gy) => wetAreas.some((a) => gx > a.bb[0] && gx < a.bb[2] && gy > a.bb[1] && gy < a.bb[3] && pip(gx, gy, a.q));
  return { under, over, low(c) { low(c); glow(); }, points, drawProp, roof, wet, has: true, roofIds: roofs };
}

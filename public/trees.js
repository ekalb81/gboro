// Downtown's real trees, drawn for the time of year, and the wind made visible.
//
// Where the trees are comes from public/model/trees.json (tools/model/trees.py): positions, heights and crown
// widths measured by the 2015 NC lidar, plus OpenStreetMap trees planted since, and evergreen-or-not from the
// February 2024 aerial. Species are inferred (no public inventory of downtown's trees exists), so each tree gets
// a species typical of Piedmont plantings for its size and setting.
//
// The season follows the date in Greensboro. Each species has its own calendar (leaf-out, bloom, fall colour,
// leaf drop), set from typical Greensboro timing: red maples flower in late February, Bradford pears and redbuds
// in March, dogwoods in early April, oaks leaf out mid-April, crape myrtles bloom July to September, and fall
// colour peaks in the first half of November, with willow oaks turning last and holding brown leaves into winter.
//
// The wind is the live NWS reading (KGSO): trees lean downwind (baked in with the static picture), leaves and
// petals blow off them in the wind's real direction and strength, and the Tanger Center's three flags fly.
//
// Nothing here owns a canvas. The renderer passes P (grid to model pixels) and its drawing helpers in.

const rad = Math.PI / 180;
const hash = (a, b) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const ramp = (d, a, b) => clamp01((d - a) / (b - a));
const hx = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mixc = (a, b, t) => '#' + hx(a).map((x, i) => Math.round(x + (hx(b)[i] - x) * clamp01(t)).toString(16).padStart(2, '0')).join('');

// ---------- species and their year ----------
// Days are day-of-year (1 Jan = 1). leaf: [start of leaf-out, full leaf, start of leaf drop, bare]; hold: share of
// (brown) leaves kept through winter. fall: [colour starts, colour peaks]. bloom: [start, peak, end, colour, on bare
// branches?]. shape: how the crown is drawn.
const D = (m, d) => Math.round([0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334][m - 1] + d);
export const SPECIES = {
  willowoak: { name: 'Willow oak', shape: 'round', green: '#4f9a45', spring: '#a6cf5a', fall: ['#c9a24a', '#a8642e'], leaf: [D(4, 2), D(4, 28), D(11, 22), D(12, 20)], fallC: [D(11, 1), D(11, 20)], hold: 0.22, held: '#9a6a3c' },
  whiteoak: { name: 'White oak', shape: 'round', green: '#4a8f44', spring: '#c0c870', fall: ['#a8443a', '#8a3a30'], leaf: [D(4, 8), D(5, 2), D(11, 18), D(12, 15)], fallC: [D(10, 28), D(11, 15)], hold: 0.3, held: '#8a5a38' },
  redmaple: { name: 'Red maple', shape: 'oval', green: '#4a9a4c', spring: '#b0d070', fall: ['#e8642e', '#d8382a'], leaf: [D(3, 20), D(4, 12), D(11, 8), D(11, 28)], fallC: [D(10, 18), D(11, 4)], bloom: [D(2, 15), D(3, 1), D(3, 18), '#c8403a', 1] },
  zelkova: { name: 'Japanese zelkova', shape: 'vase', green: '#5aa34c', spring: '#b4d870', fall: ['#d8963a', '#c0602e'], leaf: [D(3, 28), D(4, 18), D(11, 12), D(12, 2)], fallC: [D(10, 28), D(11, 12)] },
  pear: { name: 'Callery pear', shape: 'upright', green: '#3f9446', spring: '#7cc060', fall: ['#c8503a', '#8e2e3a'], leaf: [D(3, 22), D(4, 8), D(11, 25), D(12, 14)], fallC: [D(11, 5), D(11, 24)], bloom: [D(3, 8), D(3, 18), D(3, 30), '#fbf8f0', 1] },
  sweetgum: { name: 'Sweetgum', shape: 'pyramid', green: '#469a48', spring: '#a8d468', fall: ['#e0a030', '#8e2c3c'], multi: 1, leaf: [D(4, 5), D(4, 25), D(11, 15), D(12, 8)], fallC: [D(10, 22), D(11, 12)] },
  riverbirch: { name: 'River birch', shape: 'multi', green: '#6aae52', spring: '#b8dc78', fall: ['#e0cc58', '#d8b840'], leaf: [D(3, 25), D(4, 12), D(10, 30), D(11, 18)], fallC: [D(10, 8), D(10, 28)], bark: '#c89a78' },
  tulip: { name: 'Tulip poplar', shape: 'tall', green: '#5aaa4c', spring: '#b8dc70', fall: ['#f0d040', '#e8c030'], leaf: [D(4, 1), D(4, 20), D(10, 25), D(11, 12)], fallC: [D(10, 5), D(10, 22)], bloom: [D(5, 1), D(5, 12), D(5, 28), '#f0a040', 0] },
  dogwood: { name: 'Flowering dogwood', shape: 'small', green: '#4e9450', spring: '#98c868', fall: ['#b83a3a', '#9e2a36'], leaf: [D(4, 10), D(4, 28), D(11, 6), D(11, 22)], fallC: [D(10, 1), D(10, 25)], bloom: [D(3, 30), D(4, 10), D(4, 24), '#fbf6ee', 0] },
  redbud: { name: 'Eastern redbud', shape: 'small', green: '#5aa64e', spring: '#a8d070', fall: ['#e0cc50', '#d8b840'], leaf: [D(4, 8), D(4, 25), D(11, 2), D(11, 18)], fallC: [D(10, 15), D(11, 2)], bloom: [D(3, 18), D(3, 30), D(4, 14), '#d860a8', 1] },
  crape: { name: 'Crape myrtle', shape: 'crape', green: '#4c9a4a', spring: '#b06a48', fall: ['#f08a3a', '#d8443a'], leaf: [D(4, 22), D(5, 15), D(11, 12), D(11, 30)], fallC: [D(10, 22), D(11, 8)], bloom: [D(6, 28), D(7, 25), D(9, 20), null, 0], bark: '#c8a088' },
  loblolly: { name: 'Loblolly pine', shape: 'pine', ever: 1, green: '#2b7448' },
  magnolia: { name: 'Southern magnolia', shape: 'magnolia', ever: 1, green: '#2f6a3a', bloom: [D(5, 12), D(5, 30), D(6, 25), '#fbf6e8', 0] },
  cedar: { name: 'Eastern red cedar', shape: 'cedar', ever: 1, green: '#3a6a40' },
  holly: { name: 'American holly', shape: 'holly', ever: 1, green: '#2e6a3c', berries: [D(10, 20), D(2, 28)] },
};
const CRAPE_BLOOM = ['#e8609a', '#d8304a', '#f0a0c8', '#fbf6f0', '#b05aa8'];

/** Day of the year in Greensboro (1 Jan = 1). */
export function dayOfYear(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date).map((x) => [x.type, x.value]));
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day) - Date.UTC(+p.year, 0, 1)) / 864e5) + 1;
}

/** What a species looks like on a day: leaf (0 bare .. 1 full), crown colour, bloom colour and amount, leaves falling. */
export function look(spKey, doy, seed = 0.5) {
  const sp = SPECIES[spKey] || SPECIES.redmaple;
  const j = (seed - 0.5) * 8; // each tree is a few days ahead or behind its neighbours
  const d = doy - j;
  const out = { leaf: 1, col: sp.green, col2: sp.green, bloom: null, bloomAmt: 0, bloomBare: 0, dropping: 0, litter: 0, litterCol: null, berries: 0 };
  if (sp.bloom) {
    const [a, pk, b, c, bare] = sp.bloom;
    const amt = d < pk ? ramp(d, a, pk) : 1 - ramp(d, pk, b);
    if (amt > 0) { out.bloom = c || CRAPE_BLOOM[Math.floor(seed * CRAPE_BLOOM.length)]; out.bloomAmt = amt; out.bloomBare = bare; }
    if (d > pk && d < b + 6) out.petals = amt;
  }
  if (sp.berries) { const [a, b] = sp.berries; out.berries = d >= a || d <= b ? 1 : 0; }
  if (sp.ever) return out;
  const [l0, l1, f0, f1] = sp.leaf;
  const [c0, c1] = sp.fallC;
  if (d < l0 || d >= f1) out.leaf = sp.hold || 0;
  else if (d < l1) out.leaf = ramp(d, l0, l1);
  else if (d >= f0) out.leaf = lerp(1, sp.hold || 0, ramp(d, f0, f1));
  // colour: fresh spring green, summer green, then fall colour from first tint to peak
  if (d < l1 + 25 && d >= l0) out.col = mixc(sp.spring, sp.green, ramp(d, l1 - 5, l1 + 25));
  else if (d >= c0 && d < f1) {
    const t = ramp(d, c0, c1);
    out.col = t < 0.5 ? mixc(sp.green, sp.fall[0], t * 2) : mixc(sp.fall[0], sp.fall[1], (t - 0.5) * 2);
    out.col2 = sp.multi ? mixc(sp.green, sp.fall[1], Math.min(1, t * 1.6)) : mixc(sp.green, sp.fall[0], Math.min(1, t * 1.4));
    if (!sp.multi) out.col2 = mixc(out.col, '#ffe8a0', 0.18);
  }
  if ((d < l0 || d >= f1) && sp.hold) out.col = out.col2 = sp.held;
  if (out.col2 === sp.green && out.col !== sp.green) out.col2 = out.col;
  // leaves on the ground: from the start of the drop until a few weeks after (the City's leaf collection)
  if (d >= f0 - 3 && d < f1 + 21) {
    out.dropping = d < f1 ? 1 : 0;
    out.litter = d < f1 ? ramp(d, f0 - 3, f1) : 1 - ramp(d, f1 + 7, f1 + 21);
    out.litterCol = sp.fall[1];
  }
  return out;
}

// ---------- the trees ----------
/** Unpack trees.json into tree objects the renderer can sort and draw. */
export function loadTrees(data) {
  if (!data || !data.T) return [];
  return data.T.map(([gx, gy, h, r, sp, src]) => {
    const key = data.SP[sp];
    const seed = hash(gx * 3.1, gy * 7.7);
    // OSM-only trees have no measured size: plant them as young trees of their kind
    const sm = SPECIES[key]?.shape;
    if (src === 1) { h = sm === 'small' || sm === 'crape' ? 4 + seed * 2 : 6 + seed * 3; r = h * 0.35; }
    return { kind: 'tree', gx, gy, h: Math.min(h, 32), r: Math.min(r, 9), sp: key, seed, src: data.SRC[src] };
  });
}

/** The flagpoles (OpenStreetMap man_made=flagpole). */
export const loadFlags = (data) => (data?.F || []).map((f, i) => ({ kind: 'flag', gx: f.gx, gy: f.gy, h: +f.h || 12, i }));

// size of a tree in model pixels: 2 px per metre up (ZPM), about 2 px per metre across
const dims = (o) => {
  const hp = Math.max(9, o.h * 2), rp = Math.max(3, o.r * 1.9);
  return { hp, rp };
};

/**
 * Draw one tree with its base at P(o.gx, o.gy).
 * h: { P, fr, circ, poly, line, mix, surf, SH, HI, doy, lean:[x,y] (model px at the crown top) }.
 */
export function drawTree(c, o, h) {
  const { P, fr, circ, poly, line, mix, surf, SH, HI } = h;
  const sp = SPECIES[o.sp] || SPECIES.redmaple;
  const lk = look(o.sp, h.doy, o.seed);
  const [x0, y0] = P(o.gx, o.gy);
  const x = Math.round(x0), y = Math.round(y0);
  const { hp, rp } = dims(o);
  const [lx, ly] = h.lean || [0, 0];
  const L = (k) => [x + lx * k, y + ly * k]; // a point k of the way up, pushed downwind
  const trunk = sp.bark || '#6e4a32', trunkD = mix(trunk, SH, 0.35);
  const s = o.seed;

  // leaves on the ground, blown a little downwind
  if (lk.litter > 0.05) {
    // a soft carpet under the crown (an iso ellipse), a few loose leaves around its edge
    const lc = mix(lk.litterCol, '#a8865a', 0.35), n = Math.round(rp * rp * 0.35 * lk.litter);
    for (let k = 0; k < n; k++) {
      const a = hash(s * 91 + k, 3.3) * 7, d = Math.pow(hash(k, s * 17), 0.8) * rp * 0.95;
      const gx = x + Math.cos(a) * d + lx * 0.5, gy = y + Math.sin(a) * d * 0.5 + 1;
      fr(c, Math.round(gx), Math.round(gy), k % 4 ? 2 : 1, 1, k % 3 ? lc : mix(lc, '#f0c060', 0.35));
    }
  }

  // evergreens
  if (sp.ever) {
    const g = sp.green;
    if (sp.shape === 'pine') {
      // tall bare trunk, tufted crown up top
      const top = L(1), mid = L(0.55);
      line(c, [x + 0.5, y], [top[0] + 0.5, top[1] - hp], trunkD, 2);
      const cr = Math.max(4, rp * 0.8);
      for (let k = 0; k < 5; k++) {
        const t = 0.62 + k * 0.08, p = L(t), dx = (hash(s, k) - 0.5) * cr * 1.2;
        circ(c, p[0] + dx, p[1] - hp * t, cr * (0.75 - k * 0.07), mix(g, SH, 0.25));
        circ(c, p[0] + dx - 1, p[1] - hp * t - 1, cr * (0.6 - k * 0.07), surf(g, false));
        circ(c, p[0] + dx - 2, p[1] - hp * t - 2, cr * 0.3, surf(mix(g, '#8ad05a', 0.35), true));
      }
      void mid;
      return;
    }
    if (sp.shape === 'cedar' || sp.shape === 'holly') {
      const w = Math.max(3, rp * 0.8), tp = L(1);
      fr(c, x, y - 3, 1, 3, trunkD);
      poly(c, [[x - w, y - 2], [x + w, y - 2], [tp[0], tp[1] - hp]], mix(g, SH, 0.2));
      poly(c, [[x - w + 1, y - 3], [x + 1, y - 3], [tp[0], tp[1] - hp + 1]], surf(mix(g, '#6ab060', 0.25), true));
      if (lk.berries) for (let k = 0; k < 7; k++) fr(c, Math.round(x + (hash(s, k) - 0.5) * w * 1.4), Math.round(y - 4 - hash(k, s) * hp * 0.7), 1, 1, '#d8302a');
      return;
    }
    // magnolia: dense, dark, glossy, low branched
    const tp = L(0.6);
    fr(c, x, Math.round(y - hp * 0.2), 2, Math.round(hp * 0.2), trunkD);
    circ(c, tp[0], tp[1] - hp * 0.55, rp, mix(g, SH, 0.3));
    circ(c, tp[0] - 1, tp[1] - hp * 0.58, rp * 0.85, surf(g, false));
    circ(c, tp[0] - rp * 0.35, tp[1] - hp * 0.68, rp * 0.4, surf(mix(g, '#8ad05a', 0.3), true));
    for (let k = 0; k < 6; k++) fr(c, Math.round(tp[0] + (hash(s, k) - 0.5) * rp * 1.4), Math.round(tp[1] - hp * 0.55 + (hash(k, s) - 0.5) * rp), 1, 1, mix(g, HI, 0.45));
    if (lk.bloomAmt > 0) for (let k = 0; k < Math.round(8 * lk.bloomAmt); k++) fr(c, Math.round(tp[0] + (hash(s, k + 9) - 0.5) * rp * 1.5), Math.round(tp[1] - hp * 0.55 + (hash(k + 9, s) - 0.5) * rp * 1.2), 2, 2, lk.bloom);
    return;
  }

  // deciduous: crown centre and size by shape
  const shape = sp.shape;
  let cy = 0.62, rx = rp, ry = rp * 0.85, stems = 1;
  if (shape === 'oval') { cy = 0.6; ry = rp * 1.0; }
  if (shape === 'upright') { cy = 0.6; rx = rp * 0.8; ry = Math.max(rp, hp * 0.32); }
  if (shape === 'pyramid') { cy = 0.58; rx = rp * 0.85; ry = Math.max(rp, hp * 0.35); }
  if (shape === 'tall') { cy = 0.66; rx = rp * 0.85; ry = Math.max(rp, hp * 0.3); }
  if (shape === 'vase') { cy = 0.64; rx = rp * 1.05; ry = rp * 0.75; }
  if (shape === 'multi') { stems = 3; ry = rp * 0.95; }
  if (shape === 'small') { cy = 0.58; rx = rp * 1.1; ry = rp * 0.7; }
  if (shape === 'crape') { stems = 3; cy = 0.6; ry = rp * 0.8; }
  ry = Math.min(ry, hp * 0.48);
  const top = L(cy), ccx = top[0], ccy = top[1] - hp * cy;

  // trunk(s) and the branches you see when the leaves are off
  const bare = 1 - lk.leaf;
  for (let k = 0; k < stems; k++) {
    const off = stems > 1 ? (k - 1) * 1.5 : 0;
    line(c, [x + 0.5 + off * 0.5, y], [ccx + 0.5 + off, ccy + ry * 0.4], k ? trunk : trunkD, stems > 1 ? 1 : hp > 30 ? 2 : 1.5);
  }
  if (bare > 0.15) {
    const nb = shape === 'small' || shape === 'crape' ? 5 : 7;
    for (let k = 0; k < nb; k++) {
      const a = (-160 + (k / (nb - 1)) * 140 + (hash(s, k) - 0.5) * 20) * rad;
      const bx = ccx + Math.cos(a) * rx * 0.95, by = ccy + Math.sin(a) * ry * 0.95 + ry * 0.15;
      const sx = ccx + (bx - ccx) * 0.15, sy = ccy + ry * 0.35;
      line(c, [sx, sy], [bx, by], mix(trunk, '#b8a898', 0.25 + 0.2 * (k % 2)), 1);
      // twigs
      line(c, [bx, by], [bx + Math.cos(a - 0.5) * 2.5, by + Math.sin(a - 0.5) * 2.5], mix(trunk, '#c8bcb0', 0.4), 1);
    }
  }
  // blossom on bare branches (red maple, pear, redbud)
  if (lk.bloomAmt > 0 && lk.bloomBare) {
    const n = Math.round(rx * ry * 1.1 * lk.bloomAmt);
    for (let k = 0; k < n; k++) {
      const a = hash(s * 7 + k, 1.1) * 7, d = Math.sqrt(hash(k, s * 3)) * 0.9;
      fr(c, Math.round(ccx + Math.cos(a) * d * rx), Math.round(ccy + Math.sin(a) * d * ry), 1 + (k % 3 === 0), 1 + (k % 2), k % 5 ? lk.bloom : mix(lk.bloom, HI, 0.4));
    }
  }
  // the crown: a cluster of leaf clumps; as leaves fall, clumps drop out and the branches show through
  if (lk.leaf > 0.02) {
    const shade = mix(lk.col, SH, 0.28);
    const nC = Math.max(5, Math.round((rx * ry) / 9));
    const clumps = [];
    for (let k = 0; k < nC; k++) {
      const a = hash(s * 13 + k, 2.7) * 7, d = Math.sqrt(hash(k + 0.5, s * 5)) * 0.72;
      clumps.push({ cx: ccx + Math.cos(a) * d * rx, cy: ccy + Math.sin(a) * d * ry, r: Math.max(2, Math.min(rx, ry) * (0.42 + hash(k, 4.4) * 0.2)), u: hash(k * 1.7, s * 9), alt: hash(k, s * 11) < 0.4 });
    }
    clumps.sort((a, b) => a.cy - b.cy);
    // dark underside first, then the lit clumps, then highlights toward the sun (upper left)
    if (lk.leaf > 0.55) circ(c, ccx + 1, ccy + 1, Math.min(rx, ry) * 0.92 * Math.sqrt(lk.leaf), shade);
    for (const q of clumps) {
      if (q.u > lk.leaf) continue;
      circ(c, q.cx + 0.5, q.cy + 0.8, q.r, shade);
    }
    for (const q of clumps) {
      if (q.u > lk.leaf) continue;
      circ(c, q.cx - 0.5, q.cy - 0.5, q.r * 0.82, surf(q.alt ? lk.col2 : lk.col, false));
    }
    for (const q of clumps) {
      if (q.u > lk.leaf || q.cx > ccx + rx * 0.2 || q.cy > ccy) continue;
      circ(c, q.cx - q.r * 0.35, q.cy - q.r * 0.4, q.r * 0.38, surf(mix(q.alt ? lk.col2 : lk.col, '#fff2b0', 0.32), true));
    }
    // leaf texture: a few darker flecks in the lit clumps
    for (let k = 0; k < Math.round(rx * ry * 0.12 * lk.leaf); k++) {
      const a = hash(s * 5 + k, 8.1) * 7, d = Math.sqrt(hash(k, s * 6)) * 0.7;
      fr(c, Math.round(ccx + Math.cos(a) * d * rx), Math.round(ccy + Math.sin(a) * d * ry), 1, 1, mix(k % 2 ? lk.col : lk.col2, SH, 0.22));
    }
    // summer and spring flowers among the leaves (dogwood, crape myrtle, tulip poplar)
    if (lk.bloomAmt > 0 && !lk.bloomBare) {
      const n = Math.round(rx * ry * 0.3 * lk.bloomAmt);
      for (let k = 0; k < n; k++) {
        const a = hash(s * 3 + k, 5.5) * 7, d = Math.sqrt(hash(k, s * 2)) * 0.85;
        fr(c, Math.round(ccx + Math.cos(a) * d * rx - 1), Math.round(ccy + Math.sin(a) * d * ry - 1), 2, shape === 'tulip' ? 1 : 2, k % 4 ? lk.bloom : mix(lk.bloom, HI, 0.35));
      }
    }
  }
}

/** The tree's outline as a Path2D in model pixels relative to its base point, for cutting things out behind it. */
export function treeOutline(o, lean = [0, 0], doy = null) {
  const sp = SPECIES[o.sp] || SPECIES.redmaple;
  const { hp, rp } = dims(o);
  const p = new Path2D();
  // a bare deciduous tree hides only its trunk; a thinning crown hides less of what is behind it
  const leaf = sp.ever || doy == null ? 1 : look(o.sp, doy, o.seed).leaf;
  if (leaf < 0.35) { p.rect(-1, -hp * 0.4, 2, hp * 0.4); return p; }
  if (sp.shape === 'pine') { const cr = Math.max(4, rp * 0.8); p.ellipse(lean[0] * 0.75, lean[1] * 0.75 - hp * 0.75, cr * 1.1, hp * 0.22, 0, 0, 7); p.rect(-1, -hp * 0.6, 2, hp * 0.6); return p; }
  if (sp.shape === 'cedar' || sp.shape === 'holly') { const w = Math.max(3, rp * 0.8); p.moveTo(-w, -2); p.lineTo(w, -2); p.lineTo(lean[0], lean[1] - hp); p.closePath(); return p; }
  const f = leaf < 0.7 ? 0.75 : 1;
  p.ellipse(lean[0] * 0.6, lean[1] * 0.6 - hp * 0.6, rp * f, Math.min(Math.max(rp * 0.9, hp * 0.3), hp * 0.48) * f, 0, 0, 7);
  p.rect(-1, -hp * 0.4, 2, hp * 0.4);
  return p;
}

/** Shadow footprint size of a tree in grid units (for the renderer's sun shadows): crown radius and height. */
export const shadowOf = (o, M) => ({ r: (o.r * 0.8) / M, h: o.h, leaf: SPECIES[o.sp]?.ever ? 1 : 0.35 + 0.65 * look(o.sp, dayOfYear(), o.seed).leaf });

// ---------- wind ----------
/**
 * The wind on the model: speed and gust (mph), where it blows to on screen (unit vector, model pixels), and how far
 * crowns lean (model px at the top of a tall tree). from: degrees the wind comes from, clockwise from north.
 * Grid x runs east and grid y runs south; screen x = (gx - gy) * 16, screen y = (gx + gy) * 8.
 */
export function windOn(mph = 0, gust = 0, from = null) {
  mph = Math.max(0, +mph || 0); gust = Math.max(mph, +gust || 0);
  if (from == null || !mph) return { mph, gust, vx: 0, vy: 0, lean: [0, 0], calm: mph < 2 };
  const to = (from + 180) * rad;
  const e = Math.sin(to), n = Math.cos(to); // toward east, north
  const gx = e, gy = -n;
  let vx = (gx - gy) * 16, vy = (gx + gy) * 8;
  const L = Math.hypot(vx, vy) || 1; vx /= L; vy /= L;
  const k = Math.min(3.5, mph / 7); // a stiff 25 mph breeze bends a tall crown about 3 px
  return { mph, gust, vx, vy, lean: [Math.round(vx * k), Math.round(vy * k * 0.5)], calm: mph < 2 };
}
/** A short key that changes when the lean changes, for deciding when to redraw the static picture. */
export const windKey = (w) => w.lean.join(',');

// ---------- things blowing in the wind (drawn every frame) ----------
/**
 * Leaves (fall) and petals (spring) blowing off the trees on screen.
 * step(c, dt, { onScreen: [{x, y, hp, rp, look}] in canvas px, wind, reduce, W, H, scale })
 */
export function makeBlowing() {
  const bits = [];
  return {
    step(c, dt, { onScreen, wind, reduce, W, H, scale = 1 }) {
      if (reduce) return;
      // how many to let go this frame: more in a breeze and in gusts, more when the leaves are coming down
      const gusting = wind.gust > wind.mph + 5 ? 0.5 + 0.5 * Math.sin(performance.now() / 1300) : 0;
      const breeze = Math.min(1.6, (wind.mph + gusting * (wind.gust - wind.mph)) / 12);
      for (const t of onScreen) {
        const lk = t.look; const rate = (lk.dropping ? 0.35 * lk.leaf + 0.05 : 0) + (lk.petals ? 0.25 * lk.petals : 0);
        if (!rate) continue;
        if (Math.random() < rate * (0.15 + breeze) * dt * (t.rp / 6)) {
          const petal = lk.petals && !lk.dropping;
          bits.push({ x: t.x + (Math.random() - 0.5) * t.rp * 1.6, y: t.y - t.hp * (0.45 + Math.random() * 0.3), ground: t.y + (Math.random() - 0.3) * 4 * scale,
            vx: 0, vy: 0, ph: Math.random() * 7, col: petal ? lk.bloom : Math.random() < 0.6 ? lk.col : lk.litterCol || lk.col, life: 0 });
        }
      }
      if (bits.length > 400) bits.splice(0, bits.length - 400);
      const wx = wind.vx * (4 + wind.mph * 1.6) * scale, wy = wind.vy * (4 + wind.mph * 1.6) * scale * 0.5;
      for (let i = bits.length - 1; i >= 0; i--) {
        const b = bits[i]; b.life += dt; b.ph += dt * 5;
        const fall = 9 * scale;
        b.vx += ((wx + Math.sin(b.ph) * 6 * scale) - b.vx) * Math.min(1, dt * 2);
        b.vy += ((wy + fall + Math.cos(b.ph * 1.3) * 3 * scale) - b.vy) * Math.min(1, dt * 2);
        b.x += b.vx * dt; b.y += b.vy * dt; b.ground += wy * dt;
        if (b.y >= b.ground || b.life > 12 || b.x < -20 || b.x > W + 20 || b.y > H + 20) { bits.splice(i, 1); continue; }
        c.fillStyle = b.col;
        const s = Math.max(1, Math.round(scale));
        c.fillRect(Math.round(b.x), Math.round(b.y), s + (Math.sin(b.ph) > 0.3 ? s : 0), s);
      }
    },
  };
}

/**
 * A US flag on its pole, flying downwind; it hangs limp when it is calm and snaps in gusts.
 * h: { P, fr, line, SH, T, wind }
 */
export function drawFlag(c, f, h) {
  const { P, fr, line, SH, T, wind } = h;
  const [bx, by] = P(f.gx, f.gy);
  const x = Math.round(bx), y = Math.round(by);
  const hp = Math.round(f.h * 2);
  line(c, [x + 0.5, y], [x + 0.5, y - hp], '#d8d4cc', 1);
  fr(c, x, y - hp - 1, 1, 1, '#f0c040');
  const gust = wind.gust > wind.mph ? (wind.gust - wind.mph) * (0.5 + 0.5 * Math.sin(T * 1.7 + f.i)) : 0;
  const spd = wind.mph + gust;
  const fly = Math.min(1, spd / 14); // fully out by about 14 mph
  // direction on screen: mostly sideways (a flag is seen side-on more often than not)
  let dx = wind.vx || 1, dy = wind.vy || 0;
  const side = dx >= 0 ? 1 : -1;
  const len = 10, ht = 6;
  for (let i = 0; i < len; i++) {
    const t = i / (len - 1);
    const wave = Math.sin(T * (3 + spd * 0.25) - i * 0.9 + f.i) * (0.6 + 1.1 * fly) * t;
    // limp: the fly end hangs down along the pole; flying: straight out with a wave
    const px = x + 1 + side * Math.round(i * (0.25 + 0.75 * fly));
    const py = y - hp + 1 + Math.round(i * (1 - fly) * 0.9 + dy * i * 0.3 * fly + wave);
    for (let r = 0; r < ht; r++) {
      const canton = i < 4 && r < 3;
      const col = canton ? '#2c3e86' : r % 2 ? '#f6f2ea' : '#c8343a';
      fr(c, px, py + r, 1, 1, canton && (i + r) % 2 && i > 0 ? '#e8ecf4' : col);
    }
  }
  void SH; void dx;
}

// Paths shared by the close-up house and its resident on the downtown map.
export const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
/** A walk along points: where you are after d metres, and which way you face. */
export function makeRoute(pts) {
  const seg = []; let len = 0;
  for (let i = 0; i < pts.length - 1; i++) { const l = dist(pts[i], pts[i + 1]); if (l > 1e-6) { seg.push({ a: pts[i], b: pts[i + 1], l, at: len }); len += l; } }
  return { pts, seg, len, at(d) {
    if (!seg.length) return { x: pts[0][0], y: pts[0][1], hx: 0, hy: 1 };
    d = Math.max(0, Math.min(len, d)); let s = seg[seg.length - 1]; for (const q of seg) if (d <= q.at + q.l) { s = q; break; }
    const t = (d - s.at) / s.l; return { x: s.a[0] + (s.b[0] - s.a[0]) * t, y: s.a[1] + (s.b[1] - s.a[1]) * t, hx: (s.b[0] - s.a[0]) / s.l, hy: (s.b[1] - s.a[1]) / s.l };
  } };
}

/** The mowing round: up and down each patch in stripes, round the fire ring, pushing the mower between patches. */
export function mowRoute(lot, W = 0.9) {
  const pts = [], stripes = [];
  // things to steer round: the fire ring, and any trunk standing in a patch
  const obst = [{ x: lot.fire.x, y: lot.fire.y, r: lot.fire.r + 0.25 }, ...lot.trees.map((t) => ({ x: t.x, y: t.y, r: 0.9 }))];
  lot.mow.forEach((m, mi) => {
    const [x0, y0, x1, y1] = m; const n = Math.max(1, Math.floor((x1 - x0) / W));
    if (mi === 1) { pts.push(lot.doors.gateIn, lot.doors.gateOut, [x0 + W / 2, lot.doors.gateOut[1]]); } // out through the gate once; the front patches join
    for (let i = 0; i < n; i++) {
      const x = x0 + W * (i + 0.5), down = i % 2 === 0, s = down ? 1 : -1; let ya = down ? y0 : y1; const yb = down ? y1 : y0;
      let from = pts.length; pts.push([x, ya]);
      const hit = obst.filter((o) => Math.abs(x - o.x) < o.r && o.y + o.r > y0 && o.y - o.r < y1).sort((p, q) => s * (p.y - q.y));
      for (const o of hit) { // up to it, round it on the nearer side, and on
        const dx = x - o.x, hc = Math.sqrt(o.r * o.r - dx * dx), side = dx >= 0 ? 1 : -1, yin = o.y - s * hc;
        // one standing at the patch's edge: the stripe starts on its ring
        if (s * (yin - ya) > 0) { pts.push([x, yin]); stripes.push({ x, ya, yb: yin, par: i % 2, mi, from, to: pts.length - 1 }); } else pts[pts.length - 1] = [x, yin];
        const a0 = Math.atan2(-s * hc, dx); let da = Math.atan2(s * hc, dx) - a0;
        if (side * s > 0 && da < 0) da += 2 * Math.PI; if (side * s < 0 && da > 0) da -= 2 * Math.PI;
        for (let k = 1; k < 6; k++) pts.push([o.x + o.r * Math.cos(a0 + da * k / 6), o.y + o.r * Math.sin(a0 + da * k / 6)]);
        ya = o.y + s * hc; from = pts.length; pts.push([x, ya]);
      }
      if (s * (yb - ya) > 0) { pts.push([x, yb]); stripes.push({ x, ya, yb, par: i % 2, mi, from, to: pts.length - 1 }); }
    }
  });
  const route = makeRoute(pts);
  // metres along the route at which each stripe starts and ends
  const atPt = [0]; for (let i = 1; i < pts.length; i++) atPt.push(atPt[i - 1] + dist(pts[i - 1], pts[i]));
  for (const s of stripes) { s.d0 = atPt[s.from]; s.d1 = atPt[s.to]; }
  return { route, stripes, W };
}

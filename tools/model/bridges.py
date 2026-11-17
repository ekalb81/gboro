"""Road bridges for the model (the 'road' entries of DK in public/model/downtown.json).

The model's ground is flat, so a street that crosses the tracks or another street on a bridge is built up as decks
the renderer stands on the ground:

  span   the bridge itself: a slab on piers (z0 = its underside)
  fill   the stretch between two bridges of the same street that are close together: the street stays up there on
         solid fill instead of dipping to the ground and climbing again
  ramp   the approaches: solid fill whose top slopes evenly from the bridge down to the ground ('sl' gives the slope),
         cut into a few pieces so each takes its own place among the buildings when the model is drawn

The two carriageways of a divided street share one structure: their decks are joined into one outline, and every
piece is cut straight across both, so the two halves always stand at the same height.

Each deck: {k:'road', p: outline, z0, z1: underside and top (m), n: street name, w: road width (m),
            cl: the centre line of each carriageway on this piece (also tells the renderer which way the deck runs),
            gl: gold lines (the centre of a two-way street, the middle of a divided one), wl: dashed white lane lines,
            ed: the kerb and parapet lines, sp: 1 for a span, pr: its piers,
            sl: [ax, ay, za, bx, by, zb] for a ramp: the top is za metres high at (ax, ay) and zb at (bx, by)}

prep.py calls road_decks() while it builds the model. To rebuild only the bridges of a model that is already built:
  python3 tools/model/bridges.py public/model/downtown.json
"""
import json, math, sys

RWm = [16, 14, 12, 10, 8, 4.5, 5]          # road width by class, metres (as the renderer paints them)
SPAN_TOP, SPAN_UNDER = 7.0, 5.8            # a span's deck top and underside, metres
RAMP = 110.0                               # the longest an approach ramp gets, metres
GAP = 90.0                                 # two bridges of one street closer than this are one structure
KERB = 2.8                                 # deck width beyond the roadway on each side, metres
PIECE = 16.0                               # a ramp is cut into pieces about this long, metres


def flat(pts):
    return [round(v, 2) for p in pts for v in p]


def road_decks(R, RL, X, GX, GY, M, widths=None):
    """The road decks for streets R (model tiles), tracks RL and junctions X on a GX by GY board at M metres per tile.

    widths: {street name: road width in metres} for bridges whose lane count isn't on the street any more.
    """
    from shapely.geometry import Polygon, LineString, Point
    from shapely.ops import unary_union, substring, linemerge
    Mi = 1 / M
    widths = widths or {}
    board = Polygon([(0, 0), (GX, 0), (GX, GY), (0, GY)])
    ways = [(LineString(list(zip(r['p'][0::2], r['p'][1::2]))), r) for r in R if not r.get('ar') and len(r['p']) >= 4]
    ways = [(ln, r) for ln, r in ways if ln.length > 0]
    rails = [LineString(list(zip(r['p'][0::2], r['p'][1::2]))) for r in RL]
    junc = [Point(x[0], x[1]) for x in X]
    is_bridge = lambda ln, r: bool(r.get('br')) and r['c'] <= 4 and ln.length * M >= 12 and ln.intersects(board)
    bridges = [i for i, (ln, r) in enumerate(ways) if is_bridge(ln, r)]
    bset = set(bridges)

    def lines(g_):
        return [m for m in (getattr(g_, 'geoms', None) or [g_]) if m.geom_type == 'LineString' and m.length > 0]

    def polys(g_):
        return [m for m in (getattr(g_, 'geoms', None) or [g_]) if m.geom_type == 'Polygon' and m.area > .01]

    def ring(q):
        return flat(list(q.exterior.coords)[:-1])

    def unit(a, b):
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy) or 1
        return dx / L, dy / L

    def follow(pt, d, used, maxlen, name):
        """Walk on from pt in direction d along the street, way by way. -> (coords, the bridge way reached or None)"""
        out = [pt]
        length = 0
        used = set(used)
        while length < maxlen:
            best = None
            for i, (ln, r) in enumerate(ways):
                if i in used or r['c'] > 4:
                    continue
                c = list(ln.coords)
                for cc in (c, c[::-1]):
                    if math.dist(cc[0], pt) > .02:
                        continue
                    k = next((q for q in cc[1:] if math.dist(q, cc[0]) > .05), cc[-1])
                    u = unit(cc[0], k)
                    dot = u[0] * d[0] + u[1] * d[1]
                    score = dot + (.3 if r['n'] == name else 0)
                    if dot > .6 and (best is None or score > best[0]):
                        best = (score, i, cc)
            if not best:
                break
            _, i, cc = best
            if i in bset:
                return out, i
            used.add(i)
            out += cc[1:]
            length += LineString(cc).length
            pt = cc[-1]
            d = unit(cc[-2], cc[-1])
        return out, None

    # 1. cores: each bridge, joined with the next bridge of the same street when the gap between them is short
    #    and no other street meets it in between. A core is a list of sections ('span' or 'fill'), end to end.
    cores = [{'sec': [('span', list(ways[i][0].coords), i)], 'ids': {i}} for i in bridges]
    merged = True
    while merged:
        merged = False
        for a in cores:
            c = a['sec'][-1][1]
            path, hit = follow(c[-1], unit(c[-2], c[-1]), a['ids'], GAP * Mi, ways[a['sec'][0][2]][1]['n'])
            if hit is None or hit in a['ids']:
                continue
            b = next(q for q in cores if hit in q['ids'])
            gap = LineString(path) if len(path) > 1 else None
            if gap is not None and any(j.distance(gap) < .05 and 3 * Mi < gap.project(j) < gap.length - 3 * Mi for j in junc):
                continue
            # b must start where the path ends; turn it round if it ends there instead
            bs = b['sec']
            if math.dist(bs[0][1][0], path[-1]) > .02:
                if math.dist(bs[-1][1][-1], path[-1]) > .02:
                    continue
                bs = [(k, cc[::-1], i) for k, cc, i in bs[::-1]]
            a['sec'] += ([('fill', path, None)] if gap is not None else []) + bs
            a['ids'] |= b['ids']
            cores.remove(b)
            merged = True
            break
    for co in cores:
        r0 = ways[co['sec'][0][2]][1]
        co['n'], co['c'], co['ow'] = r0['n'], r0['c'], bool(r0.get('ow'))
        w = RWm[r0['c']]
        for k, cc, i in co['sec']:
            if i is None:
                continue
            try:
                lanes_ = float(ways[i][1].get('ln') or 0)
            except ValueError:
                lanes_ = 0
            w = max(w, lanes_ * 3.0)
        co['w'] = max(w, widths.get(co['n'], 0))
        co['line'] = LineString([p for k_, cc, i in co['sec'] for p in cc])

    # 2. the approaches at both ends of each core, as far as a ramp may run
    def approach(co, end):
        c = co['sec'][-1][1] if end else co['sec'][0][1][::-1]
        path, hit = follow(c[-1], unit(c[-2], c[-1]), co['ids'], RAMP * Mi, co['n'])
        if len(path) < 2:
            return None
        ch = LineString(path)
        run = min(RAMP * Mi, ch.length)
        if hit is not None:
            run = min(run, ch.length / 2)          # another bridge further on: meet its ramp half way
        js = [ch.project(j) for j in junc if j.distance(ch) < .05 and ch.project(j) > 3 * Mi]
        if js:
            run = min(run, max(30 * Mi, min(js) - (RWm[co['c']] / 2 + 9) * Mi))
        return ch, run

    for co in cores:
        co['ap'] = [approach(co, 0), approach(co, 1)]

    # 3. the two carriageways of a divided street make one structure
    groups = []
    for co in cores:
        g_ = next((q for q in groups if len(q) == 1 and q[0]['n'] == co['n'] and len(q[0]['sec']) == len(co['sec'])
                   and q[0]['line'].hausdorff_distance(co['line']) < 3.2), None)
        if g_ is None:
            groups.append([co])
            continue
        o = g_[0]
        a0, a1 = o['line'].coords[0], o['line'].coords[-1]
        b0, b1 = co['line'].coords[0], co['line'].coords[-1]
        if math.dist(a0, b1) + math.dist(a1, b0) < math.dist(a0, b0) + math.dist(a1, b1):   # runs the other way: turn it
            co['sec'] = [(k, cc[::-1], i) for k, cc, i in co['sec'][::-1]]
            co['ap'] = co['ap'][::-1]
            co['line'] = LineString(list(co['line'].coords)[::-1])
        g_.append(co)

    DK = []

    def cut(pts, tans, reach):
        """The line a structure is cut along at one station: through both carriageways, or square across one."""
        if len(pts) == 2 and math.dist(pts[0], pts[1]) > .05:
            u = unit(pts[0], pts[1])
            # keep left and right the same from one cut to the next
            t = tans[0]
            if u[0] * -t[1] + u[1] * t[0] < 0:
                pts = pts[::-1]
                u = (-u[0], -u[1])
            return (pts[0][0] - u[0] * reach, pts[0][1] - u[1] * reach), (pts[1][0] + u[0] * reach, pts[1][1] + u[1] * reach)
        p, t = pts[0], tans[0]
        return (p[0] + t[1] * reach, p[1] - t[0] * reach), (p[0] - t[1] * reach, p[1] + t[0] * reach)

    def at(ln, d):
        d = max(0, min(ln.length, d))
        p = ln.interpolate(d)
        a, b = ln.interpolate(max(0, d - .05)), ln.interpolate(min(ln.length, d + .05))
        return (p.x, p.y), unit((a.x, a.y), (b.x, b.y))

    def piece(lanes, c0, c1, z0, za, zb, extra, AB=None):
        """One deck, cut between the lines c0 and c1. lanes = [(carriageway line F, from, to (distances along F),
        half width in tiles, road width in m, one way)]."""
        quad = Polygon([c0[0], c0[1], c1[1], c1[0]])
        if not quad.is_valid:
            quad = quad.buffer(0)
        # each roadway a little longer than the piece at both ends, so the cuts decide where it stops and the
        # pieces meet without gaps
        body = unary_union([substring(F, max(0, s0 - .5), min(F.length, s1 + .5)).buffer(h, cap_style='flat', join_style='mitre')
                            for F, s0, s1, h, w, ow in lanes])
        shape = body.intersection(quad).intersection(board)
        mark = [substring(F, s0, s1) for F, s0, s1, h, w, ow in lanes]
        mid = None
        if len(lanes) == 2 and mark[0].distance(mark[1]) < lanes[0][3] + lanes[1][3]:
            n = 8       # the decks touch: one roadway, a gold line down the middle
            mid = flat([((pa.x + pb.x) / 2, (pa.y + pb.y) / 2) for pa, pb in
                        ((mark[0].interpolate(k / n, normalized=True), mark[1].interpolate(k / n, normalized=True)) for k in range(n + 1))])
        cl, gl, wl, edges = [], [], [], []
        for k, (F, s0, s1, h, w, ow) in enumerate(lanes):
            ln = mark[k]
            long_ = substring(F, max(0, s0 - .5), min(F.length, s1 + .5))
            cl.append(flat(list(ln.coords)))
            # paint lines are given whole (the renderer clips them to the piece), so dashes keep step across the cuts
            (wl if ow else gl).append(flat(list(F.coords)))
            if w >= 17:
                wl += [flat(list(m.coords)) for sd in (1, -1) for m in lines(F.offset_curve(sd * w / 4 * Mi))]
            for sd in (1, -1):
                e = long_.offset_curve(sd * (h - .3 * Mi))
                for j, o in enumerate(lanes):
                    if j != k:              # no kerb where the other carriageway's roadway is
                        e = e.difference(o[0].buffer(o[3] - .1 * Mi))
                edges.append(e)
        if mid:
            gl.append(mid)
        A, B = AB or [[sum(c_[i][j] for i in (0, 1)) / 2 for j in (0, 1)] for c_ in (c0, c1)]
        for q in polys(shape):
            # kerbs and parapets stop at the cuts; paint (clipped by the renderer) may run past them
            ed = [flat(list(m.coords)) for e in edges for m in lines(e.intersection(q.buffer(.02))) if m.length > .1]
            d = {'k': 'road', 'p': ring(q), 'z0': z0, 'z1': round(max(za, zb), 2), 'w': round(max(l_[4] for l_ in lanes), 1),
                 'cl': cl, 'gl': gl, 'wl': wl, 'ed': ed, **extra}
            if za != zb:
                d['sl'] = [round(A[0], 2), round(A[1], 2), round(za, 2), round(B[0], 2), round(B[1], 2), round(zb, 2)]
            DK.append(d)

    for g_ in groups:
        name = g_[0]['n']
        K = range(len(g_))
        half = [(co['w'] / 2 + KERB) * Mi for co in g_]
        foot = [(RWm[co['c']] / 2 + KERB) * Mi for co in g_]
        reach = max(half) + .25
        # each carriageway as one line from the far end of one approach to the far end of the other, and where on
        # it the core's sections begin and end
        Fs, st = [], []
        for co in g_:
            a0, a1 = co['ap']
            pts = (list(a0[0].coords)[::-1][:-1] if a0 else []) + list(co['line'].coords) + (list(a1[0].coords)[1:] if a1 else [])
            Fs.append(LineString(pts))
            d = a0[0].length if a0 else 0
            marks = [d]
            for k_, cc, i in co['sec']:
                d += LineString(cc).length
                marks.append(d)
            st.append(marks)
        cutat = lambda ds, ks: cut([at(Fs[k], d)[0] for k, d in zip(ks, ds)], [at(Fs[k], d)[1] for k, d in zip(ks, ds)], reach)
        nsec = len(g_[0]['sec'])
        cuts = [cutat([st[k][s] for k in K], K) for s in range(nsec + 1)]
        for s in range(nsec):
            kind = g_[0]['sec'][s][0]
            lanes = [(Fs[k], st[k][s], st[k][s + 1], half[k], g_[k]['w'], g_[k]['ow']) for k in K]
            extra = {'n': name}
            if kind == 'span':
                # piers, kept clear of the tracks and of the streets that pass underneath
                piers = []
                for F, s0, s1, h, w, ow in lanes:
                    ln = substring(F, s0, s1)
                    under = [q for q in rails if q.distance(ln) < h] + [q.buffer((RWm[o['c']] / 2) * Mi) for q, o in ways
                                                                         if not o.get('br') and o['c'] <= 5 and q.crosses(ln)]
                    n_ = max(1, round(ln.length * M / 24))
                    for i in range(1, n_):
                        (px, py), (ux, uy) = at(ln, ln.length * i / n_)
                        hw = h * .62
                        q = Polygon([(px - uy * hw - ux * .07, py + ux * hw - uy * .07), (px + uy * hw - ux * .07, py - ux * hw - uy * .07),
                                     (px + uy * hw + ux * .07, py - ux * hw + uy * .07), (px - uy * hw + ux * .07, py + ux * hw + uy * .07)])
                        if all(q.distance(u) > 2.2 * Mi for u in under):
                            piers.append(ring(q))
                extra.update(sp=1, pr=piers)
            piece(lanes, cuts[s], cuts[s + 1], SPAN_UNDER if kind == 'span' else 0, SPAN_TOP, SPAN_TOP, extra)
        # the ramps at each end, from the bridge outward
        for end in (0, 1):
            ks = [k for k in K if g_[k]['ap'][end]]
            if not ks:
                continue
            run = min(g_[k]['ap'][end][1] for k in ks)
            n_ = max(3, round(run * M / PIECE))
            sgn = 1 if end else -1
            base = [st[k][-1] if end else st[k][0] for k in ks]
            # when only one of two carriageways has an approach here, its first cut is not the core's own:
            # start a touch inside the bridge so no gap opens
            prev = cuts[-1 if end else 0] if len(ks) == len(g_) else cutat([b_ - sgn * .15 for b_ in base], ks)
            for i in range(n_):
                f0, f1, t_ = i / n_, (i + 1) / n_, (i + .5) / n_
                lanes = []
                for k, b_ in zip(ks, base):
                    d0, d1 = sorted((b_ + sgn * run * f0, b_ + sgn * run * f1))
                    lanes.append((Fs[k], d0, d1, half[k] + (foot[k] - half[k]) * t_, g_[k]['w'] + (RWm[g_[k]['c']] - g_[k]['w']) * t_, g_[k]['ow']))
                ds0, ds1 = [b_ + sgn * run * f0 for b_ in base], [b_ + sgn * run * f1 for b_ in base]
                za, zb = SPAN_TOP * (1 - f0), SPAN_TOP * (1 - f1)
                apart = len(ks) == 2 and any(math.dist(at(Fs[ks[0]], d[0])[0], at(Fs[ks[1]], d[1])[0]) > lanes[0][3] + lanes[1][3] for d in (ds0, ds1))
                if apart:
                    # the carriageways have parted: each gets its own piece, cut square across itself, starting a
                    # little inside the piece before so they overlap rather than leave a gap
                    for j, k in enumerate(ks):
                        mid = lambda d: list(at(Fs[k], d)[0])
                        piece([lanes[j]], cutat([ds0[j] - sgn * .45], [k]), cutat([ds1[j]], [k]), 0, za, zb, {'n': name}, [mid(ds0[j]), mid(ds1[j])])
                    prev = None
                    continue
                nxt = cutat(ds1, ks)
                piece(lanes, prev or cutat(ds0, ks), nxt, 0, za, zb, {'n': name})
                prev = nxt
    return DK


if __name__ == '__main__':
    path = sys.argv[1]
    m = json.load(open(path))
    old = [d for d in m['DK'] if d['k'] == 'road']
    widths = {}
    for d in old:
        if d.get('sp'):
            widths[d['n']] = max(widths.get(d['n'], 0), d['w'])
    new = road_decks(m['R'], m['RL'], m['X'], m['GX'], m['GY'], m['M'], widths)
    m['DK'] = new + [d for d in m['DK'] if d['k'] != 'road']
    json.dump(m, open(path, 'w'), separators=(',', ':'))
    print('road decks: %d before, %d now (%d spans, %d ramp pieces)' % (
        len(old), len(new), sum(1 for d in new if d.get('sp')), sum(1 for d in new if d.get('sl'))))

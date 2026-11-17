"""Work yards read from the aerial: the dirt they stand on and the things parked and piled in them.

Usage: python3 tools/model/yards.py [aerial.jpg] [out.json]
       (defaults: /mnt/project-files/village/imagery/ortho-downtown-15cm.jpg, public/model/yards.json)

Nothing in OpenStreetMap says "contractor's yard", so the model drew the one by the tracks east of the depot as an empty
stretch of paving with specks of lawn. A yard is found here as a big patch (3,000 m2 and up) of earth-coloured ground that
nothing is mapped on: no building, street, parking lot, park, path or track. Inside it, whatever stands out from the dirt
is read off the picture: bright shapes are trailers, sheds, trucks and containers (a box each, with its size, heading and
colour), big dark ones are rubble piles, long dark ones are stacks of pipe or timber. A dark shape lying against a bright
one is that one's shadow and is left out.

Like roofs.json this is a survey layer keyed by ground position and kept in git: the weekly rebuild does not make it, and
it only needs running again when there is a new aerial (tools/model/ortho.py).
Writes {"about", "aerial_date", "r": cells per tile, "runs": [[row, first cell, count], ...] (the dirt),
        "things": [[x, y, long side m, short side m, heading deg, "#colour", kind], ...]}   kind: box | pile | stack
"""
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
AERIAL = sys.argv[1] if len(sys.argv) > 1 else '/mnt/project-files/village/imagery/ortho-downtown-15cm.jpg'
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'public', 'model', 'yards.json')
MIN_YARD = 3000      # m2
MAX_THINGS = 60      # per yard, biggest first


def main():
    d = json.load(open(os.path.join(ROOT, 'public', 'model', 'downtown.json')))
    src = json.load(open(os.path.join(ROOT, 'data', 'model', 'sources.json')))
    GC, M = d['GC'], d['M']; R, gw, gh = GC['r'], GC['w'], GC['h']; cell = M / R
    ga = np.zeros((gh, gw), np.uint8)
    for j, row in enumerate(GC['rows']):
        i = 0
        for t in row.split(','):
            n = int(t[1:], 36); ga[j, i:i + n] = int(t[0], 36); i += n
    im = Image.open(AERIAL).convert('RGB')
    small = np.asarray(im.resize((gw, gh), Image.BOX)).astype(np.float32) / 255
    # everything the map already accounts for
    mk = Image.new('L', (gw, gh), 0); dr = ImageDraw.Draw(mk)
    pl = lambda p: [(x * R, y * R) for x, y in zip(p[0::2], p[1::2])]
    for b in d['B']: dr.polygon(pl(b['p']), fill=1)
    for p in d['PL']: dr.polygon(pl(p), fill=1)
    for r in d['R']:
        if r['ar']: dr.polygon(pl(r['p']), fill=1)
        else: dr.line(pl(r['p']), fill=1, width=round(14 / cell))
    for f in d['FW']: dr.line(pl(f['p']), fill=1, width=3)
    for p in d['PK']: dr.polygon(pl(p['p']), fill=1)
    for l in d['RL']: dr.line(pl(l['p']), fill=1, width=4)
    mapped = np.asarray(mk) > 0
    r_, g_, b_ = small[..., 0], small[..., 1], small[..., 2]
    dirt = (r_ - b_ > .07) & (r_ > g_) & (r_ > .35)
    free = ~mapped & (ga != 1) & (ga != 7)
    core = ndi.binary_opening(ndi.binary_closing((ga == 0) & ~mapped & dirt, iterations=3) & free, iterations=2)
    lab, n = ndi.label(core)
    runs, things, yards = [], [], 0
    px = im.size[0] / d['GX'] / 2                      # pixels per tile at half the aerial's resolution
    for k in range(1, n + 1):
        one = lab == k
        if one.sum() * cell * cell < MIN_YARD: continue
        yards += 1
        # the yard is the dirt and what the dirt wraps round: its piles, weeds and parked things
        yard = ndi.binary_fill_holes(ndi.binary_closing(one, iterations=8)) & free
        yard = ndi.binary_opening(yard, iterations=1) | one
        for j in np.nonzero(yard.any(1))[0]:
            row = yard[j].astype(np.int8); e = np.flatnonzero(np.diff(np.concatenate(([0], row, [0]))))
            for a, b in zip(e[0::2], e[1::2]): runs.append([int(j), int(a), int(b - a)])
        js, is_ = np.nonzero(yard); j0, j1, i0, i1 = js.min(), js.max() + 1, is_.min(), is_.max() + 1
        box = (round(i0 / R * px * 2), round(j0 / R * px * 2), round(i1 / R * px * 2), round(j1 / R * px * 2))
        crop = im.crop(box); W, H = crop.size[0] // 2, crop.size[1] // 2
        a = np.asarray(crop.resize((W, H), Image.BOX)).astype(np.float32) / 255       # 0.3 m a pixel
        ym = np.asarray(Image.fromarray(yard[j0:j1, i0:i1].astype(np.uint8) * 255).resize((W, H), Image.NEAREST)) > 0
        mp = np.asarray(Image.fromarray(mapped[j0:j1, i0:i1].astype(np.uint8) * 255).resize((W, H), Image.NEAREST)) > 0
        ok = ym & ~mp; m_px = M / px                                                    # metres per pixel here
        lum = a @ np.array([.3, .59, .11], np.float32); bg = float(np.median(lum[ok]))
        bright = ndi.binary_opening((lum > bg + .14) & ok, iterations=2)
        dark = ndi.binary_opening((lum < bg - .2) & ok, iterations=3)
        near = ndi.binary_dilation(bright, iterations=round(3 / m_px))
        found = []
        for mask, kind in ((bright, 'box'), (dark, 'dark')):
            lb, m = ndi.label(mask)
            for q in range(1, m + 1):
                ys, xs = np.nonzero(lb == q); area = len(xs) * m_px * m_px
                if area < (5 if kind == 'box' else 25) or area > 400: continue
                if kind == 'dark' and near[ys, xs].mean() > .35: continue              # a shadow
                c = np.stack([xs, ys], 1).astype(np.float32); c0 = c.mean(0); u, s, vt = np.linalg.svd(c - c0, full_matrices=False)
                ax = vt[0]; t = (c - c0) @ ax; o = (c - c0) @ np.array([-ax[1], ax[0]])
                L = (np.percentile(t, 98) - np.percentile(t, 2)) * m_px; Wd = (np.percentile(o, 98) - np.percentile(o, 2)) * m_px
                if Wd < 1.5 or L < 2.5: continue
                if kind == 'box' and area < .5 * L * Wd: continue                      # not box-shaped: glare, a scatter of small things
                col = np.median(a[ys, xs], 0); kd = kind if kind == 'box' else ('stack' if L > 3 * Wd else 'pile')
                if kd == 'box': L, Wd = min(L, 16.5), min(Wd, 4.5)                       # a trailer at most
                found.append((area, [round(float(box[0] / 2 + c0[0]) / px, 2), round(float(box[1] / 2 + c0[1]) / px, 2), round(float(L), 1), round(float(Wd), 1),
                                     round(math.degrees(math.atan2(ax[1], ax[0])) % 180), '#%02x%02x%02x' % tuple(int(v * 255) for v in col), kd]))
        found.sort(key=lambda f: -f[0]); things += [f[1] for f in found[:MAX_THINGS]]
    things.sort(key=lambda t: (t[0] + t[1], t[0]))
    json.dump({'about': 'Work yards read from the aerial by tools/model/yards.py: runs of dirt cells [row, first, count] at r cells per tile, and the '
                        'things standing in them [x, y, long side m, short side m, heading deg, colour, kind].',
               'aerial_date': src.get('aerial_date', ''), 'r': R, 'runs': runs, 'things': things}, open(OUT, 'w'), separators=(',', ':'))
    print(yards, 'yards,', len(runs), 'runs of dirt,', len(things), 'things:', {k: sum(1 for t in things if t[6] == k) for k in ('box', 'pile', 'stack')}, '->', OUT)


if __name__ == '__main__': main()

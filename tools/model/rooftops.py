"""Read what is on each flat roof from the aerial photo: the rooftop units and the big patches of another colour.

  python3 tools/model/rooftops.py <aerial.jpg> [model.json] [out.json] [--debug DIR id,id,...]

The aerial is the NC OneMap picture tools/model/ortho.py fetches (0.15 m a pixel, the model's own box, so one
model tile is 60 pixels). It is too big for git, which is why this runs by hand and its result is committed:
public/model/roofs.json. The weekly rebuild does not touch that file. Each record is tied to a spot on the ground,
not to a building's id (ids of buildings found by lidar change when the survey is rerun), so the renderer gives
a record to whichever building stands on its spot and drops the ones nothing stands on.

For each building over 60 m2:
  - the roof's own colour is the middle colour of its sunlit pixels (a roof mostly in shadow is not read);
  - a small compact blob that stands out from it (1 to 40 m2, no side over 9 m) is a rooftop unit: air handlers,
    vents, skylights, hatches. A dark blob beside a light one is that unit's shadow and is dropped;
  - a big region of another colour (40 m2 and a twentieth of the roof) is a patch: a newer membrane, a lower
    wing, a painted deck. Dark regions are left out, because in a February picture they are mostly shadows.
A tall building leans away from the camera in the picture, so for buildings over 12 m the outline is slid (up to a
fifth of the height) to where the pixels inside it are most alike before anything is read.

Output: {"about": ..., "roofs": [[x, y, units, patches], ...]} in model tiles; x, y is a spot inside the outline;
units are [x, y, width m, depth m, colour]; patches are [colour, [x, y, x, y, ...]].
"""
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

Image.MAX_IMAGE_PIXELS = None
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
PPT = 60            # aerial pixels per model tile
MPP = 0.15          # metres per aerial pixel
CELL = 4            # aerial pixels per cell the roof is read in (0.6 m)
CM = CELL * MPP     # metres per cell
MIN_ROOF = 60       # m2
STAND_OUT = 34      # how far (RGB distance) a cell must be from the roof's colour to count as something else
MAX_UNITS = 8
MAX_PATCHES = 3


def hexc(v):
    return '#%02x%02x%02x' % tuple(int(max(0, min(255, round(float(x))))) for x in v)


def lum(a):
    return a @ np.array([0.299, 0.587, 0.114])


def mask_of(pts, x0, y0, w, h, dx=0, dy=0):
    m = Image.new('L', (w, h), 0)
    ImageDraw.Draw(m).polygon([(x - x0 + dx, y - y0 + dy) for x, y in pts], fill=255)
    return m


def lean(im, pts, x0, y0, w, h, height):
    """Where the roof really is in the picture: slide the outline up to a fifth of the height and keep the
    place where the pixels inside are most alike (a roof is plainer than the mix of wall, street and roof)."""
    reach = min(60, int(0.2 * height / MPP))
    if reach < 4:
        return 0, 0
    g = lum(im.astype(float))
    best = None
    step = max(2, reach // 6)
    for dy in range(-reach, reach + 1, step):
        for dx in range(-reach, reach + 1, step):
            m = np.asarray(mask_of(pts, x0, y0, w, h, dx, dy).filter(ImageFilter.MinFilter(7))) > 0
            if m.sum() < 200:
                continue
            v = g[m]
            lo, hi = np.percentile(v, [20, 80])
            s = (hi - lo) + 0.02 * math.hypot(dx, dy)      # the spread of the middle of the roof; ties go to less slide
            if best is None or s < best[0]:
                best = (s, dx, dy)
    if best is None:
        return 0, 0
    still = np.asarray(mask_of(pts, x0, y0, w, h).filter(ImageFilter.MinFilter(7))) > 0
    if still.sum() >= 200:
        lo, hi = np.percentile(g[still], [20, 80])
        if best[0] > 0.8 * (hi - lo):                      # not clearly better than staying put
            return 0, 0
    return best[1], best[2]


def thin(units, patches, roof_m2):
    """Keep what reads at the model's size: the bigger units, none crowding another, and patches with a plain shape."""
    kept = []
    for u in units:                                        # biggest first
        if all(math.hypot((u[0] - k[0]) * 9, (u[1] - k[1]) * 9) > 2.5 + (max(u[2], u[3]) + max(k[2], k[3])) / 2 for k in kept):
            kept.append(u)
    kept = kept[:MAX_UNITS]
    if len(kept) > 5 and roof_m2 / len(kept) < 40:          # a roof that busy is texture (gravel, panels, clutter), not units
        kept = kept[:max(3, int(roof_m2 / 40))]
    plain = []
    for col, ring in patches:
        g = Polygon([(ring[i], ring[i + 1]) for i in range(0, len(ring), 2)])
        if g.is_valid and g.area > 0.6 * g.minimum_rotated_rectangle.area:
            plain.append([col, ring])
    return kept, plain[:MAX_PATCHES]


def read_roof(im_full, b, debug=None):
    p = b['p']
    pts = [(p[i] * PPT, p[i + 1] * PPT) for i in range(0, len(p), 2)]
    poly = Polygon([(p[i], p[i + 1]) for i in range(0, len(p), 2)])
    if not poly.is_valid:
        poly = poly.buffer(0)
    if poly.is_empty or poly.area * 81 < MIN_ROOF:
        return None
    H, W = im_full.shape[:2]
    height = b.get('lh') or b.get('h') or 0
    pad = 8 + (min(60, int(0.2 * height / MPP)) if height > 12 else 0)
    xs = [q[0] for q in pts]; ys = [q[1] for q in pts]
    x0 = int(min(xs)) - pad; y0 = int(min(ys)) - pad
    x0 -= x0 % CELL; y0 -= y0 % CELL
    x1 = int(max(xs)) + pad + 1; y1 = int(max(ys)) + pad + 1
    x1 += -(x1 - x0) % CELL; y1 += -(y1 - y0) % CELL
    if x0 < 0 or y0 < 0 or x1 > W or y1 > H:
        return None
    w, h = x1 - x0, y1 - y0
    im = im_full[y0:y1, x0:x1]
    dx, dy = lean(im, pts, x0, y0, w, h, height) if height > 12 else (0, 0)
    inner = np.asarray(mask_of(pts, x0, y0, w, h, dx, dy).filter(ImageFilter.MinFilter(9))) > 0   # 0.6 m in from the edge
    if inner.sum() < 400:
        return None
    px = im.astype(float)
    L = lum(px)
    lit = inner & (L > 70)
    if lit.sum() < 0.5 * inner.sum():       # mostly in another building's shadow: nothing can be read
        return None
    base = np.median(px[lit], axis=0)
    bl = float(lum(base))
    # read in 0.6 m cells
    ch, cw = h // CELL, w // CELL
    cell = px.reshape(ch, CELL, cw, CELL, 3).mean(axis=(1, 3))
    cin = inner.reshape(ch, CELL, cw, CELL).mean(axis=(1, 3)) > 0.99
    cl = lum(cell)
    dist = np.sqrt(((cell - base) ** 2).sum(axis=2))
    odd = cin & (dist > STAND_OUT)
    # things of different kinds that touch (a red roof beside a dark one) are told apart by a rough colour class
    chro = cell.max(axis=2) - cell.min(axis=2)
    kind = np.where(cl < 80, 1, np.where(chro > 45, 2 + cell.argmax(axis=2), 5 + (cl // 60).astype(int)))
    lab = np.zeros(odd.shape, int); n = 0
    for k in np.unique(kind[odd]):
        lk, nk = ndimage.label(odd & (kind == k))
        lab[lk > 0] = lk[lk > 0] + n; n += nk
    units, patches, shadows = [], [], []
    roof_m2 = cin.sum() * CM * CM
    to_grid = lambda cx, cy: ((x0 + cx * CELL - dx) / PPT, (y0 + cy * CELL - dy) / PPT)
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        m = lab[sl] == i
        cells = int(m.sum())
        area = cells * CM * CM
        hh, ww = m.shape
        col = cell[sl][m].mean(axis=0)
        cL = float(lum(col))
        chroma = float(col.max() - col.min())
        cy, cx = ndimage.center_of_mass(m)
        gx, gy = to_grid(sl[1].start + cx + .5, sl[0].start + cy + .5)
        if 1 <= area <= 40 and max(hh, ww) * CM <= 9 and cells / (hh * ww) > 0.5:
            light = cL > bl + 18
            dark = cL < bl - 40 and bl > 130
            rec = [round(gx, 2), round(gy, 2), round(ww * CM, 1), round(hh * CM, 1), hexc(col)]
            if light or chroma > 45 and cL > 80:
                units.append((area, rec, sl))
            elif dark:
                shadows.append((area, rec, sl))
        elif area >= 40 and area >= 0.05 * roof_m2 and area <= 0.6 * roof_m2 and (cL >= 80 or chroma > 40 and cL > 60):
            polys = []
            for r in range(hh):                         # one box per run of cells in a row, joined and smoothed
                row = m[r]; c = 0
                while c < ww:
                    if row[c]:
                        c2 = c
                        while c2 < ww and row[c2]:
                            c2 += 1
                        polys.append(box(sl[1].start + c, sl[0].start + r, sl[1].start + c2, sl[0].start + r + 1)); c = c2
                    else:
                        c += 1
            g = unary_union(polys).buffer(1.2).buffer(-1.2).simplify(1.2)
            if g.geom_type == 'MultiPolygon':
                g = max(g.geoms, key=lambda q: q.area)
            if g.is_empty or g.area * CM * CM < 40:
                continue
            ring = []
            for qx, qy in list(g.exterior.coords)[:-1]:
                a, c_ = to_grid(qx, qy); ring += [round(a, 2), round(c_, 2)]
            if 6 <= len(ring) <= 80:
                patches.append((area, [hexc(col), ring]))
    # a dark blob is a unit of its own only on a pale roof and only if no light unit stands right beside it
    for a, rec, sl in shadows:
        near = any(abs(u[1][0] - rec[0]) * 9 < (u[1][2] + rec[2]) / 2 + 1.5 and abs(u[1][1] - rec[1]) * 9 < (u[1][3] + rec[3]) / 2 + 1.5 for u in units)
        if not near and a <= 16:
            units.append((a, rec, sl))
    units, patches = thin([u[1] for u in sorted(units, key=lambda u: -u[0])], [q[1] for q in sorted(patches, key=lambda q: -q[0])], roof_m2)
    rp = poly.representative_point()
    if debug:
        big = Image.fromarray(im).resize((w * 3, h * 3), Image.LANCZOS)
        d = ImageDraw.Draw(big)
        d.polygon([((x - x0 + dx) * 3, (y - y0 + dy) * 3) for x, y in pts], outline=(255, 255, 0))
        for u in units:
            ux, uy = (u[0] * PPT - x0 + dx) * 3, (u[1] * PPT - y0 + dy) * 3
            d.rectangle([ux - u[2] / MPP * 1.5, uy - u[3] / MPP * 1.5, ux + u[2] / MPP * 1.5, uy + u[3] / MPP * 1.5], outline=(255, 0, 255))
        for colr, ring in patches:
            d.polygon([((ring[i] * PPT - x0 + dx) * 3, (ring[i + 1] * PPT - y0 + dy) * 3) for i in range(0, len(ring), 2)], outline=(0, 255, 255))
        big.save(os.path.join(debug, '%s.png' % b['id']))
    return [round(rp.x, 2), round(rp.y, 2), units, patches]


def main():
    args = [a for a in sys.argv[1:]]
    debug = ids = None
    if '--debug' in args:
        i = args.index('--debug'); debug = args[i + 1]; ids = set(args[i + 2].split(',')); del args[i:i + 3]
        os.makedirs(debug, exist_ok=True)
    aerial = args[0]
    model = args[1] if len(args) > 1 else os.path.join(ROOT, 'public', 'model', 'downtown.json')
    out = args[2] if len(args) > 2 else os.path.join(ROOT, 'public', 'model', 'roofs.json')
    im = np.asarray(Image.open(aerial).convert('RGB'))
    B = json.load(open(model))['B']
    roofs = []
    for b in B:
        if ids is not None and str(b['id']) not in ids:
            continue
        r = read_roof(im, b, debug if ids else None)
        if r is not None:
            roofs.append(r)
    if ids is not None:
        print(json.dumps(roofs)[:3000]); return
    roofs.sort(key=lambda r: (r[1], r[0]))
    src = {}
    try:
        src = json.load(open(os.path.join(ROOT, 'data', 'model', 'sources.json')))
    except Exception:
        pass
    doc = {'about': 'Rooftop units and patches read from the NC OneMap aerial by tools/model/rooftops.py. [x, y, units, patches] in model tiles.',
           'aerial_date': src.get('aerial_date'), 'roofs': roofs}
    with open(out, 'w') as f:
        f.write(json.dumps(doc, separators=(',', ':')))
    print(len(roofs), 'roofs read;', sum(len(r[2]) for r in roofs), 'units;', sum(len(r[3]) for r in roofs), 'patches;', os.path.getsize(out), 'bytes')


if __name__ == '__main__':
    main()

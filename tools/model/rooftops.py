"""Read what is on each flat roof from the aerial photo: the rooftop units and the big patches of another colour.

  python3 tools/model/rooftops.py <aerial.jpg> [model.json] [out.json] [--debug DIR id,id,...]

The aerial covers the model's own box (tools/model/ortho.py). It is too big for git, which is why this runs by hand and its result is committed:
public/model/roofs.json. The weekly rebuild does not touch that file. Each record is tied to a spot on the ground,
not to a building's id (ids of buildings found by lidar change when the survey is rerun), so the renderer gives
a record to whichever building stands on its spot and drops the ones nothing stands on.

For each building over 60 m2:
  - the roof's own colour is the middle colour of its sunlit pixels (a roof mostly in shadow is not read);
  - a small compact blob that stands out from it (1 to 40 m2, no side over 9 m) is a rooftop unit: air handlers,
    vents, skylights, hatches. A dark blob beside a light one is that unit's shadow and is dropped;
  - a big region of another colour (40 m2 and a twentieth of the roof) is a patch: a newer membrane, a lower
    wing, a painted deck. Dark regions are left out because they are mostly shadows.
A tall building leans away from the camera in the picture, so for buildings over 12 m the outline is slid (up to a
fifth of the height) to where the pixels inside it are most alike before anything is read.

Output: {"about": ..., "roofs": [[x, y, units, patches], ...]} in model tiles; x, y is a spot inside the outline;
units are [x, y, width m, depth m, colour, optional display height m]; patches are [colour, [x, y, x, y, ...]].
WGS84 roof surveys in data/model/roof-surveys.json replace the automatic readings. Debug images show the automatic pass.
"""
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

Image.MAX_IMAGE_PIXELS = None
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
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


def lean(im, pts, x0, y0, w, h, height, mpp):
    """Where the roof really is in the picture: slide the outline up to a fifth of the height and keep the
    place where the pixels inside are most alike (a roof is plainer than the mix of wall, street and roof)."""
    reach = int(min(9, 0.2 * height) / mpp)
    if reach * mpp < .6:
        return 0, 0
    g = lum(im.astype(float))
    best = None
    step = max(1, round(.3 / mpp), reach // 6)
    edge = 2 * round(.45 / mpp) + 1
    min_pixels = round(4.5 / mpp ** 2)
    still = np.asarray(mask_of(pts, x0, y0, w, h))
    ys, xs = np.nonzero(ndimage.minimum_filter(still, size=edge))
    if xs.size < min_pixels:
        return 0, 0
    for dy in range(-reach, reach + 1, step):
        for dx in range(-reach, reach + 1, step):
            v = g[ys + dy, xs + dx]
            lo, hi = np.percentile(v, [20, 80])
            s = (hi - lo) + (0.02 / .15) * mpp * math.hypot(dx, dy)  # ties go to less slide
            if best is None or s < best[0]:
                best = (s, dx, dy)
    if best is None:
        return 0, 0
    lo, hi = np.percentile(g[ys, xs], [20, 80])
    if best[0] > 0.8 * (hi - lo):                          # not clearly better than staying put
        return 0, 0
    return best[1], best[2]


def thin(units, patches, roof_m2, metres_per_tile):
    """Keep what reads at the model's size: the bigger units, none crowding another, and patches with a plain shape."""
    kept = []
    for u in units:                                        # biggest first
        if all(math.hypot(u[0] - k[0], u[1] - k[1]) * metres_per_tile > 2.5 + (max(u[2], u[3]) + max(k[2], k[3])) / 2 for k in kept):
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


def read_roof(im_full, b, scale_x, scale_y, metres_per_tile, debug=None):
    p = b['p']
    pts = [(p[i] * scale_x, p[i + 1] * scale_y) for i in range(0, len(p), 2)]
    poly = Polygon([(p[i], p[i + 1]) for i in range(0, len(p), 2)])
    if not poly.is_valid:
        poly = poly.buffer(0)
    if poly.is_empty or poly.area * metres_per_tile ** 2 < MIN_ROOF:
        return None
    rp = poly.representative_point()
    if b.get('t') == 'parking' or b.get('a') == 'parking':
        # Parked cars on the top deck are not rooftop equipment.
        return [round(rp.x, 2), round(rp.y, 2), [], []]
    W, H = im_full.size
    mpp = metres_per_tile / scale_x
    cell_px = max(1, round(.6 / mpp))
    cell_m = cell_px * mpp
    height = b.get('lh') or b.get('h') or 0
    pad = round(1.2 / mpp) + (int(min(9, 0.2 * height) / mpp) if height > 12 else 0)
    xs = [q[0] for q in pts]; ys = [q[1] for q in pts]
    x0 = int(min(xs)) - pad; y0 = int(min(ys)) - pad
    x0 -= x0 % cell_px; y0 -= y0 % cell_px
    x1 = int(max(xs)) + pad + 1; y1 = int(max(ys)) + pad + 1
    x1 += -(x1 - x0) % cell_px; y1 += -(y1 - y0) % cell_px
    if x0 < 0 or y0 < 0 or x1 > W or y1 > H:
        return None
    w, h = x1 - x0, y1 - y0
    im = np.asarray(im_full.crop((x0, y0, x1, y1)))
    dx, dy = lean(im, pts, x0, y0, w, h, height, mpp) if height > 12 else (0, 0)
    inner = ndimage.minimum_filter(np.asarray(mask_of(pts, x0, y0, w, h, dx, dy)), size=2 * cell_px + 1) > 0
    if inner.sum() * mpp ** 2 < 9:
        return None
    px = im.astype(float)
    L = lum(px)
    lit = inner & (L > 70)
    if lit.sum() < 0.5 * inner.sum():       # mostly in another building's shadow: nothing can be read
        return None
    base = np.median(px[lit], axis=0)
    bl = float(lum(base))
    # read in 0.6 m cells
    ch, cw = h // cell_px, w // cell_px
    cell = px.reshape(ch, cell_px, cw, cell_px, 3).mean(axis=(1, 3))
    cin = inner.reshape(ch, cell_px, cw, cell_px).all(axis=(1, 3))
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
    roof_m2 = cin.sum() * cell_m ** 2
    to_grid = lambda cx, cy: ((x0 + cx * cell_px - dx) / scale_x, (y0 + cy * cell_px - dy) / scale_y)
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        m = lab[sl] == i
        cells = int(m.sum())
        area = cells * cell_m ** 2
        hh, ww = m.shape
        col = cell[sl][m].mean(axis=0)
        cL = float(lum(col))
        chroma = float(col.max() - col.min())
        cy, cx = ndimage.center_of_mass(m)
        gx, gy = to_grid(sl[1].start + cx + .5, sl[0].start + cy + .5)
        if 1 <= area <= 40 and max(hh, ww) * cell_m <= 9 and cells / (hh * ww) > 0.5:
            light = cL > bl + 18
            dark = cL < bl - 40 and bl > 130
            rec = [round(gx, 2), round(gy, 2), round(ww * cell_m, 1), round(hh * cell_m, 1), hexc(col)]
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
            if g.is_empty or g.area * cell_m ** 2 < 40:
                continue
            ring = []
            for qx, qy in list(g.exterior.coords)[:-1]:
                a, c_ = to_grid(qx, qy); ring += [round(a, 2), round(c_, 2)]
            if 6 <= len(ring) <= 80:
                patches.append((area, [hexc(col), ring]))
    # a dark blob is a unit of its own only on a pale roof and only if no light unit stands right beside it
    for a, rec, sl in shadows:
        near = any(abs(u[1][0] - rec[0]) * metres_per_tile < (u[1][2] + rec[2]) / 2 + 1.5
                   and abs(u[1][1] - rec[1]) * metres_per_tile < (u[1][3] + rec[3]) / 2 + 1.5 for u in units)
        if not near and a <= 16:
            units.append((a, rec, sl))
    units, patches = thin([u[1] for u in sorted(units, key=lambda u: -u[0])],
                          [q[1] for q in sorted(patches, key=lambda q: -q[0])], roof_m2, metres_per_tile)
    if debug:
        big = Image.fromarray(im).resize((w * 3, h * 3), Image.LANCZOS)
        d = ImageDraw.Draw(big)
        d.polygon([((x - x0 + dx) * 3, (y - y0 + dy) * 3) for x, y in pts], outline=(255, 255, 0))
        for u in units:
            ux, uy = (u[0] * scale_x - x0 + dx) * 3, (u[1] * scale_y - y0 + dy) * 3
            d.rectangle([ux - u[2] / mpp * 1.5, uy - u[3] / mpp * 1.5, ux + u[2] / mpp * 1.5, uy + u[3] / mpp * 1.5], outline=(255, 0, 255))
        for colr, ring in patches:
            d.polygon([((ring[i] * scale_x - x0 + dx) * 3, (ring[i + 1] * scale_y - y0 + dy) * 3) for i in range(0, len(ring), 2)], outline=(0, 255, 255))
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
    with open(model) as f:
        data = json.load(f)
    im = Image.open(aerial)
    if im.mode != 'RGB':
        im = im.convert('RGB')
    src = {}
    sidecar = os.path.splitext(aerial)[0] + '.json'
    if os.path.isfile(sidecar):
        with open(sidecar) as f:
            src = json.load(f)
        if list(im.size) != src['size'] or any(abs(src['bounds'][k] - data['GEO'][k]) > 1e-7
                                              for k in ('north', 'south', 'east', 'west')):
            raise ValueError('Aerial extent or size does not match the model')
    scale_x, scale_y = im.width / data['GX'], im.height / data['GY']
    if abs(scale_x / scale_y - 1) > .002:
        raise ValueError('Expected square aerial pixels over the model bounds')
    survey_path = os.path.join(ROOT, 'data', 'model', 'roof-surveys.json')
    try:
        with open(survey_path, encoding='utf-8') as f:
            surveys = json.load(f)
    except FileNotFoundError:
        surveys = {}
    geo, meters = data['GEO'], data['M']

    def g(lon, lat):
        return [round((lon - geo['west']) * geo['mPerDegLon'] / meters, 3),
                round((geo['north'] - lat) * geo['mPerDegLat'] / meters, 3)]

    B = data['B']
    roofs = []
    for b in B:
        if ids is not None and str(b['id']) not in ids:
            continue
        survey = surveys.get(str(b['id']))
        if survey:
            center = Polygon(list(zip(b['p'][::2], b['p'][1::2]))).representative_point()
            units = [[*g(lon, lat), *unit] for lon, lat, *unit in survey['units']]
            patches = [[color, [coord for lon, lat in zip(ring[::2], ring[1::2]) for coord in g(lon, lat)]]
                       for color, ring in survey['patches']]
            r = [round(center.x, 2), round(center.y, 2), units, patches]
            if debug:
                read_roof(im, b, scale_x, scale_y, data['M'], debug)
        else:
            r = read_roof(im, b, scale_x, scale_y, data['M'], debug)
        if r is not None:
            roofs.append(r)
    if ids is not None:
        print(json.dumps(roofs)[:3000]); return
    roofs.sort(key=lambda r: (r[1], r[0]))
    doc = {'about': 'Rooftop units and patches read from the aerial by tools/model/rooftops.py. [x, y, units, patches] in model tiles.',
           'aerial_date': src.get('capture_date'), 'imagery_year': src.get('imagery_year'),
           'capture_window': src.get('capture_window'), 'source': src.get('source'),
           'source_url': src.get('source_url'), 'm_per_px': src.get('m_per_px'), 'roofs': roofs}
    with open(out, 'w') as f:
        f.write(json.dumps(doc, separators=(',', ':')))
    print(len(roofs), 'roofs read;', sum(len(r[2]) for r in roofs), 'units;', sum(len(r[3]) for r in roofs), 'patches;', os.path.getsize(out), 'bytes')


if __name__ == '__main__':
    main()

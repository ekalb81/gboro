"""Read what is on the ground from a model-aligned aerial into a file prep.py can use every week.

Usage: python3 tools/model/ground.py [inputs-dir] [out.json] [ortho.jpg]
Defaults to reading <inputs-dir>/imagery/ortho-downtown-15cm.jpg and writing <inputs-dir>/imagery/ground.json with
  gc:      a ground-class grid, one cell per 1.5 m (6 per model tile):
           0 light paving/concrete, 1 asphalt, 2 lawn, 3 planted/wooded ground, 4 bare earth or mulch, 5 water (unused downtown), 6 shade (only while building the grid)
  stripes: painted-line directions in 3 m cells (3 per model tile), for laying out parking stalls: per cell the
           dominant direction of thin bright lines in degrees (grid axes: x east, y south) and how clear it is (0-9).
The aerial comes from tools/model/ortho.py (which see: the picture must cover exactly the model's bounds).
The aerial's same-stem JSON sidecar supplies provenance when present.
"""
import json, math, sys, os
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
Image.MAX_IMAGE_PIXELS = None
INP = (sys.argv[1] if len(sys.argv) > 1 else '/mnt/project-files/village').rstrip('/') + '/'
OUT = sys.argv[2] if len(sys.argv) > 2 else INP + 'imagery/ground.json'
AERIAL = Path(sys.argv[3] if len(sys.argv) > 3 else INP + 'imagery/ortho-downtown-15cm.jpg')
N0, S, Wl, E0 = 36.0768, 36.0660, -79.7954, -79.7856   # the downtown the model began as
NORTH = 145                                             # model tiles (9 m) added on the north side since, up to the house up the street
EAST = 13                                               # and on the east side, to take in the apartments, pool and water tower by Murrow Boulevard
N = N0 + NORTH * 9.0 / 110574; M = 9.0
k = math.cos(math.radians((N0 + S) / 2)) * 111320
El = E0 + EAST * 9.0 / k
GX = (El - Wl) * k / M; GY = (N - S) * 110574 / M
im = np.asarray(Image.open(AERIAL).convert('RGB')).astype(np.float32)
im /= 255
H_, W_ = im.shape[:2]
sidecar = AERIAL.with_suffix('.json')
source = 'NC OneMap orthoimagery, flown 2022-02-09' if len(sys.argv) <= 3 else AERIAL.name
if sidecar.is_file():
    metadata = json.loads(sidecar.read_text(encoding='utf-8'))
    expected_bounds = {'west': Wl, 'south': S, 'east': El, 'north': N}
    if metadata['size'] != [W_, H_] or any(
        not math.isclose(metadata['bounds'][key], expected, rel_tol=0, abs_tol=1e-8)
        for key, expected in expected_bounds.items()
    ):
        raise SystemExit('Aerial sidecar does not match the image dimensions or model bounds')
    source = metadata['source']
pxx, pxy = W_ / GX, H_ / GY  # image pixels per model tile in x and y
lum = im @ np.array([.3, .59, .11], np.float32)

def blocks(a, R):
    """mean of a over the grid cells of 1/R tile (nearest image pixels)"""
    gw, gh = int(math.ceil(GX * R)), int(math.ceil(GY * R))
    xs = np.minimum(W_, np.round(np.arange(gw + 1) / R * pxx).astype(int)); ys = np.minimum(H_, np.round(np.arange(gh + 1) / R * pxy).astype(int))
    dx, dy = np.diff(xs), np.diff(ys)
    if (dx == 0).any() or (dy == 0).any():
        raise SystemExit(f'Aerial resolution is too low for {R} cells per tile')
    # Reduce within each block to avoid losing small differences between large cumulative sums.
    s = np.add.reduceat(np.add.reduceat(a, ys[:-1], axis=0), xs[:-1], axis=1)
    n = (dy[:, None] * dx[None, :]).astype(np.float32)
    return s / (n[..., None] if a.ndim == 3 else n)

# ---- ground classes, 1.5 m cells
R = 6
rgb = blocks(im, R); L = blocks(lum, R); L2 = blocks(lum * lum, R); tex = np.sqrt(np.maximum(0, L2 - L * L))
del im
if source == 'Guilford County GIS, 2026 Orthos':
    # Clear pavement samples run warm in this aerial; balance the color used to detect vegetation.
    rgb *= np.array([.96, 1, 1.17], np.float32)
r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]; mx = rgb.max(-1); mn = rgb.min(-1); sat = (mx - mn) / (mx + 1e-6)
gc = np.zeros(L.shape, np.uint8)                                         # light paving by default
gc[(L < .47) & (sat < .14) & (tex < .07)] = 1                              # asphalt: dark, grey and smooth
gc[(g > b + .02) & (sat > .16) & (g >= r - .06) & (mx < .75)] = 2          # green lawn
dormant = (r > b + .06) & (g > b + .03) & (sat > .14) & (sat < .45) & (L > .28) & (L < .62) & (tex < .09)
gc[dormant & (gc != 2)] = 2                                                # winter-brown lawn (flown in February)
gc[(tex > .06) & (L < .5) & (r >= b - .03) & (L > .12)] = 3                # bare winter trees over planted ground
gc[(r > g + .03) & (g > b + .02) & (L < .38) & (sat > .2) & (tex < .085)] = 4  # mulch, bare earth
gc[(L < .17) | ((L < .36) & (b > r + .015) & (gc != 3))] = 6               # shadow (bluish in the aerial): unknown, filled below
# fill shadow from the nearest classified neighbours (majority of a growing window)
for it in range(12):
    m = gc == 6
    if not m.any(): break
    P = np.pad(gc, 1, constant_values=6)
    votes = np.zeros(gc.shape + (6,), np.int16)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            nb = P[1 + dy:1 + dy + gc.shape[0], 1 + dx:1 + dx + gc.shape[1]]
            for c in range(6): votes[..., c] += (nb == c)
    best = votes.argmax(-1).astype(np.uint8); has = votes.max(-1) > 0
    gc[m & has] = best[m & has]
# smooth single-cell speckle
P = np.pad(gc, 1, mode='edge'); votes = np.zeros(gc.shape + (7,), np.int16)
for dy in (-1, 0, 1):
    for dx in (-1, 0, 1):
        nb = P[1 + dy:1 + dy + gc.shape[0], 1 + dx:1 + dx + gc.shape[1]]
        for c in range(7): votes[..., c] += (nb == c)
maj = votes.argmax(-1).astype(np.uint8); gc = np.where(votes.max(-1) >= 6, maj, gc).astype(np.uint8)
gc[gc == 6] = 0
rows = []
b36 = lambda n: np.base_repr(int(n), 36).lower()
for row in gc:
    out = []; cur = row[0]; n = 0
    for v in row:
        if v == cur: n += 1
        else: out.append(b36(cur) + b36(n)); cur = v; n = 1
    out.append(b36(cur) + b36(n)); rows.append(','.join(out))

# ---- painted lines, 3 m cells: thin bright lines on darker ground (white top-hat), then the structure tensor
# Keep the detector's 15 cm-image kernel sizes in physical units on finer or coarser images.
bg = ndi.grey_opening(lum, size=tuple(2 * round(3 * px / 60) + 1 for px in (pxy, pxx)))
th = lum - bg
del bg
th -= .06
np.maximum(th, 0, out=th)
th[lum < .35] = 0
del lum
gy_, gx_ = np.gradient(ndi.gaussian_filter(th, (pxy / 60, pxx / 60)))
gx_ *= pxx / 3600; gy_ *= pxy / 3600  # gradients in model axes, at the original detector's scale
R2 = 3
Jxx = blocks(gx_ * gx_, R2); Jyy = blocks(gy_ * gy_, R2); Jxy = blocks(gx_ * gy_, R2); E = blocks(th, R2)
lam = np.sqrt((Jxx - Jyy) ** 2 + 4 * Jxy ** 2); coh = lam / (Jxx + Jyy + 1e-12)
grad_ang = .5 * np.degrees(np.arctan2(2 * Jxy, Jxx - Jyy))      # dominant gradient direction
line_ang = (grad_ang + 90) % 180                                 # lines run across it
strength = np.clip(np.round(coh * 9 * np.clip(E / .01, 0, 1)), 0, 9).astype(int)
srows = []
for j in range(line_ang.shape[0]):
    srows.append(''.join(b36(int(a // 5)) + str(s) if s >= 2 else '--' for a, s in zip(line_ang[j], strength[j])))
json.dump({'source': source, 'gc': {'r': R, 'w': gc.shape[1], 'h': gc.shape[0], 'rows': rows},
           'stripes': {'r': R2, 'w': line_ang.shape[1], 'h': line_ang.shape[0], 'rows': srows, 'note': 'per cell: angle bin (5 deg, base 36) then strength digit; -- = none'}},
          open(OUT, 'w'), separators=(',', ':'))
print('classes', np.bincount(gc.ravel(), minlength=7), 'stripe cells', int((strength >= 2).sum()), 'bytes', os.path.getsize(OUT))

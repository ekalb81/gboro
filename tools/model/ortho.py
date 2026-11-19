"""Export Guilford County aerial tiles and assemble a north-up image aligned to the model.

Usage: python tools/model/ortho.py <out.jpg> [metres-per-pixel=0.10] [west south east north]
       Add --rows START STOP to download only those rows (zero-based, stop exclusive).
       Run again without --rows to assemble the cached tiles and write the provenance sidecar.
"""
import argparse
import hashlib
import io
import json
import math
import os
from pathlib import Path
import time
from urllib.parse import urlencode, urlsplit
from urllib.request import urlopen

from PIL import Image

SOURCE = 'Guilford County GIS, 2026 Orthos'
URL = 'https://gcgis.guilfordcountync.gov/imagery/rest/services/Imagery/2026_Orthos/ImageServer'
MODEL = Path(__file__).resolve().parents[2] / 'public/model/downtown.json'


def get(url):
    for attempt in range(4):
        try:
            with urlopen(url, timeout=90) as response:
                return response.read()
        except OSError:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def grid(w, s, e, n, width, height):
    # Keep requests below both county export limits. Use pixel edges to avoid seams.
    cols, rows = math.ceil(width / 3500), math.ceil(height / 3000)
    xs = [round(width * i / cols) for i in range(cols + 1)]
    ys = [round(height * j / rows) for j in range(rows + 1)]
    for j, (top, bottom) in enumerate(zip(ys, ys[1:])):
        for i, (left, right) in enumerate(zip(xs, xs[1:])):
            extent = (w + (e - w) * left / width, n - (n - s) * bottom / height,
                      w + (e - w) * right / width, n - (n - s) * top / height)
            yield j, i, (left, top), (right - left, bottom - top), extent


def fetch_tile(path, size, extent):
    try:
        with Image.open(path) as tile:
            if tile.mode == 'RGB' and tile.size == size:
                tile.load()
                return
    except OSError:
        pass
    query = urlencode({'bbox': ','.join(map(str, extent)), 'bboxSR': 4326, 'imageSR': 4326,
                       'size': ','.join(map(str, size)), 'adjustAspectRatio': 'false',
                       'format': 'jpg', 'compressionQuality': 90, 'interpolation': 'RSP_BilinearInterpolation',
                       'f': 'json'})
    # Export in the model's lon/lat grid. The server defaults to expanding the box to fit the image.
    export = json.loads(get(f'{URL}/exportImage?{query}'))
    actual = export.get('extent', {})
    if ((export.get('width'), export.get('height')) != size or actual.get('spatialReference', {}).get('wkid') != 4326
            or any(abs(actual[k] - v) > 1e-8 for k, v in zip(('xmin', 'ymin', 'xmax', 'ymax'), extent))):
        raise ValueError(f'Unexpected export extent or dimensions for {path.name}: {export}')
    href = urlsplit(export['href'])
    if (href.scheme, href.netloc) != ('https', urlsplit(URL).netloc):
        raise ValueError(f'Unexpected export host for {path.name}: {href.netloc}')
    raw = get(href.geturl())
    with Image.open(io.BytesIO(raw)) as tile:
        if tile.mode != 'RGB' or tile.size != size or not any(lo < hi for lo, hi in tile.getextrema()):
            raise ValueError(f'Empty or incorrectly sized imagery for {path.name}')
    temp = path.with_suffix(f'.{os.getpid()}.tmp')
    temp.write_bytes(raw)
    temp.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('out', type=Path)
    parser.add_argument('metres_per_pixel', type=float, nargs='?', default=.10)
    parser.add_argument('bounds', type=float, nargs='*')
    parser.add_argument('--rows', type=int, nargs=2, metavar=('START', 'STOP'))
    args = parser.parse_args()
    geo = json.loads(MODEL.read_text(encoding='utf-8'))['GEO']
    if args.bounds and len(args.bounds) != 4:
        parser.error('supply all four bounds or use the model bounds')
    w, s, e, n = bounds = args.bounds or [geo[k] for k in ('west', 'south', 'east', 'north')]
    mpp = args.metres_per_pixel
    if not (all(map(math.isfinite, bounds)) and w < e and s < n and math.isfinite(mpp) and mpp > 0):
        parser.error('bounds must have positive area and metres per pixel must be positive')
    size = (round((e - w) * geo['mPerDegLon'] / mpp), round((n - s) * geo['mPerDegLat'] / mpp))
    if min(size) < 1:
        parser.error('image must be at least one pixel in each dimension')
    tiles = list(grid(*bounds, *size))
    first, stop = args.rows or (0, tiles[-1][0] + 1)
    if not 0 <= first < stop <= tiles[-1][0] + 1:
        parser.error(f'rows must be within [0, {tiles[-1][0] + 1})')

    key = hashlib.sha256(repr((URL, bounds, size)).encode()).hexdigest()[:12]
    cache = args.out.with_suffix('.tiles') / key
    cache.mkdir(parents=True, exist_ok=True)
    if not args.rows:
        image = Image.new('RGB', size)
    for row, col, offset, tile_size, extent in tiles:
        if not first <= row < stop:
            continue
        path = cache / f'{row:02}-{col:02}.jpg'
        fetch_tile(path, tile_size, extent)
        if not args.rows:
            with Image.open(path) as tile:
                image.paste(tile, offset)
        print(path, flush=True)
    if args.rows:
        return

    image.save(args.out, quality=95, subsampling=0)
    provenance = {'bounds': dict(zip(('west', 'south', 'east', 'north'), bounds)), 'size': size,
                  'm_per_px': mpp, 'crs': 'EPSG:4326, north up', 'source': SOURCE,
                  'imagery_year': 2026, 'capture_window': ['2026-01', '2026-03'],
                  'source_url': URL, 'native_pixel_size_inches': 1}
    args.out.with_suffix('.json').write_text(json.dumps(provenance, indent=2) + '\n', encoding='utf-8')
    print(f'Assembled {size[0]} × {size[1]} from {len(tiles)} tiles')


if __name__ == '__main__':
    main()

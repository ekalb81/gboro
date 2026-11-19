"""Read roof colours from an ortho.py mosaic.

Usage: python tools/model/roof_colours.py <aerial.jpg> <downtown.json> <osm/roofs.json>
Keeps existing colours for roofs with too little imagery inside the model bounds.
"""
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi


def colour(image, outline, px, py, inset):
    points = [(x * px, y * py) for x, y in zip(outline[::2], outline[1::2])]
    x0, y0 = max(0, int(min(x for x, _ in points))), max(0, int(min(y for _, y in points)))
    x1 = min(image.width, int(max(x for x, _ in points)) + 1)
    y1 = min(image.height, int(max(y for _, y in points)) + 1)
    if x1 <= x0 or y1 <= y0:
        return None
    mask = Image.new('1', (x1 - x0, y1 - y0))
    ImageDraw.Draw(mask).polygon([(x - x0, y - y0) for x, y in points], fill=1)
    inside = np.asarray(mask)
    interior = ndi.binary_erosion(inside, iterations=inset)
    pixels = np.asarray(image.crop((x0, y0, x1, y1)))[interior if interior.sum() >= 20 else inside]
    if len(pixels) < 20:
        return None
    lit = pixels[pixels.max(axis=1) > 71]
    median = np.median(lit if len(lit) >= .4 * len(pixels) else pixels, axis=0)
    return '#%02x%02x%02x' % tuple(map(round, median))


def main(aerial, model, output):
    meta = json.loads(aerial.with_suffix('.json').read_text(encoding='utf-8'))
    data = json.loads(model.read_text(encoding='utf-8'))
    geo = data['GEO']
    if any(abs(geo[key] - meta['bounds'][key]) > 1e-8 for key in ('north', 'south', 'west', 'east')):
        raise ValueError('Aerial bounds must match the model')
    Image.MAX_IMAGE_PIXELS = None
    colours = json.loads(output.read_text(encoding='utf-8')) if output.exists() else {}
    n = 0
    with Image.open(aerial) as image:
        if image.mode != 'RGB' or list(image.size) != meta['size']:
            raise ValueError('Expected the RGB image described in the aerial sidecar')
        px = image.width * data['M'] / ((geo['east'] - geo['west']) * geo['mPerDegLon'])
        py = image.height * data['M'] / ((geo['north'] - geo['south']) * geo['mPerDegLat'])
        inset = max(1, round(.30 / meta['m_per_px']))
        for building in data['B'] + data.get('PT', []):
            sample = colour(image, building['p'], px, py, inset)
            if sample:
                colours[str(building['id'])] = sample
                n += 1
    output.write_text(json.dumps(colours, indent=0, sort_keys=True) + '\n', encoding='utf-8')
    print(f'Sampled {n} roof colours')


if __name__ == '__main__':
    main(*(Path(arg) for arg in sys.argv[1:]))

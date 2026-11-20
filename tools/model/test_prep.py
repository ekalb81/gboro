"""Geometry regression for prep.py. Run with Shapely installed."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


PREP = Path(__file__).with_name('prep.py').resolve()


@unittest.skipUnless(importlib.util.find_spec('shapely'), 'requires Shapely')
class PrepTests(unittest.TestCase):
    def test_overlapping_lots_share_stall_occupancy(self):
        geo = json.loads((PREP.parents[2] / 'public/model/downtown.json').read_text())['GEO']
        points = [(-1, .1), (5.2, .1), (5.2, 2.1), (-1, 2.1), (-.75, 1.1), (5, 1.1)]
        nodes = [
            {'type': 'node', 'id': i, 'lon': geo['west'] + x * 9 / geo['mPerDegLon'],
             'lat': geo['north'] - y * 9 / geo['mPerDegLat']}
            for i, (x, y) in enumerate(points, 1)
        ]
        lot = {'type': 'way', 'id': 11, 'nodes': [1, 2, 3, 4, 1], 'tags': {'amenity': 'parking'}}
        aisle = {'type': 'way', 'id': 12, 'nodes': [5, 6],
                 'tags': {'highway': 'service', 'service': 'parking_aisle'}}
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            (base / 'osm').mkdir()
            (base / 'imagery').mkdir()
            (base / 'imagery/ground.json').write_text(json.dumps({
                'stripes': {'r': 3, 'rows': ['c9' * 20] * 8},
                'gc': {'r': 1, 'w': 1, 'h': 1, 'rows': ['01']},
            }))
            source = base / 'geometry.json'
            source.write_text(json.dumps({'elements': []}))
            output = base / 'built.json'

            def build(ways):
                (base / 'osm/downtown-raw.json').write_text(json.dumps({'elements': nodes + ways}))
                subprocess.run([sys.executable, str(PREP), str(source), tmp, str(output)], check=True, capture_output=True)
                return json.loads(output.read_text())

            first = build([lot, aisle])
            duplicate = build([lot, aisle, dict(lot, id=13)])
        self.assertEqual(len(duplicate['PL']), 2)
        self.assertTrue(any(row[0] < 0 for row in first['SR']))
        self.assertTrue(any(abs(row[5]) % 90 for row in first['SR']))
        self.assertEqual(first['SR'], duplicate['SR'])


if __name__ == '__main__':
    unittest.main()

"""Tests for tools/model/refresh.py. Run: python3 -m unittest tools/model/test_refresh.py"""
import copy, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import refresh as R


def raw_extract():
    nodes = [{'type': 'node', 'id': i, 'lat': 36.07 + i * 1e-4, 'lon': -79.79 + (i % 2) * 1e-4} for i in range(1, 6)]
    return {'elements': nodes + [
        {'type': 'way', 'id': 30, 'nodes': [1, 2, 3, 1], 'tags': {'building': 'yes', 'name': 'Shop'}},
        {'type': 'way', 'id': 20, 'nodes': [3, 4, 5], 'tags': {'highway': 'residential'}},
        {'type': 'way', 'id': 10, 'nodes': [4, 5], 'tags': {'barrier': 'fence'}},  # not drawn: dropped
        {'type': 'way', 'id': 40, 'nodes': [5, 99], 'tags': {'highway': 'service'}},  # one known node: dropped
    ]}


def model(*bs):
    return {'B': list(bs), 'R': [], 'PK': [], 'PL': [], 'RL': [], 'VG': None}


def bld(i, side=10, **kw):
    s = side / R.M
    return dict({'id': i, 'p': [0, 0, s, 0, s, s, 0, s], 'n': f'B{i}', 'l': 3, 'h': None}, **kw)


class ToGeometry(unittest.TestCase):
    def test_keeps_mapped_ways_with_coordinates_sorted_by_id(self):
        g = R.to_geometry(raw_extract())
        self.assertEqual([e['id'] for e in g['elements']], [20, 30])
        self.assertEqual(len(g['elements'][1]['geometry']), 4)
        self.assertAlmostEqual(g['elements'][1]['bounds']['maxlat'], 36.0703)


class Compare(unittest.TestCase):
    def test_no_change(self):
        m = model(bld(1), bld(2))
        self.assertEqual(R.compare(m, copy.deepcopy(m)), ([], []))
        self.assertEqual(R.canon(m), R.canon(model(bld(2), bld(1))))
        x1 = dict(m, X=[[1, 2, [[0, 1, 3], [1, 0, 2]]], [5, 6, [[1, 0, 4]]]])
        x2 = dict(m, X=[[5, 6, [[1, 0, 4]]], [1, 2, [[1, 0, 2], [0, 1, 3]]]])
        self.assertEqual(R.canon(x1), R.canon(x2))
        self.assertNotEqual(R.canon(x1), R.canon(dict(m, X=[[5, 6, [[1, 0, 4]]]])))

    def test_new_and_gone_buildings_are_big_unless_tiny(self):
        big, small = R.compare(model(bld(1), bld(2, side=3)), model(bld(1), bld(3)))
        self.assertEqual(big, ['New: B3 (100 m²)'])
        self.assertEqual(small, ['Gone: B2 (9 m²)'])

    def test_height_jump_is_big_small_tweaks_are_small(self):
        big, small = R.compare(model(bld(1), bld(2)), model(bld(1, lh=25.0), bld(2, l=4, n='Two')))
        self.assertEqual(big, ['Height: B1 11 m to 25 m'])
        self.assertIn('Renamed: B2 to Two', small)

    def test_outline_and_roof_changes_are_small(self):
        moved = bld(1, rc='#aa0000'); moved['p'] = [v + 0.1 for v in moved['p']]
        big, small = R.compare(model(bld(1)), model(moved))
        self.assertEqual(big, [])
        self.assertEqual(small, ['1 building outline(s) adjusted', '1 roof colour(s) changed'])


BOX = {'n': 36.0886, 's': 36.066, 'w': -79.7954, 'e': -79.7843, 'kx': 89978.163, 'ky': 110574}


class Fetching(unittest.TestCase):
    def test_tiles_cover_the_box_and_margin_without_gaps(self):
        t = R.osm_tiles(BOX)
        self.assertEqual(min(x[0] for x in t), round(BOX['w'] - R.OSM_MARGIN, 6))
        self.assertEqual(max(x[2] for x in t), round(BOX['e'] + R.OSM_MARGIN, 6))
        self.assertEqual(min(x[1] for x in t), round(BOX['s'] - R.OSM_MARGIN, 6))
        self.assertEqual(max(x[3] for x in t), round(BOX['n'] + R.OSM_MARGIN, 6))
        for w, s, e, n in t:   # each call stays small, and each tile's neighbour starts where it ends
            self.assertLessEqual(e - w, R.OSM_TILE + 1e-9); self.assertLessEqual(n - s, R.OSM_TILE + 1e-9)
            self.assertTrue(e == max(x[2] for x in t) or any(x[0] == e and x[1] == s for x in t))
            self.assertTrue(n == max(x[3] for x in t) or any(x[1] == n and x[0] == w for x in t))

    def test_merge_keeps_one_of_each_in_a_stable_order(self):
        a = [{'type': 'way', 'id': 7, 'nodes': [1, 2]}, {'type': 'node', 'id': 2}, {'type': 'node', 'id': 1}]
        b = [{'type': 'node', 'id': 2}, {'type': 'relation', 'id': 3}, {'type': 'way', 'id': 7, 'nodes': [1, 2]}, {'type': 'node', 'id': 9}]
        m = R.merge_elements([a, b])
        self.assertEqual([(e['type'], e['id']) for e in m], [('node', 1), ('node', 2), ('node', 9), ('way', 7), ('relation', 3)])
        self.assertEqual(m, R.merge_elements([b, a]))

    def test_counts_only_buildings_inside_the_box(self):
        def way(i, lat, lon, **tags):
            return {'type': 'way', 'id': i, 'tags': tags, 'geometry': [{'lat': lat, 'lon': lon}, {'lat': lat + 1e-4, 'lon': lon + 1e-4}]}
        g = {'elements': [way(1, 36.07, -79.79, building='yes'), way(2, 36.10, -79.79, building='yes'),
                          way(3, 36.07, -79.70, building='house'), way(4, 36.07, -79.79, highway='service')]}
        self.assertEqual(R.buildings_in_box(g, BOX), 1)


class Checks(unittest.TestCase):
    def test_newest_flight_date_is_read_from_image_names(self):
        reply = {'catalogItems': {'features': [{'attributes': {'Name': 'OF6i0_37_000_10786402_20220209', 'OBJECTID': 20260930}},
                                               {'attributes': {'Name': 'OF6i0_37_000_10786402_20260214', 'Year': 2026}},
                                               {'attributes': {'Name': 'tile_10786402', 'ProductName': 'x_20261340', 'Tag': 'planned_20991231'}}]}}
        self.assertEqual(R.newest_date(reply), '2026-02-14')
        self.assertIsNone(R.newest_date({}))
        self.assertIsNone(R.newest_date({'catalogItems': {'features': [{'attributes': {'Name': 'no date here 123456789'}}]}}))


class AerialReadings(unittest.TestCase):
    def test_brick_paving_and_rubber_playgrounds_are_carried_over(self):
        cur = {'BK': {'r': 6, 'rows': ['1,2']}, 'A': [{'k': 'play', 'p': [1, 2, 3, 4, 5, 6], 's': 'rubber'}, {'k': 'play', 'p': [9, 9, 8, 8, 7, 7]}]}
        made = {'BK': None, 'A': [{'k': 'play', 'p': [1, 2, 3, 4, 5, 6]}, {'k': 'play', 'p': [9, 9, 8, 8, 7, 7]}, {'k': 'pool', 'p': [1, 2, 3, 4, 5, 6]}]}
        R.keep_aerial_readings(made, cur)
        self.assertEqual(made['BK'], cur['BK'])
        self.assertEqual([a.get('s') for a in made['A']], ['rubber', None, None])


    def test_lidar_found_buildings_keep_their_roof_colour_by_outline(self):
        old = model(bld(9100000001, lidar_new=1, rc='#aabbcc'), bld(9100000002, side=20, lidar_new=1, rc='#112233'), bld(5, rc='#ffffff'))
        new = model(bld(9100000001, side=20, lidar_new=1), bld(9100000002, side=30, lidar_new=1), bld(5))   # ids shifted by one
        self.assertEqual(R.keep_roof_colours(new, old), 1)
        self.assertEqual([b.get('rc') for b in new['B']], ['#112233', None, None])


class Staleness(unittest.TestCase):
    def test_inputs_hash_is_stable(self):
        self.assertEqual(R.inputs_hash(), R.inputs_hash())
        self.assertEqual(len(R.inputs_hash()), 16)


if __name__ == '__main__':
    unittest.main()

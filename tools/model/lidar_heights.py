"""Step 2 of 4 of a lidar refresh: measure every OpenStreetMap building's height from the points lidar_load.py kept.

Usage: python3 tools/model/lidar_heights.py <work-dir> <osm-extract.json> <osm-raw.json> <previous heights.json> <out heights.json>
A building wholly inside the downloaded tiles (and the model) is measured afresh and marked "survey": 2024, with the
earlier figure kept beside it as h_2015. Any other building keeps its record from the previous file, marked 2015.
prep.py reads the result as <inputs-dir>/osm/heights.json. Needs shapely 2, pyproj, numpy.
"""
import json,sys,math,numpy as np,pyproj
from shapely.geometry import Polygon,box
from shapely.ops import unary_union,transform
from shapely import contains_xy
work,osm_main,osm_raw,old_json,out=sys.argv[1:6]
N0,S,Wl,E0=36.0768,36.0660,-79.7954,-79.7856;NORTH=145;EAST=13
N=N0+NORTH*9.0/110574;k=math.cos(math.radians((N0+S)/2))*111320
def g(lon,lat): return ((lon-Wl)*k,(N-lat)*110574)
cov=json.load(open(work+'/cover.json'))
tr=pyproj.Transformer.from_crs(6543,4326,always_xy=True)
def tomodel(x,y,z=None):
    lon,lat=tr.transform(x,y);return g(np.asarray(lon),np.asarray(lat))
COVER=unary_union([transform(tomodel,box(*t['bbox_ftus']).segmentize(250)) for t in cov['tiles'] if t['used']]).buffer(0).intersection(box(-5,-5,cov['GXm']+5,cov['GYm']+5))  # 2024 points were only loaded for the model's own area
d=np.load(work+'/pts.npz');X=d['X'];Y=d['Y'];Z=d['Z'];C=d['C']
GROUND=np.isin(C,[2,11,20]);BLD=np.isin(C,[6,1])
keep=GROUND|BLD;X,Y,Z,C,GROUND,BLD=X[keep],Y[keep],Z[keep],C[keep],GROUND[keep],BLD[keep]
x0,y0=float(X.min()),float(Y.min());cs=5.0
gx=((X-x0)//cs).astype(np.int64);gy=((Y-y0)//cs).astype(np.int64);W=int(gx.max())+1
key=gy*W+gx;order=np.argsort(key,kind='stable');ks=key[order];del key,gx,gy
def pts_in(minx,miny,maxx,maxy):
    a=max(int((minx-x0)//cs),0);b=min(int((maxx-x0)//cs),W-1);c0=max(int((miny-y0)//cs),0);dd=int((maxy-y0)//cs)
    idx=[order[np.searchsorted(ks,r*W+a):np.searchsorted(ks,r*W+b,side='right')] for r in range(c0,dd+1)]
    return np.concatenate(idx) if idx else np.array([],np.int64)
def robust_max(z):
    z=np.sort(z)[::-1]
    for i in range(min(len(z)-1,60)):
        if z[i]-z[min(i+5,len(z)-1)]<3.0: return float(z[i])
    return float(z[min(len(z)-1,60)])
els=json.load(open(osm_main))['elements'];raw=json.load(open(osm_raw))['elements']
nodes={e['id']:e for e in raw if e['type']=='node'}
for e in raw:
    if e['type']=='way' and 'geometry' not in e and 'nodes' in e and all(n in nodes for n in e['nodes']):
        e['geometry']=[{'lat':nodes[n]['lat'],'lon':nodes[n]['lon']} for n in e['nodes']]
feats={}
for e in els+raw:
    t=e.get('tags',{})
    if e['type']=='way' and ('building' in t or 'building:part' in t) and len(e.get('geometry',[]))>=4: feats[e['id']]=e
old=json.load(open(old_json));OB=old['buildings']
res={};cnt={}
def bump(n): cnt[n]=cnt.get(n,0)+1
for oid,e in feats.items():
    t=e.get('tags',{})
    poly=Polygon([g(p['lon'],p['lat']) for p in e['geometry']]).buffer(0)
    if poly.is_empty: continue
    o=OB.get(str(oid))
    if not COVER.contains(poly):
        if o: r=dict(o);r['survey']=2015;res[str(oid)]=r;bump('kept_2015_outside_2024_tiles_or_model')
        else: res[str(oid)]={'name':t.get('name'),'part':'building:part' in t,'h':None,'hmax':None,'note':'outside_coverage','survey':None};bump('outside_coverage')
        continue
    minx,miny,maxx,maxy=poly.bounds;area=poly.area
    rec={'name':t.get('name'),'part':'building:part' in t,'area_m2':round(area,1),'survey':2024}
    idx=pts_in(minx-50,miny-50,maxx+50,maxy+50)
    ii=idx[contains_xy(poly,X[idx],Y[idx])]
    gnd=None;gi0=idx[GROUND[idx]]
    for r in (10,25,50):
        ring=poly.buffer(r).difference(poly);gi=gi0[contains_xy(ring,X[gi0],Y[gi0])]
        if len(gi)>=20: gnd=float(np.median(Z[gi]));break
    b=ii[BLD[ii]];c6=ii[C[ii]==6]
    rec['n_points']=int(len(b));rec['n_class6']=int(len(c6))
    if o and o.get('h') is not None: rec['h_2015']=o['h']
    if gnd is None:
        rec.update(h=None,hmax=None,note='no_ground_nearby');bump('too_few_points')
    else:
        rec['ground']=round(gnd,2)
        from_c6=len(c6)>=max(30,0.3*len(b));use=c6 if from_c6 else b
        rec['method']='class6' if from_c6 else 'unclassified_nonground'
        zz=Z[use]-gnd
        tall=int((zz>2.0).sum())
        if tall<max(20,0.5*area):
            rec.update(h=None,hmax=None);rec['note']='no_building_in_2024' if area>60 else 'too_few_points';bump(rec['note'])
        else:
            zz=zz[zz>2.0] if not from_c6 else zz
            h=float(np.percentile(zz,90));hm=robust_max(Z[b]-gnd)
            rec['h']=round(h,1);rec['hmax']=round(max(hm,h),1);rec['note']='ok';bump('ok')
    for kk in ('height','building:levels'):
        if kk in t: rec['osm_'+kk.replace('building:','')]=t[kk]
    res[str(oid)]=rec
outd={'source':'NC Emergency Management Phase 3 QL1 lidar, flown 2024-02-03 (NC Spatial Data Download, sdd.nc.gov, tiles ordered by hand 2026-11-16), for every building inside the downloaded tiles; buildings north of them keep the 2015 measurement (NC Floodplain Mapping Program Phase III QL2, NOAA Digital Coast id 6209, flown 2015-02-03). Each building says which in "survey".',
 'survey_year':2024,'survey_date':'2024-02-03','previous':'heights-2015.json',
 'coverage_2024':{'tiles_ftus_epsg6543':[t['bbox_ftus'] for t in cov['tiles'] if t['used']],'note':'the model north of about 36.0829 N is outside these tiles'},
 'crs_note':'heights in metres above median ground (classes 2, 11 road, 20) within a 10 m ring (25 or 50 m if sparse)',
 'method':{'h':'90th percentile of building-class (6) returns in the footprint; falls back to unclassified (1) returns more than 2 m up when class 6 is under 30% of them','hmax':'highest building/unclassified return with no 3 m gap in the 5 returns below it (drops birds, wires, noise)','h_2015':'the 2015 measurement of the same footprint, for comparison'},
 'notes':{'no_building_in_2024':'under half the footprint has anything more than 2 m up in Feb 2024: demolished, not yet built, or the outline is in the wrong place','too_few_points':'too few returns to measure','outside_coverage':'outside both surveys\' tiles','likely_newer_than_survey':'(2015 records only) footprint empty or flat in Feb 2015'},
 'skipped_relations':old.get('skipped_relations',[]),'counts':cnt,'buildings':res}
json.dump(outd,open(out,'w'),indent=1)
print(cnt,len(res))

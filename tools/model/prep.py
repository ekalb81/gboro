"""Build public/model/downtown.json (the downtown scale model) from an OpenStreetMap extract plus
the optional survey layers (lidar tiers and heights, roof colours, aerial vegetation, street-photo facades).

Usage: python3 tools/model/prep.py <osm-extract.json> [inputs-dir] [out.json]
inputs-dir holds osm/shapes.json, osm/downtown-raw.json (also read for building names, tenants and addresses), osm/roofs.json, osm/facades.json,
osm/heights.json, addresses.json (tools/model/addresses.py; the copy in data/model/ is used when it is missing), imagery/ortho-downtown.png and imagery/ground.json (tools/model/ground.py: ground classes and
painted parking lines from the aerial, checked into data/model/imagery/). Missing optional inputs are skipped.
Bridges, the underpass, skywalks (DK) and railroad crossings (LX) come from the extract's bridge and crossing tags.
Laying out parking stalls needs shapely (pip install shapely); without it the lots are drawn with no stalls.
"""
import json,math,sys,os
src=sys.argv[1]
INP=(sys.argv[2] if len(sys.argv)>2 else '/mnt/project-files/village').rstrip('/')+'/'
OUT=sys.argv[3] if len(sys.argv)>3 else os.path.join(os.path.dirname(__file__),'..','..','public','model','downtown.json')
d=json.load(open(src))
N0, S, Wl, E0 = 36.0768, 36.0660, -79.7954, -79.7856   # the downtown the model began as
NORTH = 145                                             # model tiles (9 m) added on the north side since, up to the house up the street
EAST = 13                                               # and on the east side, to take in the apartments, pool and water tower by Murrow Boulevard
N = N0 + NORTH * 9.0 / 110574
M=9.0
lat0=N;lon0=Wl;k=math.cos(math.radians((N0+S)/2))*111320
El = E0 + EAST * 9.0 / k
def g(p): return ((p['lon']-lon0)*k/M,(lat0-p['lat'])*110574/M)
GX=(El-Wl)*k/M; GY=(N-S)*110574/M
def inreg(x,y,m=0): return -m<=x<=GX+m and -m<=y<=GY+m
def flat(pts): return [round(v,2) for p in pts for v in p]
B=[];R=[];RL=[];PK=[];PL=[];PED=[]
rcls={'motorway':0,'trunk':0,'primary':1,'secondary':2,'tertiary':3,'residential':4,'unclassified':4,'service':5,'pedestrian':6}
for e in d['elements']:
    t=e.get('tags',{});geo=e.get('geometry') or []
    if len(geo)<2: continue
    pts=[g(p) for p in geo]
    cx=sum(p[0] for p in pts)/len(pts);cy=sum(p[1] for p in pts)/len(pts)
    if 'building' in t:
        if not inreg(cx,cy): continue
        if pts[0]==pts[-1]: pts=pts[:-1]
        if len(pts)<3: continue
        lv=t.get('building:levels');h=t.get('height')
        try: lv=float(lv)
        except: lv=None
        try: hm=float(str(h).split()[0])
        except: hm=None
        B.append({'p':flat(pts),'l':lv,'h':hm,'t':t.get('building'),'n':t.get('name',''),'id':e['id'],'a':t.get('amenity',''),'mat':t.get('building:material',''),'rs':t.get('roof:shape','')})
    elif 'highway' in t:
        if t['highway'] not in rcls: continue
        if not any(inreg(x,y,3) for x,y in pts): continue
        area=t.get('area')=='yes' or (t['highway']=='pedestrian' and pts[0]==pts[-1])
        R.append({'c':rcls[t['highway']],'n':t.get('name',''),'p':flat(pts),'ar':1 if area else 0,'ow':1 if t.get('oneway')=='yes' else 0})
        # a roundabout's ring: one way round (OpenStreetMap leaves the oneway tag off), and no crosswalks painted on it
        if t.get('junction') in ('roundabout','circular') and not area: R[-1]['rb']=1
        if t.get('bridge') in ('yes','viaduct') and not area: R[-1]['br']=1;R[-1]['ln']=t.get('lanes','')
    elif t.get('railway')=='rail':
        if not any(inreg(x,y,3) for x,y in pts): continue
        RL.append({'n':t.get('name',''),'p':flat(pts),'sv':1 if t.get('service') else 0})
    elif t.get('leisure') in ('park','pitch','stadium'):
        if not inreg(cx,cy,5): continue
        PK.append({'n':t.get('name',''),'p':flat(pts),'k':t.get('leisure')})
    elif t.get('amenity')=='parking':
        if not inreg(cx,cy,2): continue
        if t.get('parking') in ('multi-storey','underground'): continue
        PL.append(flat(pts))
# merge polylines by name for traffic and rail
def chains(items):
    segs=[list(zip(it['p'][0::2],it['p'][1::2])) for it in items]
    out=[]
    while segs:
        cur=segs.pop(0);changed=True
        while changed:
            changed=False
            for i,s in enumerate(segs):
                if s[0]==cur[-1]: cur=cur+s[1:]
                elif s[-1]==cur[0]: cur=s[:-1]+cur
                elif s[-1]==cur[-1]: cur=cur+s[::-1][1:]
                elif s[0]==cur[0]: cur=s[::-1][:-1]+cur
                else: continue
                segs.pop(i);changed=True;break
        out.append(cur)
    return out
def plen(c): return sum(math.dist(c[i],c[i+1]) for i in range(len(c)-1))
traffic=[]
for nm in ['North Elm Street','South Elm Street','East Market Street','West Market Street','North Greene Street','South Greene Street','North Davie Street','South Davie Street','East Friendly Avenue','West Friendly Avenue','North Eugene Street','South Eugene Street','West Washington Street','East Washington Street','North Church Street','East Lindsay Street','Bellemeade Street','West McGee Street','East Gate City Boulevard','West Gate City Boulevard','North Edgeworth Street','South Edgeworth Street','Summit Avenue','North Murrow Boulevard']:
    its=[r for r in R if r['n']==nm and r['c']<=4]
    for c in chains(its):
        if plen(c)>8: traffic.append({'n':nm,'p':[round(v,2) for p in c for v in p],'c':min(r['c'] for r in its)})
main=[r for r in RL if not r['sv']]
# the train runs on the main line with the most track inside the model, not the longest chain in the extract
# (a line that only clips a corner of the model can be longer end to end)
def plen_in(c):
    t=0
    for a,b in zip(c,c[1:]):
        L=math.dist(a,b);n=max(1,int(L/2))
        t+=sum(L/n for i in range(n) if inreg(a[0]+(b[0]-a[0])*(i+.5)/n,a[1]+(b[1]-a[1])*(i+.5)/n,1.5))
    return t
rc=sorted(chains(main),key=plen_in,reverse=True)
train=[round(v,2) for p in rc[0] for v in p] if rc else []
# intersections for crosswalks
from collections import defaultdict
vx=defaultdict(list)
for r in R:
    if r['ar'] or r['c']>4: continue
    p=list(zip(r['p'][0::2],r['p'][1::2]))
    for i,pt in enumerate(p):
        for j in (i-1,i+1):
            if 0<=j<len(p):
                dx=p[j][0]-pt[0];dy=p[j][1]-pt[1];L=math.hypot(dx,dy)
                if L>0: vx[pt].append((r['n'],round(dx/L,3),round(dy/L,3),r['c']))
X=[]
for pt,ds in vx.items():
    if len(set(d[0] for d in ds))>=2 and len(ds)>=3 and inreg(pt[0],pt[1]):
        X.append([round(pt[0],2),round(pt[1],2),[[d[1],d[2],d[3]] for d in ds]])
# lidar-derived shapes: stepped tiers inside footprints, and verified buildings OSM lacks (outlines from the State's
# 2022 building footprints where it has one, else from the lidar; 't' is set for the depot's platform canopies)
# (tools/model/lidar_shapes.py writes the file; the heights further down come from tools/model/lidar_heights.py)
try:
    SHP=json.load(open(INP+'osm/shapes.json'))
    for b in B:
        t=SHP['tiers'].get(str(b['id']))
        if t: b['tb']=t['base'];b['tr']=t['tiers']
    for n,nb in enumerate(SHP['new']):
        if nb.get('gone'): continue    # keep obsolete entries in shapes.json so the survey IDs stay stable
        B.append({'p':nb['p'],'l':None,'h':None,'lh':nb['h'],'t':nb.get('t','yes'),'n':'','id':9100000000+n,'a':'','mat':'','rs':'','lidar_new':1})
except FileNotFoundError: pass
# a building that straddles the edge of the model is cut off at the edge, not left hanging over it
try:
    from shapely.geometry import Polygon as _Pg, box as _box
    _brd=_box(0,0,GX,GY)
    def _clip(p):
        xs=p[0::2];ys=p[1::2]
        if min(xs)>=0 and min(ys)>=0 and max(xs)<=GX and max(ys)<=GY: return p
        q=_Pg(list(zip(xs,ys))).buffer(0).intersection(_brd)
        if q.geom_type=='MultiPolygon': q=max(q.geoms,key=lambda g_:g_.area)
        return flat(list(q.exterior.coords)[:-1]) if q.geom_type=='Polygon' and not q.is_empty and q.area>.02 else None
    for b in B:
        b['p']=_clip(b['p']) or b['p']
        if b.get('tr'): b['tr']=[dict(t_,p=q) for t_ in b['tr'] for q in [_clip(t_['p'])] if q]
except ImportError: pass
# 3D building parts (from the unfiltered OSM extract)
PT=[]
try:
    raw=json.load(open(INP+'osm/downtown-raw.json'))['elements']
    nd={e['id']:e for e in raw if e['type']=='node'}
    def num(v):
        try: return float(str(v).split()[0])
        except: return None
    for e in raw:
        t=e.get('tags',{})
        if e['type']!='way' or 'building:part' not in t: continue
        pts=[g(nd[i]) for i in e['nodes'] if i in nd]
        if pts and pts[0]==pts[-1]: pts=pts[:-1]
        PT.append({'id':e['id'],'p':flat(pts),'h':num(t.get('height')),'mh':num(t.get('min_height')),'l':num(t.get('building:levels')),'rs':t.get('roof:shape',''),'rc':t.get('roof:colour',''),'ra':num(t.get('roof:angle')),'n':t.get('name',''),'a':t.get('amenity','')})
except FileNotFoundError: pass

# Roof colours from roof_colours.py, with an optional vegetation mask from the older aerial.
try:
    RC=json.load(open(INP+'osm/roofs.json'))
    for b in B:
        if str(b['id']) in RC: b['rc']=RC[str(b['id'])]
    for pt in PT:
        if str(pt['id']) in RC: pt['rc2']=RC[str(pt['id'])]
except FileNotFoundError: pass
VG=None
try:
    from PIL import Image
    import numpy as np
    im=np.asarray(Image.open(INP+'imagery/ortho-downtown.png').convert('RGB')).astype(float)/255
    r_,g_,b_=im[...,0],im[...,1],im[...,2];mx=im.max(-1);mn=im.min(-1);sat=(mx-mn)/(mx+1e-6)
    veg=((g_>b_+0.02)&(sat>0.16)&(mx>0.18)&(mx<0.75)&(g_>=r_-0.06)).astype(float)
    H_,W_=veg.shape;RES=6
    gw=int(math.ceil(GX*RES));gh=int(math.ceil(GY*RES))
    G=np.zeros((gh,gw),np.uint8)
    for j in range(gh):
        y=(j+.5)/RES;lat=lat0-y*M/110574;py0=(N-lat)/(N-S)*H_
        for i in range(gw):
            x=(i+.5)/RES;lon=lon0+x*M/k;px=(lon-Wl)/(El-Wl)*W_
            x0=int(px-2.5);y0=int(py0-2.5)
            if 0<=x0 and 0<=y0 and x0+5<=W_ and y0+5<=H_ and veg[y0:y0+5,x0:x0+5].mean()>0.45: G[j,i]=1
    P_=np.pad(G,1);S_=sum(P_[1+dy:1+dy+gh,1+dx:1+dx+gw] for dy in (-1,0,1) for dx in (-1,0,1))
    G=(S_>=5).astype(np.uint8)
    rows=[]
    for j in range(gh):
        runs=[];cur=0;n=0
        for v in G[j]:
            if v==cur: n+=1
            else: runs.append(n);cur=v;n=1
        runs.append(n)
        rows.append(','.join(format(r,'x') for r in runs))
    VG={'r':RES,'w':gw,'h':gh,'rows':rows}
    # roof colours for the buildings OpenStreetMap lacks (roofs.json only knows OSM ids): the sunlit roof's median colour
    from PIL import ImageDraw
    for b in B:
        if b.get('rc') or not b.get('lidar_new'): continue
        q=[(x*M/k/(El-Wl)*W_,y*M/110574/(N-S)*H_) for x,y in zip(b['p'][0::2],b['p'][1::2])]
        x0,y0=int(min(p[0] for p in q)),int(min(p[1] for p in q));x1,y1=int(max(p[0] for p in q))+1,int(max(p[1] for p in q))+1
        if x0<0 or y0<0 or x1>W_ or y1>H_ or x1-x0<3 or y1-y0<3: continue
        mk_=Image.new('L',(x1-x0,y1-y0),0);ImageDraw.Draw(mk_).polygon([(a-x0,c-y0) for a,c in q],fill=255)
        sel=im[y0:y1,x0:x1][np.asarray(mk_)>0]
        if len(sel)<20: continue
        lit=sel[sel.max(-1)>.28];med=np.median(lit if len(lit)>=.15*len(sel) else sel,axis=0)
        b['rc']='#%02x%02x%02x'%tuple(int(round(v*255)) for v in med)
except FileNotFoundError: pass

# facade readings from Mapillary street photos (2018/2021)
try:
    FC=json.load(open(INP+'osm/facades.json'))
    for b in B:
        f=FC.get(str(b['id']))
        if f: b['f']={k:f.get(k) for k in ('wall_hex','trim_hex','material','floors','storefront','awning_hex','window_style','confidence')}
except FileNotFoundError: pass
# facade readings from Wikimedia Commons photos (mostly a 2019 walk along Elm and Market streets, straight-on and
# CC0); committed in data/model/facades-commons.json. One replaces a Mapillary reading unless that one is surer.
try:
    FW_=json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','data','model','facades-commons.json')))
    _rk={'low':0,'medium':1,'high':2}
    for b in B:
        f=FW_.get(str(b['id']))
        if f and _rk.get(f.get('confidence'),0)>=_rk.get((b.get('f') or {}).get('confidence'),-1):
            b['f']={k:f.get(k) for k in ('wall_hex','trim_hex','material','floors','storefront','awning_hex','window_style','confidence')}
except FileNotFoundError: pass

# measured heights: the 2024 NC lidar (flown 2024-02-03); a building outside the ordered tiles keeps its 2015 figure
try:
    HT=json.load(open(INP+'osm/heights.json'))['buildings']
    for b in B:
        r=HT.get(str(b['id']))
        if r and r.get('h'): b['lh']=round(r['h'],1)
except FileNotFoundError: pass
# North of the old downtown edge the map runs through a neighbourhood of houses that OpenStreetMap mostly tags as plain
# "building=yes" (outlines traced from aerials). A small, low, unnamed building there whose nearest street is a
# residential one is drawn as a house (pitched roof, no shopfront) instead of a downtown storefront.
def _seg_d(px,py,ax,ay,bx,by):
    dx=bx-ax;dy=by-ay;L2=dx*dx+dy*dy;u=0 if L2==0 else max(0,min(1,((px-ax)*dx+(py-ay)*dy)/L2))
    return math.hypot(px-ax-u*dx,py-ay-u*dy)
_streets=[(r['c'],r['p']) for r in R if not r['ar'] and r['c']<=4 and r['n']]
nh=0
for b in B:
    if b['t']!='yes' or b['n'] or b['a'] or b.get('tr'): continue   # (the houses the lidar found count too)
    xs=b['p'][0::2];ys=b['p'][1::2];cx=sum(xs)/len(xs);cy=sum(ys)/len(ys)
    if cy>=NORTH: continue
    ar=abs(sum(xs[i]*ys[(i+1)%len(xs)]-xs[(i+1)%len(xs)]*ys[i] for i in range(len(xs))))/2*M*M
    if ar>=400 or (b.get('lh') or 0)>=11 or (b.get('l') or 0)>3: continue
    best=(1e9,9)
    for c,p in _streets:
        if min(p[0::2])>cx+8 or max(p[0::2])<cx-8 or min(p[1::2])>cy+8 or max(p[1::2])<cy-8: continue
        for i in range(0,len(p)-2,2):
            d_=_seg_d(cx,cy,p[i],p[i+1],p[i+2],p[i+3])
            if d_<best[0]: best=(d_,c)
    if best[1]==4 and best[0]<8: b['t']='house';nh+=1
print('houses north of downtown',nh)

# ---- the ground between the buildings: OSM footpaths, lawns, beds, woods and plazas; surface lots with their stalls
# laid out along the mapped parking aisles at the stall angle read from the aerial (imagery/ground.json from
# tools/model/ground.py); and the aerial's ground classes for everything else.
FW=[];GA=[];SR=[];GC=None;SIG=[]
try:
    raw_el=json.load(open(INP+'osm/downtown-raw.json'))['elements']
    ndr={e['id']:e for e in raw_el if e['type']=='node'}
    wyr={e['id']:e for e in raw_el if e['type']=='way'}
    lots=[];aisles=[]
    for e in raw_el:
        t=e.get('tags',{})
        if e['type']=='node':
            hw=t.get('highway')
            if hw in ('traffic_signals','stop','give_way') or t.get('crossing')=='traffic_signals':
                x,y=g(e)
                if inreg(x,y,1): SIG.append([round(x,2),round(y,2),{'traffic_signals':'s','stop':'p','give_way':'y'}.get(hw,'s'),t.get('direction','')])
            continue
        if e['type']=='relation':
            # a surface lot drawn as an outline with islands cut out of it (a multipolygon): the outline is the lot
            if t.get('amenity')=='parking' and t.get('parking','surface') in ('surface','street_side','lane') and 'building' not in t:
                for m in e.get('members',[]):
                    w=wyr.get(m.get('ref')) if m.get('type')=='way' and m.get('role','outer') in ('outer','') else None
                    if not w or w['nodes'][0]!=w['nodes'][-1]: continue
                    q=[g(ndr[i]) for i in w['nodes'] if i in ndr]
                    if len(q)>=4 and any(inreg(x,y,2) for x,y in q): lots.append(q[:-1])
            continue
        if e['type']!='way': continue
        pts=[g(ndr[i]) for i in e.get('nodes',[]) if i in ndr]
        if len(pts)<2 or not any(inreg(x,y,2) for x,y in pts): continue
        closed=e['nodes'][0]==e['nodes'][-1] and len(pts)>=4
        hw=t.get('highway')
        if hw in ('footway','path','cycleway','steps') or (hw=='pedestrian' and not closed):
            FW.append({'p':flat(pts),'k':hw});continue
        if not closed: 
            if hw=='service' and t.get('service')=='parking_aisle': aisles.append(pts)
            continue
        kind=None
        if t.get('landuse') in ('grass','village_green','meadow','recreation_ground') or t.get('leisure') in ('garden','dog_park'): kind='grass'
        elif t.get('landuse')=='flowerbed': kind='bed'
        elif t.get('natural') in ('wood','scrub') or t.get('landuse')=='forest': kind='wood'
        elif (hw=='pedestrian' and t.get('area')=='yes') or t.get('place')=='square' or t.get('area:highway')=='pedestrian': kind='plaza'
        if kind: GA.append({'p':flat(pts[:-1]),'k':kind})
        if t.get('amenity')=='parking' and t.get('parking','surface') in ('surface','street_side','lane') and 'building' not in t:
            lots.append(pts[:-1])
        if hw=='service' and t.get('service')=='parking_aisle': aisles.append(pts)
    GA.sort(key=lambda a:a['k']!='plaza')
    if lots: PL=[flat(q) for q in lots]
    try:
        from shapely.geometry import Polygon,LineString,Point
        from shapely.ops import unary_union
        from shapely.strtree import STRtree
        gd=json.load(open(INP+'imagery/ground.json'))
        st=gd['stripes'];SF={}
        for j,row in enumerate(st['rows']):
            for i in range(0,len(row),2):
                if row[i]!='-': SF[(i//2,j)]=(int(row[i],36)*5+2.5,int(row[i+1]))
        def stripe_angle(band,phi):
            """painted-line direction relative to the aisle inside a band beside it (degrees, 90 = square to it), or None"""
            x0,y0,x1,y1=band.bounds;hist={};tot=0
            for i in range(int(x0*st['r']),int(x1*st['r'])+1):
                for j in range(int(y0*st['r']),int(y1*st['r'])+1):
                    v=SF.get((i,j))
                    if not v or not band.contains(Point((i+.5)/st['r'],(j+.5)/st['r'])): continue
                    rel=(v[0]-phi)%180
                    if rel<25 or rel>155: continue
                    b=int(rel//10);hist[b]=hist.get(b,0)+v[1];tot+=v[1]
            if tot<8: return None
            sc=lambda q:hist.get(q,0)+.6*hist.get(q-1,0)+.6*hist.get(q+1,0)
            b=max(hist,key=sc);rel=b*10+5
            # angled stalls only on clear evidence; square-on is the usual layout
            if abs(rel-90)>20 and (tot<20 or sc(b)<2.2*max(sc(8),sc(9))): return 90
            for snap in (45,60,90,120,135):
                if abs(rel-snap)<=12: return snap
            return 90
        Mi=1/M  # tiles per metre
        WD,DP,AH=2.6*Mi,5.4*Mi,3.1*Mi
        obst=[Polygon(list(zip(b['p'][0::2],b['p'][1::2]))).buffer(.4*Mi) for b in B]
        RDL=[]  # smaller streets: their lanes can be the aisle of a lot they run through (Commerce Place)
        for r in R:
            if r['ar'] or r['c']>5: continue
            ln=LineString(list(zip(r['p'][0::2],r['p'][1::2])))
            if r['c']<=2: obst.append(ln.buffer(([16,14,12,10,8][r['c']]/2+3.6)*Mi))
            elif r['c']<=4: obst.append(ln.buffer(([16,14,12,10,8][r['c']]/2+.3)*Mi));RDL.append((ln,([16,14,12,10,8][r['c']]/2+.4)*Mi))
        OB=unary_union([o for o in obst if o.is_valid])
        placed=[]
        def place_along(line,usable,lot_i,AH=AH):
            L=line.length
            if L<WD: return
            for side in (-1,1):
                runs=[];cur=None
                # aisle direction for this stretch (the aisle may bend: work segment by segment)
                cs=list(line.coords)
                for a_,b_ in zip(cs,cs[1:]):
                    seg=LineString([a_,b_]);sl=seg.length
                    if sl<WD*.8: continue
                    ax,ay=(b_[0]-a_[0])/sl,(b_[1]-a_[1])/sl;phi=math.degrees(math.atan2(ay,ax))%180
                    nx,ny=-ay*side,ax*side
                    band=Polygon([(a_[0]+nx*AH,a_[1]+ny*AH),(b_[0]+nx*AH,b_[1]+ny*AH),(b_[0]+nx*(AH+DP),b_[1]+ny*(AH+DP)),(a_[0]+nx*(AH+DP),a_[1]+ny*(AH+DP))])
                    if band.intersection(usable).area<WD*DP*.8: continue
                    rel=stripe_angle(band,phi) or 90
                    au=math.radians(phi+rel);ux,uy=math.cos(au),math.sin(au)
                    if ux*nx+uy*ny<0: ux,uy=-ux,-uy
                    sn=abs(ax*uy-ay*ux);sp=WD/max(sn,.5)
                    dperp=DP*sn  # how far the stall reaches out from the aisle
                    n=int(sl/sp);off=(sl-n*sp)/2
                    for k_ in range(n):
                        d=off+(k_+.5)*sp;ex,ey=a_[0]+ax*d+nx*AH,a_[1]+ay*d+ny*AH
                        poly_=Polygon([(ex-ax*sp/2,ey-ay*sp/2),(ex+ax*sp/2,ey+ay*sp/2),(ex+ax*sp/2+ux*DP,ey+ay*sp/2+uy*DP),(ex-ax*sp/2+ux*DP,ey-ay*sp/2+uy*DP)])
                        if poly_.intersection(usable).area<poly_.area*.88: cur=None;continue
                        left,top,right,bottom=poly_.bounds
                        if any(poly_.intersection(q).area>poly_.area*.12 for q,(x0,y0,x1,y1) in placed
                               if x0<right and x1>left and y0<bottom and y1>top): cur=None;continue
                        placed.append((poly_,(left,top,right,bottom)))
                        cx,cy=ex+ux*DP/2,ey+uy*DP/2;au_d=round(math.degrees(math.atan2(uy,ux)))
                        if cur and cur['au']==au_d and abs(cx-(cur['x']+cur['dx']*cur['n']))<1e-6+.02 and abs(cy-(cur['y']+cur['dy']*cur['n']))<.02: cur['n']+=1
                        else:
                            cur={'x':cx,'y':cy,'dx':ax*sp,'dy':ay*sp,'n':1,'au':au_d,'ad':round(phi),'sp':sp};runs.append(cur)
                for r_ in runs: SR.append([round(r_['x'],2),round(r_['y'],2),round(r_['dx'],3),round(r_['dy'],3),r_['n'],r_['au'],r_['ad'],round(r_['sp'],3),round(DP,3)])
        AL=[LineString(a) for a in aisles if len(a)>=2]
        for li,q in enumerate(lots):
            lot=Polygon(q).buffer(0)
            if lot.area<WD*DP*2: continue
            usable=lot.buffer(-.3*Mi).difference(OB)
            if usable.area<WD*DP*2: continue
            def parts(g_): return [m for m in (getattr(g_,'geoms',None) or [g_]) if m.geom_type=='LineString' and m.length>WD]
            mine=[(m,AH) for a in AL if a.intersects(lot) for m in parts(a.intersection(lot.buffer(AH+DP)))]
            mine+=[(m,h) for ln,h in RDL if ln.intersects(lot) for m in parts(ln.intersection(lot.buffer(h+DP)))]
            for a,h in mine: place_along(a,usable,li,h)
            # whatever the mapped aisles leave over gets rows along the lot's long side (or the aisles' direction), back
            # to back with an aisle between each pair; most lots downtown have no aisles mapped at all
            rest=usable.difference(unary_union([a.buffer(h) for a,h in mine]+[q for q,_ in placed if q.intersects(lot)])) if mine else usable
            if rest.area>WD*DP*4:
                if mine:  # follow the mapped aisles
                    sg=max(((p_,q_) for a,h in mine for p_,q_ in zip(list(a.coords),list(a.coords)[1:])),key=lambda e:math.dist(*e));phi=math.atan2(sg[1][1]-sg[0][1],sg[1][0]-sg[0][0])
                else:
                    # rows run square to the painted stall lines seen in the lot; failing that, along its longest side
                    x0_,y0_,x1_,y1_=lot.bounds;hist={}
                    for i in range(int(x0_*st['r']),int(x1_*st['r'])+1):
                        for j in range(int(y0_*st['r']),int(y1_*st['r'])+1):
                            v=SF.get((i,j))
                            if v and lot.contains(Point((i+.5)/st['r'],(j+.5)/st['r'])): b_=int(v[0]//10)%18;hist[b_]=hist.get(b_,0)+v[1]
                    if sum(hist.values())>=12:
                        b_=max(hist,key=lambda q:hist[q]+.6*hist.get((q-1)%18,0)+.6*hist.get((q+1)%18,0));phi=math.radians(b_*10+5+90)
                    else:
                        cs=list(lot.exterior.coords);e_=max(zip(cs,cs[1:]),key=lambda e:math.dist(*e));phi=math.atan2(e_[1][1]-e_[0][1],e_[1][0]-e_[0][0])
                ax,ay=math.cos(phi),math.sin(phi);nx,ny=-ay,ax;pr=[(q[0]*nx+q[1]*ny,q[0]*ax+q[1]*ay) for q in lot.exterior.coords]
                t0=min(v[0] for v in pr);s0=min(v[1] for v in pr);L1=max(v[1] for v in pr)-s0;L2=max(v[0] for v in pr)-t0
                o0=(nx*t0+ax*s0,ny*t0+ay*s0)
                if L2>=DP*.9:
                    t=-AH
                    while t<L2+AH:
                        sx,sy=o0[0]+nx*t-ax*2,o0[1]+ny*t-ay*2
                        place_along(LineString([(sx,sy),(sx+ax*(L1+4),sy+ay*(L1+4))]),rest,li);t+=2*DP+2*AH
    except (FileNotFoundError,ImportError) as ex: print('no stalls:',ex)
    try:
        gd=gd if 'gd' in dir() else json.load(open(INP+'imagery/ground.json'))
        GC=gd['gc']
        # Tidy the aerial's ground classes: a 1.5 m cell on its own (a car, a shadow, one bare branch) is noise, so each
        # cell takes the commonest class around it and specks of green in paving (or paving in green) under 25 m2 go.
        # The ground along and between railroad tracks is ballast (class 7), whatever the weeds looked like in February.
        try:
            import numpy as np
            from scipy import ndimage as ndi
            gw,gh,gr=GC['w'],GC['h'],GC['r'];ga=np.zeros((gh,gw),np.uint8)
            for j,row in enumerate(GC['rows']):
                i=0
                for t in row.split(','):
                    n=int(t[1:],36);ga[j,i:i+n]=int(t[0],36);i+=n
            def mode(a,size):
                best=np.zeros(a.shape,np.float32);out=a.copy()
                for c in np.unique(a):
                    f=ndi.uniform_filter((a==c).astype(np.float32),size)
                    out[f>best]=c;best=np.maximum(best,f)
                return out
            ga=mode(ga,3);wide=mode(ga,9);veg=(ga==2)|(ga==3)
            for msk in (veg,~veg):
                lab,n=ndi.label(msk);small=np.isin(lab,1+np.nonzero(ndi.sum(msk,lab,range(1,n+1))<11)[0])
                ga[small]=wide[small]
            from PIL import Image,ImageDraw
            rm=Image.new('L',(gw,gh),0);dr=ImageDraw.Draw(rm)
            for r in RL: dr.line([(r['p'][i]*gr,r['p'][i+1]*gr) for i in range(0,len(r['p']),2)],fill=1,width=1)
            near=ndi.distance_transform_edt(np.asarray(rm)==0)*M/gr          # metres to the nearest track
            yard=ndi.binary_erosion(near<10,iterations=3)|(near<4.2)          # between tracks up to 20 m apart, and the bed itself
            bm=Image.new('L',(gw,gh),0);dr=ImageDraw.Draw(bm)
            for b_ in B: dr.polygon([(b_['p'][i]*gr,b_['p'][i+1]*gr) for i in range(0,len(b_['p']),2)],fill=1)
            ga[yard&(np.asarray(bm)==0)]=7
            rows=[]
            for j in range(gh):
                row=ga[j];cut=np.flatnonzero(np.diff(row))+1;st_=np.concatenate(([0],cut));en=np.concatenate((cut,[gw]))
                rows.append(','.join(np.base_repr(int(row[a_]),36).lower()+np.base_repr(int(b__-a_),36).lower() for a_,b__ in zip(st_,en)))
            GC={'r':gr,'w':gw,'h':gh,'rows':rows}
        except ImportError as ex: print('ground classes left as read:',ex)
    except (FileNotFoundError,NameError): pass
except FileNotFoundError: pass
# ---- bridges and railroad crossings (OpenStreetMap bridge=yes ways and railway=level_crossing nodes) ----
# The model's ground is flat, so each bridge is a slab ("deck") the renderer stands on it:
#   road over rail or road: the span is a slab on piers, and the road climbs to it on ramps of fill (bridges.py)
#   rail over road: the tracks stay at ground level on a low girder plate and the road passes under it (DK 'dip'
#     pieces are the road's last metres each side, shaded as the dip into the underpass)
#   covered footbridges between buildings: a glazed box above the street
# DK: {k:'road'|'rail'|'foot', p: outline, z0,z1: underside and top in metres, rl: the tracks on a rail deck,
#      dip: [[line, road class], ...]; a road deck's other fields are listed in bridges.py}
# LX: level crossings [ax,ay,bx,by,road class,gates]: where a street crosses the tracks at grade, from the first rail to the last
DK=[];LX=[]
try:
    from shapely.geometry import Polygon,LineString,Point,MultiLineString
    from shapely.ops import unary_union,substring,linemerge
    RWm=[16,14,12,10,8,4.5,5];Mi=1/M;SPAN_TOP,SPAN_UNDER,STEP,RAMP=7.0,5.8,.7,110.0
    def ring(g_):
        if g_.geom_type!='Polygon': g_=max(g_.geoms,key=lambda q:q.area)
        return flat(list(g_.exterior.coords)[:-1])
    def lines(g_): return [m for m in (getattr(g_,'geoms',None) or [g_]) if m.geom_type=='LineString' and m.length>0]
    rails=[LineString(list(zip(r['p'][0::2],r['p'][1::2]))) for r in RL]
    roadl=[(LineString(list(zip(r['p'][0::2],r['p'][1::2]))),r) for r in R if not r['ar']]
    board=Polygon([(0,0),(GX,0),(GX,GY),(0,GY)])
    # road bridges: spans, the fill between two close bridges, and evenly sloping ramps (see bridges.py)
    from bridges import road_decks
    DK+=road_decks(R,RL,X,GX,GY,M)
    # rail bridges: neighbouring tracks share one deck
    rb=[];
    for e in raw_el:
        t=e.get('tags',{})
        if e['type']=='way' and t.get('railway')=='rail' and t.get('bridge') in ('yes','viaduct'):
            pts=[g(ndr[i]) for i in e['nodes'] if i in ndr]
            if len(pts)>=2 and all(inreg(x,y,-.5) for x,y in pts): rb.append(LineString(pts))
    groups=[]
    for q in rb:
        hit=[g_ for g_ in groups if any(q.distance(o)<14*Mi for o in g_)]
        for g_ in hit: groups.remove(g_)
        groups.append(sum(hit,[])+[q])
    for g_ in groups:
        deck=unary_union([q.buffer(2.7*Mi,cap_style='flat') for q in g_]).convex_hull
        dips=[]
        for q,o in roadl:
            if o['c']>5 or not q.intersects(deck): continue
            for far in (16,8):
                for piece in lines(q.intersection(deck.buffer(far*Mi)).difference(deck)): dips.append([flat(list(piece.coords)),o['c']])
        DK.append({'k':'rail','p':ring(deck),'z0':0,'z1':2.2,'rl':[flat(list(q.coords)) for q in g_],'dip':dips})
    # covered footbridges between buildings
    for e in raw_el:
        t=e.get('tags',{})
        if e['type']=='way' and t.get('highway')=='footway' and t.get('bridge')=='yes' and t.get('footway')!='sidewalk':
            pts=[g(ndr[i]) for i in e['nodes'] if i in ndr]
            if len(pts)<2 or not all(inreg(x,y,-.5) for x,y in pts): continue
            q=LineString(pts)
            if q.length*M<8: continue
            DK.append({'k':'foot','p':ring(q.buffer(1.7*Mi,cap_style='flat')),'z0':5.5,'z1':8.6,'cv':1 if t.get('covered')=='yes' else 0})
    # level crossings
    lxn=[e for e in raw_el if e['type']=='node' and e.get('tags',{}).get('railway')=='level_crossing']
    for q,o in roadl:
        if o['c']>5 or o.get('br'): continue
        on=sorted((q.project(Point(g(e))),e) for e in lxn if q.distance(Point(g(e)))<.01)
        while on:
            grp=[on.pop(0)]
            while on and on[0][0]-grp[-1][0]<30*Mi: grp.append(on.pop(0))
            a_,b_=q.interpolate(grp[0][0]),q.interpolate(grp[-1][0])
            if not (inreg(a_.x,a_.y,-1.2) and inreg(b_.x,b_.y,-1.2)): continue
            if a_.distance(b_)<1e-6:
                p0,p1=q.interpolate(max(0,grp[0][0]-.1)),q.interpolate(min(q.length,grp[0][0]+.1));dx,dy=p1.x-p0.x,p1.y-p0.y;L_=math.hypot(dx,dy) or 1
                a_,b_=Point(a_.x-dx/L_*.01,a_.y-dy/L_*.01),Point(a_.x+dx/L_*.01,a_.y+dy/L_*.01)
            gates=1 if any(e['tags'].get('crossing:barrier') in ('full','half','double_half','yes') for _,e in grp) else 0
            # the same crossing mapped on a second way of the street (split at a rail): keep one
            near=next((l for l in LX if l[4]==o['c'] and min(math.hypot(l[i]-p_.x,l[i+1]-p_.y) for i in (0,2) for p_ in (a_,b_))<30*Mi),None)
            if near:
                ends=[(near[0],near[1]),(near[2],near[3]),(a_.x,a_.y),(b_.x,b_.y)];far=max(((u,v) for u in ends for v in ends),key=lambda e_:math.dist(*e_))
                near[0:4]=[round(far[0][0],2),round(far[0][1],2),round(far[1][0],2),round(far[1][1],2)];near[5]=max(near[5],gates);continue
            LX.append([round(a_.x,2),round(a_.y,2),round(b_.x,2),round(b_.y,2),o['c'],gates])
except (ImportError,NameError) as ex: print('no bridges or crossings:',ex)
for r in R: r.pop('ln',None)
print('decks',[(d_['k'],d_['z1']) for d_ in DK if d_.get('sp') or d_['k']!='road'],'ramp pieces',sum(1 for d_ in DK if d_['k']=='road' and not d_.get('sp')),'crossings',LX)
print('footpaths',len(FW),'areas',len(GA),'lots',len(PL),'stall rows',len(SR),'stalls',sum(r[4] for r in SR),'signals/stops',len(SIG))

# names: the building's own, who is inside it, and its street address (tools/model/names.py)
try:
    sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
    import names
    try: NOV=json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','data','model','names.json'))).get('buildings',{})
    except FileNotFoundError: NOV={}
    RAWN=json.load(open(INP+'osm/downtown-raw.json'))['elements']
    names.name_buildings(B,RAWN,g,NOV)
    # a street address, from the State's address points and parcels, for whatever OpenStreetMap left with nothing
    REPO=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..')
    AD=next((f for f in (INP+'addresses.json',os.path.join(REPO,'data','model','addresses.json')) if os.path.exists(f)),None)
    if AD:
        quiet=None
        try:
            # the keepsake house stays unlabelled, and so do its nearest neighbours, whose numbers would give its own away
            HL=json.load(open(os.path.join(REPO,'public','model','house.json')));hx,hy=HL['at'];hb=HL['base'];QM=12.0
            quiet=(hx+(hb[0]-QM)/M,hy+(hb[1]-QM)/M,hx+(hb[2]+QM)/M,hy+(hb[3]+QM)/M)
        except (FileNotFoundError,KeyError): pass
        print('addresses from the State for',names.state_addresses(B,json.load(open(AD)),g,RAWN,quiet),'buildings')
    print('names',names.coverage(B))
except FileNotFoundError: pass

# Outlines the lidar found are checked against what is mapped around them (gboro issue #41):
#   - one lying mostly on a mapped footbridge or bridge deck is that bridge seen from above, and goes;
#   - where one overlaps a building OpenStreetMap has, the overlap belongs to the mapped building and the rest stays
#     as the part of it the map lacks (or goes, if only a sliver is left).
# (One that reaches over a street is left alone: cutting it along the street left notched outlines the renderer could
# no longer square up, and the squaring already pulls the ragged edge back.)
try:
    from shapely.geometry import Polygon as _Pg2
    from shapely.ops import unary_union as _uu2
    from shapely.strtree import STRtree as _Tree2
    def _poly(p): return _Pg2(list(zip(p[0::2],p[1::2]))).buffer(0)
    _dk=[_poly(d_['p']) for d_ in DK]
    _osm=[_poly(b['p']) for b in B if not b.get('lidar_new')];_ot=_Tree2(_osm)
    _keep=[];_n=[0,0]
    for b in B:
        if not b.get('lidar_new'): _keep.append(b);continue
        g_=_poly(b['p']);a0=g_.area
        if a0<=0: continue
        if sum(g_.intersection(q).area for q in _dk)>.5*a0: _n[0]+=1;continue
        hit=[_osm[i] for i in _ot.query(g_) if _osm[i].intersects(g_)]
        if hit and g_.intersection(_uu2(hit)).area>.03*a0:
            g_=g_.difference(_uu2(hit).buffer(.3/M)).buffer(-1/M).buffer(1/M);_n[1]+=1
        if g_.geom_type=='MultiPolygon': g_=max(g_.geoms,key=lambda q:q.area)
        if g_.is_empty or g_.geom_type!='Polygon' or g_.area*M*M<40 or g_.area<.3*a0: _n[0]+=1;continue
        if g_.area<a0-1e-6: b['p']=flat([(round(x,2),round(y,2)) for x,y in list(g_.simplify(.3/M).exterior.coords)[:-1]])
        _keep.append(b)
    B=_keep;print('lidar outlines against the map: dropped',_n[0],'cut round a mapped building',_n[1])
except ImportError: pass

GEO={'north':N,'south':S,'west':Wl,'east':El,'mPerDegLon':round(k,3),'mPerDegLat':110574}
if GC: VG=None   # the aerial's ground classes (GC) took over from the planted-ground mask; the live model ships without it
out={'GEO':GEO,'X':X,'GX':round(GX,2),'GY':round(GY,2),'M':M,'B':B,'R':R,'RL':RL,'PK':PK,'PL':PL,'TR':traffic,'TRAIN':train,'PT':PT,'VG':VG,'FW':FW,'GA':GA,'SR':SR,'GC':GC,'SIG':SIG,'DK':DK,'LX':LX}
s=json.dumps(out,separators=(',',':'))
open(OUT,'w').write(s)
print(len(B),len(R),len(RL),len(PK),len(PL),len(traffic),'train pts',len(train)//2,'trainlen',round(plen(rc[0]),1) if rc else 0,'bytes',len(s),'GX',GX,'GY',GY)

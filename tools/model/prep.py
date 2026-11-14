"""Build public/model/downtown.json (the downtown scale model) from an OpenStreetMap extract plus
the optional survey layers (lidar tiers and heights, roof colours, aerial vegetation, street-photo facades).

Usage: python3 tools/model/prep.py <osm-extract.json> [inputs-dir] [out.json]
inputs-dir holds osm/shapes.json, osm/downtown-raw.json (also read for building names, tenants and addresses), osm/roofs.json, osm/facades.json,
osm/heights.json, imagery/ortho-downtown.png and imagery/ground.json (tools/model/ground.py: ground classes and
painted parking lines read from the 2024 aerial; a copy lives in data/model/imagery/); any that are missing are skipped.
Laying out parking stalls needs shapely (pip install shapely); without it the lots are drawn with no stalls.
"""
import json,math,sys,os
src=sys.argv[1]
INP=(sys.argv[2] if len(sys.argv)>2 else '/mnt/project-files/village').rstrip('/')+'/'
OUT=sys.argv[3] if len(sys.argv)>3 else os.path.join(os.path.dirname(__file__),'..','..','public','model','downtown.json')
d=json.load(open(src))
N,S,Wl,El=36.0768,36.0676,-79.7954,-79.7856
M=9.0
lat0=N;lon0=Wl;k=math.cos(math.radians((N+S)/2))*111320
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
rc=sorted(chains(main),key=plen,reverse=True)
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
# lidar-derived shapes: stepped tiers inside footprints, and verified buildings OSM lacks
try:
    SHP=json.load(open(INP+'osm/shapes.json'))
    for b in B:
        t=SHP['tiers'].get(str(b['id']))
        if t: b['tb']=t['base'];b['tr']=t['tiers']
    for n,nb in enumerate(SHP['new']):
        B.append({'p':nb['p'],'l':None,'h':None,'lh':nb['h'],'t':'yes','n':'','id':9100000000+n,'a':'','mat':'','rs':'','lidar_new':1})
except FileNotFoundError: pass
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

# real roof colours (NC OneMap aerial, 2024) and a ground vegetation mask from the same aerial
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
except FileNotFoundError: pass

# facade readings from Mapillary street photos (2018/2021)
try:
    FC=json.load(open(INP+'osm/facades.json'))
    for b in B:
        f=FC.get(str(b['id']))
        if f: b['f']={k:f.get(k) for k in ('wall_hex','trim_hex','material','floors','storefront','awning_hex','window_style','confidence')}
except FileNotFoundError: pass

# measured heights from NC Phase III lidar (flown 2015-02-03)
try:
    HT=json.load(open(INP+'osm/heights.json'))['buildings']
    for b in B:
        r=HT.get(str(b['id']))
        if r and r.get('h'): b['lh']=round(r['h'],1)
except FileNotFoundError: pass

# ---- the ground between the buildings: OSM footpaths, lawns, beds, woods and plazas; surface lots with their stalls
# laid out along the mapped parking aisles at the stall angle painted on the 2024 aerial (imagery/ground.json from
# tools/model/ground.py); and the aerial's ground classes for everything else.
FW=[];GA=[];SR=[];GC=None;SIG=[]
try:
    raw_el=json.load(open(INP+'osm/downtown-raw.json'))['elements']
    ndr={e['id']:e for e in raw_el if e['type']=='node'}
    lots=[];aisles=[]
    for e in raw_el:
        t=e.get('tags',{})
        if e['type']=='node':
            hw=t.get('highway')
            if hw in ('traffic_signals','stop','give_way') or t.get('crossing')=='traffic_signals':
                x,y=g(e)
                if inreg(x,y,1): SIG.append([round(x,2),round(y,2),{'traffic_signals':'s','stop':'p','give_way':'y'}.get(hw,'s'),t.get('direction','')])
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
        placed=[];tree_ix=[]
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
                        if any(poly_.intersection(q).area>poly_.area*.12 for q in placed if q.bounds[0]<poly_.bounds[2] and q.bounds[2]>poly_.bounds[0] and q.bounds[1]<poly_.bounds[3] and q.bounds[3]>poly_.bounds[1]): cur=None;continue
                        placed.append(poly_)
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
            rest=usable.difference(unary_union([a.buffer(h) for a,h in mine]+[q for q in placed if q.intersects(lot)])) if mine else usable
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
    except (FileNotFoundError,NameError): pass
except FileNotFoundError: pass
print('footpaths',len(FW),'areas',len(GA),'lots',len(PL),'stall rows',len(SR),'stalls',sum(r[4] for r in SR),'signals/stops',len(SIG))

# names: the building's own, who is inside it, and its street address (tools/model/names.py)
try:
    sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
    import names
    try: NOV=json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','data','model','names.json'))).get('buildings',{})
    except FileNotFoundError: NOV={}
    names.name_buildings(B,json.load(open(INP+'osm/downtown-raw.json'))['elements'],g,NOV)
    print('names',names.coverage(B))
except FileNotFoundError: pass

GEO={'north':N,'south':S,'west':Wl,'east':El,'mPerDegLon':round(k,3),'mPerDegLat':110574}
out={'GEO':GEO,'X':X,'GX':round(GX,2),'GY':round(GY,2),'M':M,'B':B,'R':R,'RL':RL,'PK':PK,'PL':PL,'TR':traffic,'TRAIN':train,'PT':PT,'VG':VG,'FW':FW,'GA':GA,'SR':SR,'GC':GC,'SIG':SIG}
s=json.dumps(out,separators=(',',':'))
open(OUT,'w').write(s)
print(len(B),len(R),len(RL),len(PK),len(PL),len(traffic),'train pts',len(train)//2,'trainlen',round(plen(rc[0]),1) if rc else 0,'bytes',len(s),'GX',GX,'GY',GY)

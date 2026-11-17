"""Names for the model's buildings, from OpenStreetMap only (so a rebuild picks up new ones by itself).

For each building, in order of how much it says about the building:
  n   its own name: the OSM name, else addr:housename ("Guilford Building"), else a correction from
      data/model/names.json (for typos and gaps upstream)
  tn  who is inside: named shops, restaurants, offices... mapped as points within the footprint, best known first
  ad  its street address, short ("304 S Elm St"), from the building or from a point inside it
The renderer labels a building with the first of these it has. Closed places (disused:, was:) are left out.
"""
import math, re

# a point counts as a tenant when it has one of these keys; lower rank is listed (and labelled) first
RANK={'tourism':0,'amenity':1,'leisure':2,'shop':3,'craft':3,'healthcare':4,'club':4,'office':5}
AMENITY_FIRST={'theatre','arts_centre','cinema','library','museum','townhall','courthouse','place_of_worship','university','college','events_venue','music_venue'}
AMENITY_FOOD={'restaurant','bar','pub','cafe','nightclub','biergarten','fast_food','ice_cream','food_court'}
NOT_TENANT={'parking','parking_entrance','parking_space','bicycle_parking','bench','atm','vending_machine','toilets','waste_basket','post_box',
            'drinking_water','fountain','charging_station','bicycle_rental','telephone','clock','recycling','shelter','taxi','information',
            'artwork','attraction','viewpoint','picnic_table','playground','pitch','garden','yes'}
ABBR={'North':'N','South':'S','East':'E','West':'W','Street':'St','Avenue':'Ave','Boulevard':'Blvd','Road':'Rd','Drive':'Dr',
      'Place':'Pl','Court':'Ct','Lane':'Ln','Parkway':'Pkwy','Square':'Sq','Circle':'Cir','Highway':'Hwy'}

def pip(x,y,p):
    c=False
    for i in range(len(p)):
        x1,y1=p[i];x2,y2=p[i-1]
        if (y1>y)!=(y2>y) and x<(x2-x1)*(y-y1)/(y2-y1)+x1: c=not c
    return c

def short_address(num,street):
    """('346, 348','South Elm Street') -> '346-348 S Elm St'; '' when either half is missing."""
    if not num or not street: return ''
    parts=[p.strip() for p in re.split(r'[,;]',str(num)) if p.strip()]
    if not parts: return ''
    if len(parts)>1:
        a=parts[0].split('-')[0];b=parts[-1].split('-')[-1]
        num=a if a==b else a+'-'+b
    else: num=parts[0]
    w=street.split()
    w=[ABBR.get(x,x) if (i==0 and len(w)>1 and x in('North','South','East','West')) or (i==len(w)-1 and i>0) else x for i,x in enumerate(w)]
    return num+' '+' '.join(w)

def tenant_rank(t):
    """Sort key for a tagged point, or None if it is not a tenant worth naming."""
    name=(t.get('name') or '').strip()
    if not name: return None
    best=None
    for k,r in RANK.items():
        v=t.get(k)
        if not v or v in NOT_TENANT or v=='no': continue
        if k=='amenity': r=0 if v in AMENITY_FIRST else 1 if v in AMENITY_FOOD else 4
        if k=='tourism': r=0 if v in('hotel','museum','gallery','motel','hostel') else 4
        if best is None or r<best: best=r
    return best

def num_key(ad):
    m=re.match(r'\d+',ad);return (int(m.group()) if m else 10**9,ad)

def dist_poly(x,y,poly):
    """Distance from a point to a polygon's edge, in the polygon's units."""
    best=1e9
    for i in range(len(poly)):
        x1,y1=poly[i];x2,y2=poly[i-1];dx,dy=x2-x1,y2-y1;L=dx*dx+dy*dy
        t=0 if L==0 else max(0,min(1,((x-x1)*dx+(y-y1)*dy)/L))
        best=min(best,math.hypot(x-x1-t*dx,y-y1-t*dy))
    return best

def name_buildings(B,raw,g,overrides=None,addr_pts=None,roads=None,M=9.0,private=None):
    """Fill n / tn / ad (and st) on each building dict in B. raw: OSM API elements; g: {'lat','lon'} -> model grid;
    addr_pts: [[lon,lat,'413 McAdoo Ave'],...] from data/model/addresses.json; roads: the model's R list; M: metres per grid unit;
    private: (x0,y0,x1,y1) in grid units, the keepsake house's lot: nothing on it is given an address or a street."""
    overrides=overrides or {}
    ways={e['id']:e.get('tags',{}) for e in raw if e['type']=='way'}
    pts=[]
    for e in raw:
        if e['type']!='node' or not e.get('tags'): continue
        t=e['tags'];r=tenant_rank(t)
        addr=short_address(t.get('addr:housenumber'),t.get('addr:street'))
        if r is None and not addr: continue
        x,y=g(e)
        pts.append((x,y,r,t.get('name','').strip() if r is not None else '',addr))
    for b in B:
        poly=list(zip(b['p'][0::2],b['p'][1::2]))
        xs=[p[0] for p in poly];ys=[p[1] for p in poly]
        x0,x1,y0,y1=min(xs),max(xs),min(ys),max(ys)
        t=ways.get(b['id'],{})
        o=overrides.get(str(b['id']),{})
        own=o.get('name') or b.get('n') or t.get('addr:housename','')
        inside=[p for p in pts if x0<=p[0]<=x1 and y0<=p[1]<=y1 and pip(p[0],p[1],poly)]
        ten=[];seen={own.lower()}
        for p in sorted((p for p in inside if p[2] is not None),key=lambda p:(p[2],p[3].lower())):
            if p[3].lower() in seen: continue
            seen.add(p[3].lower());ten.append(p[3])
        ad=short_address(t.get('addr:housenumber'),t.get('addr:street'))
        if not ad:
            # every point inside agrees on the street: take the lowest number as the building's address
            inn=sorted(set(p[4] for p in inside if p[4]))
            if inn and len(set(a.split(' ',1)[1] for a in inn))==1: ad=inn[0]
        b['n']=own
        if ten: b['tn']=ten[:8]
        if ad: b['ad']=ad
        b['_poly']=poly;b['_box']=(x0,x1,y0,y1)
    # what OpenStreetMap left without an address takes one from the State's address points: the lowest number on the
    # commonest street among the points inside it, else the nearest point within 20 m (one that is not inside another
    # building, if there is one)
    def hidden(b):
        if not private: return False
        x0,x1,y0,y1=b['_box'];cx,cy=(x0+x1)/2,(y0+y1)/2
        return min(private[0],private[2])-.3<cx<max(private[0],private[2])+.3 and min(private[1],private[3])-.3<cy<max(private[1],private[3])+.3
    if addr_pts:
        ap=[g({'lon':a[0],'lat':a[1]})+(a[2],) for a in addr_pts]
        cell={}
        for i,b in enumerate(B):
            x0,x1,y0,y1=b['_box']
            for cx in range(int(x0//4),int(x1//4)+1):
                for cy in range(int(y0//4),int(y1//4)+1): cell.setdefault((cx,cy),[]).append(i)
        owner=[]
        for x,y,_ in ap:
            o=None
            for i in cell.get((int(x//4),int(y//4)),()):
                x0,x1,y0,y1=B[i]['_box']
                if x0<=x<=x1 and y0<=y<=y1 and pip(x,y,B[i]['_poly']): o=i;break
            owner.append(o)
        inside={}
        for k,o in enumerate(owner):
            if o is not None: inside.setdefault(o,[]).append(ap[k][2])
        free=[ap[k] for k,o in enumerate(owner) if o is None];R_=20/M
        for i,b in enumerate(B):
            if b.get('ad') or hidden(b): continue
            inn=inside.get(i)
            if inn:
                by={}
                for a in inn: by.setdefault(a.split(' ',1)[1],[]).append(a)
                b['ad']=min(max(by.values(),key=lambda v:(len(v),-num_key(min(v,key=num_key))[0])),key=num_key);continue
            x0,x1,y0,y1=b['_box']
            for pool in (free,ap):      # (a garage or shed behind a house has no point of its own: it takes the house's)
                best=None
                for x,y,a in pool:
                    if x<x0-R_ or x>x1+R_ or y<y0-R_ or y>y1+R_: continue
                    d=dist_poly(x,y,b['_poly'])
                    if d<R_ and (best is None or d<best[0]): best=(d,a)
                if best: b['ad']=best[1];break
    # and what still has neither a name nor an address is at least placed on its street ("Building on W Friendly Ave")
    if roads:
        named=[(r['n'],list(zip(r['p'][0::2],r['p'][1::2]))) for r in roads if r.get('n')]
        for b in B:
            if b.get('ad') or b.get('n') or hidden(b): continue
            x0,x1,y0,y1=b['_box'];cx,cy=(x0+x1)/2,(y0+y1)/2;best=None
            for n,q in named:
                for j in range(len(q)-1):
                    (xa,ya),(xb,yb)=q[j],q[j+1]
                    if min(xa,xb)-12>cx or max(xa,xb)+12<cx or min(ya,yb)-12>cy or max(ya,yb)+12<cy: continue
                    d=dist_poly(cx,cy,[q[j],q[j+1]])
                    if best is None or d<best[0]: best=(d,n)
            if best:
                w=best[1].split();b['st']=' '.join(ABBR.get(x,x) if (k==0 and len(w)>1 and x in('North','South','East','West')) or (k==len(w)-1 and k>0) else x for k,x in enumerate(w))
    for b in B: b.pop('_poly',None);b.pop('_box',None)
    return B

def coverage(B):
    c={'name':0,'tenant':0,'address':0,'none':0}
    for b in B: c['name' if b.get('n') else 'tenant' if b.get('tn') else 'address' if b.get('ad') else 'none']+=1
    return c

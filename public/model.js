// The downtown scale model ("Brick and Clay", designed by June Holloway's brief in the design thread).
// Plain canvas, no build step. Ported from the design mockup; the mockup's example toggles are replaced
// by a live scene from app.js (weather, council, closures, events, open bars and restaurants).
//
//   const model = startModel({ canvas, map, onPick, onHover });
//   model.update(scene)   // see app.js buildScene() for the shape
//
// map is public/model/downtown.json (tools/model/prep.py). Drop in a newer one and nothing here changes.
export function startModel({ canvas: cv0, map: MAP, onPick = () => {}, onHover = () => {} }) {
MAP = JSON.parse(JSON.stringify(MAP)); // the tower fix-up below edits it
const PAL=[
 ['Pine night','#1d2a2b','letterbox, deep shade'],['Loblolly','#2b7448','pine trees'],['Pine','#3d9a4f','leafy trees'],['Bermuda','#5cb648','lawn'],['Fescue','#8ad05a','lawn light'],
 ['Red clay','#cf5a36','bare ground, rail bed'],['Clay light','#f0965a','paths'],['Old brick','#b23f2c','mills, depot'],['Brick','#e05a3c','storefronts'],['Mortar','#f5dba6','sidewalks, trim'],
 ['Limestone','#f2e6cb','tower, civic'],['Concrete','#cfc6b3','municipal'],['Slate','#4a68b0','roofs'],['Tin','#9cc6da','metal roofs, rails'],['Asphalt','#57566a','roads'],
 ['Wet asphalt','#434862','rain roads'],['Line gold','#ffd23f','road paint'],['Tobacco','#f7a823','accent, flags'],['Paper','#fff3d6','the paper'],['Plum ink','#2c2147','shadows, text'],
 ['Haw River','#37a6dc','water, glass'],['Aggie blue','#2452c4','flags'],['Window glow','#ffd75e','lit windows'],['Barrel orange','#ff7426','closures']
];
const C=Object.fromEntries(PAL.map(([n,h])=>[n,h]));
const SH=C['Plum ink'],HI='#fff6e4',GLOW=C['Window glow'],BULB='#fff1c2';
const rad=Math.PI/180;

// ---------- time and sun (Greensboro, America/New_York) ----------
const LAT=36.0726,LON=-79.792;
function sunPos(d){const n=d.getTime()/86400000+2440587.5-2451545.0;const L=(280.46+0.9856474*n)%360,g=((357.528+0.9856003*n)%360)*rad;const lam=(L+1.915*Math.sin(g)+0.02*Math.sin(2*g))*rad,eps=(23.439-4e-7*n)*rad;
  const ra=Math.atan2(Math.cos(eps)*Math.sin(lam),Math.cos(lam)),dec=Math.asin(Math.sin(eps)*Math.sin(lam));const gmst=((18.697374558+24.06570982441908*n)%24+24)%24;const ha=(gmst*15+LON)*rad-ra;const la=LAT*rad;
  const alt=Math.asin(Math.sin(la)*Math.sin(dec)+Math.cos(la)*Math.cos(dec)*Math.cos(ha));const A=Math.atan2(Math.sin(ha),Math.cos(ha)*Math.sin(la)-Math.tan(dec)*Math.cos(la));return{alt:alt/rad,az:((A/rad+180)%360+360)%360}}
const nyParts=d=>Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric',hourCycle:'h23',weekday:'short'}).formatToParts(d).map(p=>[p.type,p.value]));
function nyDate(h,m){const now=new Date(),p=nyParts(now);const guess=Date.UTC(+p.year,+p.month-1,+p.day,h,m);const q=nyParts(new Date(guess));const off=(Date.UTC(+q.year,+q.month-1,+q.day,+q.hour,+q.minute)-guess);return new Date(guess-off)}
const fmtTime=d=>{const p=nyParts(d);let h=+p.hour%12;if(!h)h=12;return h+':'+p.minute.padStart(2,'0')};
const ampm=d=>+nyParts(d).hour<12?'AM':'PM';
function sunTimes(){const base=nyDate(0,0).getTime();let rise=null,set=null,prev=sunPos(new Date(base)).alt;for(let m=2;m<1440;m+=2){const a=sunPos(new Date(base+m*60000)).alt;if(prev<-0.833&&a>=-0.833)rise=new Date(base+m*60000);if(prev>=-0.833&&a<-0.833)set=new Date(base+m*60000);prev=a}return{rise,set}}
const PREVIEW={dawn:[6,52],day:[12,30],dusk:[17,20],night:[22,45]};
const sceneDate=()=>S.time==='now'?new Date():nyDate(...PREVIEW[S.time]);

// ---------- geometry ----------
const W=800,H=450,TW=16,TH=8,ZPM=2.0,M=MAP.M,GX=MAP.GX,GY=MAP.GY,MARG=60,MAXH=270;
const BW=Math.ceil((GX+GY)*TW+2*MARG),BH=Math.ceil((GX+GY)*TH+MAXH+2*MARG+20);
const BOX=GY*TW+MARG,BOY=MAXH+MARG;
let ox=BOX,oy=BOY;
const P=(gx,gy,z=0)=>[ox+(gx-gy)*TW,oy+(gx+gy)*TH-z];
const pairs=a=>{const r=[];for(let i=0;i<a.length;i+=2)r.push([a[i],a[i+1]]);return r};
const cache=new Map();const hex=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
function mix(a,b,t){const k=a+b+t;let v=cache.get(k);if(v)return v;const A=hex(a),B=hex(b);v='#'+A.map((x,i)=>Math.round(x+(B[i]-x)*t).toString(16).padStart(2,'0')).join('');cache.set(k,v);return v}
const hash=(a,b)=>{const s=Math.sin(a*12.9898+b*78.233)*43758.5453;return s-Math.floor(s)};
function pip(x,y,pts){let ins=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){const[xi,yi]=pts[i],[xj,yj]=pts[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)ins=!ins}return ins}
function hull(p){p=p.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);const cr=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);const lo=[],up=[];for(const q of p){while(lo.length>=2&&cr(lo[lo.length-2],lo[lo.length-1],q)<=0)lo.pop();lo.push(q)}for(let i=p.length-1;i>=0;i--){const q=p[i];while(up.length>=2&&cr(up[up.length-2],up[up.length-1],q)<=0)up.pop();up.push(q)}up.pop();lo.pop();return lo.concat(up)}

// ---------- canvases ----------
const mk=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c};
const cv=cv0,ctx=cv.getContext('2d');
const SCc=mk(BW,BH),SEc=mk(BW,BH),SGc=mk(BW,BH);const SC=SCc.getContext('2d'),SE=SEc.getContext('2d'),SG=SGc.getContext('2d');
const Wc=mk(W,H),Ec=mk(W,H),Gc=mk(W,H),Tc=mk(W,H);const w=Wc.getContext('2d',{willReadFrequently:true}),E=Ec.getContext('2d'),GL=Gc.getContext('2d'),tc=Tc.getContext('2d');
let TGT={c:SC,e:SE,g:SG};
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const S={time:'now',wx:'clear',labels:false};
{const t=new URLSearchParams(location.search).get('time');if(PREVIEW[t])S.time=t}
// The live scene. app.js replaces it through update(); everything defaults to a quiet town.
let L={version:0,wx:'clear',storm:false,fog:false,cloudy:false,windMph:0,tempF:null,council:{lit:false,inSession:false},
  lit:new Map(),strings:new Set(),crowds:[],trucks:[],closures:[],bubbles:[],focus:[],signs:[]};
let signRects=[];
let SUN=sunPos(new Date());
const evening=()=>SUN.alt<4,night=()=>SUN.alt<-8,lampsOn=()=>SUN.alt<2;
function surf(col,top){if(S.wx==='snow'&&top)return mix(col,'#f5f7fb',.78);if(S.wx==='pollen'&&top)return mix(col,'#e8d860',.16);return col}

function erase(p){for(const e of [TGT.e,TGT.g]){e.globalCompositeOperation='destination-out';e.fillStyle='#000';e.fill(p);e.globalCompositeOperation='source-over'}}
function path(pts){const p=new Path2D();p.moveTo(pts[0][0],pts[0][1]);for(let i=1;i<pts.length;i++)p.lineTo(pts[i][0],pts[i][1]);p.closePath();return p}
function poly(c,pts,fill,stroke){const p=path(pts);c.fillStyle=fill;c.fill(p);if(stroke){c.strokeStyle=stroke;c.lineWidth=1;c.stroke(p)}if(c===TGT.c)erase(p)}
function line(c,a,b,col,lw=1){c.beginPath();c.moveTo(a[0],a[1]);c.lineTo(b[0],b[1]);c.strokeStyle=col;c.lineWidth=lw;c.stroke()}
function fr(c,x,y,ww,hh,col){c.fillStyle=col;c.fillRect(x,y,ww,hh);if(c===TGT.c){TGT.e.clearRect(x,y,ww,hh);TGT.g.clearRect(x,y,ww,hh)}}
function circ(c,x,y,r,col){const p=new Path2D();p.arc(x,y,r,0,7);c.fillStyle=col;c.fill(p);if(c===TGT.c)erase(p)}
const eq=(q,col)=>{TGT.e.fillStyle=col;TGT.e.fill(path(q))};
const ed=(p,col,s=1)=>{TGT.e.fillStyle=col;TGT.e.fillRect(Math.round(p[0]-s/2),Math.round(p[1]-s/2),s,s)};
function eg(x,y,r,al,sy=1,col='255,205,120'){const G=TGT.g;G.save();G.translate(x,y);G.scale(1,sy);const gr=G.createRadialGradient(0,0,0,0,0,r);gr.addColorStop(0,`rgba(${col},${al})`);gr.addColorStop(1,`rgba(${col},0)`);G.fillStyle=gr;G.fillRect(-r,-r,r*2,r*2);G.restore()}

// ---------- buildings ----------
const PART=Object.fromEntries((MAP.PT||[]).map(p=>[p.id,p]));
// The OSM outline 208115796 covers both towers. Use its real 3D parts instead:
// Lincoln Financial Tower (1990) and the Jefferson Standard Building (1923), joined by a low connector.
(()=>{const ob=MAP.B.find(b=>b.id===208115796);if(!ob||!PART[341049142]||!PART[467218959])return;
  ob.p=[44.85,46.66,46.42,46.72,45.97,50.57,44.6,50.42];ob.l=4;ob.h=16;ob.n='';ob.t='office';
  MAP.B.push({id:341049142,p:PART[341049142].p,l:20,h:79,t:'office',n:'Lincoln Financial Tower'});
  MAP.B.push({id:467218959,p:PART[467218959].p,l:18,h:65,t:'office',n:'Jefferson Standard Building'})})();
const SPECIAL={341049142:'tower',467218959:'jsb',208101229:'kress',208202822:'theatre',326037856:'city',264852482:'depot',1064222230:'tanger',208101224:'icrc',133178249:'ballpark'};
const brickW=['#a2503a','#8f4232','#b0604a','#7e4436','#b9714f','#c79a72','#d9c9a8','#e6e0d4','#9a5440'];
const pastW=[C.Mortar,C.Paper,'#ffd59a','#c9eeb0','#ffcdc2','#c8e4f5',C.Limestone];
const roofsF=['#e9e8e3','#dcdbd6','#c8c7c2','#b3b1ab','#8f8d88','#6e6c6a','#d8d2c4'];
const roofsH=['#55555c','#4a4440','#6b5a4e','#7a3e34','#5c6a72','#8a8a86'];
const awnC=['#23303d','#6e2626','#2c4636','#34343a','#7a5a34','#1f3f5f'];
const blds=MAP.B.map((b,i)=>{
  let pts=pairs(b.p);let A=0;for(let k=0;k<pts.length;k++){const[a,c]=pts[k],[d,e]=pts[(k+1)%pts.length];A+=a*e-d*c}A/=2;if(A<0)pts.reverse();
  const area=Math.abs(A)*M*M;const t=b.t||'yes';const r=hash(b.id%9973,7);
  const F=b.f||null,Fok=F&&F.confidence!=='low';
  let lv=b.l||(F&&F.floors&&!b.h?F.floors:0);if(!lv){lv=({house:2,detached:2,residential:2,apartments:3,office:3,commercial:2,retail:2,industrial:1,parking:4,garage:1,shed:1,garages:1,school:2,university:3,dormitory:4,government:3,hotel:4,church:2,train_station:2,roof:1,yes:2})[t]||2;if((t==='yes'||t==='retail')&&r>.6)lv++;if(area<45)lv=1}
  if(SPECIAL[b.id]==='kress'){delete b.tr;delete b.tb}
  const hm=(b.tb>2.5?b.tb:0)||(b.id!==208115796&&b.lh>2.5?b.lh:0)||b.h||lv*3.6;if(b.lh>2.5&&!b.l&&!(F&&F.floors))lv=Math.max(1,Math.round(b.lh/3.8));const hpx=Math.min(250,hm*ZPM);
  const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),sums=pts.map(p=>p[0]+p[1]);
  const o={i,id:b.id,pts,t,name:b.n,lv,hm,hpx,area,special:SPECIAL[b.id]||'',minx:Math.min(...xs),maxx:Math.max(...xs),miny:Math.min(...ys),maxy:Math.max(...ys),key:(Math.min(...sums)+Math.max(...sums))/2,cx:xs.reduce((a,c)=>a+c,0)/xs.length,cy:ys.reduce((a,c)=>a+c,0)/ys.length};
  const pick=(arr,s=3)=>arr[Math.floor(hash(b.id%7919,s)*arr.length)];
  if(o.special==='tower'){o.wall='#ece4d2';o.roof='#cfc6b3';o.win=3.2;o.cornice=1}
  else if(o.special==='kress'){o.wall='#f0e4c4';o.roof='#cdc6b8';o.win=2.6;o.cornice=1;o.shop=1;o.lv=4;o.piers=1}
  else if(o.special==='jsb'){o.wall='#e9e0cc';o.roof='#cdc6b8';o.win=2.9;o.cornice=1;o.arch=1}
  else if(b.mat==='brick'&&!o.special&&!['house','detached','residential'].includes(t)){o.wall=pick(brickW);o.roof=pick(roofsF);o.shop=['retail','yes','commercial'].includes(t);o.cornice=1}
  else if(lv>=8){o.wall=pick([C.Limestone,'#bfe0ef','#e8dccb','#a9d4ea']);o.roof=pick(roofsF);o.win=3.2}
  else if(t==='parking'){o.wall=C.Concrete;o.roof='#b9b2a4';o.garage=1}
  else if(t==='church'){o.wall=pick([C.Brick,C['Old brick'],C.Limestone]);o.roof='#55555c';o.hip=1}
  else if(['house','detached','residential'].includes(t)&&area<400){o.wall=pick(pastW);o.roof=pick(roofsH);o.hip=1}
  else if(['government','office'].includes(t)){o.wall=pick([C.Limestone,C.Concrete,'#e9d2b0','#d8e2ea']);o.roof=pick(roofsF);o.cornice=1}
  else if(['university','school','dormitory','train_station'].includes(t)){o.wall=pick([C['Old brick'],C.Brick,'#c8673f']);o.roof=pick([C.Slate,'#5e5e64',C.Tin]);o.cornice=1}
  else if(['apartments','hotel'].includes(t)){o.wall=pick(['#ffd59a','#f0b48a',C.Mortar,'#c8e4f5','#e9d2b0']);o.roof=pick(roofsF)}
  else if(t==='roof'){o.wall=C.Tin;o.roof=C.Tin;o.canopy=1;o.hpx=Math.min(o.hpx,9)}
  else{o.wall=pick(brickW);o.roof=pick(roofsF);o.shop=['retail','yes','commercial'].includes(t);o.cornice=1;o.awn=hash(b.id%5003,9)<.35?pick(awnC,11):null;o.tank=false}
  if(o.special==='depot'){o.wall=C['Old brick'];o.roof='#55555c';o.cornice=1}
  if(o.special==='city'){o.wall=C.Concrete;o.roof='#55555c'}
  if(o.special==='theatre'){o.wall='#ece6d8';o.roof='#cfcabe';o.lv=4;o.cornice=1;o.shop=0;o.awn=null}
  if(o.special==='tanger'){o.wall='#a9d4ea';o.roof='#e9e4da';o.win=2.4}
  if(o.special==='icrc'){o.wall=C.Brick;o.roof='#3f5aa8';o.band=1;o.shop=1}
  if(b.rc&&!['tower','jsb'].includes(o.special)&&!o.hip)o.roof=mix(b.rc,HI,.08);
  // what the street photos show (medium and high confidence only)
  if(Fok&&!['tower','jsb','kress','theatre'].includes(o.special)){
    if(F.wall_hex)o.wall=mix(F.wall_hex,HI,.06);if(F.trim_hex){o.trim=F.trim_hex;o.cornice=1}
    if(F.storefront!=null)o.shop=!!F.storefront;o.awn=F.awning_hex||null;
    const ws=F.window_style;if(ws==='curtain wall')o.curtain=1;else if(ws==='ribbon')o.ribbon=1;else if(ws==='arched')o.archAll=1}
  if(o.special==='tower'){o.hpx=190;o.hm=95}
  if(b.tr){o.tiers=b.tr.map(t=>{let q=pairs(t.p);let A=0;for(let i=0;i<q.length;i++){const[a,c]=q[i],[d,e]=q[(i+1)%q.length];A+=a*e-d*c}if(A<0)q.reverse();return{pts:q,h:t.h}}).sort((x,y)=>x.h-y.h);o.htop=Math.min(250,Math.max(...o.tiers.map(t=>t.h))*ZPM);o.hm=Math.max(o.hm,...o.tiers.map(t=>t.h))}
  o.tmax=(o.htop||o.hpx)/(2*TH);
  // rooftop units
  o.units=[];if(!o.hip&&!o.canopy&&area>140){const n=Math.min(4,1+Math.floor(area/500));for(let k=0;k<n*4&&o.units.length<n;k++){const ux=o.minx+(o.maxx-o.minx)*hash(b.id%997,20+k),uy=o.miny+(o.maxy-o.miny)*hash(b.id%991,40+k);if(pip(ux,uy,pts)&&pip(ux+.3,uy+.25,pts)&&pip(ux-.3,uy-.25,pts))o.units.push([ux,uy])}}
  return o;
}).sort((a,b)=>a.key-b.key);
const byId={};blds.forEach(b=>{byId[b.id]=b;if(b.special)byId[b.special]=b});

function litFrac(b){
  if(!evening())return 0;const n=night();
  const live=L.lit.get(b.id);if(live!=null)return live;
  switch(b.special){case'city':return L.council.lit?1:.03;case'theatre':return .3;case'depot':return .85;case'tanger':return .2;case'tower':return n?.06:.3}
  if(b.garage)return 1;if(b.lv>=8)return n?.08:.35;
  if(['apartments','residential','house','detached','dormitory','hotel'].includes(b.t))return n?.4:.35;
  if(b.shop)return n?.12:.55;if(b.t==='church')return .15;return n?.04:.3;
}
function visWalls(pts){const out=[];const n=pts.length;for(let k=0;k<n;k++){const a=pts[k],q=pts[(k+1)%n];const dx=q[0]-a[0],dy=q[1]-a[1];const L=Math.hypot(dx,dy);if(L<1e-4)continue;const nx=dy/L,ny=-dx/L;if(nx+ny<=0)continue;out.push({a,q,L,nx,ny,f:(ny-nx)/2+.5,k:(a[0]+a[1]+q[0]+q[1])/2})}return out.sort((x,y)=>x.k-y.k)}
const WP=(wl,u,z,out=0)=>P(wl.a[0]+(wl.q[0]-wl.a[0])*u+wl.nx*out,wl.a[1]+(wl.q[1]-wl.a[1])*u+wl.ny*out,z);
function drawPrism(c,pts,z0,h,wall,roof,noTop){
  for(const s of visWalls(pts))poly(c,[P(s.a[0],s.a[1],z0),P(s.q[0],s.q[1],z0),P(s.q[0],s.q[1],z0+h),P(s.a[0],s.a[1],z0+h)],mix(wall,SH,.32*(1-s.f)));
  if(!noTop)poly(c,pts.map(p=>P(p[0],p[1],z0+h)),surf(mix(roof,HI,.1),true));
}
function drawBuilding(c,b){drawBuilding0(c,b);if(b.tiers&&b.special!=='tower')drawTiers(c,b)}
// stepped roof levels measured by the lidar survey: each tier sits on the one below it
function drawTiers(c,b){let z0=b.hpx;const fr_=litFrac(b);let wi=7;
  for(const t of b.tiers){const z1=Math.min(250,t.h*ZPM);if(z1<z0+3)continue;
    for(const wl of visWalls(t.pts)){const col=mix(b.wall,SH,.32*(1-wl.f));poly(c,[WP(wl,0,z0),WP(wl,1,z0),WP(wl,1,z1),WP(wl,0,z1)],col);
      if(b.cornice&&z1-z0>8)poly(c,[WP(wl,0,z1-2.5),WP(wl,1,z1-2.5),WP(wl,1,z1),WP(wl,0,z1)],b.trim?mix(b.trim,SH,.3*(1-wl.f)):mix(col,HI,.35));
      const glass=mix(mix(C['Haw River'],'#2a3442',.45),SH,.12+.3*(1-wl.f)),lit=wl.f>.5?GLOW:mix(GLOW,'#ffb050',.3);
      const nw=Math.floor(wl.L*M/(b.win||3.4));if(nw<1)continue;
      for(let z=z0+2.2;z+3.4<z1-2.5;z+=7.4)for(let j=0;j<nw;j++){const u0=(j+.28)/nw,u1=(j+.72)/nw;const q4=[WP(wl,u0,z),WP(wl,u1,z),WP(wl,u1,z+3.4),WP(wl,u0,z+3.4)];if(b.curtain){poly(c,q4,mix(glass,HI,.05))}else poly(c,q4,glass);if(hash(b.id%10007,wi++)<fr_)eq(q4,lit)}}
    poly(c,t.pts.map(p=>P(p[0],p[1],z1)),surf(mix(b.roof,HI,.1),true),surf(mix(b.roof,SH,.3),true));z0=z1}}
function drawBuilding0(c,b){
  if(b.special==='tower'){drawLFT(c,b);return}
  const pts=b.pts,hp=b.hpx;const fr_=litFrac(b);let wi=0;const walls=visWalls(pts);b.walls=walls;
  for(const wl of walls){
    const col=mix(b.wall,SH,.32*(1-wl.f));const{a,q}=wl;
    poly(c,[P(a[0],a[1]),P(q[0],q[1]),P(q[0],q[1],hp),P(a[0],a[1],hp)],col);
    poly(c,[P(a[0],a[1]),P(q[0],q[1]),P(q[0],q[1],3),P(a[0],a[1],3)],mix(col,SH,.18));
    if(b.canopy)continue;
    if(b.curtain){const gl=mix(mix(b.wall,'#2c3a48',.5),SH,.1+.3*(1-wl.f));poly(c,[WP(wl,0,3),WP(wl,1,3),WP(wl,1,hp-2),WP(wl,0,hp-2)],gl);const lvp=hp/b.lv;for(let l=1;l<b.lv;l++)line(c,WP(wl,0,l*lvp),WP(wl,1,l*lvp),mix(gl,HI,.25));const nm=Math.max(1,Math.round(wl.L*M/1.8));for(let k=1;k<nm;k++)line(c,WP(wl,k/nm,3),WP(wl,k/nm,hp-2),mix(gl,HI,.15));if(fr_)for(let l=0;l<b.lv;l++)for(let k=0;k<nm;k++)if(hash(b.id%10007,wi++)<fr_*.7)eq([WP(wl,k/nm,l*lvp+1),WP(wl,(k+1)/nm,l*lvp+1),WP(wl,(k+1)/nm,(l+1)*lvp-1),WP(wl,k/nm,(l+1)*lvp-1)],GLOW);continue}
    if(b.cornice&&hp>10){poly(c,[WP(wl,0,hp-3),WP(wl,1,hp-3),WP(wl,1,hp),WP(wl,0,hp)],b.trim?mix(b.trim,SH,.3*(1-wl.f)):mix(col,HI,.35));line(c,WP(wl,0,hp-3.5),WP(wl,1,hp-3.5),mix(col,SH,.35))}
    const lvpx=hp/b.lv;const glass=mix(mix(C['Haw River'],'#2a3442',.45),SH,.12+.3*(1-wl.f));const lit=wl.f>.5?GLOW:mix(GLOW,'#ffb050',.3);
    if(b.garage){for(let l=0;l<b.lv;l++){const z=l*lvpx+lvpx*.35,z2=z+lvpx*.42;const q4=[WP(wl,.03,z),WP(wl,.97,z),WP(wl,.97,z2),WP(wl,.03,z2)];poly(c,q4,mix(b.wall,SH,.55));if(fr_)eq(q4,'rgba(255,236,190,.5)')}continue}
    const spacing=(b.win||3.4)/M;const nw=Math.floor(wl.L/spacing);
    // storefront
    let l0=0;
    if(b.shop&&wl.L*M>5){l0=1;const sz=Math.min(lvpx*.75,6.5);const q4=[WP(wl,.04,1.2),WP(wl,.96,1.2),WP(wl,.96,1.2+sz),WP(wl,.04,1.2+sz)];poly(c,q4,mix(glass,SH,.15));
      const nd=Math.max(1,Math.floor(wl.L*M/8));for(let k=0;k<nd;k++){const u=(k+.5)/nd;line(c,WP(wl,u,1.2),WP(wl,u,1.2+sz),mix(col,SH,.1))}
      if(fr_)eq(q4,mix(GLOW,'#ffffff',.25));
      if(b.awn){const an=Math.max(4,Math.round(wl.L*M/1.2));for(let k=0;k<an;k++){const u0=.03+.94*k/an,u1=.03+.94*(k+1)/an;poly(c,[WP(wl,u0,2+sz),WP(wl,u1,2+sz),WP(wl,u1,sz-.5,.13),WP(wl,u0,sz-.5,.13)],surf(k%2?b.awn:mix(b.awn,HI,.12),true))}}}
    if(nw<1)continue;
    for(let l=l0;l<b.lv;l++){
      const z=l*lvpx+lvpx*.3,wh=Math.max(2,lvpx*.45);if(z+wh>hp-(b.cornice?4:1.5))break;
      const ar=(b.arch&&l>=b.lv-2)||b.archAll;
      if(b.ribbon){const q4=[WP(wl,.03,z),WP(wl,.97,z),WP(wl,.97,z+wh),WP(wl,.03,z+wh)];poly(c,q4,glass);if(hash(b.id%10007,wi++)<fr_)eq(q4,lit);continue}
      for(let j=0;j<nw;j++){const u0=(j+.28)/nw,u1=(j+.72)/nw;const zt=ar?z+wh*1.5:z+wh;const q4=[WP(wl,u0,z),WP(wl,u1,z),WP(wl,u1,zt),WP(wl,u0,zt)];poly(c,q4,glass);if(ar){const du=(u1-u0)*.25;poly(c,[WP(wl,u0+du,zt),WP(wl,u1-du,zt),WP(wl,u1-du,zt+1.2),WP(wl,u0+du,zt+1.2)],glass)}
        if(wh>=3)line(c,WP(wl,u0,z+wh-.5),WP(wl,u1,z+wh-.5),mix(glass,HI,.4));
        if(hash(b.id%10007,wi++)<fr_)eq(q4,lit)}
    }
    if(b.band){poly(c,[WP(wl,0,hp-8),WP(wl,1,hp-8),WP(wl,1,hp-4),WP(wl,0,hp-4)],mix(C.Mortar,SH,.3*(1-wl.f)))}
  }
  let fi=0;for(let k=1;k<pts.length;k++)if(pts[k][0]+pts[k][1]>pts[fi][0]+pts[fi][1])fi=k;line(c,P(pts[fi][0],pts[fi][1]),P(pts[fi][0],pts[fi][1],hp),mix(b.wall,HI,.35));
  if(b.special==='kress'){const wl=walls.slice().sort((x,y)=>y.nx-x.nx)[0];if(wl){const col=mix(b.wall,SH,.32*(1-wl.f));
    const np=Math.max(3,Math.round(wl.L*M/3));for(let k=0;k<=np;k++){const u=k/np;line(c,WP(wl,u,9,.01),WP(wl,u,hp-1,.01),mix(col,HI,.45))}
    const A=P(wl.a[0],wl.a[1],0),Q=P(wl.q[0],wl.q[1],0);const flip=Q[0]<A[0];const du=1/(Math.abs(Q[0]-A[0])||1);const txt='KRESS',cols=txt.length*4-1;{const v0=.5-(cols+2)*du/2,v1=.5+(cols+2)*du/2;poly(c,[WP(wl,flip?1-v0:v0,hp-8,.015),WP(wl,flip?1-v1:v1,hp-8,.015),WP(wl,flip?1-v1:v1,hp-.5,.015),WP(wl,flip?1-v0:v0,hp-.5,.015)],'#3a3226')}for(const[u0,u1]of[[.16,.36],[.4,.6],[.64,.84]]){poly(c,[WP(wl,u0,9,.01),WP(wl,u1,9,.01),WP(wl,u1,hp-10,.01),WP(wl,u0,hp-10,.01)],mix('#4e5e44',SH,.2*(1-wl.f)));for(let z=12;z<hp-10;z+=5)line(c,WP(wl,u0,z,.012),WP(wl,u1,z,.012),'#8a9a6e');for(const u of[u0+(u1-u0)/3,u0+2*(u1-u0)/3])line(c,WP(wl,u,9,.012),WP(wl,u,hp-10,.012),'#8a9a6e')}
    for(let i=0;i<txt.length;i++){const g=FONT[txt[i]];for(let r=0;r<5;r++)for(let k=0;k<3;k++){if(g[r*3+k]!=='1')continue;const v=.5-cols*du/2+(i*4+k+.5)*du;const p=WP(wl,flip?1-v:v,hp-2-r,.02);fr(c,Math.round(p[0]),Math.round(p[1]),1,1,'#b8862a')}}}}
  if(b.special==='jsb'&&PART[807732943]){const cp=pairs(PART[807732943].p);const ch=(71-65)*ZPM;b.crown=cp;
    poly(c,pts.map(p=>P(p[0],p[1],hp)),surf(mix(b.roof,HI,.08),true),surf(mix(b.roof,SH,.3),true));
    for(const wl of visWalls(cp)){const col=mix(b.wall,SH,.32*(1-wl.f));poly(c,[WP(wl,0,hp),WP(wl,1,hp),WP(wl,1,hp+ch),WP(wl,0,hp+ch)],col);poly(c,[WP(wl,0,hp+ch-2),WP(wl,1,hp+ch-2),WP(wl,1,hp+ch),WP(wl,0,hp+ch)],mix(col,HI,.35));
      const nw=Math.floor(wl.L*M/2.9);const glass=mix('#3a4656',SH,.1+.3*(1-wl.f));for(let j=0;j<nw;j++){const u0=(j+.3)/nw,u1=(j+.7)/nw;poly(c,[WP(wl,u0,hp+2),WP(wl,u1,hp+2),WP(wl,u1,hp+7),WP(wl,u0,hp+7)],glass)}}
    poly(c,cp.map(p=>P(p[0],p[1],hp+ch)),surf(mix(b.roof,HI,.1),true));return}
  if(b.hip&&b.area<900){const apex=[b.cx,b.cy];const rh=Math.min(12,Math.sqrt(b.area)*.5);const tris=[];const n=pts.length;
    for(let k=0;k<n;k++){const a=pts[k],q=pts[(k+1)%n];const dx=q[0]-a[0],dy=q[1]-a[1];tris.push({a,q,k:(a[0]+a[1]+q[0]+q[1])/2,vis:(dy-dx)>0})}
    tris.sort((x,y)=>(x.vis-y.vis)||(x.k-y.k));
    for(const t of tris)poly(c,[P(t.a[0],t.a[1],hp),P(t.q[0],t.q[1],hp),P(apex[0],apex[1],hp+rh)],surf(t.vis?mix(b.roof,HI,.12):mix(b.roof,SH,.22),true));
    if(b.t==='church'){drawPrism(c,[[b.cx-.12,b.cy-.12],[b.cx+.12,b.cy-.12],[b.cx+.12,b.cy+.12],[b.cx-.12,b.cy+.12]],hp,rh+6,b.wall,b.roof);const t0=P(b.cx,b.cy,hp+rh+6);poly(c,[[t0[0]-3,t0[1]],[t0[0]+3,t0[1]],[t0[0],t0[1]-14]],surf(C.Slate,true))}
  }else{
    poly(c,pts.map(p=>P(p[0],p[1],hp)),surf(mix(b.roof,HI,.08),true),surf(mix(b.roof,SH,.3),true));
    if(b.area>200&&!b.canopy){const s=Math.max(.8,1-1.2/Math.sqrt(b.area));poly(c,pts.map(p=>P(b.cx+(p[0]-b.cx)*s,b.cy+(p[1]-b.cy)*s,hp)),surf(mix(b.roof,SH,.1),true))}
    for(const[ux,uy] of b.units){drawPrism(c,[[ux-.17,uy-.12],[ux+.17,uy-.12],[ux+.17,uy+.12],[ux-.17,uy+.12]],hp,4,'#c9cfd6','#e4e8ec');const tp=P(ux,uy,hp+4);circ(c,tp[0],tp[1],1.3,'#8a93a0')}
    if(b.tank){const tx=b.cx,ty=b.cy;[[-.1,-.1],[.1,-.1],[.1,.1],[-.1,.1]].forEach(([dx,dy])=>line(c,P(tx+dx,ty+dy,hp),P(tx+dx,ty+dy,hp+7),'#5a3f2c'));const oct=[...Array(8)].map((_,k)=>[tx+Math.cos(k*Math.PI/4)*.16,ty+Math.sin(k*Math.PI/4)*.16]);drawPrism(c,oct,hp+7,9,'#9a6a46','#9a6a46',true);const ap=P(tx,ty,hp+20);poly(c,oct.map(p=>P(p[0],p[1],hp+16)).concat([]),surf('#6a4a36',true));poly(c,[P(tx-.16,ty,hp+16),P(tx,ty+.16,hp+16),P(tx+.16,ty,hp+16),ap],surf('#7a5236',true))}
  }
  // Galyon Depot: red brick with a limestone balustrade (its columned portico faces Washington St, away from this view)
  if(b.special==='depot'){for(const wl of walls){if(wl.L*M<6)continue;const col=mix('#e8e0cc',SH,.3*(1-wl.f));poly(c,[WP(wl,0,hp-3,.01),WP(wl,1,hp-3,.01),WP(wl,1,hp+2,.01),WP(wl,0,hp+2,.01)],col);const n=Math.round(wl.L*M/.8);for(let k=1;k<n;k++){const u=k/n;line(c,WP(wl,u,hp-2.5,.02),WP(wl,u,hp+1,.02),mix(col,SH,.25))}}}
  // Carolina Theatre (1927): cream neoclassical front on South Greene St with pediment, marquee and two blade signs
  if(b.special==='theatre'){const wl=(walls.filter(w=>w.nx>.8).sort((x,y)=>y.L-x.L)[0])||walls[0];if(wl){const col=mix(b.wall,SH,.3*(1-wl.f));
    for(let k=1;k<6;k++){const u=.12+.76*k/6;line(c,WP(wl,u,14,.01),WP(wl,u,hp-3,.01),mix(col,HI,.5))}
    const glass=mix('#3a4656',SH,.1+.3*(1-wl.f));for(let k=0;k<5;k++){const u0=.12+.76*k/5+.03,u1=.12+.76*(k+1)/5-.03;poly(c,[WP(wl,u0,17),WP(wl,u1,17),WP(wl,u1,hp-6),WP(wl,u0,hp-6)],glass);line(c,WP(wl,u0,(17+hp-6)/2),WP(wl,u1,(17+hp-6)/2),mix(col,HI,.3))}
    poly(c,[WP(wl,.12,hp),WP(wl,.88,hp),WP(wl,.5,hp+7)],mix(col,HI,.25));line(c,WP(wl,.12,hp),WP(wl,.5,hp+7),mix(col,SH,.25));line(c,WP(wl,.5,hp+7),WP(wl,.88,hp),mix(col,SH,.25));
    poly(c,[WP(wl,.06,9,.0),WP(wl,.94,9),WP(wl,.94,13,.3),WP(wl,.06,13,.3)],'#f4efe2');poly(c,[WP(wl,.06,9),WP(wl,.94,9),WP(wl,.94,8,.3),WP(wl,.06,8,.3)],'#bdb5a2');line(c,WP(wl,.3,11,.31),WP(wl,.7,11,.31),'#2a3a5a');
    for(const u of [.04,.96]){poly(c,[WP(wl,u,12),WP(wl,u,hp+10),WP(wl,u,hp+10,.32),WP(wl,u,12,.32)],'#3a2a2c');for(let k=0;k<8;k++){const z=14+k*(hp-4)/8;fr(c,...WP(wl,u,z,.16).map(Math.round),1,1,'#e8c060')}
      if(lampsOn())for(let k=0;k<14;k++)ed(WP(wl,u,13+k*(hp-3)/14,.16),k%2?'#ff7a5a':'#ffe08a')}
    if(lampsOn()){for(let k=0;k<26;k++){const u=.07+.86*k/25;ed(WP(wl,u,13,.31),GLOW);ed(WP(wl,u,8.5,.31),GLOW)}eq([WP(wl,.06,9),WP(wl,.94,9),WP(wl,.94,13,.3),WP(wl,.06,13,.3)],'rgba(255,244,214,.55)')}}}
  if(L.strings.has(b.id)&&evening()){const wl=walls.slice().sort((x,y)=>(y.nx-x.nx))[0];if(wl){const cols=['#ffe9a8','#ff9a8a','#a8d8ff'];for(let k=0;k<=28;k++){const u=k/28;ed(WP(wl,u,12-Math.sin(u*Math.PI*3)**2*3,.35),cols[k%3])}}}
}
function drawLFT(c,b){
  const pts=b.pts,Z=m=>m*ZPM,top=Z(79),LIME='#ece4d2',DARK='#2c3940';
  const walls=visWalls(pts);b.walls=walls;const fr_=litFrac(b);let wi=0;
  for(const wl of walls){
    const{a,q}=wl;const short=wl.L*M<6;
    const col=short?mix(DARK,SH,.25*(1-wl.f)):mix(LIME,SH,.30*(1-wl.f));
    poly(c,[P(a[0],a[1]),P(q[0],q[1]),P(q[0],q[1],top),P(a[0],a[1],top)],col);
    if(short){// the dark glass recesses at the stepped corners
      for(let l=1;l<20;l++){const z=Z(l*3.95);line(c,WP(wl,0,z),WP(wl,1,z),mix(col,HI,.14))}
      if(fr_)for(let l=0;l<20;l++)if(hash(b.id%977,wi++)<fr_*.8){const z=Z(l*3.95)+2;eq([WP(wl,.2,z),WP(wl,.8,z),WP(wl,.8,z+3),WP(wl,.2,z+3)],GLOW)}
      continue}
    const glass=mix('#3a4656',SH,.1+.3*(1-wl.f)),lit=wl.f>.5?GLOW:mix(GLOW,'#ffb050',.3);
    const nb=Math.max(1,Math.round(wl.L*M/6.2));
    const win=(u0,u1,z0,z1,arch)=>{const q4=[WP(wl,u0,z0),WP(wl,u1,z0),WP(wl,u1,z1),WP(wl,u0,z1)];poly(c,q4,glass);if(arch){const du=(u1-u0)*.25;poly(c,[WP(wl,u0+du,z1),WP(wl,u1-du,z1),WP(wl,u1-du,z1+1.4),WP(wl,u0+du,z1+1.4)],glass)}if(hash(b.id%10007,wi++)<fr_)eq(q4,lit)};
    for(const zm of [8,49,59.5,63.5])poly(c,[WP(wl,0,Z(zm)),WP(wl,1,Z(zm)),WP(wl,1,Z(zm)+1.5),WP(wl,0,Z(zm)+1.5)],mix(col,HI,.38));
    poly(c,[WP(wl,0,top-3),WP(wl,1,top-3),WP(wl,1,top),WP(wl,0,top)],mix(col,HI,.42));line(c,WP(wl,0,top-3.5),WP(wl,1,top-3.5),mix(col,SH,.3));
    for(let k=0;k<nb;k++){const u0=k/nb,u1=(k+1)/nb,uw=u1-u0;
      if(k>0)line(c,WP(wl,u0,Z(8)),WP(wl,u0,top-3),mix(col,HI,.28));
      win(u0+uw*.22,u1-uw*.22,1,Z(6),true);
      for(let zm=9.6;zm<47;zm+=3.95){win(u0+uw*.14,u0+uw*.42,Z(zm),Z(zm)+3.4);win(u0+uw*.58,u0+uw*.86,Z(zm),Z(zm)+3.4)}
      win(u0+uw*.14,u0+uw*.44,Z(50.3),Z(57.6),true);win(u0+uw*.56,u0+uw*.86,Z(50.3),Z(57.6),true);
      win(u0+uw*.22,u0+uw*.40,Z(60.6),Z(62.6));win(u0+uw*.60,u0+uw*.78,Z(60.6),Z(62.6));
      win(u0+uw*.14,u0+uw*.44,Z(65),Z(75.4),true);win(u0+uw*.56,u0+uw*.86,Z(65),Z(75.4),true)}
  }
  let fi=0;for(let k=1;k<pts.length;k++)if(pts[k][0]+pts[k][1]>pts[fi][0]+pts[fi][1])fi=k;line(c,P(pts[fi][0],pts[fi][1]),P(pts[fi][0],pts[fi][1],top),mix(LIME,HI,.4));
  poly(c,pts.map(p=>P(p[0],p[1],top)),surf(mix('#cfc6b3',HI,.08),true),surf(mix('#cfc6b3',SH,.3),true));
  if(!PART[341049143]||!PART[341049145])return;
  // green copper pyramid (OSM: 52 degree pyramidal roof, #558074) truncated by the clock lantern
  const base=pairs(PART[341049143].p),l0=pairs(PART[341049145].p);
  const cen=a=>[a.reduce((s,p)=>s+p[0],0)/a.length,a.reduce((s,p)=>s+p[1],0)/a.length];
  const lc=cen(l0),ln=l0.map(p=>[lc[0]+(p[0]-lc[0])*1.35,lc[1]+(p[1]-lc[1])*1.35]);
  const half=a=>{const c0=cen(a);let s=0;for(let i=0;i<a.length;i++){const p=a[i],q=a[(i+1)%a.length];s+=Math.hypot((p[0]+q[0])/2-c0[0],(p[1]+q[1])/2-c0[1])}return s/a.length};
  const zl=top+Z((half(base)-half(ln))*M*Math.tan(52*rad)),zt=Z(95);
  const GR=PART[341049143].rc||'#558074';const bc=cen(base);
  const fin=(p,z,h)=>{const s=P(p[0],p[1],z);fr(c,Math.round(s[0])-1,Math.round(s[1]-h),2,h,mix(LIME,SH,.15));fr(c,Math.round(s[0])-1,Math.round(s[1]-h)-1,1,1,LIME)};
  const front=p=>(p[0]-bc[0])+(p[1]-bc[1])>0;
  base.forEach(p=>{if(!front(p))fin(p,top,7)});
  const faces=base.map((p,i)=>{const q=base[(i+1)%4];const dx=q[0]-p[0],dy=q[1]-p[1],L=Math.hypot(dx,dy);const nx=dy/L,ny=-dx/L;return{i,p,q,lp:ln[i],lq:ln[(i+1)%4],nx,ny,vis:nx+ny}}).sort((a,b)=>a.vis-b.vis);
  for(const f of faces){const fsh=(f.ny-f.nx)/2+.5;const col=f.vis>0?mix(GR,SH,.35*(1-fsh)):mix(GR,HI,.06);
    poly(c,[P(f.p[0],f.p[1],top),P(f.q[0],f.q[1],top),P(f.lq[0],f.lq[1],zl),P(f.lp[0],f.lp[1],zl)],surf(col,true));
    if(f.vis>0)for(let k=1;k<8;k++){const u=k/8;line(c,P(f.p[0]+(f.q[0]-f.p[0])*u,f.p[1]+(f.q[1]-f.p[1])*u,top),P(f.lp[0]+(f.lq[0]-f.lp[0])*u,f.lp[1]+(f.lq[1]-f.lp[1])*u,zl),mix(col,SH,.18))}}
  base.forEach((p,i)=>{if(front(p)||front(ln[i]))line(c,P(p[0],p[1],top),P(ln[i][0],ln[i][1],zl),mix(GR,HI,.35))});
  base.forEach(p=>{if(front(p))fin(p,top,7)});
  ln.forEach(p=>{if(!front(p))fin(p,zt,4)});
  drawPrism(c,ln,zl-1,zt-zl+1,'#e4dccb','#cfc6b3');
  ln.forEach(p=>{if(front(p))fin(p,zt,4)});
  b.lantern=ln;b.lanternZ=zl;
}
function blockers(gx,gy,zpx=0){const out=[];for(const b of blds){if(b.minx>gx+b.tmax+.5||b.maxx<gx-.05||b.miny>gy+b.tmax+.5||b.maxy<gy-.05)continue;const tm=Math.max(0,((b.htop||b.hpx)-zpx)/(2*TH));for(let t=0;t<=tm;t+=.15){if(pip(gx+t,gy+t,b.pts)){out.push(b);break}}}return out}
function rect(cx,cy,dx,dy,len,wid){const L=Math.hypot(dx,dy)||1;const ux=dx/L,uy=dy/L,vx=-uy,vy=ux;const a=len/2,b=wid/2;return[[cx-ux*a-vx*b,cy-uy*a-vy*b],[cx+ux*a-vx*b,cy+uy*a-vy*b],[cx+ux*a+vx*b,cy+uy*a+vy*b],[cx-ux*a+vx*b,cy-uy*a+vy*b]]}

// ---------- ground and model base ----------
const RW=[16,14,12,10,8,4.5,5];
function polyPath(c,flat){c.beginPath();c.moveTo(flat[0],flat[1]);for(let i=2;i<flat.length;i+=2)c.lineTo(flat[i],flat[i+1])}
// vegetation mask from the 2024 NC OneMap aerial (1.5 m cells); everything else downtown is paved
const VG=(()=>{const v=MAP.VG;if(!v)return null;const a=new Uint8Array(v.w*v.h);v.rows.forEach((row,j)=>{let i=0,cur=0;row.split(',').forEach(t=>{const n=parseInt(t,16);if(cur)a.fill(1,j*v.w+i,j*v.w+i+n);i+=n;cur^=1})});return{r:v.r,w:v.w,h:v.h,a}})();
const isVeg=(gx,gy)=>{if(!VG)return true;const i=Math.floor(gx*VG.r),j=Math.floor(gy*VG.r);return i>=0&&j>=0&&i<VG.w&&j<VG.h&&VG.a[j*VG.w+i]===1};
function gcol(base,kind){let c=base;if(S.wx==='snow')c=mix(c,'#f5f7fb',kind==='road'?.15:kind==='walk'?.5:.72);if(S.wx==='pollen')c=mix(c,'#e8d860',.1);return c}
function drawGround(c){
  c.setTransform(1,0,0,1,0,0);c.fillStyle='#3a2c26';c.fillRect(0,0,BW,BH);
  // table weave
  c.fillStyle='rgba(255,255,255,.025)';for(let y=0;y<BH;y+=4)c.fillRect(0,y,BW,1);
  // model base slab
  const D=18;const A=P(0,GY),B_=P(GX,GY),Cc=P(GX,0);
  c.fillStyle='rgba(0,0,0,.35)';c.beginPath();c.moveTo(A[0]+6,A[1]+D+8);c.lineTo(B_[0]+6,B_[1]+D+8);c.lineTo(Cc[0]+10,Cc[1]+D+8);c.lineTo(Cc[0]+10,Cc[1]);c.closePath();c.fill();
  poly(c,[A,B_,[B_[0],B_[1]+D],[A[0],A[1]+D]],'#a8744a');poly(c,[B_,Cc,[Cc[0],Cc[1]+D],[B_[0],B_[1]+D]],'#7d5236');
  for(let k=1;k<4;k++){line(c,[A[0],A[1]+k*D/4],[B_[0],B_[1]+k*D/4],'rgba(60,30,10,.18)');line(c,[B_[0],B_[1]+k*D/4],[Cc[0],Cc[1]+k*D/4],'rgba(40,20,5,.18)')}
  line(c,A,B_,'#f0d6b0');line(c,B_,Cc,'#d9b48c');
  c.setTransform(TW,TH,-TW,TH,ox,oy);
  c.save();c.beginPath();c.rect(0,0,GX,GY);c.clip();
  if(VG){for(let y=0;y<GY;y++)for(let x=0;x<GX;x++){const n=hash(x+50,y+50);c.fillStyle=gcol(n<.5?'#b4aea3':n<.85?'#aaa499':'#bdb7ab','walk');c.fillRect(x,y,1.02,1.02)}
    const R=VG.r;for(let j=0;j<VG.h;j++){let i=0;while(i<VG.w){if(!VG.a[j*VG.w+i]){i++;continue}let e=i;while(e<VG.w&&VG.a[j*VG.w+e])e++;const n=hash(i+7,j+3);c.fillStyle=gcol(n<.5?C.Bermuda:mix(C.Bermuda,C.Fescue,.3),'grass');c.fillRect(i/R,j/R,(e-i)/R+.02,1/R+.02);i=e}}}
  else for(let y=0;y<GY;y++)for(let x=0;x<GX;x++){const n=hash(x+50,y+50);c.fillStyle=gcol(n<.4?C.Bermuda:n<.8?mix(C.Bermuda,C.Fescue,.3):mix(C.Bermuda,C['Red clay'],n>.97?.3:.06),'grass');c.fillRect(x,y,1.02,1.02)}
  MAP.PK.forEach(p=>{polyPath(c,p.p);c.closePath();c.fillStyle=gcol(p.k==='pitch'?'#79cf5e':C.Fescue,'grass');c.fill()});
  MAP.PL.forEach(p=>{polyPath(c,p);c.closePath();c.fillStyle=gcol(mix(C.Asphalt,C.Concrete,.4),'road');c.fill();c.strokeStyle=gcol('#d8d4ca','walk');c.lineWidth=1.2/M;c.stroke()});
  c.lineCap='round';c.lineJoin='round';
  MAP.R.filter(r=>r.ar).forEach(r=>{polyPath(c,r.p);c.closePath();c.fillStyle=gcol('#d8d4ca','walk');c.fill()});
  MAP.R.filter(r=>!r.ar&&r.c<=4).forEach(r=>{polyPath(c,r.p);c.strokeStyle=gcol('#c8c3b8','walk');c.lineWidth=(RW[r.c]+8)/M;c.stroke()});
  MAP.R.filter(r=>!r.ar&&r.c<=4).forEach(r=>{polyPath(c,r.p);c.strokeStyle=gcol('#d8d4ca','walk');c.lineWidth=(RW[r.c]+6.6)/M;c.stroke()});
  MAP.R.filter(r=>!r.ar&&r.c===6).forEach(r=>{polyPath(c,r.p);c.strokeStyle=gcol('#cdc8bd','walk');c.lineWidth=4/M;c.stroke()});
  MAP.RL.forEach(r=>{polyPath(c,r.p);c.strokeStyle=gcol(C['Red clay'],'grass');c.lineWidth=5.5/M;c.stroke()});
  MAP.RL.forEach(r=>{polyPath(c,r.p);c.strokeStyle=gcol('#7a5236','grass');c.lineWidth=3.2/M;c.setLineDash([.5/M,.8/M]);c.stroke();c.setLineDash([])});
  MAP.RL.forEach(r=>{polyPath(c,r.p);c.strokeStyle=C.Tin;c.lineWidth=2.0/M;c.stroke();polyPath(c,r.p);c.strokeStyle=gcol('#8a6046','grass');c.lineWidth=1.45/M;c.stroke()});
  MAP.R.filter(r=>!r.ar&&r.c===5).forEach(r=>{polyPath(c,r.p);c.strokeStyle=gcol(mix(C.Asphalt,C.Concrete,.3),'road');c.lineWidth=RW[5]/M;c.stroke()});
  const asph=gcol(S.wx==='rain'?C['Wet asphalt']:C.Asphalt,'road');
  MAP.R.filter(r=>!r.ar&&r.c<=4).forEach(r=>{polyPath(c,r.p);c.strokeStyle=asph;c.lineWidth=RW[r.c]/M;c.stroke()});
  // lane markings: double yellow on main streets, dashed white on smaller ones
  MAP.R.filter(r=>!r.ar&&r.c<=2&&!r.ow).forEach(r=>{polyPath(c,r.p);c.strokeStyle=gcol(C['Line gold'],'road');c.lineWidth=.75/M;c.stroke();polyPath(c,r.p);c.strokeStyle=asph;c.lineWidth=.3/M;c.stroke()});
  MAP.R.filter(r=>!r.ar&&(r.c===3||(r.c<=2&&r.ow))).forEach(r=>{polyPath(c,r.p);c.strokeStyle=gcol('#f4f1ea','road');c.lineWidth=.25/M;c.setLineDash([3/M,4/M]);c.stroke();c.setLineDash([])});
  // crosswalks
  c.lineCap='butt';
  MAP.X.forEach(([x,y,ds])=>{const wmax=Math.max(...ds.map(d=>RW[d[2]]));for(const[ux,uy,cl] of ds){if(cl>3)continue;const w=RW[cl];const off=(wmax/2+2.2)/M;const cx=x+ux*off,cy=y+uy*off;const vx=-uy,vy=ux;const n=Math.floor(w/1.1);for(let k=0;k<n;k++){const s=(-w/2+.55+k*1.1)/M;c.beginPath();c.moveTo(cx+vx*s-ux*1.4/M,cy+vy*s-uy*1.4/M);c.lineTo(cx+vx*s+ux*1.4/M,cy+vy*s+uy*1.4/M);c.strokeStyle=gcol('#f4f1ea','road');c.lineWidth=.55/M;c.stroke()}}});
  c.restore();c.setTransform(1,0,0,1,0,0);c.lineCap='round';
}
// cast shadows from the real sun
function drawShadows(c){
  if(SUN.alt<2||S.wx==='rain')return;
  const R=4,mc=mk(Math.ceil(GX*R),Math.ceil(GY*R)),m=mc.getContext('2d');m.setTransform(R,0,0,R,0,0);m.fillStyle=m.strokeStyle='#2c2147';
  const k=1/Math.tan(Math.max(4,SUN.alt)*rad),vx=-Math.sin(SUN.az*rad),vy=Math.cos(SUN.az*rad);
  m.lineJoin='round';for(const b of blds){if(!b.canopy){m.lineWidth=.32;m.beginPath();b.pts.forEach((p,i)=>i?m.lineTo(p[0],p[1]):m.moveTo(p[0],p[1]));m.closePath();m.stroke()}const L=Math.min(b.hm*k,b.hm*8)/M;const sh=hull(b.pts.concat(b.pts.map(p=>[p[0]+vx*L,p[1]+vy*L])));m.beginPath();sh.forEach((p,i)=>i?m.lineTo(p[0],p[1]):m.moveTo(p[0],p[1]));m.closePath();m.fill()}
  for(const o of pts0){if(o.kind==='tree'){const L=Math.min(7*k,40)/M*o.s;m.beginPath();m.ellipse(o.gx+vx*L,o.gy+vy*L,.22*o.s,.22*o.s,0,0,7);m.fill()}else if(o.kind==='car'){const L=Math.min(1.5*k,8)/M;m.beginPath();const r=o.r;r.concat(r.map(p=>[p[0]+vx*L,p[1]+vy*L]));const h=hull(r.concat(r.map(p=>[p[0]+vx*L,p[1]+vy*L])));h.forEach((p,i)=>i?m.lineTo(p[0],p[1]):m.moveTo(p[0],p[1]));m.fill()}}
  c.save();c.setTransform(TW/R,TH/R,-TW/R,TH/R,ox,oy);c.globalAlpha=S.wx==='snow'?.22:.34;c.drawImage(mc,0,0);c.restore();
}

// ---------- static points ----------
const pts0=[];
(function place(){
  const R=6,mw=Math.ceil(GX*R),mh=Math.ceil(GY*R);const mkMask=()=>{const mc=mk(mw,mh),m=mc.getContext('2d');m.fillStyle='#fff';m.fillRect(0,0,mw,mh);m.setTransform(R,0,0,R,0,0);m.lineCap='round';m.strokeStyle='#000';m.fillStyle='#000';return[mc,m]};
  const[fc,m]=mkMask();
  MAP.R.forEach(r=>{polyPath(m,r.p);if(r.ar){m.closePath();m.fill()}else{m.lineWidth=(RW[r.c]+(r.c<=4?9:3))/M;m.stroke()}});
  MAP.RL.forEach(r=>{polyPath(m,r.p);m.lineWidth=8/M;m.stroke()});
  MAP.PL.forEach(p=>{polyPath(m,p);m.closePath();m.fill()});
  const[bc,bm]=mkMask();
  blds.forEach(b=>{for(const mm of [m,bm]){mm.beginPath();b.pts.forEach((p,i)=>i?mm.lineTo(p[0],p[1]):mm.moveTo(p[0],p[1]));mm.closePath();mm.fill();mm.lineWidth=2.5/M;mm.stroke()}});
  const px=m.getImageData(0,0,mw,mh).data,bpx=bm.getImageData(0,0,mw,mh).data;
  const at=(d,x,y)=>{if(x<=.3||y<=.3||x>=GX-.3||y>=GY-.3)return false;const i=((Math.floor(y*R))*mw+Math.floor(x*R))*4;return d[i]>128};
  const parks=MAP.PK.map(p=>pairs(p.p));
  let s=3;const rnd=()=>{s=(s*16807)%2147483647;return s/2147483647};
  for(let y=0;y<GY;y+=.8)for(let x=0;x<GX;x+=.8){const gx=x+rnd()*.7,gy=y+rnd()*.7;if(!at(px,gx,gy))continue;const inPark=parks.some(p=>pip(gx,gy,p));if(rnd()<(inPark?.5:isVeg(gx,gy)?.32:0))pts0.push({kind:'tree',gx,gy,s:.8+rnd()*.5,pine:rnd()<.3})}
  // street trees and lamps along main streets
  MAP.TR.forEach(t=>{const p=pairs(t.p);let acc=0,acc2=0;const offT=(RW[t.c]/2+2.6)/M,offL=(RW[t.c]/2+1.1)/M;for(let i=0;i<p.length-1;i++){const[a,b]=[p[i],p[i+1]];const L=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!L)continue;const ux=(b[0]-a[0])/L,uy=(b[1]-a[1])/L;for(let d=0;d<L;d+=.15){acc+=.15;acc2+=.15;const bx=a[0]+ux*d,by=a[1]+uy*d;
    if(acc2>12/M&&t.c<=3){acc2=0;for(const sd of [-1,1]){const gx=bx-uy*offT*sd,gy=by+ux*offT*sd;if(at(bpx,gx,gy)&&rnd()<.75)pts0.push({kind:'tree',gx,gy,s:.65+rnd()*.2,pine:false,street:1})}}
    if(acc>30/M&&t.c<=3){acc=0;const sd=rnd()<.5?1:-1;const gx=bx-uy*offL*sd,gy=by+ux*offL*sd;if(at(bpx,gx,gy))pts0.push({kind:'lamp',gx,gy})}}}});
  // parked cars in surface lots
  const carCols=['#eeeef2','#eeeef2','#f6f4ee','#c4c8d0','#c4c8d0','#9aa0aa','#5c6270','#2c2c34','#2c2c34',C.Brick,C['Aggie blue'],'#6a7f96'];
  MAP.PL.forEach((pl,li)=>{const q=pairs(pl);const xs=q.map(p=>p[0]),ys=q.map(p=>p[1]);const horiz=hash(li,5)<.5;const sx=(horiz?5.6:2.8)/M,sy=(horiz?2.8:5.6)/M;for(let y=Math.min(...ys)+sy;y<Math.max(...ys)-sy/2;y+=sy)for(let x=Math.min(...xs)+sx;x<Math.max(...xs)-sx/2;x+=sx){const ri=Math.round(((horiz?x-Math.min(...xs):y-Math.min(...ys)))/(5.6/M));if(ri%3===2)continue;if(!pip(x,y,q)||!at(bpx,x,y)||rnd()>.5)continue;const r=rect(x,y,horiz?1:0,horiz?0:1,4.3/M,1.9/M);pts0.push({kind:'car',gx:x,gy:y,r,col:carCols[Math.floor(rnd()*carCols.length)]})}});
  // landmarks
  const ccp=MAP.PK.find(p=>p.n==='Center City Park');if(ccp){const q=pairs(ccp.p);pts0.push({kind:'fountain',gx:q.reduce((a,p)=>a+p[0],0)/q.length,gy:q.reduce((a,p)=>a+p[1],0)/q.length})}
  const lb=MAP.PK.find(p=>p.n==='Lebauer Park');if(lb){const q=pairs(lb.p);let best=null;for(let i=0;i<q.length-1;i++){const a=q[i],b=q[i+1];const nx=b[1]-a[1],ny=-(b[0]-a[0]);if(nx+ny>0){const L=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!best||L>best.L)best={a,b,L}}}if(best)pts0.push({kind:'string',a:best.a,b:best.b,gx:(best.a[0]+best.b[0])/2,gy:(best.a[1]+best.b[1])/2})}
  pts0.sort((a,b)=>(a.gx+a.gy)-(b.gx+b.gy));
})();
const NET=(()=>{const lb=MAP.PK.find(p=>p.n==='Lebauer Park');if(!lb)return null;const q=pairs(lb.p);return{cx:q.reduce((a,p)=>a+p[0],0)/q.length,cy:q.reduce((a,p)=>a+p[1],0)/q.length,rx:16/M,ry:11/M}})();
function drawTree(c,o){
  const[x,y]=P(o.gx,o.gy);const s=o.s*1.15;
  fr(c,Math.round(x-1),Math.round(y-9*s),2,Math.round(9*s),'#7a5236');
  if(o.pine){const cols=[C.Loblolly,mix(C.Loblolly,C.Pine,.5),C.Pine];for(let k=0;k<3;k++){const by=y-7*s-k*6*s,wd=(8-k*2)*s;poly(c,[[x-wd,by],[x+wd,by],[x,by-10*s]],surf(cols[k],k===2))}}
  else{const g=o.street?'#4caa55':C.Pine;circ(c,x,y-15*s,8*s,mix(g,SH,.2));circ(c,x-1,y-16*s,7*s,surf(g,false));circ(c,x-3,y-19*s,4*s,surf(mix(g,C.Fescue,.55),true));fr(c,Math.round(x-4*s),Math.round(y-21*s),1,1,mix(C.Fescue,HI,.4))}
}
function drawLamp(c,o){const[x,y]=P(o.gx,o.gy);const on=lampsOn();if(on)eg(x+.5,y,15,.3,.5);fr(c,Math.round(x),Math.round(y-16),1,16,SH);fr(c,Math.round(x-1),Math.round(y-17),3,2,SH);if(on){ed([x+.5,y-15.5],'#fff2c4',2);eg(x+.5,y-15,6,.4)}}
function drawString(c,o){[o.a,o.b].forEach(p=>line(c,P(p[0],p[1]),P(p[0],p[1],22),SH));if(!lampsOn())return;for(let k=0;k<=56;k++){const t=k/56;const gx=o.a[0]+(o.b[0]-o.a[0])*t,gy=o.a[1]+(o.b[1]-o.a[1])*t;ed(P(gx,gy,22-Math.sin(t*Math.PI*4)**2*5),k%2?'#ffe9a8':'#ffb98a')}}
function drawCarS(c,o){drawPrism(c,o.r,0,4,o.col,o.col);const[ax,ay]=[(o.r[0][0]+o.r[2][0])/2,(o.r[0][1]+o.r[2][1])/2];const r2=o.r.map(p=>[ax+(p[0]-ax)*.6,ay+(p[1]-ay)*.8]);drawPrism(c,r2,4,2.5,mix(C['Haw River'],SH,.3),mix(o.col,HI,.2))}
function drawFountain(c,o){const r=7/M;const ring=[...Array(16)].map((_,k)=>[o.gx+Math.cos(k*Math.PI/8)*r,o.gy+Math.sin(k*Math.PI/8)*r]);drawPrism(c,ring,0,3,C.Concrete,C.Concrete,true);poly(c,ring.map(p=>P(p[0],p[1],3)),surf(mix(C['Haw River'],HI,.25),true));const ring2=ring.map(p=>[o.gx+(p[0]-o.gx)*.3,o.gy+(p[1]-o.gy)*.3]);drawPrism(c,ring2,0,7,C.Concrete,C.Concrete)}
function drawPoint(c,o){switch(o.kind){case'tree':drawTree(c,o);break;case'lamp':drawLamp(c,o);break;case'string':drawString(c,o);break;case'car':drawCarS(c,o);break;case'fountain':drawFountain(c,o);break}}
// LeBauer Park's suspended net sculpture, drawn above everything
function drawNet(c){if(!NET)return;const{cx,cy,rx,ry}=NET;const z=(u,v)=>26-10*(1-u*u)*(1-v*v);const pt=(u,v)=>P(cx+u*rx,cy+v*ry,z(u,v));const lit=lampsOn();
  [[-1,-1],[1,-1],[1,1],[-1,1]].forEach(([u,v])=>line(c,P(cx+u*rx*1.15,cy+v*ry*1.15),P(cx+u*rx*1.15,cy+v*ry*1.15,34),'#e8e4dc',1));
  c.globalAlpha=.75;for(let i=0;i<=10;i++){const u=-1+i/5;c.beginPath();for(let j=0;j<=20;j++){const v=-1+j/10;const p=pt(u,v);j?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1])}c.strokeStyle=i%2?'#f08a7a':'#ffb86b';c.lineWidth=.8;c.stroke();
    c.beginPath();for(let j=0;j<=20;j++){const v=-1+j/10;const p=pt(v,u);j?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1])}c.stroke()}c.globalAlpha=1;
  [[-1,-1],[1,-1],[1,1],[-1,1]].forEach(([u,v])=>line(c,pt(u,v),P(cx+u*rx*1.15,cy+v*ry*1.15,34),'#e8e4dc',.6));
  if(lit){for(let i=0;i<=10;i++)for(let j=0;j<=10;j++){if((i+j)%2)continue;const p=pt(-1+i/5,-1+j/5);ed(p,(i+j)%4?'#ff8ab4':'#8ad8ff')}}}

let T=0,renderedFor='';
function renderStatic(){
  SUN=sunPos(sceneDate());
  TGT={c:SC,e:SE,g:SG};ox=BOX;oy=BOY;
  SE.clearRect(0,0,BW,BH);SG.clearRect(0,0,BW,BH);
  drawGround(SC);drawShadows(SC);
  for(const b of blds)drawBuilding(SC,b);
  for(const o of pts0){drawPoint(SC,o);for(const b of blockers(o.gx,o.gy,0))drawBuilding(SC,b)}
  drawNet(SC);
  renderedFor=stateKey();
}
const stateKey=()=>[S.time,S.wx,L.version,Math.round(SUN.alt/1.5),Math.round(SUN.az/3),evening(),lampsOn()].join('|');

// ---------- traffic ----------
const chains=MAP.TR.map(t=>{const p=pairs(t.p);const cum=[0];for(let i=1;i<p.length;i++)cum.push(cum[i-1]+Math.hypot(p[i][0]-p[i-1][0],p[i][1]-p[i-1][1]));return{n:t.n,c:t.c,p,cum,L:cum[cum.length-1]}});
function along(ch,d){d=Math.max(0,Math.min(ch.L-1e-6,d));let i=1;while(i<ch.cum.length-1&&ch.cum[i]<d)i++;const a=ch.p[i-1],b=ch.p[i];const seg=ch.cum[i]-ch.cum[i-1]||1;const t=(d-ch.cum[i-1])/seg;return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,(b[0]-a[0])/seg,(b[1]-a[1])/seg]}
const carCols=[C.Brick,C['Haw River'],C.Paper,C.Tobacco,C.Slate,C['Aggie blue'],'#5ec46a','#e8e8ee'];
const skins=['#f5d0ad','#e2a87e','#c3825a','#9a6040','#76462e','#553220'];
const shirts=[C.Tobacco,C['Aggie blue'],C.Brick,C.Pine,C.Paper,C['Haw River'],'#b04ec0',C.Slate,'#ff7a9a'];
const cars=[],people=[];
chains.forEach((ch,ci)=>{const n=Math.max(1,Math.round(ch.L/(ch.c<=2?9:16)));for(let k=0;k<n;k++)cars.push({ch,d:Math.random()*ch.L,dir:k%2?1:-1,v:(1.1+Math.random()*.5)*(ch.c<=2?1:.8),col:carCols[(ci*3+k)%8]});
  const np=Math.round(ch.L/4);for(let k=0;k<np;k++)people.push({ch,d:Math.random()*ch.L,dir:Math.random()<.5?1:-1,side:Math.random()<.5?1:-1,v:.13+Math.random()*.06,skin:skins[(ci+k)%6],shirt:shirts[(ci*2+k)%9]})});
const trainP=pairs(MAP.TRAIN);const trainCh=(()=>{const cum=[0];for(let i=1;i<trainP.length;i++)cum.push(cum[i-1]+Math.hypot(trainP[i][0]-trainP[i-1][0],trainP[i][1]-trainP[i-1][1]));return{p:trainP,cum,L:cum[cum.length-1]}})();
let trainD=-12,trainWait=4;

// ---------- camera ----------
const LANDMARKS=['tower','icrc','theatre','city','depot','tanger'].map(k=>byId[k]).filter(Boolean);let focus=LANDMARKS.slice();
let fi=0,camX,camY,tgtX,tgtY,lastUser=-1e9,drag=null,strollT=0;
function camFor(b){ox=BOX;oy=BOY;const[x,y]=P(b.cx,b.cy,(b.hpx||0)*.45);return[x-W/2,y-H*.5]}
const clampX=v=>Math.max(0,Math.min(BW-W,v)),clampY=v=>Math.max(0,Math.min(BH-H,v));
[camX,camY]=camFor(byId.tower||blds[0]);camY-=40;camX=clampX(camX);camY=clampY(camY);tgtX=camX;tgtY=camY;
cv.style.cursor='grab';cv.style.touchAction='none';
cv.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,cx:camX,cy:camY};cv.setPointerCapture(e.pointerId);cv.style.cursor='grabbing'});
cv.addEventListener('pointermove',e=>{if(!drag)return;const s=W/cv.clientWidth;camX=clampX(drag.cx-(e.clientX-drag.x)*s);camY=clampY(drag.cy-(e.clientY-drag.y)*s);tgtX=camX;tgtY=camY;lastUser=performance.now();if(reduce)requestAnimationFrame(frame)});
const toStatic=e=>{const r=cv.getBoundingClientRect();return[(e.clientX-r.left)*W/r.width+Math.round(camX),(e.clientY-r.top)*H/r.height+Math.round(camY)]};
function pickAt(e){const r=cv.getBoundingClientRect(),qx=(e.clientX-r.left)*W/r.width,qy=(e.clientY-r.top)*H/r.height;for(const g of signRects)if(qx>=g.x-2&&qx<=g.x+g.w+2&&qy>=g.y-2&&qy<=g.y+g.h+2)return{sign:g.id,name:g.name};const[sx,sy]=toStatic(e);for(let i=blds.length-1;i>=0;i--){const b=blds[i];if(!b.hull){ox=BOX;oy=BOY;const z=b.htop||b.hpx;b.hull=hull(b.pts.map(p=>P(p[0],p[1])).concat(b.pts.map(p=>P(p[0],p[1],z))))}if(pip(sx,sy,b.hull))return b}return null}
const endDrag=e=>{if(drag&&e&&e.type==='pointerup'&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<5){const b=pickAt(e);onPick(b);if(b){lastUser=performance.now()}}drag=null;cv.style.cursor='grab'};cv.addEventListener('pointerup',endDrag);cv.addEventListener('pointercancel',endDrag);
cv.addEventListener('mousemove',e=>{if(drag)return;const b=pickAt(e);if(b!==hoverB){hoverB=b;onHover(b);if(reduce)requestAnimationFrame(frame)}});cv.addEventListener('mouseleave',()=>{hoverB=null;onHover(null)});

// ---------- light grading from the sun ----------
const GD={dawn:{m:[1.03,.9,.92],a:[18,4,16],d:-.05},day:{m:[1.02,1.01,1],a:[0,0,0],d:-.12},dusk:{m:[1.04,.82,.76],a:[16,0,18],d:-.05},night:{m:[.40,.45,.70],a:[6,8,24],d:.2}};
const lerpG=(A,B,t)=>({m:A.m.map((v,i)=>v+(B.m[i]-v)*t),a:A.a.map((v,i)=>v+(B.a[i]-v)*t),d:A.d+(B.d-A.d)*t});
function gradeFor(sun){const tw=sun.az<180?GD.dawn:GD.dusk;if(sun.alt>=10)return GD.day;if(sun.alt>=-1)return lerpG(tw,GD.day,(sun.alt+1)/11);if(sun.alt>=-10)return lerpG(GD.night,tw,(sun.alt+10)/9);return GD.night}
const WXG={clear:{m:[1,1,1],a:[0,0,0],d:0},rain:{m:[.84,.88,.96],a:[0,0,6],d:.15},snow:{m:[1.04,1.04,1.08],a:[4,4,8],d:.08},pollen:{m:[1.04,1.03,.88],a:[6,6,0],d:0},cloudy:{m:[.94,.96,1],a:[0,0,4],d:.1}};
const blink=(t,on,off)=>(t%(on+off))<on;
const rain=[...Array(260)].map(()=>[Math.random()*W,Math.random()*H]);
const snow=[...Array(240)].map(()=>[Math.random()*W,Math.random()*H,Math.random()]);
const motes=[...Array(80)].map(()=>[Math.random()*W,Math.random()*H,Math.random()*6]);
function person(c,x,y,skin,shirt,f){x=Math.round(x);y=Math.round(y)-6;if(S.wx==='rain'){fr(c,x-2,y-2,6,1,shirt);fr(c,x,y-1,1,1,SH)}c.fillStyle='rgba(44,33,71,.25)';c.fillRect(x-1,y+6,4,1);fr(c,x,y,2,2,skin);fr(c,x,y+2,2,2,shirt);const lg=mix(SH,'#5a5070',.3);fr(c,x+(f?0:1),y+4,1,2,lg);fr(c,x+(f?1:0),y+4,1,2,lg)}

// 3x5 bulb font for the time-and-temperature sign
const FONT={'0':'111101101101111','1':'010110010010111','2':'111001111100111','3':'111001111001111','4':'101101111001001','5':'111100111001111','6':'111100111101111','7':'111001001001001','8':'111101111101111','9':'111101111001111',':':'000010000010000','°':'111101111000000','F':'111100110100100','-':'000000111000000','K':'101101110101101','R':'110101110101101','E':'111100111100111','S':'111100111001111',' ':'000000000000000'};
function lanternSign(cx,wl,z0,txt){
  // amber bulb digits on a dark panel, one bulb per pixel, as on the real lantern atop the tower
  const A=P(wl.a[0],wl.a[1],0),Q=P(wl.q[0],wl.q[1],0);const flip=Q[0]<A[0];const du=1/(Math.abs(Q[0]-A[0])||1);
  const gl=[...txt].map(ch=>ch===':'?['1','0','1','0','1'].map((v,r)=>r===1||r===3?'1':'0').join(''):(FONT[ch]||FONT[' ']));
  const ws=[...txt].map(ch=>ch===':'?1:3);const cols=ws.reduce((s,v)=>s+v,0)+ws.length-1;
  const u=k=>{const v=.5-cols*du/2+k*du;return flip?1-v:v};
  poly(cx,[WP(wl,u(-1),z0+3,.02),WP(wl,u(cols+.2),z0+3,.02),WP(wl,u(cols+.2),z0+11,.02),WP(wl,u(-1),z0+11,.02)],'#1d1a1c');
  let k0=0;txt.split('').forEach((ch,i)=>{const g=gl[i],wdt=ws[i];for(let r=0;r<5;r++)for(let k=0;k<wdt;k++){if(g[r*wdt+k]!=='1')continue;ed(WP(wl,u(k0+k+.5),z0+9.5-r,.03),'#ffb43a')}k0+=wdt+1});
}
function signText(cx,wl,z0,txt){
  // bulb matrix at a fixed 2px pitch, centred on the wall and reading left to right on screen
  const A=P(wl.a[0],wl.a[1],0),Q=P(wl.q[0],wl.q[1],0);const flip=Q[0]<A[0];
  const pxPerU=Math.abs(Q[0]-A[0])/1||1;const du=2/pxPerU;const cols=txt.length*4-1;
  const half=cols*du/2;const pad=3*du;
  const u=k=>flip?1-(.5-half+k*du):(.5-half+k*du);
  const pnl=[WP(wl,u(-1.5),z0+1,.02),WP(wl,u(cols+.5),z0+1,.02),WP(wl,u(cols+.5),z0+13,.02),WP(wl,u(-1.5),z0+13,.02)];poly(cx,pnl,'#221c26');
  for(let i=0;i<txt.length;i++){const g=FONT[txt[i]]||FONT[' '];for(let r=0;r<5;r++)for(let k=0;k<3;k++){const on=g[r*3+k]==='1';on?ed(WP(wl,u(i*4+k),z0+11-r*2,.03),BULB,2):ed(WP(wl,u(i*4+k),z0+11-r*2,.03),'#3a2e30')}}
}
const LABELS=[['tower','Lincoln Financial'],['jsb','Jefferson Standard'],['icrc','Civil Rights Museum'],['theatre','Carolina Theatre'],['city','Melvin Municipal'],['depot','Galyon Depot'],['tanger','Tanger Center'],[208219206,'Courthouse'],[414240404,'Cultural Center'],[366999616,'Renaissance Plaza'],[411854108,'Public Library']];

let last=0,lastCheck=0,flash=0,hoverB=null;
function frame(ts){
  const dt=Math.min(.1,(ts-last)/1000||0);last=ts;if(!reduce)T+=dt;
  if(S.time==='now'&&ts-lastCheck>30000){lastCheck=ts;SUN=sunPos(new Date());if(stateKey()!==renderedFor)renderStatic()}
  const D=sceneDate();
  if(glide&&!drag){camX+=(tgtX-camX)*Math.min(1,dt*2);camY+=(tgtY-camY)*Math.min(1,dt*2);if(Math.hypot(tgtX-camX,tgtY-camY)<1)glide=false}
  if(!reduce&&!drag&&!glide&&performance.now()-lastUser>25000){strollT+=dt;if(strollT>16){strollT=0;fi=(fi+1)%focus.length;[tgtX,tgtY]=camFor(focus[fi]);tgtX=clampX(tgtX);tgtY=clampY(tgtY)}camX+=(tgtX-camX)*Math.min(1,dt*.35);camY+=(tgtY-camY)*Math.min(1,dt*.35)}
  const cx=Math.round(camX),cy=Math.round(camY);
  w.clearRect(0,0,W,H);w.drawImage(SCc,cx,cy,W,H,0,0,W,H);
  E.clearRect(0,0,W,H);E.drawImage(SEc,cx,cy,W,H,0,0,W,H);GL.clearRect(0,0,W,H);GL.drawImage(SGc,cx,cy,W,H,0,0,W,H);
  TGT={c:w,e:E,g:GL};ox=BOX-cx;oy=BOY-cy;
  const ev=evening(),nt=night(),lamp=lampsOn();const dyn=[];
  const vis=(gx,gy)=>{const[x,y]=P(gx,gy);return x>-30&&x<W+30&&y>-40&&y<H+60};
  for(const c of cars){
    let stopAt=null;for(const k of L.closures)if(k.full&&k.ch===c.ch&&(c.dir>0?k.d>c.d:k.d<c.d)&&(stopAt==null||Math.abs(k.d-c.d)<Math.abs(stopAt-c.d)))stopAt=k.d;let nd=c.d+c.dir*c.v*dt;
    if(stopAt!=null){if(c.dir>0&&c.d<=stopAt-.9+1e-6&&nd>=stopAt-.9)nd=stopAt-.9;if(c.dir<0&&c.d>=stopAt+.9-1e-6&&nd<=stopAt+.9)nd=stopAt+.9}
    if(!reduce)c.d=nd;if(c.d>c.ch.L)c.d=0;if(c.d<0)c.d=c.ch.L;
    const[gx,gy,ux,uy]=along(c.ch,c.d);const off=(RW[c.ch.c]/4)/M*(c.dir>0?1:-1);const px=gx-uy*off,py=gy+ux*off;if(!vis(px,py))continue;
    dyn.push({kind:'car',gx:px,gy:py,ux:ux*c.dir,uy:uy*c.dir,col:c.col,stopped:stopAt!=null&&Math.abs(c.d-stopAt)<1})}
  for(const p of people){if(!reduce){p.d+=p.dir*p.v*dt;if(p.d>p.ch.L||p.d<0){p.dir*=-1;p.d=Math.max(0,Math.min(p.ch.L,p.d))}}if(nt&&(p.d*10|0)%3)continue;
    const[gx,gy,ux,uy]=along(p.ch,p.d);const off=(RW[p.ch.c]/2+2.0)/M*p.side;const px=gx-uy*off,py=gy+ux*off;if(!vis(px,py))continue;dyn.push({kind:'pp',gx:px,gy:py,skin:p.skin,shirt:p.shirt,f:blink(T*3+p.d,.5,.5)})}
  const crowd=(b,n,dx,col)=>{if(!b)return;for(let i=0;i<n;i++)dyn.push({kind:'pp',gx:b.maxx+dx+(i%3)*.12,gy:b.cy-.5+i*.13,skin:skins[i%6],shirt:col||shirts[(i+2)%9],bob:blink(T*2+i,.3,.3)})};
  // crowds only where something is actually on: events at a venue, council in session, open bars after dark
  const crowdAt=(gx,gy,n,col)=>{for(let i=0;i<n;i++)dyn.push({kind:'pp',gx:gx+(i%3)*.12,gy:gy-.5+i*.13,skin:skins[i%6],shirt:col||shirts[(i+2)%9],bob:blink(T*2+i,.3,.3)})};
  for(const k of L.crowds){if(k.evening&&!ev)continue;const b=k.id!=null?byId[k.id]:null;if(b)crowd(b,k.n,.3,k.col);else crowdAt(k.gx,k.gy,k.n,k.col)}
  if(L.council.lit&&byId.city)crowd(byId.city,L.council.inSession?4:2,.4,C.Slate);
  for(const k of L.closures){const[gx,gy,ux,uy]=along(k.ch,k.d);const kind=k.kind==='work'?'cone':'barrel';const n=k.full?3:1;for(let j=-n;j<=n;j++){const o=j*(RW[k.ch.c]/7)/M;dyn.push({kind,gx:gx-uy*o,gy:gy+ux*o})}
    if(k.kind==='crash')dyn.push({kind:'car',gx:gx+ux*.3,gy:gy+uy*.3,ux:uy,uy:-ux,col:C.Brick,stopped:1,haz:1})}
  for(const t of L.trucks){dyn.push({kind:'truck',gx:t.gx,gy:t.gy});for(let i=0;i<5;i++)dyn.push({kind:'pp',gx:t.gx-.35-i*.14,gy:t.gy+.5,skin:skins[(i+2)%6],shirt:shirts[(i+5)%9],f:blink(T+i,.4,.4)})}
  if(!reduce){if(trainD>trainCh.L+14){trainWait-=dt;if(trainWait<=0){trainD=-12;trainWait=12}}else trainD+=dt*2.2}
  for(let k=0;k<7;k++){const d=trainD-k*2.3;if(d<0||d>trainCh.L)continue;const[gx,gy,ux,uy]=along(trainCh,d);if(!vis(gx,gy))continue;dyn.push({kind:'train',gx,gy,ux,uy,eng:k===0})}
  dyn.sort((a,b)=>(a.gx+a.gy)-(b.gx+b.gy));
  const redo=new Set();
  for(const o of dyn){
    if(o.kind==='car'){const r=rect(o.gx,o.gy,o.ux,o.uy,4.4/M,2/M);drawPrism(w,r,0,4,o.col,o.col);const r2=rect(o.gx-o.ux*.3/M,o.gy-o.uy*.3/M,o.ux,o.uy,2.4/M,1.7/M);drawPrism(w,r2,4,2.5,mix(C['Haw River'],SH,.3),mix(o.col,HI,.2));
      if(lamp){ed(P(o.gx+o.ux*2.3/M,o.gy+o.uy*2.3/M,2.5),'#fff4c8',2)}if(o.stopped||lamp){ed(P(o.gx-o.ux*2.3/M,o.gy-o.uy*2.3/M,2.5),o.stopped?'#ff3a2a':'#c84a40',o.stopped?2:1)}if(o.haz&&blink(T,.4,.4)){ed(P(o.gx+o.ux*2.3/M,o.gy+o.uy*2.3/M,3),'#ffb040',2);ed(P(o.gx-o.ux*2.3/M,o.gy-o.uy*2.3/M,3),'#ffb040',2)}}
    else if(o.kind==='pp'){const[x,y]=P(o.gx,o.gy);person(w,x,y-(o.bob?1:0),o.skin,o.shirt,o.f)}
    else if(o.kind==='cone'){const[x,y]=P(o.gx,o.gy);fr(w,Math.round(x),Math.round(y-4),1,1,C['Barrel orange']);fr(w,Math.round(x-1),Math.round(y-3),3,2,C['Barrel orange']);fr(w,Math.round(x-1),Math.round(y-2),3,1,C.Paper);fr(w,Math.round(x-2),Math.round(y-1),5,1,C['Barrel orange'])}
    else if(o.kind==='barrel'){const[x,y]=P(o.gx,o.gy);fr(w,Math.round(x-1),Math.round(y-5),3,5,C['Barrel orange']);fr(w,Math.round(x-1),Math.round(y-3),3,1,C.Paper);if(lamp&&blink(T,.5,.5))ed([x,y-6],'#ffb040')}
    else if(o.kind==='truck'){const r=rect(o.gx,o.gy,1,0,6.5/M,2.6/M);drawPrism(w,r,0,10,C.Paper,C.Tobacco);const wq=[P(o.gx-.15,o.gy+1.3/M,4),P(o.gx+.15,o.gy+1.3/M,4),P(o.gx+.15,o.gy+1.3/M,8),P(o.gx-.15,o.gy+1.3/M,8)];poly(w,wq,mix(C['Haw River'],SH,.3));if(ev)eq(wq,GLOW)}
    else if(o.kind==='train'){const r=rect(o.gx,o.gy,o.ux,o.uy,19/M,3.4/M);drawPrism(w,r,1,12,o.eng?C.Slate:'#c0603c',o.eng?'#33509a':'#8f4228');if(o.eng){const hp=P(o.gx+o.ux*9.6/M,o.gy+o.uy*9.6/M,7);ed(hp,'#fff3c0',2);if(lamp)eg(hp[0],hp[1]+3,24,.45,.6)}}
    for(const b of blockers(o.gx,o.gy,o.kind==='train'?12:5))redo.add(b);
  }
  [...redo].sort((a,b)=>a.key-b.key).forEach(b=>drawBuilding(w,b));
  // live clocks: Lincoln Financial's bulb sign (time, then temperature) and the depot clock
  const tw=byId.tower;if(tw&&tw.lantern){const txt=blink(T,5,3)||reduce||L.tempF==null?fmtTime(D):(Math.round(L.tempF)+'°F');for(const wl of visWalls(tw.lantern))lanternSign(w,wl,tw.lanternZ,txt)}
  // (the depot has no clock face; the tower clock above Lincoln Financial is the town clock)
  for(const t of L.trucks){const[sx,sy]=P(t.gx,t.gy,13);for(let i=0;i<5;i++){const ph=(T*.5+i/5)%1;w.globalAlpha=(1-ph)*.55;w.fillStyle='#f2eee6';w.beginPath();w.arc(sx+ph*10+Math.sin(ph*6+i)*2,sy-ph*26,2+ph*4,0,7);w.fill()}w.globalAlpha=1}
  if(S.wx==='rain'){w.fillStyle='rgba(205,215,235,.55)';const slant=20+Math.min(30,L.windMph)*4,nr=Math.round(rain.length*(L.intensity==='light'?.4:L.intensity==='heavy'?1:.7));rain.forEach((r,i)=>{if(i>=nr)return;if(!reduce){r[0]-=dt*slant;r[1]+=dt*300;if(r[1]>H){r[1]=-4;r[0]=Math.random()*W+40}if(r[0]<0)r[0]+=W}w.fillRect(r[0]|0,r[1]|0,1,4)})}
  if(S.wx==='snow'){w.fillStyle='#ffffff';snow.forEach(s=>{if(!reduce){s[1]+=dt*(14+s[2]*14);s[0]+=Math.sin(T+s[2]*9)*dt*7;if(s[1]>H){s[1]=-2;s[0]=Math.random()*W}}const z=s[2]>.6?2:1;w.fillRect(s[0]|0,s[1]|0,z,z)})}
  if(S.wx==='pollen'){w.fillStyle='#f3e37a';motes.forEach(m=>{if(!reduce){m[0]+=dt*9;m[1]+=Math.sin(T+m[2])*dt*5;if(m[0]>W)m[0]=0}w.fillRect(m[0]|0,m[1]|0,1,1)})}
  if(L.fog){w.fillStyle='rgba(232,234,238,.10)';for(let y=0;y<H;y+=2)for(let x=(y>>1)%2;x<W;x+=2)w.fillRect(x,y,1,1);w.fillStyle='rgba(232,234,238,.18)';w.fillRect(0,0,W,H)}
  // grade (saturation up in daylight for the painted-model look)
  const G=gradeFor(SUN),X=L.cloudy&&S.wx==='clear'?WXG.cloudy:WXG[S.wx];const m=[G.m[0]*X.m[0],G.m[1]*X.m[1],G.m[2]*X.m[2]],a=[G.a[0]+X.a[0],G.a[1]+X.a[1],G.a[2]+X.a[2]],d=Math.min(.6,G.d+X.d);
  const img=w.getImageData(0,0,W,H),px=img.data;
  for(let i=0;i<px.length;i+=4){let r=px[i],gg=px[i+1],b=px[i+2];const l=.3*r+.59*gg+.11*b;r+=(l-r)*d;gg+=(l-gg)*d;b+=(l-b)*d;px[i]=r*m[0]+a[0];px[i+1]=gg*m[1]+a[1];px[i+2]=b*m[2]+a[2]}
  ctx.putImageData(img,0,0);
  if(L.storm){if(flash<=0&&!reduce&&Math.random()<.003)flash=10;if(flash>0){ctx.fillStyle=`rgba(255,255,240,${flash>7?.5:flash/30})`;ctx.fillRect(0,0,W,H);flash--}}
  ctx.drawImage(Ec,0,0);ctx.globalCompositeOperation='lighter';ctx.drawImage(Gc,0,0);ctx.globalCompositeOperation='source-over';
  // tilt-shift: blur the top and bottom bands so it reads as a small model
  if('filter' in tc){tc.clearRect(0,0,W,H);tc.filter='blur(1.6px)';const b1=Math.ceil(H*.3)+4,b2=Math.floor(H*.68)-4;tc.drawImage(cv,0,0,W,b1,0,0,W,b1);tc.drawImage(cv,0,b2,W,H-b2,0,b2,W,H-b2);tc.filter='none';tc.globalCompositeOperation='destination-in';const gr=tc.createLinearGradient(0,0,0,H);gr.addColorStop(0,'rgba(0,0,0,1)');gr.addColorStop(.3,'rgba(0,0,0,0)');gr.addColorStop(.68,'rgba(0,0,0,0)');gr.addColorStop(1,'rgba(0,0,0,1)');tc.fillStyle=gr;tc.fillRect(0,0,W,H);tc.globalCompositeOperation='source-over';ctx.drawImage(Tc,0,0)}
  const vg=ctx.createRadialGradient(W/2,H/2,H*.45,W/2,H/2,W*.62);vg.addColorStop(0,'rgba(20,10,30,0)');vg.addColorStop(1,'rgba(20,10,30,.22)');ctx.fillStyle=vg;ctx.fillRect(0,0,W,H);
  ctx.font='8px Silkscreen, monospace';ctx.textBaseline='top';
  const tag=(x,y,t)=>{x=Math.round(x);y=Math.round(y);const tw_=Math.ceil(ctx.measureText(t).width)+8;const bx=Math.max(2,Math.min(W-tw_-2,x-(tw_>>1)));if(y<2||y>H-14||x<4||x>W-4)return;ctx.fillStyle=SH;ctx.fillRect(bx+1,y-1,tw_-2,13);ctx.fillRect(bx,y,tw_,11);ctx.fillStyle=C.Paper;ctx.fillRect(bx+1,y,tw_-2,11);ctx.fillStyle=SH;ctx.fillRect(x-1,y+12,3,2);ctx.fillText(t,bx+4,y+2)};
  const top=b=>P(b.cx,b.cy,(b.htop||b.hpx)+(b.special==='tower'?10:8));
  const bub=[];const nb=L.bubbles.length;
  if(nb){const slot=Math.floor(T/7);for(let k=0;k<Math.min(2,nb);k++){const o=L.bubbles[(slot*2+k)%nb];if(!blink(T+k*3.5,6,1))continue;const b=o.id!=null?byId[o.id]:null;bub.push([b?top(b):P(o.gx,o.gy,24),o.text])}}
  if(S.labels){for(const[k,t]of LABELS){const b=byId[k];if(!b)continue;const[x,y]=top(b);tag(x,y-10,t)}}
  else bub.forEach(([[x,y],t])=>tag(x,y-10,t));
  if(hoverB&&hoverB.name&&!hoverB.sign){const[x,y]=top(hoverB);tag(x,y-10,hoverB.name)}
  // signposts at the edge of the model, pointing to the rest of town
  signRects=[];
  for(const g of L.signs){const[px,py]=P(g.gx,g.gy);if(px<-80||px>W+80||py<-10||py>H+40)continue;const x=Math.round(px),y=Math.round(py);
    ctx.fillStyle='rgba(44,33,71,.35)';ctx.fillRect(x-2,y,6,2);ctx.fillStyle='#6a4a30';ctx.fillRect(x,y-22,2,22);
    const t=g.n?`${g.name} ${g.n}`:g.name,tw_=Math.ceil(ctx.measureText(t).width)+8,right=g.sx>=0,bx=right?x-2:x+4-tw_,by=y-34,hot=hoverB&&hoverB.sign===g.id;
    ctx.fillStyle=SH;ctx.fillRect(bx-1,by-1,tw_+2,13);ctx.fillStyle=hot?'#fff7e0':C.Paper;ctx.fillRect(bx,by,tw_,11);
    for(let k=0;k<6;k++){const ax=right?bx+tw_+1+k:bx-2-k;ctx.fillStyle=SH;ctx.fillRect(ax,by+k,1,11-2*k);if(k<5){ctx.fillStyle=hot?'#fff7e0':C.Paper;ctx.fillRect(ax+(right?-1:1)*0,by+k+1,1,Math.max(0,9-2*k))}}
    ctx.fillStyle=g.n?'#8a3b2b':SH;ctx.fillText(t,bx+4,by+2);signRects.push({id:g.id,name:g.name,x:Math.min(bx,bx-7),y:by,w:tw_+8,h:22+12})}
  if(!reduce||!frame.once){frame.once=true;requestAnimationFrame(frame)}
}

let pending=0;const restatic=()=>{clearTimeout(pending);pending=setTimeout(()=>{renderStatic();if(reduce)requestAnimationFrame(frame)},10)};
// Live scene from app.js. Static layers are redrawn only when something that is painted into them changes.
function update(scene){
  const prevKey=JSON.stringify([L.wx,L.cloudy,[...L.lit],[...L.strings],L.council.lit]);
  L={...L,...scene};
  S.wx=L.wx==='storm'?'rain':L.wx;L.storm=L.wx==='storm';
  // closures snap to the nearest street the cars drive on
  L.closures=(scene.roads||[]).map(r=>{let best=null;for(const ch of chains){for(let i=1;i<ch.p.length;i++){const[a0,a1]=ch.p[i-1],[b0,b1]=ch.p[i];const dx=b0-a0,dy=b1-a1,L2=dx*dx+dy*dy;const t=L2?Math.max(0,Math.min(1,((r.gx-a0)*dx+(r.gy-a1)*dy)/L2)):0;const d=Math.hypot(a0+dx*t-r.gx,a1+dy*t-r.gy);if(!best||d<best.dist)best={ch,dist:d,d:ch.cum[i-1]+Math.sqrt(L2)*t}}}return best&&best.dist<4?{...r,ch:best.ch,d:best.d}:null}).filter(Boolean);
  focus=[...(scene.focus||[]).map(id=>byId[id]).filter(Boolean),...LANDMARKS];
  if(scene.signs)L.signs=placeSigns(scene.signs);
  const key=JSON.stringify([L.wx,L.cloudy,[...L.lit],[...L.strings],L.council.lit]);
  if(key!==prevKey){L.version++;if(started)restatic()}
}
// Each area's signpost goes where a line from the middle of the model toward that area leaves the model,
// a little inside the base, nudged off buildings and away from the other signs.
function placeSigns(list){const G=MAP.GEO;const cx=GX/2,cy=GY/2,out=[];
  const inB=(x,y)=>blds.some(b=>x>=b.minx-.4&&x<=b.maxx+.4&&y>=b.miny-.4&&y<=b.maxy+.4&&pip(x,y,b.pts));
  for(const s of list){const tx=(s.lon-G.west)*G.mPerDegLon/M,ty=(G.north-s.lat)*G.mPerDegLat/M;let dx=tx-cx,dy=ty-cy;const Ln=Math.hypot(dx,dy)||1;dx/=Ln;dy/=Ln;
    const pad=2.5;let t=Infinity;if(dx)t=Math.min(t,((dx>0?GX-pad:pad)-cx)/dx);if(dy)t=Math.min(t,((dy>0?GY-pad:pad)-cy)/dy);
    let gx=cx+dx*t,gy=cy+dy*t;for(let k=0;k<20&&inB(gx,gy);k++){gx-=dx*.6;gy-=dy*.6}
    for(let k=0;k<12&&out.some(o=>Math.hypot(o.gx-gx,o.gy-gy)<5);k++){gx+=-dy*1.5;gy+=dx*1.5;gx=Math.max(pad,Math.min(GX-pad,gx));gy=Math.max(pad,Math.min(GY-pad,gy))}
    out.push({...s,gx,gy,sx:dx-dy})}return out}
/** Building by OSM id (or landmark key), with its name and centre, for the paper. */
const building=id=>byId[id]||null;
/** Building whose footprint holds a grid point, or the nearest one within a tile or two. */
function buildingAt(gx,gy,maxDist=2.2){let best=null,bd=maxDist;for(const b of blds){if(gx<b.minx-bd||gx>b.maxx+bd||gy<b.miny-bd||gy>b.maxy+bd)continue;if(pip(gx,gy,b.pts))return b;let d=Infinity;for(let k=0;k<b.pts.length;k++){const[a0,a1]=b.pts[k],[q0,q1]=b.pts[(k+1)%b.pts.length];const dx=q0-a0,dy=q1-a1,L2=dx*dx+dy*dy;const t=L2?Math.max(0,Math.min(1,((gx-a0)*dx+(gy-a1)*dy)/L2)):0;d=Math.min(d,Math.hypot(a0+dx*t-gx,a1+dy*t-gy))}if(d<bd){bd=d;best=b}}return best}
/** Glide the camera to a building and hold it there for a while. */
function lookAt(b){if(!b)return;[tgtX,tgtY]=camFor(b);tgtX=clampX(tgtX);tgtY=clampY(tgtY);lastUser=performance.now()-25000+20000;if(reduce){camX=tgtX;camY=tgtY;requestAnimationFrame(frame)}else glide=true}
let started=false,glide=false;
// first paint: a loading card, then build the model
ctx.fillStyle='#3a2c26';ctx.fillRect(0,0,W,H);ctx.fillStyle='#fff3d6';ctx.font='10px Silkscreen, monospace';ctx.textAlign='center';ctx.fillText('building the model of downtown…',W/2,H/2);ctx.textAlign='start';
setTimeout(()=>{renderStatic();started=true;(document.fonts?document.fonts.ready:Promise.resolve()).then(()=>requestAnimationFrame(frame))},30);
return{update,building,buildingAt,lookAt,sunTimes,fmtTime,ampm,setLabels:v=>{S.labels=!!v;if(reduce)requestAnimationFrame(frame)}};
}

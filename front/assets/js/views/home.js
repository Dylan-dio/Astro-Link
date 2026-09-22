/* ==========================================================================
   Horizon Health OS — views/home.js
   Écran d'accueil de la console holographique :
     - Santé : hologramme du corps de l'astronaute suivi + constantes
     - Bio-Badge : posture, LED, signal, contamination
     - État de l'équipage : bandeau d'indicateurs globaux
     - Statut de l'astronaute : dossier résumé + courbe du rythme cardiaque
     - Priorités médicales : triage de l'équipage
     - Notifications : alertes du serveur et de l'IA
   Aucune donnée en dur : tout provient du store (serveur central).
   ========================================================================== */
window.HHO = window.HHO || {};
HHO.views = HHO.views || {};

HHO.views.home = (function () {
  "use strict";
  const U = HHO.util, S = HHO.store, C = HHO.charts, UI = HHO.ui;
  const KEY = "hho.focus";
  const dismissed = new Set();
  let focus = null;
  let holo3d = null;       // instance de l'hologramme 3D (null = repli vectoriel)

  /* Icônes au trait (SVG maison) */
  const I = {
    gauge: '<svg viewBox="0 0 24 24"><path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4-5"/><circle cx="12" cy="16" r="1.4"/></svg>',
    ecg: '<svg viewBox="0 0 24 24"><path d="M3 12h4l2-4 3 9 2-5h7"/></svg>',
    temp: '<svg viewBox="0 0 24 24"><path d="M10 4a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z"/><path d="M12 9v7"/></svg>',
    crew: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3 19c.8-3 3.2-5 6-5s5.2 2 6 5"/><circle cx="17" cy="9" r="2.3"/><path d="M16 14c2.4 0 4.3 1.6 5 4"/></svg>',
    bio: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.4"/><path d="M12 3.5a4 4 0 0 1 2.2 7.3M12 3.5a4 4 0 0 0-2.2 7.3M4.6 16.3a4 4 0 0 1 5.2-5M4.6 16.3a4 4 0 0 0 6.2 2.4M19.4 16.3a4 4 0 0 0-5.2-5M19.4 16.3a4 4 0 0 1-6.2 2.4"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M5 12a7 7 0 0 1 14 0"/><path d="M8 12a4 4 0 0 1 8 0"/><circle cx="12" cy="13" r="1.5"/><path d="M12 15v5"/></svg>',
    posture: '<svg viewBox="0 0 24 24"><circle cx="12" cy="4.5" r="2"/><path d="M12 7v7M8 10h8M12 14l-3 6M12 14l3 6"/></svg>',
    led: '<svg viewBox="0 0 24 24"><circle cx="12" cy="10" r="5"/><path d="M10 15v5M14 15v5"/></svg>',
    signal: '<svg viewBox="0 0 24 24"><path d="M4 20v-3M9 20v-7M14 20V9M19 20V4"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8v.5"/></svg>',
    warn: '<svg viewBox="0 0 24 24"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>'
  };

  function active() { return HHO.nav.current() === "home"; }
  function crewArr() { return Array.from(S.state.crew.values()); }
  function member() { return focus ? S.state.crew.get(focus) : null; }

  const renderAll = U.throttle(function () {
    updateDock();
    if (!active()) return;
    health(); badge(); env(); status(); prio(); notif();
  }, 400);

  function init() {
    try { focus = localStorage.getItem(KEY) || null; } catch (e) { focus = null; }

    ["crew", "telemetry", "checkins", "alerts", "crisis", "conn", "resize"].forEach(function (e) { S.on(e, renderAll); });
    S.on("crew", focusOptions);

    U.$("#focusWho").addEventListener("change", function (e) { setFocus(e.target.value || null); });
    U.$("#hOpenFile").addEventListener("click", function () { if (focus) HHO.nav.go("crew", focus); });
    U.$("#hPrio").addEventListener("click", function (e) {
      const b = e.target.closest("[data-focus]");
      if (b) setFocus(b.dataset.focus);
    });
    U.$("#hNotif").addEventListener("click", function (e) {
      const b = e.target.closest("[data-dismiss]");
      if (b) { dismissed.add(b.dataset.dismiss); renderAll(); }
    });

    HHO.nav.register("home", function () { focusOptions(); renderAll(); load(); });
    setInterval(function () { if (active()) renderAll(); }, 5000);
    focusOptions();
  }

  /* ---------------- Astronaute suivi ---------------- */
  function focusOptions() {
    const sel = U.$("#focusWho");
    const crew = crewArr();
    sel.innerHTML = crew.length
      ? crew.map(function (m) { return '<option value="' + U.esc(m.id) + '"' + (m.id === focus ? " selected" : "") + ">" + U.esc(m.name || m.id) + "</option>"; }).join("")
      : '<option value="">Aucun astronaute</option>';
    sel.disabled = !crew.length;
    ensureFocus();
  }

  function ensureFocus() {
    if (focus && S.state.crew.has(focus)) return;
    const crew = crewArr();
    if (!crew.length) return;
    const pick = crew.find(function (m) { return m.isRealBadge; }) || crew[0];
    setFocus(pick.id);
  }

  function setFocus(id) {
    focus = id ? String(id) : null;
    try { if (focus) localStorage.setItem(KEY, focus); else localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    focusOptions();
    renderAll();
    load();
  }

  async function load() {
    const id = focus;
    if (!id) return;
    const r = await Promise.allSettled([HHO.api.getTelemetry(id), HHO.api.getCheckins(id)]);
    if (id !== focus) return;
    if (r[0].status === "fulfilled") S.setTelemetryHistory(id, U.asArray(r[0].value, "points"));
    if (r[1].status === "fulfilled") S.setCheckins(id, U.asArray(r[1].value, "checkins"));
  }

  /* ---------------- Santé : hologramme mannequin anatomique ---------------- */
  // Corps en pose en T défini par son demi-contour (symétrie pour l'autre côté).
  // Maillage 3D calculé depuis la silhouette, musculature modelée par dégradés
  // (volumes clairs) et sillons sombres, visage, squelette en filigrane.
  const f = function (v) { return (+v).toFixed(1); };
const CX = 200;

/* ---------- Silhouette (demi-contour droit, pose en T) ---------- */
const RIGHT = [
  [212,64],[213,74],[215,80],[221,84],[234,86],[248,88],[258,88],
  [266,86],[276,85],[286,86],[298,88],[310,90],[322,91.5],[334,92.5],[346,92],
  [358,91],[370,91.5],[380,93.5],[388,93],[395,94],[400,96.5],[403,100],[403.5,105],[402,110],[399,114],
  [393,116.5],[386,117],[380,116],[370,118],[358,121],[346,124],[336,127],[326,128.5],
  [314,130],[302,131.5],[290,131.5],[278,129.5],[266,126],[254,123],[248,125],
  [246,136],[244,150],[240,162],[235,174],[231.5,186],[230,196],
  [232,206],[237,216],[242,228],[245,240],
  [245,252],[243.5,264],[241,280],[238,298],[234,314],[229.5,328],
  [227,338],[227,348],
  [230,360],[233.5,372],[232.5,386],[228,400],[223.5,414],[220,426],
  [218,434],[219,441],
  [223,446],[229,450],[233,454],[229,457.5],[218,458.5],[209,457.5],[205,452],
  [204,442],[205,432],
  [206,420],[208,406],[210,392],[212,378],[212,364],[211,350],
  [210,340],[211,330],
  [210,316],[209,300],[208,286],[206,274],[203,266],[200,262]
];
const HEAD_R = [[200,6],[210,7],[218,11],[224,19],[227,29],[227.5,38],[226,46],[223,54],[218,61],[212,66],[205,69.5],[200,70]];

function segs(pts,closed){const n=pts.length,out=[],last=closed?n:n-1;
  for(let i=0;i<last;i++){const p0=pts[(i-1+n)%n],p1=pts[i],p2=pts[(i+1)%n],p3=pts[(i+2)%n];
    out.push([p1,[p1[0]+(p2[0]-p0[0])/6,p1[1]+(p2[1]-p0[1])/6],[p2[0]-(p3[0]-p1[0])/6,p2[1]-(p3[1]-p1[1])/6],p2]);}
  return out;}
function pathD(pts,closed){const s=segs(pts,closed);let d="M"+f(s[0][0][0])+" "+f(s[0][0][1]);
  s.forEach(c=>{d+="C"+f(c[1][0])+" "+f(c[1][1])+" "+f(c[2][0])+" "+f(c[2][1])+" "+f(c[3][0])+" "+f(c[3][1]);});return d+(closed?"Z":"");}
function sample(pts,k){const out=[];segs(pts,true).forEach(c=>{for(let j=0;j<k;j++){const t=j/k,u=1-t;
  out.push([u*u*u*c[0][0]+3*u*u*t*c[1][0]+3*u*t*t*c[2][0]+t*t*t*c[3][0],u*u*u*c[0][1]+3*u*u*t*c[1][1]+3*u*t*t*c[2][1]+t*t*t*c[3][1]]);}});return out;}
const mirrorPts=r=>r.concat(r.slice(0,-1).reverse().map(p=>[2*CX-p[0],p[1]]));
const BODY=mirrorPts(RIGHT), HEAD=HEAD_R.concat(HEAD_R.slice(1,-1).reverse().map(p=>[2*CX-p[0],p[1]]));

function cross(poly,v,axis){const a1=axis?0:1,a0=axis?1:0,xs=[];
  for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];
    if((a[a1]<=v&&b[a1]>v)||(b[a1]<=v&&a[a1]>v))xs.push(a[a0]+(v-a[a1])/(b[a1]-a[a1])*(b[a0]-a[a0]));}
  return xs.sort((p,q)=>p-q);}
function mesh(polys,from,to,step,axis,keep){let rings="",tracks=[],done=[];
  const P=(u,v)=>axis?f(v)+" "+f(u):f(u)+" "+f(v);
  for(let v=from;v<=to;v+=step){const pairs=[];
    polys.forEach(poly=>{const xs=cross(poly,v,axis);for(let i=0;i+1<xs.length;i+=2){let a=xs[i],b=xs[i+1];const k=keep(v,a,b);if(!k)continue;a=k[0];b=k[1];
      if(b-a>2)pairs.push({a,b,w:b-a,c:(a+b)/2});}});
    const next=[];pairs.forEach(p=>{const s=p.w*0.11*(axis?-1:1);
      rings+='<path d="M'+P(p.a,v)+"Q"+P(p.c,v+2*s)+" "+P(p.b,v)+'"/>';
      let best=null,bd=1e9;tracks.forEach(t=>{const d=Math.abs(t.c-p.c);if(!t.used&&d<bd&&d<Math.max(8,p.w*.5)){bd=d;best=t;}});
      const pt={v,...p,s};if(best){best.used=true;best.pts.push(pt);best.c=p.c;next.push(best);}else next.push({c:p.c,pts:[pt],used:true});});
    tracks.forEach(t=>{if(!t.used)done.push(t);});tracks=next;tracks.forEach(t=>t.used=false);}
  let mer="";done.concat(tracks).forEach(t=>{if(t.pts.length<3)return;
    [.2,.4,.6,.8].forEach(fr=>{mer+='<path d="'+t.pts.map((p,i)=>(i?"L":"M")+P(p.a+fr*p.w,p.v+4*p.s*fr*(1-fr))).join("")+'"/>';});});
  return rings+mer;}

/* ---------- Musculature : volumes (dégradé) + sillons (traits sombres) ---------- */
const MU = (d) => '<path class="mu" d="'+d+'"/>';          // volume clair
const GR = (d) => '<path class="gr" d="'+d+'"/>';          // sillon sombre
const SH = (d) => '<path class="sh" d="'+d+'"/>';          // ombre (creux)
const mir = (html) => html + '<g transform="translate(400 0) scale(-1 1)">' + html + '</g>';

function muscles(){
  let h="";
  // Cou
  h+=MU("M203 72C209 72 213 78 213 86C210 90 205 92 203 92Z");
  h+=GR("M212 68C210 76 207 84 204 92");                                   // sterno-cléido-mastoïdien
  h+=SH("M200 66C208 68 214 74 214 84C208 80 203 76 200 74Z");            // ombre sous le menton
  // Trapèze
  h+=MU("M206 78C218 78 236 84 254 91C246 97 232 99 214 97Z");
  h+=GR("M212 78C228 82 244 87 256 92");
  // Deltoïde
  h+=MU("M244 90C254 83 272 82 284 90C287 108 280 126 264 127C250 124 242 106 244 90Z");
  h+=GR("M246 120C254 128 266 130 278 127");
  h+=SH("M248 124C254 132 264 134 276 132C268 136 254 136 248 130Z");     // aisselle
  // Pectoral
  h+=MU("M202 94C218 92 238 96 250 108C252 123 244 138 230 140C216 142 205 136 202 124Z");
  h+=GR("M203 140C216 142 232 142 248 132");
  h+=GR("M202 94C216 93 236 97 250 108");
  h+='<circle class="gr" cx="232" cy="129" r="1.1"/>';                    // mamelon
  // Bras : biceps / brachial / avant-bras
  h+=MU("M268 96C284 92 304 93 322 100C322 118 308 130 290 130C274 128 266 116 268 96Z");
  h+=GR("M270 120C286 130 306 130 324 120");
  h+=GR("M320 96C328 106 328 120 320 128");                               // pli du coude
  h+=MU("M330 96C344 92 362 94 378 100C376 112 360 120 344 120C334 118 328 108 330 96Z");
  h+=GR("M332 120C348 126 364 122 380 114");
  h+=GR("M374 96C380 104 382 110 380 116M368 95C374 104 376 110 374 116");// tendons du poignet
  // Main
  h+=MU("M384 96C390 93 398 94 402 100C403 108 400 115 392 116C386 114 383 106 384 96Z");
  h+=GR("M391 95.5L399 96.5M392 100.5L401.5 101.5M392 105.5L402 106.5M391 110.5L400 112.5"); // doigts
  h+=GR("M385 110C388 114 392 116 396 116");                                 // pouce
  // Dentelé et obliques
  h+=GR("M238 144L245 140M237 152L244 147M236 160L243 154");
  h+=MU("M229 152C238 160 241 178 239 202C235 216 236 228 244 238C236 234 229 222 229 202C229 182 227 166 229 152Z");
  h+=GR("M231 150C240 166 240 184 237 202");
  // Grand droit (abdominaux)
  h+=GR("M200 96V250");                                                      // ligne blanche
  h+=MU("M202 140H222C224 148 223 156 220 160H202Z");
  h+=MU("M202 164H221C222 172 221 180 218 184H202Z");
  h+=MU("M202 188H219C220 196 218 204 214 208H202Z");
  h+=MU("M202 212H215C214 224 210 238 202 248Z");
  h+=GR("M202 161H221M202 185H219M202 209H215");
  // Aine
  h+=GR("M236 226C226 242 212 256 202 262");
  h+=SH("M238 232C226 244 214 256 204 264C210 258 224 244 236 230Z");
  // Cuisse
  h+=MU("M212 262C224 256 236 262 241 278C241 302 236 320 224 330C214 326 210 300 212 262Z"); // droit fémoral
  h+=MU("M236 256C246 268 246 298 238 322C233 316 235 294 236 256Z");                          // vaste externe
  h+=MU("M209 298C216 304 219 322 215 338C210 336 207 318 209 298Z");                           // vaste interne
  h+=GR("M243 250C234 266 222 288 214 310");                                                    // couturier
  h+=GR("M236 262C240 290 239 314 229 332");
  h+=MU("M203 266C209 270 211 290 210 312C206 306 203 288 203 266Z");                           // adducteurs
  h+=GR("M204 268C210 276 211 298 210 318");
  // Genou
  h+=MU("M214 334C220 329 227 332 228 341C227 350 219 352 214 346Z");
  h+=GR("M212 350C218 356 226 354 229 348");
  // Mollet
  h+=MU("M226 356C234 360 235 382 230 402C224 394 222 372 226 356Z");
  h+=MU("M208 356C214 362 215 388 211 406C206 398 204 372 208 356Z");
  h+=GR("M220 352C222 380 218 410 216 430");                                                    // jambier antérieur
  h+=GR("M226 402C228 412 224 424 220 432M209 406C208 418 208 428 210 436");
  // Cheville et pied
  h+='<ellipse class="gr" cx="218.5" cy="433" rx="2.4" ry="3.2"/><ellipse class="gr" cx="205.5" cy="433" rx="2.2" ry="3"/>';
  h+=MU("M207 442C214 440 224 442 230 448C226 454 216 456 208 454Z");
  h+=GR("M211 456L211 452M216 457L216 452M221 456.5L221 452M226 455L226 451");
  return mir(h);
}

/* ---------- Visage ---------- */
function face(){
  let h="";
  h+='<ellipse class="mu" cx="200" cy="34" rx="24" ry="28"/>';             // rondeur du crâne
  h+=SH("M190 44C194 48 197 50 200 50C203 50 206 48 210 44C207 51 203 53 200 53C197 53 193 51 190 44Z"); // creux sous les pommettes
  let r="";
  r+=GR("M204 29.5C209 26.8 216 27.4 220.5 30.5");                            // sourcil
  r+=SH("M204 31.5C209 30 216 30.5 220 33C217 35 209 35.5 204 34Z");          // orbite
  r+='<path class="eye" d="M205.5 36C208.5 33 214.5 33 217.5 36C214.5 39 208.5 39 205.5 36Z"/>';
  r+='<circle class="iris" cx="211.5" cy="36.2" r="2"/><circle class="pupil" cx="211.5" cy="36.2" r=".9"/><circle class="glint" cx="212.3" cy="35.3" r=".45"/>';
  r+=GR("M205.5 36C208.5 33.2 214.5 33.2 217.5 36");                         // paupière
  r+=GR("M203.5 36C205 41 206 45 205.5 49");                                // arête du nez
  r+=GR("M203.5 50.5C205.5 52.6 208.5 51.6 208.5 49.2C207.5 50.8 205 51.4 203.5 50.5Z"); // narine
  r+=MU("M218 40C222 40 224 46 222 52C220 50 218 46 218 40Z");               // pommette
  r+=GR("M206.5 57.4C204 56.6 202 56.7 200 57");                                 // lèvre sup.
  r+=GR("M206.5 57.6C205 59.8 202.5 60.4 200 60.3");                               // lèvre inf.
  r+=MU("M200 58C202.5 58 204.5 58.4 206.3 57.8C204.5 59.6 202.5 60 200 59.9Z");
  r+=GR("M226 33C230 31 231.5 37 229.5 43.5C228.5 46.5 226 46.5 225 44");    // oreille
  r+=GR("M227 36C229 37 229 41 227.5 43");
  r+=SH("M213 65C216 62 218.5 59 219.5 55.5C218.5 60.5 216.5 64 213 67Z");               // ombre mâchoire
  return h+mir(r)+GR("M200 51.5C201.5 52.2 202.5 52.2 204 51.8")+GR("M193.5 57.5H206.5");
}

/* ---------- Squelette ---------- */
function bone(x1,y1,x2,y2,w){const L=Math.hypot(x2-x1,y2-y1)||1;let nx=(y2-y1)/L*w*.2,ny=-(x2-x1)/L*w*.2;if(ny>0){nx=-nx;ny=-ny;}
  return '<line class="b-shaft" x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" stroke-width="'+w+'"/>'+
    '<line class="b-hi" x1="'+f(x1+nx)+'" y1="'+f(y1+ny)+'" x2="'+f(x2+nx)+'" y2="'+f(y2+ny)+'" stroke-width="'+f(w*.3)+'"/>'+
    '<circle class="b-end" cx="'+x1+'" cy="'+y1+'" r="'+f(w*.75)+'"/><circle class="b-end" cx="'+x2+'" cy="'+y2+'" r="'+f(w*.75)+'"/>';}
function skeleton(){let half="";
  for(let i=0;i<11;i++){const y=94+i*6.4,w=16+Math.sin(Math.PI*(i+1.3)/12.5)*18;
    half+='<path class="b-rib" d="M203 '+f(y)+"C"+f(203+w*.7)+" "+f(y-6)+" "+f(203+w)+" "+f(y+3)+" "+f(203+w-3)+" "+f(y+15)+'"/>';}
  half+='<path class="b-rib" d="M200 88C210 85 228 86 247 92"/>';
  half+='<path class="b-scap" d="M236 98C244 96 248 102 246 114C242 124 234 128 228 126C230 116 232 104 236 98Z"/>';
  half+='<circle class="b-end" cx="250" cy="106" r="5"/>';
  half+='<path class="b-flat" d="M201 216C204 205 221 199 233 206C236 217 231 233 219 241C212 245 206 247 201 247Z"/><ellipse class="b-hole" cx="212" cy="236" rx="4.5" ry="5.5"/>';
  half+=bone(254,108,312,110,5.4);
  half+=bone(318,108,362,106.5,2.9)+bone(318,114,362,112,2.7);
  half+='<circle class="b-end" cx="368" cy="108" r="3.4"/>';
  [[382,102],[386,106],[386,110],[382,113.5]].forEach((p,i)=>{half+=bone(370,105+i*1.3,p[0],p[1],1.5)+bone(p[0]+2,p[1],p[0]+11-i*1.5,p[1]+1.2+i*.3,1.1);});
  half+=bone(371,110,377,116,1.4);
  half+='<circle class="b-end" cx="219" cy="240" r="5.5"/>'+bone(219,242,216,330,6);
  half+='<circle class="b-end" cx="215" cy="337" r="3.8"/>';
  half+=bone(214,345,213,428,4.6)+bone(221,347,220,425,2);
  half+=bone(213,434,217,448,2.6)+bone(209,436,208,450,2)+bone(217,438,223,450,1.8);
  let axial='<path class="b-flat" d="M200 13C211 13 218 21 218 32C218 40 215 45 211 48L209 56C205 59 195 59 191 56L189 48C185 45 182 40 182 32C182 21 189 13 200 13Z"/>';
  axial+='<ellipse class="b-hole" cx="193" cy="34" rx="4.3" ry="3.6"/><ellipse class="b-hole" cx="207" cy="34" rx="4.3" ry="3.6"/><path class="b-hole" d="M200 38L197.5 45H202.5Z"/>';
  axial+='<path class="b-rib" d="M190 55C194 64 206 64 210 55"/><path class="b-hi2" d="M193 52H207"/>';
  for(let y=61;y<240;y+=(y<84?5.2:8.4)){const w=y<84?3.8:(y<200?5:6.5);
    axial+='<rect class="b-vert" x="'+f(200-w/2)+'" y="'+f(y)+'" width="'+f(w)+'" height="'+f(y<84?4:6.4)+'" rx="1.4"/>';
    if(y>=84)axial+='<path class="b-hi2" d="M'+f(200-w/2-3)+" "+f(y+3)+"H"+f(200+w/2+3)+'"/>';}
  axial+='<path class="b-flat" d="M197 94H203V138L200 143L197 138Z"/><path class="b-flat" d="M193.5 222H206.5L200 248Z"/>';
  return axial+half+'<g transform="translate(400 0) scale(-1 1)">'+half+'</g>';}

function buildHuman(){
  const bodyD=pathD(BODY,true),headD=pathD(HEAD,true),bodyLine=pathD(BODY,false);
  const polys=[sample(BODY,10),sample(HEAD,10)];
  const trunk=mesh(polys,9,456,4,0,(v,a,b)=>{a=Math.max(a,150);b=Math.min(b,250);return b>a?[a,b]:null;});
  const arms=mesh([polys[0]],252,402,4,1,(v,a,b)=>(v>=250||v<=150)?[a,b]:null)+mesh([polys[0]],-2,148,4,1,(v,a,b)=>[a,b]);
  return {bodyD,headD,bodyLine,mesh:trunk+arms,skeleton:skeleton(),muscles:muscles(),face:face()};
}

  let BODY_SVG = null;
  function bodySVG() {
    if (BODY_SVG) return BODY_SVG;
    const b = buildHuman();
    const bg = "#03090D";
    BODY_SVG =
      '<svg class="holo-body" viewBox="0 0 400 500" aria-hidden="true">' +
      "<defs>" +
      '<clipPath id="hbClip"><path d="' + b.bodyD + '"/><path d="' + b.headD + '"/></clipPath>' +
      '<linearGradient id="hbRim" x1="0" y1="0" x2="1" y2="0">' +
      '<stop offset="0" stop-color="currentColor" stop-opacity=".5"/><stop offset=".3" stop-color="currentColor" stop-opacity=".12"/>' +
      '<stop offset=".5" stop-color="currentColor" stop-opacity=".07"/><stop offset=".7" stop-color="currentColor" stop-opacity=".12"/>' +
      '<stop offset="1" stop-color="currentColor" stop-opacity=".5"/></linearGradient>' +
      '<radialGradient id="hbMus" cx=".45" cy=".35" r=".65"><stop offset="0" stop-color="currentColor" stop-opacity=".5"/>' +
      '<stop offset=".5" stop-color="currentColor" stop-opacity=".16"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="hbShd" cx=".5" cy=".5" r=".55"><stop offset="0" stop-color="' + bg + '" stop-opacity=".55"/><stop offset="1" stop-color="' + bg + '" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="hbKey" cx="140" cy="120" r="260" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".16"/>' +
      '<stop offset=".45" stop-color="currentColor" stop-opacity=".06"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></radialGradient>' +
      '<pattern id="hbScan" width="4" height="3" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="currentColor" fill-opacity=".12"/></pattern>' +
      '<linearGradient id="hbBand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity="0"/>' +
      '<stop offset=".85" stop-color="currentColor" stop-opacity=".4"/><stop offset="1" stop-color="#fff" stop-opacity=".85"/></linearGradient>' +
      '<linearGradient id="hbBeam" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="currentColor" stop-opacity=".55"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient>' +
      '<radialGradient id="hbPed" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="currentColor" stop-opacity=".35"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></radialGradient>' +
      '<filter id="hbGlow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '<filter id="hbBoneGlow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '<filter id="hbSoft" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation=".7"/></filter>' +
      "</defs>" +
      '<g class="hb-beams" fill="none" stroke="url(#hbBeam)">' +
      '<path d="M130 462L70 60" stroke-width="10" opacity=".25"/><path d="M270 462L330 60" stroke-width="10" opacity=".25"/>' +
      '<path d="M138 462L112 120" stroke-width="2" opacity=".5"/><path d="M262 462L288 120" stroke-width="2" opacity=".5"/></g>' +
      '<g class="hb-volume"><path d="' + b.bodyD + '" fill="url(#hbRim)"/><path d="' + b.headD + '" fill="url(#hbRim)"/></g>' +
      '<g clip-path="url(#hbClip)">' +
      '<rect width="400" height="500" fill="url(#hbScan)"/><rect width="400" height="500" fill="url(#hbKey)"/>' +
      '<g class="hb-mesh" fill="none" stroke="currentColor" stroke-width=".35">' + b.mesh + "</g>" +
      "</g>" +
      '<g class="hb-skeleton" filter="url(#hbBoneGlow)">' + b.skeleton + "</g>" +
      '<g class="hb-anatomy" clip-path="url(#hbClip)"><g filter="url(#hbSoft)">' + b.muscles + '</g><g filter="url(#hbSoft)">' + b.face + "</g>" +
      '<rect class="hb-band" x="0" y="-40" width="400" height="40" fill="url(#hbBand)"/></g>' +
      '<path class="hb-heart" d="M208 132C203.5 128 202 123.5 204.8 121.3C206.5 120 208 120.6 208 122.4C208 120.6 209.5 120 211.2 121.3C214 123.5 212.5 128 208 132Z"/>' +
      '<g class="hb-chroma" fill="none" stroke-width="1.1"><path d="' + b.bodyLine + '" stroke="#FF6A6A" transform="translate(-1 0)"/><path d="' + b.bodyLine + '" stroke="#7A7AFF" transform="translate(1 0)"/>' +
      '<path d="' + b.headD + '" stroke="#FF6A6A" transform="translate(-1 0)"/><path d="' + b.headD + '" stroke="#7A7AFF" transform="translate(1 0)"/></g>' +
      '<g class="hb-outline" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" filter="url(#hbGlow)"><path d="' + b.bodyLine + '"/><path d="' + b.headD + '"/></g>' +
      '<circle class="hb-badge-ring" cx="184" cy="114" r="7"/><circle class="hb-badge" cx="184" cy="114" r="2.8"/>' +
      '<g class="hb-base">' +
      '<ellipse cx="200" cy="462" rx="120" ry="26" fill="url(#hbPed)"/>' +
      '<path class="hb-ped-side" d="M112 462V478A88 13 0 0 0 288 478V462"/>' +
      '<ellipse class="hb-ped-top" cx="200" cy="462" rx="88" ry="13" filter="url(#hbGlow)"/>' +
      '<ellipse class="hb-base-spin" cx="200" cy="462" rx="70" ry="9.5"/>' +
      '<path class="hb-ped-rim" d="M112 478A88 13 0 0 0 288 478" filter="url(#hbGlow)"/>' +
      '<ellipse class="hb-ped-floor" cx="200" cy="490" rx="104" ry="8"/>' +
      "</g></svg>";
    return BODY_SVG;
  }

  function vital(key, icon, label) {
    return '<div class="vital" data-v="' + key + '"><div class="v-ico">' + I[icon] + "</div><b>—</b><span>" + label + "</span></div>";
  }
  function setVital(root, key, value, warn) {
    const d = root.querySelector('[data-v="' + key + '"]');
    if (!d) return;
    d.classList.toggle("warn", !!warn);
    const txt = value == null ? "—" : value;
    const b = d.querySelector("b");
    if (b.textContent !== txt) b.textContent = txt;
  }

  function health() {
    const m = member();
    const el = U.$("#hHealth");
    U.$("#hHealthName").textContent = m ? (m.name || m.id) : "—";
    if (!m) {
      if (holo3d) { holo3d.dispose(); holo3d = null; }
      el.dataset.for = "";
      el.className = "health-body is-empty";
      el.innerHTML = UI.emptyHTML("Aucun astronaute suivi",
        S.state.crew.size ? "Choisissez un astronaute en haut de l'écran." : "Les profils apparaîtront dès que le serveur central les transmettra.");
      return;
    }

    // Construction unique par astronaute : les animations ne redémarrent pas à chaque mesure.
    if (el.dataset.for !== m.id || !el.querySelector(".body-holo")) {
      el.dataset.for = m.id;
      el.className = "health-body";
      if (holo3d) { holo3d.dispose(); holo3d = null; }
      el.innerHTML =
        '<div class="vitals-col">' + vital("hr", "ecg", "Rythme") + vital("temp", "temp", "Température") + vital("stress", "gauge", "Stress") + "</div>" +
        '<div class="body-holo"><div class="holo-3d"></div>' + bodySVG() + '<div class="hb-caption"></div>' +
        '<p class="holo-hint">Faites glisser pour faire pivoter</p></div>' +
        '<div class="seg-wrap"><div class="seg-scale" aria-label="Stress déclaré">' + "<i></i>".repeat(20) + "</div><span>Stress</span></div>";
    }

    const holoBox = el.querySelector(".body-holo");
    if (!holo3d && holoBox && !holoBox.dataset.tried) {
      holoBox.dataset.tried = "1";
      holo3d = HHO.holo3d ? HHO.holo3d.create(holoBox.querySelector(".holo-3d")) : null;
      holoBox.classList.toggle("is-3d", !!holo3d);           // sinon : hologramme vectoriel
    }

    const t = S.state.telemetry.get(m.id);
    const v = t ? t.latest : null;
    const lvl = S.levelOf(m.id);
    const thr = HHO.config.get().ANXIETY_THRESHOLD;
    const ck = S.lastCheckin(m.id);
    const stress = ck ? U.num(ck.stress) : null;
    const hr = U.num(v && v.heartRate), temp = U.num(v && v.temperature);
    if (holo3d) holo3d.setState({ level: lvl || "n", bpm: hr, fever: temp != null && temp >= 38, signal: !!v });

    setVital(el, "hr", hr == null ? null : Math.round(hr) + " bpm", hr != null && (hr > 110 || hr < 45));
    setVital(el, "temp", temp == null ? null : temp.toFixed(1) + " °C", temp != null && temp >= 38);
    setVital(el, "stress", stress == null ? null : Math.round(stress) + " %", stress != null && stress >= thr);

    const holo = el.querySelector(".body-holo");
    holo.className = "body-holo lvl-" + (lvl || "n") + (v ? "" : " no-signal") + (temp != null && temp >= 38 ? " fever" : "") + (holo3d ? " is-3d" : "");
    // Le cœur bat au rythme cardiaque mesuré
    holo.querySelector(".hb-heart").style.animationDuration = hr ? (60 / U.clamp(hr, 30, 200)).toFixed(2) + "s" : "1s";

    const cap = holo.querySelector(".hb-caption");
    const capHTML = v ? UI.levelPill(lvl) : '<span class="faint">Badge non détecté</span>';
    if (cap.innerHTML !== capHTML) cap.innerHTML = capHTML;

    const on = stress == null ? 0 : Math.round(U.clamp(stress, 0, 100) / 100 * 20);
    el.querySelectorAll(".seg-scale i").forEach(function (seg, i) {
      seg.className = i < on ? "on" + (stress >= thr ? " warn" : "") : "";
    });
  }

  /* ---------------- Bio-Badge ---------------- */
  function cell(icon, valueHTML, label) {
    return '<div class="bcell"><span class="ico">' + I[icon] + "</span><div><b>" + valueHTML + "</b><span>" + label + "</span></div></div>";
  }

  function badge() {
    const m = member();
    const el = U.$("#hBadge");
    U.$("#hBadgeId").textContent = m && m.badgeId ? m.badgeId : "—";
    if (!m) { el.innerHTML = UI.emptyHTML("Aucun badge", "Sélectionnez un astronaute."); return; }
    const t = S.state.telemetry.get(m.id);
    const v = t ? t.latest : null;
    const lvl = S.levelOf(m.id);
    const tilt = U.tiltOf(v);
    const ledName = { g: "Verte", o: "Orange", r: "Rouge" }[lvl] || "Éteinte";
    const ledCls = { g: "ok-text", o: "warn-text", r: "bad-text" }[lvl] || "faint";
    el.innerHTML = '<div class="badge-cells">' +
      cell("posture", tilt ? (tilt === "repos" ? "Repos" : "Actif") : "—", "Posture") +
      cell("led", '<span class="' + ledCls + '">' + ledName + "</span>", "LED du badge") +
      cell("signal", '<span class="' + (S.isOnline(m.id) ? "ok-text" : "") + '">' + (v ? U.fmtAgo(v.ts) : "Aucun") + "</span>", "Signal") +
      cell("shield", m.contaminated ? '<span class="bad-text">Contaminé</span>' : "Non", "Contamination") +
      "</div>" +
      (t && t.history.length ? '<p class="field-hint bc-ratio-lbl">Ratio repos / activité</p>' + UI.ratioHTML(t.history) : "");
  }

  /* ---------------- État de l'équipage ---------------- */
  function envCell(icon, label, value, cls) {
    return '<div class="env-cell"><span class="env-lbl">' + label + '</span><span class="ico">' + I[icon] + '</span><b class="' + (cls || "") + '">' + U.esc(value) + "</b></div>";
  }

  function env() {
    const crew = crewArr();
    const cfg = HHO.config.get();
    const online = crew.filter(function (m) { return S.isOnline(m.id); }).length;
    const rate = S.contaminationRate();
    const day = S.state.alerts.filter(function (a) { return Date.now() - a.ts < 864e5; }).length;
    const stresses = crew.map(function (m) {
      const ck = S.lastCheckin(m.id);
      return ck ? U.num(ck.stress) : null;
    }).filter(function (v) { return v != null; });
    const avg = stresses.length ? Math.round(stresses.reduce(function (a, b) { return a + b; }, 0) / stresses.length) : null;
    const ws = S.state.conn.ws;

    U.$("#hEnv").innerHTML =
      envCell("crew", "Équipage", crew.length ? online + " / " + crew.length : "—") +
      envCell("bio", "Contamination", rate == null ? "—" : Math.round(rate * 100) + " %",
        rate != null && rate >= cfg.CONTAMINATION_THRESHOLD ? "bad" : (rate > 0 ? "warn" : "")) +
      envCell("bell", "Alertes 24 h", S.state.conn.api === "online" || day ? String(day) : "—", day ? "warn" : "") +
      envCell("gauge", "Stress moy.", avg == null ? "—" : avg + " %", avg != null && avg >= cfg.ANXIETY_THRESHOLD ? "warn" : "") +
      envCell("link", "Liaison", ws === "online" ? "Active" : (ws === "connecting" ? "Connexion" : "Coupée"), ws === "online" ? "ok" : "bad");
  }

  /* ---------------- Statut de l'astronaute ---------------- */
  function status() {
    const m = member();
    const list = U.$("#hStatusList"), chart = U.$("#hStatusChart"), rings = U.$("#hMiniRings");
    U.$("#hOpenFile").disabled = !m;
    if (!m) {
      U.$("#hStatusTag").textContent = "—";
      list.innerHTML = "";
      rings.innerHTML = "";
      chart.innerHTML = UI.emptyHTML("Aucun astronaute suivi", "");
      return;
    }
    const lvl = S.levelOf(m.id);
    const ck = S.lastCheckin(m.id);
    const t = S.state.telemetry.get(m.id);
    U.$("#hStatusTag").textContent = m.badgeId || "";

    const allergies = Array.isArray(m.allergies) ? (m.allergies.length ? m.allergies.join(", ") : "Aucune") : m.allergies;
    const rows = [
      ["Astronaute", m.name],
      ["Rôle", m.role],
      ["Groupe sanguin", m.bloodType],
      ["Allergies", allergies],
      ["Dernier check-in", ck ? U.fmtAgo(ck.ts) : null]
    ];
    list.innerHTML = rows.map(function (r) {
      const empty = r[1] == null || r[1] === "";
      return "<div><dt>" + r[0] + '</dt><dd class="' + (empty ? "na" : "") + '">' + U.esc(empty ? "Non renseigné" : r[1]) + "</dd></div>";
    }).join("") + '<div><dt>État</dt><dd class="lvl-' + (lvl || "n") + '">' + U.esc(U.levelInfo(lvl).label) + "</dd></div>";

    C.line(chart, [{
      name: "Rythme cardiaque",
      color: lvl === "r" ? "#FF4D5A" : (lvl === "o" ? "#F2B34B" : "#5EE7F2"),
      points: (t ? t.history : []).map(function (p) { return { ts: p.ts, value: p.heartRate }; })
    }], {
      height: 210, min: 40, max: 160,
      threshold: { value: 110, label: "Tachycardie" },
      emptyTitle: "Aucune mesure du rythme cardiaque",
      emptyHint: "La courbe apparaîtra dès les premières données du Bio-Badge.",
      ariaLabel: "Rythme cardiaque de l'astronaute suivi"
    });

    const defs = [["humeur", "Humeur"], ["sommeil", "Sommeil"], ["energie", "Énergie"]];
    rings.innerHTML = defs.map(function (d) { return '<div id="hr-' + d[0] + '"></div>'; }).join("");
    defs.forEach(function (d) {
      let v = null;
      if (ck) {
        if (d[0] === "energie") { const f = U.num(ck.fatigue); v = f == null ? null : 100 - f; }
        else v = U.num(ck[d[0]]);
      }
      C.ring(U.$("#hr-" + d[0]), v, { size: 60, stroke: 5, unit: "%", label: d[1], color: v != null && v < 40 ? "var(--orange)" : null });
    });
  }

  /* ---------------- Priorités médicales ---------------- */
  function prio() {
    const crew = crewArr();
    const el = U.$("#hPrio");
    if (!crew.length) { el.innerHTML = UI.emptyHTML("Aucune priorité", "Le triage démarrera à la réception des profils."); return; }
    const thr = HHO.config.get().ANXIETY_THRESHOLD;
    const rank = function (m) { const l = S.levelOf(m.id); return m.contaminated ? 1 : (l === "o" ? 2 : (l === "g" ? 3 : 4)); };
    const rows = crew.slice().sort(function (a, b) { return rank(a) - rank(b); });

    el.innerHTML = '<ul class="prio-list">' + rows.map(function (m) {
      const r = rank(m);
      const t = S.state.telemetry.get(m.id);
      const v = t ? t.latest : null;
      const ck = S.lastCheckin(m.id);
      const subs = [];
      if (m.contaminated) subs.push("Isolement et suivi de la température");
      if (v && U.num(v.heartRate) != null && v.heartRate >= 110) subs.push("Rythme cardiaque élevé : " + Math.round(v.heartRate) + " bpm");
      if (ck && U.num(ck.stress) != null && ck.stress >= thr) subs.push("Stress déclaré : " + Math.round(ck.stress) + " %");
      if (v && U.num(v.temperature) != null && v.temperature >= 38) subs.push("Température : " + v.temperature + " °C");
      if (!v) subs.push("Aucun signal du Bio-Badge");
      if (!subs.length) subs.push("Constantes nominales");
      return '<li class="prio-item p' + r + (m.id === focus ? " active" : "") + '"><button data-focus="' + U.esc(m.id) + '">' +
        '<span class="p-dot"></span><span class="p-txt"><b>' + U.esc(m.name || m.id) + "</b>" +
        subs.map(function (s) { return '<span class="p-sub">' + U.esc(s) + "</span>"; }).join("") +
        "</span></button></li>";
    }).join("") + "</ul>";
  }

  /* ---------------- Notifications ---------------- */
  function notif() {
    const el = U.$("#hNotif");
    const list = S.state.alerts.filter(function (a) { return !dismissed.has(String(a.id)); }).slice(0, 8);
    U.$("#hNotifCount").textContent = list.length ? list.length + (list.length > 1 ? " actives" : " active") : "Aucune";
    if (!list.length) { el.innerHTML = UI.emptyHTML("Aucune notification", "Les alertes du serveur et de l'IA apparaîtront ici."); return; }
    el.innerHTML = '<div class="notif-list">' + list.map(function (a) {
      const lvl = String(a.level || "info").toLowerCase();
      return '<div class="notif n-' + U.esc(lvl) + '"><span class="ico">' + (lvl === "info" ? I.info : I.warn) + "</span>" +
        '<div class="n-txt"><b>' + U.esc(a.message || "Alerte") + "</b><span><span>" + U.esc(a.crewId != null ? S.memberName(a.crewId) : "Système") +
        "</span><span>" + U.fmtAgo(a.ts) + "</span></span></div>" +
        '<button class="n-close" data-dismiss="' + U.esc(String(a.id)) + '" aria-label="Masquer la notification">' + I.close + "</button></div>";
    }).join("") + "</div>";
  }

  /* ---------------- Pastilles du dock ---------------- */
  function badgeNum(sel, n) {
    const b = U.$(sel);
    if (!b) return;
    b.hidden = !n;
    b.textContent = n > 9 ? "9+" : String(n);
  }
  function updateDock() {
    badgeNum("#dockBadgeHome", S.state.alerts.filter(function (a) { return !dismissed.has(String(a.id)) && Date.now() - a.ts < 864e5; }).length);
    let c = 0;
    S.state.crew.forEach(function (m) { if (m.contaminated) c++; });
    badgeNum("#dockBadgeCrew", c);
  }

  return { init: init, focus: function () { return focus; } };
})();

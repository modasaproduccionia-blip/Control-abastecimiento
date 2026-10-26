// Código original del Artifact (respaldo/index-artifact.html), sin cambios de lógica.
// Único cambio: el logo incrustado ahora se importa desde src/assets/logo-modasa.png.
import logoModasa from './assets/logo-modasa.png';
import { supabase, supabaseConfigured, requireSupabase } from './supabase.js';

/* ============ utilidades ============ */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const pct = (a, b) => b > 0 ? Math.round(a / b * 100) : 0;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const DAYS = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const MONTHS = {ene:0,feb:1,mar:2,abr:3,may:4,jun:5,jul:6,ago:7,set:8,sep:8,oct:9,nov:10,dic:11,jan:0,apr:3,aug:7,dec:11};
const MSHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Set','Oct','Nov','Dic'];
function toast(msg){ const h=$('#toastHost'); h.innerHTML=`<div class="toast" role="status">${esc(msg)}</div>`; clearTimeout(toast.t); toast.t=setTimeout(()=>h.innerHTML='',2200); }
const fmtDate = iso => { if(!iso) return '—'; const [y,m,d]=iso.split('-'); return `${+d}-${MSHORT[+m-1]}`; };
const fmtDT = ts => { if(!ts) return '—'; const d=new Date(ts); return `${d.getDate()}-${MSHORT[d.getMonth()]} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
const todayISO = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
function fmtDur(ms){ if(ms==null||isNaN(ms)) return '—'; const m=Math.round(ms/60000); if(m<60) return `${m} min`; const h=Math.floor(m/60), r=m%60; if(h<24) return `${h} h ${r?r+' min':''}`.trim(); return `${h} h`; }
function fmtClock(ms){ const s=Math.max(0,Math.floor(ms/1000)); const h=Math.floor(s/3600), m=Math.floor(s%3600/60), x=s%60; return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(x).padStart(2,'0')}`; }
const safeId = s => String(s).toUpperCase().replace(/\s+/g,'').replace(/[^A-Z0-9_.\-~]/g,'') || 'X';

/* ============ estado ============ */
const DEFAULT_CFG = {
  stations:{L1:[],L2:[]}, pieces:[], models:[],
  areas:['Fibra de vidrio','Pintura','Minifábrica'],
  schedule:{0:null,1:{s:'07:00',e:'19:50'},2:{s:'07:00',e:'19:50'},3:{s:'07:00',e:'19:50'},4:{s:'07:00',e:'19:50'},5:{s:'07:00',e:'17:20'},6:{s:'07:00',e:'16:00'}},
  breaks:[{s:'11:40',e:'12:25',name:'Refrigerio'}]
};
const S = {
  cfg: clone(DEFAULT_CFG), plans:{L1:[],L2:[]}, checks:{}, session:null, profile:null, authBusy:false,
  loaded:{cfg:false,L1:false,L2:false,checks:false},
  view:'home', homeMode:'buses', homeLine:'all', homeFilter:'activos', rvArea:null, homeArea:'all', homeQ:'',
  rv:{bus:null, station:null}, dash:{line:'all',model:'all',area:'all',station:'all',from:'',to:''},
  plan:{line:'L2',mode:'replace',preview:null}, params:{tab:'pieces',draft:null,dirty:false,pModel:'all',pStation:'all'},
};
let db = null, mode = 'connecting';
let authSubscription = null;
const serverRows = new Map();
const reviewWrites = new Map();

/* ============ índices ============ */
let IDX = {pieces:new Map(), stationName:new Map()};
function buildIndex(){
  const m = new Map();
  for (const p of S.cfg.pieces){ const k=p.model+'|'+p.station; if(!m.has(k)) m.set(k,[]); m.get(k).push(p); }
  const sn = new Map();
  for (const L of ['L1','L2']) for (const st of (S.cfg.stations[L]||[])) sn.set(st.id, st.name);
  IDX = {pieces:m, stationName:sn};
}
const stName = id => IDX.stationName.get(id) || id;
function modelOf(op){
  const o = String(op||'').toUpperCase().replace(/\s+/g,'');
  const rules = [...(S.cfg.models||[])].sort((a,b)=>b.prefix.length-a.prefix.length);
  for (const r of rules){ if (r.prefix && o.startsWith(String(r.prefix).toUpperCase().replace(/\s+/g,''))) return r.model; }
  return '';
}
const piecesFor = (model, station) => IDX.pieces.get(model+'|'+station) || [];
const allBuses = () => [...S.plans.L1.map(b=>({...b,line:'L1'})), ...S.plans.L2.map(b=>({...b,line:'L2'}))];
const busById = id => allBuses().find(b=>b.id===id);
const checkId = (busId, st, area) => safeId(busId) + '__' + safeId(st) + '__' + safeId(norm(area || AREA0()));

function received(item, req){ if(!item) return 0; if(item.st==='ok') return req; if(item.st==='parcial') return Math.min(req, Math.max(0, +item.qty||0)); return 0; }
const AREA0 = () => S.cfg.areas[0] || 'Fibra de vidrio';
const areaOf = p => (p.area && S.cfg.areas.includes(p.area)) ? p.area : AREA0();
function stationStat(bus, stId, area){
  const model = modelOf(bus.op);
  const all = piecesFor(model, stId);
  const areas = area && area !== 'all' ? [area] : S.cfg.areas;
  let req=0, rec=0, pend=0, reqAll=0, anyStart=false, anyRun=false, anyEnd=false;
  const parts = [];
  for (const a of areas){
    const ps = all.filter(p => areaOf(p) === a); if (!ps.length) continue;
    const ck = S.checks[checkId(bus.id, stId, a)];
    parts.push({a, ps, ck});
    for (const p of ps){ const q = +p.qty||0; reqAll += q; if (!ck?.start) continue; const r = received(ck.items?.[p.id], q); req += q; rec += r; if ((ck.end || ck.items?.[p.id]) && r < q) pend++; }
    if (ck?.start){ anyStart = true; if (ck.end) anyEnd = true; else anyRun = true; }
  }
  const ps = parts.flatMap(x => x.ps);
  let state = 'idle';
  if (!ps.length) state = 'na';
  else if (anyRun) state = 'run';
  else if (anyEnd) state = pend === 0 ? 'ok' : (rec > 0 ? 'part' : 'no');
  const ck = (area && area !== 'all') ? (parts[0]?.ck || null) : null;
  return {model, ps, ck, parts, req, rec, pend, reqAll, anyStart, state, pct: pct(rec, req)};
}
function busStat(bus){
  const sts = S.cfg.stations[bus.line] || [];
  let req=0, rec=0, pend=0, revisadas=0, conPiezas=0;
  const per = sts.map(st => { const s = stationStat(bus, st.id, 'all'); if (s.ps.length) conPiezas++; if (s.anyStart){ revisadas++; req += s.req; rec += s.rec; pend += s.pend; } return {st, ...s}; });
  return {per, req, rec, pend, revisadas, conPiezas, active: revisadas > 0, pct: pct(rec, req), model: modelOf(bus.op)};
}

/* ============ horario laboral ============ */
const hm = s => { const [h,m] = String(s||'0:0').split(':').map(Number); return (h||0)*60 + (m||0); };
function workMs(a, b){
  if (!a || !b || b <= a) return 0;
  let total = 0; const d = new Date(a); d.setHours(0,0,0,0);
  const end = b;
  let guard = 0;
  while (d.getTime() <= end && guard++ < 400){
    const sch = S.cfg.schedule?.[d.getDay()];
    if (sch && sch.s && sch.e){
      const base = d.getTime();
      const ws = base + hm(sch.s)*60000, we = base + hm(sch.e)*60000;
      const lo = Math.max(a, ws), hi = Math.min(b, we);
      if (hi > lo){
        let t = hi - lo;
        for (const br of (S.cfg.breaks||[])){
          const bs = base + hm(br.s)*60000, be = base + hm(br.e)*60000;
          const l2 = Math.max(lo, bs), h2 = Math.min(hi, be);
          if (h2 > l2) t -= (h2 - l2);
        }
        total += Math.max(0, t);
      }
    }
    d.setDate(d.getDate()+1);
  }
  return total;
}

/* ============ persistencia ============ */
const writeQ = new Map(); // ruta -> {data, running}
const pendingIds = new Set(); // revisiones con escritura en curso: se respeta la versión local
async function persist(path, data){
  if (mode === 'local'){ try { localStorage.setItem('fv:'+path, JSON.stringify(data)); } catch(e){} return; }
  if (!db) return;
  const q = writeQ.get(path) || {data:null, running:false};
  q.data = data; writeQ.set(path, q);
  if (path.startsWith('checks/')) pendingIds.add(path.slice(7));
  if (q.running) return;
  q.running = true;
  while (q.data){
    const d = q.data; q.data = null;
    try { await db.doc(path).set(d); }
    catch(e){
      if (e?.code === 'unavailable'){ await new Promise(r=>setTimeout(r, 600+Math.random()*800)); try{ await db.doc(path).set(d); }catch(e2){ toast('No se pudo guardar. Revisa tu conexión.'); } }
      else if (e?.code === 'invalid_argument'){ toast('Tu acceso es de solo lectura: no se guardó el cambio.'); }
      else if (e?.code === 'quota_exceeded'){ toast('Se llenó la base de datos. Elimina programación antigua.'); }
      else toast('No se pudo guardar el cambio.');
    }
  }
  q.running = false;
  if (path.startsWith('checks/')) setTimeout(() => { const w = writeQ.get(path); if (!w?.running && !w?.data) pendingIds.delete(path.slice(7)); }, 2500);
}
const saveCfg = async () => {
  if (!S.profile || S.profile.rol !== 'admin') { toast('Solo el administrador puede guardar parámetros.'); return; }
  try {
    const client = requireSupabase();
    const { error } = await client.from('config').upsert({id:1, datos:S.cfg, actualizado_por:S.session.user.id});
    if (error) throw error;
  } catch (e) { toast('No se guardaron los parámetros: ' + (e.message || 'revisa permisos')); }
};
const savePlan = async L => {
  if (!S.profile || S.profile.rol !== 'admin') { toast('Solo el administrador puede modificar la programación.'); return; }
  try {
    const client = requireSupabase();
    const { error } = await client.from('planes').upsert({linea:L, buses:S.plans[L], actualizado_por:S.session.user.id});
    if (error) throw error;
  } catch (e) { toast('No se guardó la programación: ' + (e.message || 'revisa permisos')); }
};
function reviewFromRow(row) {
  const id = checkId(row.bus_id, row.estacion, row.area);
  const ck = {serverId:row.id, busId:row.bus_id, op:row.op, cliente:row.cliente, line:row.linea,
    model:row.modelo, station:row.estacion, area:row.area,
    start:row.inicio ? new Date(row.inicio).getTime() : null, end:row.fin ? new Date(row.fin).getTime() : null,
    items:row.items || {}, updatedAt:row.actualizado_en ? new Date(row.actualizado_en).getTime() : Date.now(),
    serverEnd:row.fin ? new Date(row.fin).getTime() : null, serverItems:clone(row.items || {})};
  serverRows.set(id, row); return [id, ck];
}
async function saveCheck(id) {
  const ck = S.checks[id]; if (!ck) return;
  const previous = reviewWrites.get(id) || Promise.resolve();
  const task = previous.catch(()=>{}).then(async () => {
    const client = requireSupabase();
    let row = serverRows.get(id);
    let serverId = ck.serverId || row?.id || null;
    if (ck.serverEnd && !ck.end && serverId) {
      const {data, error} = await client.rpc('reabrir_revision', {p_revision:serverId});
      if (error) throw error;
      row = data; ck.serverEnd = null;
    }
    const oldItems = ck.serverItems || row?.items || {};
    for (const [pid, item] of Object.entries(ck.items || {})) {
      const before = oldItems[pid];
      if (before && before.st===item.st && Number(before.qty)===Number(item.qty)) continue;
      const {data, error} = await client.rpc('marcar_pieza', {
        p_bus_id:ck.busId, p_estacion:ck.station, p_area:ck.area, p_pieza:pid,
        p_estado:item.st, p_cantidad:Number(item.qty)||0
      });
      if (error) throw error;
      row = data; serverId = data.id;
      Object.assign(ck, {serverId:data.id, serverItems:clone(data.items || {}), serverEnd:data.fin ? new Date(data.fin).getTime() : null});
      serverRows.set(id, data);
    }
    if (ck.end && !ck.serverEnd && serverId) {
      const {data, error} = await client.rpc('cerrar_revision', {p_revision:serverId});
      if (error) throw error;
      row = data; ck.serverEnd = data.fin ? new Date(data.fin).getTime() : Date.now();
      ck.serverItems = clone(data.items || {}); serverRows.set(id, data);
    }
    if (!serverId && !Object.keys(ck.items || {}).length) return;
    if (row) {
      const [mappedId, mapped] = reviewFromRow(row);
      S.checks[mappedId] = {...ck, serverId:mapped.serverId, serverItems:mapped.serverItems, serverEnd:mapped.serverEnd};
    }
  }).catch(e => {
    toast('No se guardó la revisión: ' + (e.message || 'verifica tu sesión y permisos'));
  }).finally(() => { if (reviewWrites.get(id) === task) reviewWrites.delete(id); });
  reviewWrites.set(id, task);
  return task;
}

function applyCfg(d){
  S.cfg = Object.assign(clone(DEFAULT_CFG), d||{});
  S.cfg.stations = Object.assign({L1:[],L2:[]}, S.cfg.stations||{});
  buildIndex();
}
function setSync(){
  const el = $('#sync');
  if (mode==='local'){ el.className='sync local'; el.innerHTML='<i></i>Solo en este equipo'; }
  else if (mode==='db'){ el.className='sync'; el.innerHTML='<i></i>En línea con el equipo'; }
}
async function loadSharedData() {
  const client = requireSupabase();
  const [{data:cfg,error:ce},{data:plans,error:pe},{data:rows,error:re},{data:profile,error:ue}] = await Promise.all([
    client.from('config').select('datos').eq('id',1).maybeSingle(),
    client.from('planes').select('linea,buses'),
    client.from('revisiones').select('*'),
    client.from('perfiles').select('id,nombre,rol').eq('id',S.session.user.id).single()
  ]);
  if (ce) throw ce; if (pe) throw pe; if (re) throw re; if (ue) throw ue;
  S.profile = profile;
  if (cfg?.datos) applyCfg(cfg.datos);
  for (const L of ['L1','L2']) S.plans[L] = plans?.find(p=>p.linea===L)?.buses || [];
  S.checks = {}; serverRows.clear();
  for (const row of (rows || [])) { const [id, ck] = reviewFromRow(row); S.checks[id] = ck; }
  Object.keys(S.loaded).forEach(k=>S.loaded[k]=true);
  mode = 'db'; setSync(); render();
}
function showLogin(message='') {
  const main=$('#main');
  main.innerHTML = `<section class="card pad" style="max-width:440px;margin:40px auto">
    <h2 style="font-size:26px;margin-bottom:8px">Iniciar sesión</h2>
    <p class="muted">Control de Abastecimiento | MODASA</p>
    <form id="loginForm" style="display:grid;gap:12px;margin-top:18px">
      <label>Correo de trabajo<input class="in" id="loginEmail" type="email" autocomplete="username" required></label>
      <label>Contraseña<input class="in" id="loginPassword" type="password" autocomplete="current-password" required></label>
      <p id="loginError" class="small" style="color:var(--no);margin:0">${esc(message)}</p>
      <button class="btn primary big" type="submit" ${S.authBusy?'disabled':''}>${S.authBusy?'Ingresando…':'Ingresar'}</button>
    </form>
  </section>`;
}
async function init(){
  buildIndex(); renderNav();
  if (!supabaseConfigured) { showLogin('Falta configurar la conexión de Supabase.'); return; }
  const client = requireSupabase();
  const {data:{session}, error} = await client.auth.getSession();
  if (error) { showLogin(error.message); return; }
  S.session = session;
  if (session) {
    try { await loadSharedData(); }
    catch(e) { S.session=null; showLogin('No se pudieron cargar los datos: '+(e.message||'')); }
  } else showLogin();
  const {data} = client.auth.onAuthStateChange(async (_event, sessionNow) => {
    S.session = sessionNow;
    if (!sessionNow) { S.profile=null; S.loaded={cfg:false,L1:false,L2:false,checks:false}; showLogin(); return; }
    try { await loadSharedData(); } catch(e) { showLogin('Error al cargar: '+(e.message||'')); }
  });
  authSubscription = data.subscription;
  client.channel('control-abastecimiento-live')
    .on('postgres_changes',{event:'*',schema:'public',table:'config'},()=>loadSharedData().catch(()=>{}))
    .on('postgres_changes',{event:'*',schema:'public',table:'planes'},()=>loadSharedData().catch(()=>{}))
    .on('postgres_changes',{event:'*',schema:'public',table:'revisiones'},()=>loadSharedData().catch(()=>{}))
    .subscribe();
}

/* ============ render ============ */
const VIEWS = [
  ['home','Inicio','<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'],
  ['review','Revisar','<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>'],
  ['dash','Dashboard','<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'],
  ['plan','Programación','<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>'],
  ['params','Parámetros','<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.6 15H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 4.6V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>'],
];
function renderNav(){
  const lg = $('#logo'); if (lg){ const want = logoHTML(S.cfg.logo); if (lg.dataset.v !== (S.cfg.logo||'w')) { lg.innerHTML = want; lg.dataset.v = S.cfg.logo||'w'; } }
  setTimeout(setHeaderH, 0);
  $('#tabs').innerHTML = VIEWS.map(([k,t]) => `<button data-nav="${k}" aria-current="${S.view===k}">${t}</button>`).join('');
  $('#bottom').innerHTML = VIEWS.map(([k,t,ic]) => `<button data-nav="${k}" aria-current="${S.view===k}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ic}</svg>${t}</button>`).join('');
  const userLabel = S.session?.user?.email || '';
  const old = $('#userSession'); if(old) old.remove();
  if(S.session){ const el=document.createElement('div'); el.id='userSession'; el.style.cssText='display:flex;align-items:center;gap:8px;font-size:12px;margin-left:auto;padding:4px 10px'; el.innerHTML=`<span>${esc(userLabel)} · ${S.profile?.rol==='admin'?'Administrador':'Operario'}</span><button class="btn" data-logout style="padding:5px 8px">Salir</button>`; $('.top-in')?.append(el); }
}
const DEFAULT_LOGO = logoModasa;
const logoHTML = src => `<img src="${src || DEFAULT_LOGO}" alt=""><span class="wordmark">MODASA</span>`;
let pendingRender = false;
function softRender(){
  const ae = document.activeElement;
  const typing = ae && $('#main').contains(ae) && /INPUT|TEXTAREA|SELECT/.test(ae.tagName) && ae.type !== 'checkbox';
  if (typing || (S.view==='params' && S.params.dirty) || (S.view==='plan' && S.plan.preview)) { pendingRender = true; return; }
  render();
}
document.addEventListener('focusout', () => setTimeout(() => { if (pendingRender) { pendingRender = false; softRender(); } }, 50));

function render(){
  if (!S.session) { showLogin(); return; }
  renderNav();
  const ready = Object.values(S.loaded).every(Boolean);
  const m = $('#main');
  if (!ready){ m.innerHTML = '<div class="empty">Cargando datos…</div>'; return; }
  const y = window.scrollY;
  m.innerHTML = ({home:vHome, review:vReview, dash:vDash, plan:vPlan, params:vParams})[S.view]();
  window.scrollTo(0, y);
  tick();
}
function go(view){ S.params.unlocked = false; S.view = view; window.scrollTo(0,0); render(); }

/* ---------- INICIO ---------- */
function busInPlant(b){
  const t = todayISO();
  const a = b.d?.acab || b.d?.pint || b.d?.estr;
  const lib = b.d?.lib;
  if (!a) return false;
  const soon = new Date(); soon.setDate(soon.getDate()+3);
  const soonISO = soon.toISOString().slice(0,10);
  return a <= soonISO && (!lib || lib >= t);
}
function lastActivity(busId){ let m = 0; for (const c of Object.values(S.checks)) if (c.busId === busId) m = Math.max(m, c.updatedAt || c.start || 0); return m; }
function homeBuses(){
  let bs = allBuses();
  if (S.homeLine !== 'all') bs = bs.filter(b => b.line === S.homeLine);
  const q = norm(S.homeQ);
  if (q) bs = bs.filter(b => norm(b.op+' '+b.cliente).includes(q));
  let out = bs.map(b => ({b, s: busStat(b)})).filter(x => x.s.active);
  if (S.homeFilter === 'curso') out = out.filter(x => x.s.per.some(p => p.state === 'run'));
  if (S.homeFilter === 'faltan') out = out.filter(x => x.s.pend > 0);
  out.sort((x, y) => lastActivity(y.b.id) - lastActivity(x.b.id));
  return out;
}
function vHome(){
  const list = homeBuses();
  const act = allBuses().map(b => busStat(b)).filter(s => s.active);
  const tReq = act.reduce((a,s)=>a+s.req,0), tRec = act.reduce((a,s)=>a+s.rec,0), tPend = act.reduce((a,s)=>a+s.pend,0);
  const running = Object.values(S.checks).filter(c => c.start && !c.end).length;
  const gp = pct(tRec, tReq);
  return `
  <section class="summary">
    <div class="card lead"><div class="k">Abastecimiento de buses activos</div><div class="v num">${gp}%</div><div class="meter"><span style="width:${gp}%"></span></div><div class="small muted" style="margin-top:6px">${tRec} de ${tReq} piezas recibidas</div></div>
    <div class="card"><div class="k">Piezas pendientes</div><div class="v num" style="color:var(--no)">${tPend}</div></div>
    <div class="card"><div class="k">Revisiones en curso</div><div class="v num" style="color:var(--brand)">${running}</div></div>
    <div class="card"><div class="k">Buses activos</div><div class="v num">${act.length}</div></div>
  </section>
  <div class="sec-title"><h2>${S.homeMode==='buses'?'Buses activos':'Piezas que faltan'}</h2>
    <div class="chips" style="margin-left:auto"><button class="chip" data-hmode="buses" aria-pressed="${S.homeMode==='buses'}">Por bus</button><button class="chip" data-hmode="miss" aria-pressed="${S.homeMode==='miss'}">Faltantes</button></div>
  </div>
  <div class="row" style="margin-bottom:12px">
    <input class="in grow" style="max-width:320px" id="homeQ" placeholder="Buscar O/P o cliente" value="${esc(S.homeQ)}">
    <div class="chips">${['all','L1','L2'].map(l=>`<button class="chip" data-hline="${l}" aria-pressed="${S.homeLine===l}">${l==='all'?'Ambas líneas':l}</button>`).join('')}</div>
    ${S.homeMode==='buses' ? `<div class="chips">${[['activos','Todos los activos'],['curso','En revisión'],['faltan','Con faltantes']].map(([k,t])=>`<button class="chip" data-hfilter="${k}" aria-pressed="${S.homeFilter===k}">${t}</button>`).join('')}</div>`
      : `<select class="in" style="width:auto" id="homeArea"><option value="all">Todos los tipos</option>${S.cfg.areas.map(a=>`<option ${S.homeArea===a?'selected':''}>${esc(a)}</option>`).join('')}</select>`}
  </div>
  ${S.homeMode==='buses' ? homeBusList(list) : homeMissing()}`;
}
function homeBusList(list){
  if (!list.length) return `<div class="card empty">Todavía no hay buses en revisión. Un bus aparece aquí apenas se marca su primera pieza.<div style="margin-top:12px"><button class="btn primary" data-nav="review">Ir a Revisar</button></div></div>`;
  return `<div class="legend" style="margin-bottom:10px">
      <span style="--c:var(--ok)">Completo</span><span style="--c:var(--part)">Parcial</span><span style="--c:var(--no)">No llegó</span><span style="--c:var(--run)">En revisión</span><span style="--c:var(--idle)">Sin revisar</span>
    </div>
    <div class="buses">${list.map(({b,s}) => `
    <article class="card bus">
      <div class="bus-h">
        <div class="grow">
          <div class="bus-op">${esc(b.op)}</div>
          <div class="muted">${esc(b.cliente)}</div>
          <div class="small muted">${b.line} | ${s.model?esc(s.model):'sin modelo'} | Acabados ${fmtDate(b.d?.acab)} | Liberación ${fmtDate(b.d?.lib)}</div>
        </div>
        <div class="bus-pct"><b class="num" style="color:${s.pend? 'var(--no)':'var(--ok)'}">${s.pct}%</b><small>${s.revisadas} de ${s.conPiezas} est.</small>${s.pend?`<small style="color:var(--no);font-weight:600">${s.pend} faltan</small>`:''}</div>
      </div>
      <div class="strip">${s.per.map(p => `
        <button class="seg ${p.state}" data-open="${esc(b.id)}" data-st="${esc(p.st.id)}" title="${esc(p.st.name)}: ${p.state==='na'?'sin piezas':p.pct+'%'}">
          <span class="bar"><i style="height:${p.state==='na'||p.state==='idle'?0:p.state==='no'?100:Math.max(8,p.pct)}%"></i></span>
          <span class="lbl">${esc(p.st.name)}</span>
        </button>`).join('')}
      </div>
    </article>`).join('')}</div>`;
}
function missingRows(){
  const rows = [];
  for (const b of allBuses()){
    if (S.homeLine !== 'all' && b.line !== S.homeLine) continue;
    const q = norm(S.homeQ); if (q && !norm(b.op+' '+b.cliente).includes(q)) continue;
    for (const st of (S.cfg.stations[b.line]||[])){
      for (const a of S.cfg.areas){
        if (S.homeArea !== 'all' && S.homeArea !== a) continue;
        const ck = S.checks[checkId(b.id, st.id, a)];
        if (!ck?.start) continue;
        const items = piecesFor(modelOf(b.op), st.id).filter(p => areaOf(p) === a && (ck.end || ck.items?.[p.id]) && received(ck.items?.[p.id], +p.qty) < +p.qty);
        if (items.length) rows.push({b, st, a, ck, items});
      }
    }
  }
  return rows;
}
function homeMissing(){
  const rows = missingRows();
  if (!rows.length) return `<div class="card empty">No hay piezas pendientes con este filtro.</div>`;
  const byBus = new Map();
  for (const r of rows){ if(!byBus.has(r.b.id)) byBus.set(r.b.id, {b:r.b, sts:[]}); byBus.get(r.b.id).sts.push(r); }
  const now = Date.now();
  return [...byBus.values()].map(({b, sts}) => `
    <section class="card miss-bus">
      <header><div class="grow"><b class="bus-op" style="font-size:21px">${esc(b.op)}</b> <span class="small muted">${esc(b.cliente)} | ${b.line}</span></div><span class="pill no">${sts.reduce((a,r)=>a+r.items.length,0)} piezas</span></header>
      ${sts.map(r => `<div class="miss-st"><h4>${esc(r.st.name)} | ${esc(r.a)} | ${r.ck.end ? 'esperando ' + fmtDur(workMs(r.ck.end, now)) : 'en revisión'}</h4>
        ${r.items.map(p => { const got = received(r.ck.items?.[p.id], +p.qty); const cid = checkId(b.id, r.st.id, r.a); return `
        <div class="miss-item">
          <div class="d"><b>${esc(p.desc)}</b><div class="small muted">${esc(p.code)} | se abastece en ${esc(p.abast||'—')}</div></div>
          <span class="pill ${got?'part':'no'} num">${got}/${p.qty}</span>
          <button class="btn part-btn" data-mpart="${esc(cid)}" data-pid="${esc(p.id)}">Parcial</button>
          <button class="btn ok-btn" data-arrive="${esc(cid)}" data-pid="${esc(p.id)}">Llegó</button>
        </div>`; }).join('')}
      </div>`).join('')}
    </section>`).join('');
}

/* ---------- REVISAR ---------- */
function stepBar(n){
  const s = ['Elegir bus','Elegir estación','Marcar piezas'];
  return `<ol class="steps" aria-label="Pasos">${s.map((t,i)=>`<li class="${i+1<n?'done':i+1===n?'cur':''}" ${i+1===n?'aria-current="step"':''}><b>${i+1<n?'✓':i+1}</b><span>${t}</span></li>`).join('')}</ol>`;
}
function areaChips(){
  return `<div class="area-tabs" role="tablist" aria-label="Tipo de pieza">${S.cfg.areas.map(a => `<button role="tab" data-rvarea="${esc(a)}" aria-selected="${S.rvArea===a}">${esc(a)}</button>`).join('')}</div>`;
}
function vReview(){
  if (!S.cfg.areas.includes(S.rvArea)) S.rvArea = AREA0();
  const {bus:busId, station} = S.rv;
  const bus = busId ? busById(busId) : null;
  if (!bus) return reviewPickBus();
  if (!station) return reviewPickStation(bus);
  return reviewStation(bus, station);
}
function reviewPickBus(){
  const bs = allBuses();
  const sug = bs.filter(b => busStat(b).active || busInPlant(b)).sort((a,b)=>(a.d?.acab||'').localeCompare(b.d?.acab||''));
  return `${stepBar(1)}
  <div class="card pad" style="max-width:680px">
    <h2 style="font-size:26px;margin-bottom:10px">¿Qué vas a revisar?</h2>
    <p class="lbl-step">Tipo de pieza</p>
    ${areaChips()}
    <label class="small muted" for="busInput" style="display:block;margin:14px 0 4px">Código de bus (O/P)</label>
    <div class="row">
      <input class="in grow big-in" id="busInput" list="busList" placeholder="Ej. Z5PSC6B-57" autocomplete="off">
      <datalist id="busList">${bs.map(b=>`<option value="${esc(b.op)}">${esc(b.cliente)} (${b.line})</option>`).join('')}</datalist>
      <button class="btn primary" id="busGo" style="padding:12px 18px">Ver estaciones</button>
    </div>
  </div>
  <div class="sec-title"><h2>Buses en planta</h2><span class="muted small">Toca para abrir</span></div>
  ${sug.length ? `<div class="chips">${sug.map(b=>{ const s=busStat(b); return `<button class="chip" data-pickbus="${esc(b.id)}" style="padding:10px 16px;font-size:15px">${esc(b.op)}${s.active?` <span class="muted">${s.pct}%</span>`:''}</button>`; }).join('')}</div>` : '<p class="muted">No hay buses en planta según la programación.</p>'}`;
}
const ST_LABEL = {ok:'Completo',part:'Parcial',no:'No llegó',run:'En revisión',idle:'Sin revisar',na:'Sin piezas'};
function reviewPickStation(bus){
  const s = busStat(bus);
  const per = (S.cfg.stations[bus.line]||[]).map(st => ({st, ...stationStat(bus, st.id, S.rvArea)}));
  return `
  <div class="crumbs"><button data-rv="reset">Buses</button><span class="muted">/</span><b>${esc(bus.op)}</b></div>
  ${stepBar(2)}
  <div class="card sh" style="margin-bottom:14px">
    <div class="grow"><div class="bus-op">${esc(bus.op)}</div><div class="muted">${esc(bus.cliente)} | ${bus.line} | ${esc(s.model||'sin modelo')}</div></div>
    <div style="text-align:right"><div class="pctbig num">${s.active?s.pct+'%':'—'}</div><div class="small muted">abastecimiento del bus</div></div>
  </div>
  <p class="lbl-step">Tipo de pieza</p>
  ${areaChips()}
  <p class="lbl-step" style="margin-top:18px">Elige la estación</p>
  ${!s.model ? `<div class="card pad" style="margin:12px 0">No se reconoce el modelo de esta O/P. Agrega su prefijo en Parámetros, Modelos.</div>`:''}
  <div class="st-grid" style="margin-top:14px">${per.map(p => `
    <button class="st-btn ${p.state}" data-pickst="${esc(p.st.id)}" ${p.state==='na'?'disabled':''}>
      <span class="nm">${esc(p.st.name)}</span>
      <span class="small muted">${p.ps.length ? `${p.ps.length} piezas | ${p.reqAll} und.` : 'Sin piezas de este tipo'}</span>
      <span class="pill ${p.state==='na'?'idle':p.state}">${ST_LABEL[p.state]}${p.anyStart?' '+p.pct+'%':''}</span>
    </button>`).join('') || '<div class="card empty">Esta línea no tiene estaciones configuradas.</div>'}
  </div>`;
}
function reviewStation(bus, stId){
  const s = stationStat(bus, stId, S.rvArea);
  const ck = s.ck;
  const started = !!ck?.start, ended = !!ck?.end;
  const unmarked = s.ps.filter(p => !ck?.items?.[p.id]).length;
  const p100 = pct(s.rec, s.reqAll);
  return `
  <div class="crumbs"><button data-rv="reset">Buses</button><span class="muted">/</span><button data-rv="bus">${esc(bus.op)}</button><span class="muted">/</span><b>${esc(stName(stId))}</b><span class="muted">/</span><span>${esc(S.rvArea)}</span></div>
  ${stepBar(3)}
  <div class="sticky-head card">
    <div class="sh">
      <div class="grow">
        <div class="bus-op">${esc(stName(stId))}</div>
        <div style="font-weight:600">${esc(bus.op)} <span class="muted" style="font-weight:400">| ${esc(S.rvArea)}</span></div>
        <div class="small muted">${s.ps.length} piezas | ${s.reqAll} und.</div>
      </div>
      <div style="text-align:right">
        ${!started ? '<div class="timer muted">00:00:00</div><div class="small muted">inicia al marcar</div>' : ended ? `<div class="timer">${fmtClock(workMs(ck.start, ck.end))}</div><div class="small muted">revisión terminada</div>` : `<div class="timer" data-timer="${ck.start}">00:00:00</div><div class="small muted">tiempo de revisión</div>`}
      </div>
      <div style="text-align:right;min-width:90px"><div class="pctbig num" style="color:${p100>=100?'var(--ok)':s.rec?'var(--part-ink)':'var(--ink)'}">${p100}%</div><div class="small muted">abastecido</div></div>
    </div>
    <div class="meter" style="margin:0 14px 12px"><span style="width:${p100}%;background:${p100>=100?'var(--ok)':'var(--brand)'}"></span></div>
  </div>
  ${s.ps.length ? `<p class="hint">Marca cada pieza con <b style="color:var(--ok)">Llegó</b>, <b style="color:var(--part-ink)">Parcial</b> o <b style="color:var(--no)">No llegó</b>. El tiempo empieza con la primera marca.</p><div class="card">${s.ps.map(p => pieceRow(p, ck?.items?.[p.id])).join('')}</div>` : `<div class="card empty">Esta estación no tiene piezas de ${esc(S.rvArea)} para este modelo.</div>`}
  ${started && !ended ? `<div class="end-actions"><button class="btn big" data-report>Reportar revisión${unmarked?` (${unmarked} sin marcar)`:''}</button><button class="btn primary big" data-finish>Terminar revisión</button></div><p class="small muted">Las piezas sin marcar se reportan como no llegó (faltante). Terminar revisión cierra el tiempo y te lleva al inicio.</p>` : ''}
  ${!started ? `<div class="end-actions"><button class="btn big" data-nav="home">Volver al inicio</button></div>` : ''}
  ${ended ? `<div class="card pad small" style="margin-top:12px">Inicio ${fmtDT(ck.start)} | reporte ${fmtDT(ck.end)} | duración ${fmtDur(workMs(ck.start, ck.end))}
    <div class="row" style="margin-top:8px"><button class="btn danger" data-reopen>Reabrir revisión</button><button class="btn primary" data-nav="home" style="margin-left:auto">Volver al inicio</button></div></div>` : ''}`;
}
function pieceRow(p, it){
  const st = it?.st || '';
  const got = received(it, +p.qty);
  return `
  <div class="piece">
    <div><div class="nm">${esc(p.desc)}</div><div class="meta">${esc(p.code)} | se abastece en ${esc(p.abast||'—')}${it?.arrivedAt?` | llegó ${fmtDT(it.arrivedAt)}`:''}</div></div>
    <div class="req num">${st?`${got}/`:''}${p.qty}${st && got < +p.qty ? `<small class="falta">faltan ${+p.qty - got}</small>` : `<small>${st?'recibido':'requerido'}</small>`}</div>
    <div class="seg3">
      <button class="ok" aria-pressed="${st==='ok'}" data-mark="ok" data-pid="${esc(p.id)}">Llegó</button>
      <button class="part" aria-pressed="${st==='parcial'}" data-mark="parcial" data-pid="${esc(p.id)}">Parcial${st==='parcial'?` (${got})`:''}</button>
      <button class="no" aria-pressed="${st==='no'}" data-mark="no" data-pid="${esc(p.id)}">No llegó</button>
    </div>
  </div>`;
}
function curCheck(create){
  const {bus:busId, station} = S.rv; const area = S.rvArea; const bus = busById(busId);
  const id = checkId(busId, station, area);
  if (!S.checks[id] && create){
    S.checks[id] = {busId, op:bus.op, cliente:bus.cliente, line:bus.line, model:modelOf(bus.op), station, area, start:null, end:null, items:{}};
  }
  return [id, S.checks[id], bus];
}
function setItem(ck, pid, st, qty){
  const p = S.cfg.pieces.find(x=>x.id===pid); const req = +p?.qty||0;
  const prev = ck.items[pid] || {};
  let q = st==='ok' ? req : st==='no' ? 0 : Math.max(0, Math.min(req, +qty||0));
  if (st==='parcial' && q>=req) st='ok';
  if (st==='parcial' && q<=0) st='no';
  const item = {st, qty:q, req, at:Date.now()};
  if (ck.end && st==='ok' && prev.st!=='ok') item.arrivedAt = Date.now();
  else if (prev.arrivedAt && st==='ok') item.arrivedAt = prev.arrivedAt;
  ck.items[pid] = item; ck.updatedAt = Date.now();
}
function markPiece(pid, st, qty){
  const [id, ck] = curCheck(true);
  if (!ck.start){ ck.start = Date.now(); ck.end = null; }
  setItem(ck, pid, st, qty);
  saveCheck(id); render();
}
/* ventana de cantidad parcial */
let QM = null;
function openQty(pid, ckId){
  const p = S.cfg.pieces.find(x=>x.id===pid); if (!p) return;
  const ck = ckId ? S.checks[ckId] : curCheck(false)[1];
  const cur = ck?.items?.[pid];
  const v = cur?.st==='parcial' ? cur.qty : (cur?.st==='ok' ? Math.max(0,+p.qty-1) : 0);
  QM = {pid, ckId, max:+p.qty};
  $('#modalHost').innerHTML = `<div class="modal-bg" data-mclose>
    <div class="modal card" role="dialog" aria-modal="true" aria-labelledby="mqT">
      <h3 id="mqT">¿Cuántas llegaron?</h3>
      <p class="muted" style="margin:4px 0 16px">${esc(p.desc)}<br>Requerido: <b>${p.qty}</b></p>
      <div class="stepper xl"><button data-mstep="-1" aria-label="Menos">−</button><input id="mq" type="number" inputmode="numeric" min="0" max="${p.qty}" value="${v}" aria-label="Cantidad que llegó"><button data-mstep="1" aria-label="Más">+</button></div>
      <p class="small muted" style="text-align:center;margin:8px 0 16px">de ${p.qty}</p>
      <div class="row"><button class="btn grow" data-mclose>Cancelar</button><button class="btn primary grow" data-mok>Guardar</button></div>
    </div></div>`;
  const i = $('#mq'); i.focus(); i.select();
}
function closeQty(){ QM = null; $('#modalHost').innerHTML = ''; }
function saveQty(){
  if (!QM) return; const q = Math.max(0, Math.min(QM.max, +$('#mq').value||0));
  const {pid, ckId} = QM; closeQty();
  if (ckId){ const ck = S.checks[ckId]; if (!ck) return; setItem(ck, pid, 'parcial', q); saveCheck(ckId); render(); }
  else markPiece(pid, 'parcial', q);
}

/* ---------- DASHBOARD ---------- */
function dashData(){
  const f = S.dash;
  const recs = [];
  for (const [id, ck] of Object.entries(S.checks)){
    if (!ck.start) continue;
    const area = ck.area || AREA0();
    const bus = busById(ck.busId) || {id:ck.busId, op:ck.op, cliente:ck.cliente, line:ck.line};
    if (f.line!=='all' && ck.line!==f.line) continue;
    const model = ck.model || modelOf(ck.op);
    if (f.model!=='all' && model!==f.model) continue;
    if (f.station!=='all' && ck.station!==f.station) continue;
    if (f.area!=='all' && area!==f.area) continue;
    const day = new Date(ck.start); const dISO = `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
    if (f.from && dISO < f.from) continue; if (f.to && dISO > f.to) continue;
    const ps = piecesFor(model, ck.station).filter(p => areaOf(p) === area);
    let req=0, rec=0, pend=0; const repos=[];
    for (const p of ps){ const it = ck.items?.[p.id]; req+=+p.qty||0; const r = received(it,+p.qty||0); rec+=r; if (r<+p.qty) pend++;
      if (it?.arrivedAt && ck.end && it.arrivedAt > ck.end) repos.push(workMs(ck.end, it.arrivedAt)); }
    const everMissing = ps.filter(p => { const it = ck.items?.[p.id]; return !it || it.st!=='ok' || (it.arrivedAt && ck.end && it.arrivedAt>ck.end); });
    recs.push({id, ck, area, bus, model, ps, req, rec, pend, revMs: ck.end ? workMs(ck.start, ck.end) : null, repos, everMissing});
  }
  return recs;
}
function hbars(items, fmt, max){
  if (!items.length) return '<div class="empty small">Sin datos con estos filtros.</div>';
  const mx = max ?? Math.max(1, ...items.map(i=>i.v));
  return items.map(i => `<div class="hbar"><span class="nm" title="${esc(i.k)}">${esc(i.k)}</span><span class="t"><i class="${i.cls||''}" style="width:${Math.min(100, i.v/mx*100)}%"></i></span><span class="vv">${fmt(i.v)}</span></div>`).join('');
}
const avg = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : null;
function vDash(){
  const f = S.dash; const recs = dashData();
  const done = recs.filter(r=>r.ck.end);
  const req = done.reduce((a,r)=>a+r.req,0), rec = done.reduce((a,r)=>a+r.rec,0), pend = done.reduce((a,r)=>a+r.pend,0);
  const revAvg = avg(done.map(r=>r.revMs));
  const allRepos = done.flatMap(r=>r.repos); const repAvg = avg(allRepos);
  const models = [...new Set(S.cfg.pieces.map(p=>p.model))];
  const stations = [...(S.cfg.stations.L1||[]), ...(S.cfg.stations.L2||[])];
  // por estación
  const stOrder = stations.map(s=>s.id);
  const bySt = new Map();
  for (const r of done){ const k=r.ck.station; if(!bySt.has(k)) bySt.set(k,{req:0,rec:0,rev:[],rep:[]}); const o=bySt.get(k); o.req+=r.req; o.rec+=r.rec; o.rev.push(r.revMs); o.rep.push(...r.repos); }
  const stKeys = [...bySt.keys()].sort((a,b)=>stOrder.indexOf(a)-stOrder.indexOf(b));
  const pctSt = stKeys.map(k=>({k:stName(k), v:pct(bySt.get(k).rec, bySt.get(k).req)}));
  const revSt = stKeys.map(k=>({k:stName(k), v:avg(bySt.get(k).rev)||0}));
  const repSt = stKeys.filter(k=>bySt.get(k).rep.length).map(k=>({k:stName(k), v:avg(bySt.get(k).rep), cls:'b2'}));
  // por bus
  const byBus = new Map();
  for (const r of done){ const k=r.bus.op||r.ck.op; if(!byBus.has(k)) byBus.set(k,{req:0,rec:0}); const o=byBus.get(k); o.req+=r.req; o.rec+=r.rec; }
  const pctBus = [...byBus.entries()].map(([k,o])=>({k, v:pct(o.rec,o.req)})).sort((a,b)=>a.v-b.v).slice(0,15);
  // piezas más faltantes
  const missCount = new Map();
  for (const r of done) for (const p of r.everMissing){ const k=p.code+' '+p.desc; missCount.set(k,(missCount.get(k)||0)+1); }
  const topMiss = [...missCount.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
  return `
  <div class="filters card pad">
    <label>Línea<select class="in" data-df="line"><option value="all">Todas</option><option ${f.line==='L1'?'selected':''}>L1</option><option ${f.line==='L2'?'selected':''}>L2</option></select></label>
    <label>Modelo<select class="in" data-df="model"><option value="all">Todos</option>${models.map(m=>`<option ${f.model===m?'selected':''}>${esc(m)}</option>`).join('')}</select></label>
    <label>Estación<select class="in" data-df="station"><option value="all">Todas</option>${stations.map(s=>`<option value="${esc(s.id)}" ${f.station===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label>
    <label>Tipo de pieza<select class="in" data-df="area"><option value="all">Todas</option>${S.cfg.areas.map(a=>`<option ${f.area===a?'selected':''}>${esc(a)}</option>`).join('')}</select></label>
    <label>Desde<input type="date" class="in" data-df="from" value="${f.from}"></label>
    <label>Hasta<input type="date" class="in" data-df="to" value="${f.to}"></label>
  </div>
  <div class="kpis">
    <div class="card"><div class="k">Porcentaje entregado</div><div class="v num" style="color:var(--brand)">${pct(rec,req)}%</div><div class="small muted">${rec} de ${req} und.</div></div>
    <div class="card"><div class="k">Tiempo prom. de revisión</div><div class="v num">${fmtDur(revAvg)}</div><div class="small muted">${done.length} revisiones</div></div>
    <div class="card"><div class="k">Tiempo prom. de reposición</div><div class="v num" style="color:var(--part)">${fmtDur(repAvg)}</div><div class="small muted">${allRepos.length} piezas repuestas</div></div>
    <div class="card"><div class="k">Piezas pendientes</div><div class="v num" style="color:var(--no)">${pend}</div><div class="small muted">aún sin llegar</div></div>
  </div>
  <div class="dgrid">
    <section class="card pad"><h3 style="font-size:19px;margin-bottom:8px">Porcentaje entregado por estación</h3>${hbars(pctSt, v=>v+'%', 100)}</section>
    <section class="card pad"><h3 style="font-size:19px;margin-bottom:8px">Tiempo de revisión por estación</h3>${hbars(revSt, v=>fmtDur(v))}</section>
    <section class="card pad"><h3 style="font-size:19px;margin-bottom:2px">Tiempo de demora en reponer faltantes</h3><p class="small muted" style="margin:0 0 8px">Desde el reporte hasta que llega la pieza, en horario laboral.</p>${hbars(repSt, v=>fmtDur(v))}</section>
    <section class="card pad"><h3 style="font-size:19px;margin-bottom:8px">Buses con menor abastecimiento</h3>${hbars(pctBus, v=>v+'%', 100)}</section>
  </div>
  <div class="sec-title"><h2>Piezas que más faltan</h2></div>
  ${topMiss.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Pieza</th><th>Veces que faltó</th></tr></thead><tbody>${topMiss.map(([k,v])=>`<tr><td>${esc(k)}</td><td class="num">${v}</td></tr>`).join('')}</tbody></table></div>` : '<div class="card empty small">Sin faltantes registrados.</div>'}
  <div class="sec-title"><h2>Detalle de revisiones</h2><button class="btn" data-export style="margin-left:auto">Exportar CSV</button></div>
  ${recs.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>O/P</th><th>Cliente</th><th>Línea</th><th>Estación</th><th>Tipo</th><th>Inicio</th><th>Reporte</th><th>Revisión</th><th>Entregado</th><th>Pendientes</th></tr></thead><tbody>
    ${recs.sort((a,b)=>b.ck.start-a.ck.start).map(r=>`<tr><td><b>${esc(r.ck.op)}</b></td><td>${esc(r.ck.cliente)}</td><td>${r.ck.line}</td><td>${esc(stName(r.ck.station))}</td><td>${esc(r.area)}</td><td>${fmtDT(r.ck.start)}</td><td>${r.ck.end?fmtDT(r.ck.end):'<span class="pill run">En curso</span>'}</td><td>${fmtDur(r.revMs)}</td><td class="num">${pct(r.rec,r.req)}%</td><td>${r.pend?`<span class="pill no">${r.pend}</span>`:'<span class="pill ok">0</span>'}</td></tr>`).join('')}
  </tbody></table></div>` : '<div class="card empty small">Aún no hay revisiones.</div>'}`;
}
async function exportCSV(){
  const recs = dashData();
  const lines = [['O/P','Cliente','Linea','Modelo','Estacion','Tipo','Codigo','Pieza','Requerido','Recibido','Estado','Inicio revision','Reporte','Min revision','Llegada','Min reposicion']];
  for (const r of recs) for (const p of r.ps){
    const it = r.ck.items?.[p.id]; const got = received(it, +p.qty);
    lines.push([r.ck.op, r.ck.cliente, r.ck.line, r.model, stName(r.ck.station), r.area, p.code, p.desc, p.qty, got, it?.st||'sin marcar', fmtDT(r.ck.start), fmtDT(r.ck.end), r.revMs!=null?Math.round(r.revMs/60000):'', fmtDT(it?.arrivedAt), (it?.arrivedAt && r.ck.end && it.arrivedAt>r.ck.end)?Math.round(workMs(r.ck.end,it.arrivedAt)/60000):'']);
  }
  const csv = '\ufeff' + lines.map(l=>l.map(v=>{ const s=String(v??''); return /[;"\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; }).join(';')).join('\r\n');
  try { const dl = window.claude ? await window.claude.use('downloads') : null; if (!dl) { toast('La descarga no está disponible aquí.'); return; } await dl.save({filename:`control-fibra-${todayISO()}.csv`, data:csv}); }
  catch(e){ if (e?.code!=='cancelled') toast('No se descargó el archivo.'); }
}

/* ---------- PROGRAMACIÓN ---------- */
const COLS = ['mes','linea','op','cliente','chasis','estr','pint','acab','of','lib'];
function headerKey(h){
  const n = norm(h);
  if (n.includes('o/p') || n==='op' || n.includes('orden')) return 'op';
  if (n.includes('o/f') || n==='of' || n.includes('ingreso of')) return 'of';
  if (n.includes('cliente')) return 'cliente';
  if (n.includes('chasis')) return 'chasis';
  if (n.includes('estructura')) return 'estr';
  if (n.includes('pintura')) return 'pint';
  if (n.includes('acabado')) return 'acab';
  if (n.includes('liberacion')) return 'lib';
  if (n.includes('linea')) return 'linea';
  if (n.includes('produccion') || n.includes('mes')) return 'mes';
  return null;
}
function inferYear(m){ const now=new Date(); let y=now.getFullYear(); const d=m-now.getMonth(); if(d>6) y--; if(d<-6) y++; return y; }
function parseDate(v){
  const s = String(v??'').trim().replace(/\.$/,'');
  if (!s || s==='-') return null;
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})[-\/ ]([A-Za-zÁ-úñ]{3,})\.?(?:[-\/ ](\d{2,4}))?$/))){
    const mi = MONTHS[norm(m[2]).slice(0,3)]; if (mi==null) return null;
    let y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : inferYear(mi);
    return `${y}-${String(mi+1).padStart(2,'0')}-${String(+m[1]).padStart(2,'0')}`;
  }
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))){ let y=+m[3]; if(y<100) y+=2000; return `${y}-${String(+m[2]).padStart(2,'0')}-${String(+m[1]).padStart(2,'0')}`; }
  if (/^\d{5}$/.test(s)){ const d = new Date(Date.UTC(1899,11,30) + (+s)*86400000); return d.toISOString().slice(0,10); }
  return null;
}
function parsePlan(text, line){
  const rows = text.replace(/\r/g,'').split('\n').filter(r=>r.trim()).map(r=>r.split('\t'));
  if (!rows.length) return {buses:[], warn:['No se encontró texto para leer.']};
  let map = null, start = 0;
  const hi = rows.findIndex(r => r.some(c => ['op','cliente'].includes(headerKey(c))));
  if (hi >= 0){ map = rows[hi].map(headerKey); start = hi+1; } else map = COLS;
  const warn = []; if (!rows.some(r=>r.length>3)) warn.push('No se detectaron columnas. Copia las celdas directamente desde Excel.');
  const raw = [];
  for (let i=start;i<rows.length;i++){
    const r = rows[i]; const o = {d:{}};
    map.forEach((k, j) => { if(!k) return; const v = (r[j]??'').trim(); if (['chasis','estr','pint','acab','of','lib'].includes(k)) o.d[k] = parseDate(v); else o[k] = v; });
    if (!o.op || headerKey(o.op)==='op') continue;
    raw.push(o);
  }
  const count = {};
  const buses = raw.map(o => { const base = safeId(o.op); count[base]=(count[base]||0)+1; const id = line+'_'+base+(count[base]>1?'~'+count[base]:''); return {id, mes:o.mes||'', op:o.op, cliente:o.cliente||'', d:o.d}; });
  const noModel = buses.filter(b=>!modelOf(b.op)).length;
  if (noModel) warn.push(`${noModel} buses sin modelo reconocido. Puedes agregar su prefijo en Parámetros, Modelos.`);
  return {buses, warn};
}
function vPlan(){
  const P = S.plan; const L = P.line; const cur = S.plans[L];
  return `
  <div class="subtabs">${['L2','L1'].map(l=>`<button data-pline="${l}" aria-current="${L===l}">Programación ${l} (${S.plans[l].length})</button>`).join('')}</div>
  <div class="card pad">
    <h2 style="font-size:22px">Pegar planeamiento ${L}</h2>
    <p class="small muted" style="margin:4px 0 10px">Selecciona en Excel desde la fila de títulos (ES PRODUCCIÓN, LÍNEA, O/P, CLIENTE, ingresos y liberación), copia y pega aquí.</p>
    <textarea class="in" id="planText" placeholder="Pega aquí las celdas copiadas de Excel"></textarea>
    <div class="row" style="margin-top:10px">
      <div class="chips"><button class="chip" data-pmode="replace" aria-pressed="${P.mode==='replace'}">Reemplazar todo ${L}</button><button class="chip" data-pmode="merge" aria-pressed="${P.mode==='merge'}">Agregar y actualizar</button></div>
      <button class="btn primary" data-pparse style="margin-left:auto">Vista previa</button>
    </div>
  </div>
  ${P.preview ? `<div class="card pad" style="margin-top:12px;border-color:var(--brand)">
      <div class="row"><b class="grow">${P.preview.buses.length} buses leídos</b><button class="btn" data-pcancel>Cancelar</button><button class="btn primary" data-psave>Guardar en ${L}</button></div>
      ${P.preview.warn.map(w=>`<p class="small" style="color:var(--part);margin:6px 0 0">${esc(w)}</p>`).join('')}
      <div class="tbl-wrap" style="margin-top:10px;max-height:340px;overflow:auto">${planTable(P.preview.buses, false)}</div>
    </div>` : ''}
  <div class="sec-title"><h2>Buses en ${L}</h2>${cur.length?`<button class="btn danger" data-pclear style="margin-left:auto">Vaciar ${L}</button>`:''}</div>
  ${cur.length ? `<div class="tbl-wrap">${planTable(cur, true)}</div>` : '<div class="card empty">Sin buses. Pega tu planeamiento arriba.</div>'}`;
}
function planTable(bs, del){
  return `<table class="tbl"><thead><tr><th>Mes</th><th>O/P</th><th>Modelo</th><th>Cliente</th><th>Chasis</th><th>Estructuras</th><th>Pintura</th><th>Acabados</th><th>O/F</th><th>Liberación</th>${del?'<th></th>':''}</tr></thead><tbody>
  ${bs.map(b=>`<tr><td>${esc(b.mes)}</td><td><b>${esc(b.op)}</b></td><td>${esc(modelOf(b.op))||'<span class="pill no">?</span>'}</td><td>${esc(b.cliente)}</td><td>${fmtDate(b.d?.chasis)}</td><td>${fmtDate(b.d?.estr)}</td><td>${fmtDate(b.d?.pint)}</td><td>${fmtDate(b.d?.acab)}</td><td>${fmtDate(b.d?.of)}</td><td>${fmtDate(b.d?.lib)}</td>${del?`<td><button class="btn ghost danger" data-pdel="${esc(b.id)}" aria-label="Eliminar">Quitar</button></td>`:''}</tr>`).join('')}
  </tbody></table>`;
}

/* ---------- PARÁMETROS ---------- */
function draft(){ if (!S.params.draft) S.params.draft = clone(S.cfg); return S.params.draft; }
function markDirty(){ if (!S.params.dirty){ S.params.dirty = true; const b=$('#saveBar'); if(b) b.hidden=false; } }
const PARAMS_PW = '2026';
function vLock(){
  return `<div class="card pad lock">
    <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
    <h2 style="font-size:26px;margin:8px 0 4px">Parámetros protegidos</h2>
    <p class="muted" style="margin:0 0 16px">Ingresa la contraseña para modificar piezas, estaciones, modelos y horario.</p>
    <input class="in big-in" id="pw" type="password" inputmode="numeric" autocomplete="off" placeholder="Contraseña" aria-label="Contraseña">
    <p id="pwErr" class="small" style="color:var(--no);min-height:20px;margin:6px 0"></p>
    <button class="btn primary big" data-unlock>Desbloquear</button>
  </div>`;
}
function tryUnlock(){
  if (S.profile?.rol === 'admin') { S.params.unlocked = true; render(); return; }
  const i = $('#pw'); if (!i) return;
  const err = $('#pwErr'); if (err) err.textContent = 'Solo una cuenta administradora puede acceder a Parámetros.';
  i.value = ''; i.focus();
}
function vParams(){
  if (!S.params.unlocked){ setTimeout(() => $('#pw')?.focus(), 50); return vLock(); }
  const T = S.params.tab; const D = draft();
  const tabs = [['pieces','Piezas'],['stations','Estaciones'],['models','Modelos'],['schedule','Horario'],['areas','Tipos de pieza'],['logo','Logo'],['data','Borrar datos']];
  const body = ({pieces:pPieces, stations:pStations, models:pModels, schedule:pSchedule, areas:pAreas, logo:pLogo, data:pData})[T](D);
  return `<div class="subtabs">${tabs.map(([k,t])=>`<button data-ptab="${k}" aria-current="${T===k}">${t}</button>`).join('')}<button data-plock style="margin-left:auto;color:var(--no)">Bloquear</button></div>
  ${body}
  <div class="savebar" id="saveBar" ${S.params.dirty?'':'hidden'}><b class="grow">Tienes cambios sin guardar</b><button class="btn" data-pdiscard>Descartar</button><button class="btn primary" data-psavecfg>Guardar cambios</button></div>`;
}
function allStations(D){ return [...(D.stations.L1||[]).map(s=>({...s,L:'L1'})), ...(D.stations.L2||[]).map(s=>({...s,L:'L2'}))]; }
function pPieces(D){
  const models = [...new Set([...D.pieces.map(p=>p.model), ...D.models.map(m=>m.model)])].filter(Boolean);
  const sts = allStations(D);
  let list = D.pieces;
  if (S.params.pModel!=='all') list = list.filter(p=>p.model===S.params.pModel);
  if (S.params.pStation!=='all') list = list.filter(p=>p.station===S.params.pStation);
  return `
  <div class="row" style="margin-bottom:10px">
    <select class="in" style="width:auto" data-pf="pModel"><option value="all">Todos los modelos</option>${models.map(m=>`<option ${S.params.pModel===m?'selected':''}>${esc(m)}</option>`).join('')}</select>
    <select class="in" style="width:auto" data-pf="pStation"><option value="all">Todas las estaciones</option>${sts.map(s=>`<option value="${esc(s.id)}" ${S.params.pStation===s.id?'selected':''}>${esc(s.name)} (${s.L})</option>`).join('')}</select>
    <span class="muted small grow">${list.length} piezas</span>
    <button class="btn" data-pastepieces>Pegar piezas de Excel</button>
    <button class="btn primary" data-addpiece>Agregar pieza</button>
  </div>
  <div id="pastePieces" hidden class="card pad" style="margin-bottom:10px">
    <p class="small muted" style="margin:0 0 6px">Columnas: Modelo, Estación, Código, Descripción, Cantidad, Estación de abastecimiento y, opcional, Tipo (Fibra de vidrio, Pintura o Minifábrica). Con o sin fila de títulos. Las piezas con el mismo modelo y código se actualizan.</p>
    <textarea class="in" id="piecesText"></textarea>
    <div class="row" style="margin-top:8px"><button class="btn primary" data-importpieces>Agregar al catálogo</button></div>
  </div>
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Modelo</th><th>Estación</th><th>Código</th><th>Descripción</th><th>Cant.</th><th>Se abastece en</th><th>Tipo</th><th></th></tr></thead><tbody>
  ${list.map(p=>`<tr data-prow="${esc(p.id)}">
    <td><input data-pk="model" value="${esc(p.model)}" style="width:80px"></td>
    <td><select data-pk="station">${sts.map(s=>`<option value="${esc(s.id)}" ${p.station===s.id?'selected':''}>${esc(s.name)} (${s.L})</option>`).join('')}${sts.some(s=>s.id===p.station)?'':`<option selected value="${esc(p.station)}">${esc(p.station)}</option>`}</select></td>
    <td><input data-pk="code" value="${esc(p.code)}" style="width:80px"></td>
    <td><input data-pk="desc" value="${esc(p.desc)}" style="min-width:260px"></td>
    <td><input data-pk="qty" type="number" min="0" value="${esc(p.qty)}" style="width:64px"></td>
    <td><input data-pk="abast" value="${esc(p.abast)}" style="width:110px"></td>
    <td><select data-pk="area">${D.areas.map(a=>`<option ${p.area===a?'selected':''}>${esc(a)}</option>`).join('')}${D.areas.includes(p.area)?'':`<option selected>${esc(p.area||'')}</option>`}</select></td>
    <td><button class="btn ghost danger" data-delpiece="${esc(p.id)}">Eliminar</button></td></tr>`).join('')}
  </tbody></table></div>`;
}
function pStations(D){
  return `<div class="dgrid">${['L1','L2'].map(L=>`
    <section class="card pad st-list"><h3 style="font-size:20px">Línea ${L.slice(1)} <span class="muted small">${D.stations[L].length} estaciones</span></h3>
      <p class="small muted" style="margin:2px 0 8px">En este orden aparecen en la línea.</p>
      ${D.stations[L].map((s,i)=>`<div class="st-row">
        <input class="in" data-stname="${L}|${i}" value="${esc(s.name)}">
        <button class="icon-btn" data-stmove="${L}|${i}|-1" aria-label="Subir">↑</button><button class="icon-btn" data-stmove="${L}|${i}|1" aria-label="Bajar">↓</button>
        <button class="icon-btn" data-stdel="${L}|${i}" aria-label="Eliminar" style="color:var(--no)">✕</button></div>`).join('')}
      <button class="btn" data-staddd="${L}" style="margin-top:8px">Agregar estación</button>
    </section>`).join('')}</div>`;
}
function pModels(D){
  return `<div class="card pad" style="max-width:640px">
    <p class="small muted" style="margin:0 0 10px">El modelo de cada bus se reconoce por el inicio de su O/P. Por ejemplo, las O/P que empiezan con Z5 son ZEUS5 y usan sus piezas.</p>
    ${D.models.map((m,i)=>`<div class="row" style="margin-bottom:6px"><input class="in" style="width:140px" data-mk="prefix|${i}" value="${esc(m.prefix)}" placeholder="Prefijo O/P"><span class="muted">es</span><input class="in grow" data-mk="model|${i}" value="${esc(m.model)}" placeholder="Modelo"><button class="icon-btn" data-mdel="${i}" style="color:var(--no)" aria-label="Eliminar">✕</button></div>`).join('')}
    <button class="btn" data-madd style="margin-top:6px">Agregar regla</button>
  </div>`;
}
function pSchedule(D){
  return `<div class="dgrid">
    <section class="card pad"><h3 style="font-size:20px;margin-bottom:8px">Horario por día</h3>
      ${[1,2,3,4,5,6,0].map(d=>{ const s=D.schedule[d]; return `<div class="row" style="margin-bottom:6px"><label class="row" style="width:130px;gap:6px"><input type="checkbox" data-sday="${d}" ${s?'checked':''}> ${DAYS[d]}</label>
        <input type="time" class="in" style="width:120px" data-stime="${d}|s" value="${s?.s||''}" ${s?'':'disabled'}><span class="muted">a</span><input type="time" class="in" style="width:120px" data-stime="${d}|e" value="${s?.e||''}" ${s?'':'disabled'}></div>`; }).join('')}
    </section>
    <section class="card pad"><h3 style="font-size:20px;margin-bottom:4px">Tiempos que no cuentan</h3>
      <p class="small muted" style="margin:0 0 8px">El refrigerio y otras pausas se descuentan de los tiempos de revisión y de reposición.</p>
      ${D.breaks.map((b,i)=>`<div class="row" style="margin-bottom:6px"><input class="in" style="width:130px" data-bk="name|${i}" value="${esc(b.name||'')}" placeholder="Nombre"><input type="time" class="in" style="width:115px" data-bk="s|${i}" value="${b.s}"><span class="muted">a</span><input type="time" class="in" style="width:115px" data-bk="e|${i}" value="${b.e}"><button class="icon-btn" data-bdel="${i}" style="color:var(--no)" aria-label="Eliminar">✕</button></div>`).join('')}
      <button class="btn" data-badd>Agregar pausa</button>
    </section></div>`;
}
function pAreas(D){
  return `<div class="card pad" style="max-width:520px">
    <p class="small muted" style="margin:0 0 10px">Tipos de pieza que se revisan por separado en cada estación (cada uno con su propio tiempo). También filtran faltantes y dashboard.</p>
    ${D.areas.map((a,i)=>`<div class="row" style="margin-bottom:6px"><input class="in grow" data-area="${i}" value="${esc(a)}"><button class="icon-btn" data-adel="${i}" style="color:var(--no)" aria-label="Eliminar">✕</button></div>`).join('')}
    <button class="btn" data-aadd>Agregar tipo</button></div>`;
}
function pLogo(D){
  return `<div class="card pad" style="max-width:560px">
    <p class="small muted" style="margin:0 0 12px">Sube el logo de la empresa (PNG o JPG). Se muestra en la barra superior para todo el equipo.</p>
    <div class="logo-preview"><div class="logo-inline">${logoHTML(D.logo)}</div></div>
    <div class="row" style="margin-top:12px"><label class="btn primary" style="display:inline-block">Elegir imagen<input type="file" id="logoFile" accept="image/*" hidden></label>${D.logo?'<button class="btn danger" data-logodel>Volver al logo original</button>':''}</div>
  </div>`;
}
function pData(){
  const ids = Object.keys(S.checks);
  const buses = [...new Set(Object.values(S.checks).map(c => c.busId))].map(id => busById(id) || {id, op: (Object.values(S.checks).find(c=>c.busId===id)||{}).op || id});
  return `<div class="card pad" style="max-width:620px">
    <h3 style="font-size:22px;margin-bottom:4px">Borrar revisiones</h3>
    <p class="small muted" style="margin:0 0 14px">Borra las marcas de piezas y los tiempos registrados. No se borran la programación, las piezas ni los demás parámetros. No se puede deshacer.</p>
    <p style="margin:0 0 12px">Hay <b>${ids.length}</b> revisiones registradas en <b>${buses.length}</b> buses.</p>
    <label class="small muted" for="wipeWhat">Qué borrar</label>
    <select class="in" id="wipeWhat" style="margin:4px 0 12px"><option value="all">Todas las revisiones (empezar desde cero)</option>${buses.map(b=>`<option value="${esc(b.id)}">Solo el bus ${esc(b.op)}</option>`).join('')}</select>
    <label class="small muted" for="wipePw">Confirma con la contraseña</label>
    <input class="in big-in" id="wipePw" type="password" inputmode="numeric" autocomplete="off" placeholder="Contraseña" style="margin:4px 0 4px">
    <p id="wipeErr" class="small" style="color:var(--no);min-height:20px;margin:4px 0"></p>
    <button class="btn big" data-wipe style="background:var(--no);border-color:var(--no);color:#fff" ${ids.length?'':'disabled'}>Eliminar revisiones</button>
  </div>`;
}
async function wipeChecks(){
  const pw = $('#wipePw'); if (!pw) return;
  if (pw.value !== PARAMS_PW){ $('#wipeErr').textContent = 'Contraseña incorrecta.'; pw.value = ''; pw.focus(); return; }
  const what = $('#wipeWhat').value;
  const ids = Object.keys(S.checks).filter(id => what === 'all' || S.checks[id].busId === what);
  if (!ids.length) return;
  if (!confirm(what === 'all' ? `¿Eliminar las ${ids.length} revisiones? No se puede deshacer.` : `¿Eliminar las ${ids.length} revisiones de este bus? No se puede deshacer.`)) return;
  const btn = $('[data-wipe]'); if (btn){ btn.disabled = true; btn.textContent = 'Eliminando…'; }
  let fail = 0;
  for (const id of ids){
    pendingIds.delete(id); writeQ.delete('checks/'+id);
    try {
      if (mode === 'local') localStorage.removeItem('fv:checks/'+id);
      else if (db) await db.doc('checks/'+id).delete();
      delete S.checks[id];
    } catch(e){ fail++; }
  }
  toast(fail ? `No se pudieron eliminar ${fail} revisiones.` : 'Revisiones eliminadas');
  render();
}
function importPieces(text){
  const D = draft();
  const rows = text.replace(/\r/g,'').split('\n').filter(r=>r.trim()).map(r=>r.split('\t').map(c=>c.trim()));
  let n=0, u=0;
  const stByName = new Map(allStations(D).map(s=>[norm(s.name), s.id]).concat(allStations(D).map(s=>[norm(s.id), s.id])));
  for (const r of rows){
    let c = r; if (/^\d+$/.test(c[0]) && c.length>=7) c = c.slice(1); // columna IDPieza opcional
    if (norm(c[0])==='modelo') continue;
    const [model, stRaw, code, desc, qty, abast, area] = c;
    if (!model || !code) continue;
    const station = stByName.get(norm(stRaw)) || safeId(stRaw);
    const ex = D.pieces.find(p=>p.model===model && p.code===code);
    const obj = {model, station, code, desc:desc||'', qty:+qty||0, abast:abast||'', area: area && !/^[0-9a-f-]{30,}$/.test(area) ? area : (ex?.area || D.areas[0] || '')};
    if (ex){ Object.assign(ex, obj); u++; } else { D.pieces.push({id:'p'+uid(), ...obj}); n++; }
  }
  markDirty(); render(); toast(`${n} piezas nuevas, ${u} actualizadas`);
}

/* ============ eventos ============ */
document.addEventListener('submit', async e => {
  if (e.target.id !== 'loginForm') return;
  e.preventDefault();
  if (!supabaseConfigured) return;
  S.authBusy = true;
  const errorEl=$('#loginError'); if(errorEl) errorEl.textContent='';
  const button=e.target.querySelector('button[type="submit"]'); if(button){button.disabled=true;button.textContent='Ingresando…';}
  const {error}=await requireSupabase().auth.signInWithPassword({email:$('#loginEmail').value.trim(),password:$('#loginPassword').value});
  S.authBusy=false;
  if(error){showLogin('No se pudo ingresar. Revisa el correo y la contraseña.'); const p=$('#loginPassword'); if(p)p.focus();}
});
document.addEventListener('click', e => {
  const t = e.target.closest('button,[data-mclose]'); if (!t) return;
  const ds = t.dataset;
  // ventana de cantidad
  if ('mclose' in ds){ if (t.classList.contains('modal-bg') && e.target !== t) return; closeQty(); return; }
  if ('mok' in ds){ saveQty(); return; }
  if (ds.mstep){ const i = $('#mq'); i.value = Math.max(0, Math.min(QM.max, (+i.value||0) + (+ds.mstep))); return; }
  if (ds.nav){ if (ds.nav==='review' && S.view==='review') { S.rv={bus:null,station:null}; } go(ds.nav); return; }
  if ('logout' in ds){ requireSupabase().auth.signOut().catch(()=>toast('No se pudo cerrar sesión.')); return; }
  // inicio
  if (ds.hmode){ S.homeMode = ds.hmode; render(); return; }
  if (ds.hline){ S.homeLine = ds.hline; render(); return; }
  if (ds.hfilter){ S.homeFilter = ds.hfilter; render(); return; }
  if (ds.open){ const b = busById(ds.open); S.rv = {bus:ds.open, station:ds.st}; if (!S.cfg.areas.includes(S.rvArea)) S.rvArea = AREA0();
    if (!stationStat(b, ds.st, S.rvArea).ps.length){ const a = S.cfg.areas.find(x => stationStat(b, ds.st, x).ps.length); if (a) S.rvArea = a; else S.rv.station = null; }
    go('review'); return; }
  if (ds.arrive){ const ck = S.checks[ds.arrive]; if(!ck) return; setItem(ck, ds.pid, 'ok'); saveCheck(ds.arrive); toast('Marcado como llegado'); render(); return; }
  if (ds.mpart){ openQty(ds.pid, ds.mpart); return; }
  // revisar
  if (ds.rvarea){ S.rvArea = ds.rvarea; render(); return; }
  if (ds.rv==='reset'){ S.rv={bus:null,station:null}; render(); return; }
  if (ds.rv==='bus'){ S.rv.station=null; render(); return; }
  if (t.id==='busGo'){ const v = $('#busInput').value.trim(); const b = allBuses().find(x=>norm(x.op)===norm(v)) || (v && allBuses().find(x=>norm(x.op).includes(norm(v)))); if(!b){ toast('No se encontró ese bus en la programación.'); return; } S.rv={bus:b.id,station:null}; render(); return; }
  if (ds.pickbus){ S.rv={bus:ds.pickbus,station:null}; render(); window.scrollTo(0,0); return; }
  if (ds.pickst){ S.rv.station = ds.pickst; render(); window.scrollTo(0,0); return; }
  if (ds.mark){ if (ds.mark==='parcial') openQty(ds.pid); else markPiece(ds.pid, ds.mark); return; }
  if ('report' in ds || 'finish' in ds){ const [id, ck] = curCheck(false); if(!ck) return; const b = busById(ck.busId); const ps = piecesFor(modelOf(b.op), ck.station).filter(p => areaOf(p) === (ck.area||AREA0()));
    for (const p of ps) if (!ck.items[p.id]) ck.items[p.id] = {st:'no', qty:0, req:+p.qty, at:Date.now()};
    ck.end = Date.now(); ck.updatedAt=Date.now(); saveCheck(id);
    if ('finish' in ds){ S.rv = {bus:null, station:null}; S.homeMode = 'buses'; toast('Revisión terminada'); go('home'); }
    else { toast('Revisión reportada'); render(); }
    return; }
  if ('reopen' in ds){ if(!confirm('¿Reabrir la revisión? El tiempo seguirá corriendo desde el inicio original.')) return; const [id, ck] = curCheck(false); ck.end = null; ck.updatedAt=Date.now(); saveCheck(id); render(); return; }
  // dashboard
  if ('export' in ds){ exportCSV(); return; }
  // programación
  if (ds.pline){ S.plan.line = ds.pline; S.plan.preview=null; render(); return; }
  if (ds.pmode){ S.plan.mode = ds.pmode; render(); return; }
  if ('pparse' in ds){ const txt = $('#planText').value; S.plan.preview = parsePlan(txt, S.plan.line); S.plan.text = txt; render(); return; }
  if ('pcancel' in ds){ S.plan.preview=null; render(); return; }
  if ('psave' in ds){ const L=S.plan.line; const nb = S.plan.preview.buses;
    if (S.plan.mode==='replace') S.plans[L] = nb;
    else { const ids = new Set(nb.map(b=>b.id)); S.plans[L] = [...S.plans[L].filter(b=>!ids.has(b.id)), ...nb]; }
    S.plans[L].sort((a,b)=>(a.d?.acab||'9').localeCompare(b.d?.acab||'9'));
    S.plan.preview=null; savePlan(L); toast(`Programación ${L} guardada`); render(); return; }
  if (ds.pdel){ const L=S.plan.line; S.plans[L] = S.plans[L].filter(b=>b.id!==ds.pdel); savePlan(L); render(); return; }
  if ('pclear' in ds){ const L=S.plan.line; if(!confirm(`¿Vaciar toda la programación de ${L}? Las revisiones registradas se conservan.`)) return; S.plans[L]=[]; savePlan(L); render(); return; }
  // parámetros
  if ('unlock' in ds){ tryUnlock(); return; }
  if ('wipe' in ds){ wipeChecks(); return; }
  if ('plock' in ds){ S.params.unlocked = false; render(); return; }
  if (ds.ptab){ S.params.tab = ds.ptab; render(); return; }
  if ('psavecfg' in ds){ S.cfg = clone(S.params.draft); buildIndex(); S.params.dirty=false; S.params.draft=null; saveCfg(); toast('Parámetros guardados'); render(); return; }
  if ('pdiscard' in ds){ S.params.dirty=false; S.params.draft=null; render(); return; }
  const D = S.view==='params' ? draft() : null;
  if (!D) return;
  if ('addpiece' in ds){ const st = S.params.pStation!=='all' ? S.params.pStation : (D.stations.L2[0]?.id||''); const md = S.params.pModel!=='all' ? S.params.pModel : (D.models[0]?.model||''); D.pieces.push({id:'p'+uid(), model:md, station:st, code:'', desc:'', qty:1, abast:'', area:D.areas[0]||''}); markDirty(); render(); return; }
  if (ds.delpiece){ D.pieces = D.pieces.filter(p=>p.id!==ds.delpiece); markDirty(); render(); return; }
  if ('pastepieces' in ds){ const b=$('#pastePieces'); b.hidden=!b.hidden; return; }
  if ('importpieces' in ds){ importPieces($('#piecesText').value); return; }
  if (ds.staddd){ const L=ds.staddd; const name = prompt('Nombre de la estación (ej. E27):'); if(!name) return; let id = safeId(name); while (allStations(D).some(s=>s.id===id)) id += '_'+L; D.stations[L].push({id, name:name.trim()}); markDirty(); render(); return; }
  if (ds.stmove){ const [L,i,d] = ds.stmove.split('|'); const a=D.stations[L], j=+i+(+d); if(j<0||j>=a.length) return; [a[+i],a[j]]=[a[j],a[+i]]; markDirty(); render(); return; }
  if (ds.stdel){ const [L,i] = ds.stdel.split('|'); const s = D.stations[L][+i]; const n = D.pieces.filter(p=>p.station===s.id).length; if(!confirm(`¿Eliminar ${s.name}?${n?` Tiene ${n} piezas asignadas que dejarán de mostrarse.`:''}`)) return; D.stations[L].splice(+i,1); markDirty(); render(); return; }
  if ('madd' in ds){ D.models.push({prefix:'',model:''}); markDirty(); render(); return; }
  if (ds.mdel){ D.models.splice(+ds.mdel,1); markDirty(); render(); return; }
  if ('badd' in ds){ D.breaks.push({name:'',s:'',e:''}); markDirty(); render(); return; }
  if (ds.bdel){ D.breaks.splice(+ds.bdel,1); markDirty(); render(); return; }
  if ('aadd' in ds){ D.areas.push('Nuevo tipo'); markDirty(); render(); return; }
  if (ds.adel){ D.areas.splice(+ds.adel,1); markDirty(); render(); return; }
  if ('logodel' in ds){ D.logo = ''; markDirty(); render(); return; }
});
document.addEventListener('input', e => {
  const t = e.target; const ds = t.dataset;
  if (t.id==='homeQ'){ S.homeQ = t.value; clearTimeout(window._hq); window._hq = setTimeout(()=>{ const pos=t.selectionStart; render(); const n=$('#homeQ'); if(n){ n.focus(); n.setSelectionRange(pos,pos);} }, 250); return; }
  if (S.view!=='params') return;
  const D = draft();
  if (ds.pk){ const id = t.closest('tr').dataset.prow; const p = D.pieces.find(x=>x.id===id); if(!p) return; p[ds.pk] = ds.pk==='qty' ? +t.value : t.value; markDirty(); return; }
  if (ds.stname){ const [L,i]=ds.stname.split('|'); D.stations[L][+i].name = t.value; markDirty(); return; }
  if (ds.mk){ const [k,i]=ds.mk.split('|'); D.models[+i][k] = t.value.trim(); markDirty(); return; }
  if (ds.stime){ const [d,k]=ds.stime.split('|'); if(D.schedule[d]) D.schedule[d][k]=t.value; markDirty(); return; }
  if (ds.bk){ const [k,i]=ds.bk.split('|'); D.breaks[+i][k]=t.value; markDirty(); return; }
  if (ds.area!=null && ds.area!==''){ D.areas[+ds.area]=t.value; markDirty(); return; }
});
document.addEventListener('change', e => {
  const t = e.target; const ds = t.dataset;
  if (t.id==='homeArea'){ S.homeArea = t.value; render(); return; }
  if (ds.df){ S.dash[ds.df] = t.value; render(); return; }
  if (ds.pf){ S.params[ds.pf] = t.value; render(); return; }
  if (ds.sday){ const D=draft(); D.schedule[ds.sday] = t.checked ? {s:'07:00',e:'17:20'} : null; markDirty(); render(); return; }
  if (t.id==='logoFile' && t.files[0]){ loadLogo(t.files[0]); return; }
});
document.addEventListener('keydown', e => {
  if (e.key==='Enter' && e.target.id==='busInput') $('#busGo').click();
  if (e.key==='Enter' && e.target.id==='pw') tryUnlock();
  if (e.key==='Enter' && e.target.id==='wipePw') wipeChecks();
  if (QM && e.key==='Enter') { e.preventDefault(); saveQty(); }
  if (QM && e.key==='Escape') closeQty();
});
function loadLogo(file){
  const r = new FileReader();
  r.onload = () => { const img = new Image(); img.onload = () => {
    const h = Math.min(160, img.height), w = Math.round(img.width * h / img.height);
    const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
    draft().logo = c.toDataURL('image/png'); markDirty(); render(); };
    img.onerror = () => toast('No se pudo leer la imagen.'); img.src = r.result; };
  r.readAsDataURL(file);
}
function setHeaderH(){ const h = $('header.top'); if (h) document.documentElement.style.setProperty('--hh', h.offsetHeight + 'px'); }
window.addEventListener('resize', setHeaderH);

/* cronómetro */
function tick(){ for (const el of document.querySelectorAll('[data-timer]')) el.textContent = fmtClock(workMs(+el.dataset.timer, Date.now())); }
setInterval(tick, 1000);

init();

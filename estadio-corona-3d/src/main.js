import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import maplibregl from 'maplibre-gl';
import * as THREE from 'three';
import { SITE, CURRENCY, KICKOFF } from './config.js';
import { ZONES } from './layout.js';
import { createStadium } from './stadium.js';
import { sunInfo, localToDate, fmtLocal, todayLocalYMD, worldToLocalDir, seatSunlit } from './sun.js';

const $ = (id) => document.getElementById(id);
const INTRO = !new URLSearchParams(location.search).has('sinintro');
const stadium = createStadium();
const { scene, root, sections, palcos } = stadium;

// ============================================================================
// Estado
// ============================================================================
// sel: null | { type: 'section', sec } | { type: 'seat', sec, i } | { type: 'palco', i }
const state = {
  ymd: todayLocalYMD(),
  minutes: 17 * 60,
  sun: null,
  sunLocal: [0, 0, -1],
  colorMode: 'real', // 'real' | 'libre' | 'zona' | 'sol'
  roof: true,
  scenery: true,
  sel: null,
  playing: false,
  maxPrice: Infinity,
  reserved: loadReserved(),
  mini: false, // boleto minimizado en la vista desde el lugar
};

const money = (n) => `$${n.toLocaleString('es-MX')} ${CURRENCY}`;
const priceOf = (sec) => ZONES[sec.zone].price;
const seatKey = (sec, st) => `${sec.number}-${st.rowL}-${st.num}`;
const palcoKey = (p) => p.id;

function loadReserved() {
  try { return new Set(JSON.parse(localStorage.getItem('tsm-apartados') || '[]')); } catch { return new Set(); }
}
function saveReserved() {
  try { localStorage.setItem('tsm-apartados', JSON.stringify([...state.reserved])); } catch { /* sin almacenamiento */ }
}

const selSec = () => (state.sel && state.sel.sec) || null;
const selSeat = () => (state.sel?.type === 'seat' ? state.sel.sec.seats[state.sel.i] : null);
const selPalco = () => (state.sel?.type === 'palco' ? palcos[state.sel.i] : null);

// Punto de vista (marco local) del lugar elegido: ojos de quien está sentado o en el palco.
function spotLocal() {
  const st = selSeat();
  if (st) return { x: st.x, y: st.y, z: st.z + 1.2, seatZ: st.z };
  const p = selPalco();
  if (p) return { x: p.eye.x, y: p.eye.y, z: p.eye.z, seatZ: p.eye.z - 1.2 };
  return null;
}

// ============================================================================
// Mapa + capa 3D
// ============================================================================
const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    },
    layers: [
      // Fondo de respaldo (terreno) por si los mosaicos de OSM no cargan.
      { id: 'fondo', type: 'background', paint: { 'background-color': '#cbbf9f' } },
      { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-fade-duration': 150 } },
    ],
  },
  center: [SITE.lng, SITE.lat],
  // Arranca lejos y llega volando al estadio (se omite con ?sinintro)
  zoom: INTRO ? 13.6 : 16.4,
  pitch: INTRO ? 20 : 55,
  bearing: INTRO ? -80 : -20,
  maxPitch: 85,
  antialias: true,
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

const origin = maplibregl.MercatorCoordinate.fromLngLat([SITE.lng, SITE.lat], 0);
const s = origin.meterInMercatorCoordinateUnits();
const modelMatrix = new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z).scale(new THREE.Vector3(s, -s, s));
const mapCam = new THREE.Camera();
let mapRenderer = null;

function applyViewMode(mode) {
  const seat = mode === 'seat';
  stadium.shadowGround.visible = !seat;
  stadium.terrain.visible = seat;
  stadium.sky.visible = seat && stadium.night < 0.97;
  scene.background = seat && stadium.night >= 0.97 ? stadium.nightColor : null;
  stadium.roof.visible = seat || state.roof;
  stadium.scenery.group.visible = seat || state.scenery;
  stadium.scenery.hills.visible = seat;
  const op = seat ? 1 : THREE.MathUtils.clamp(1 - (map.getZoom() - 17) * 0.6, 0.3, 1);
  for (const m of stadium.roofMats) { m.opacity = op; m.depthWrite = op > 0.99; }
  marker.visible = !seat && !!spotLocal();
}

const stadiumLayer = {
  id: 'estadio-3d',
  type: 'custom',
  renderingMode: '3d',
  onAdd(m, gl) {
    mapRenderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true });
    mapRenderer.autoClear = false;
    mapRenderer.shadowMap.enabled = true;
    mapRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
  },
  render(gl, args) {
    const main = args?.defaultProjectionData?.mainMatrix ?? args;
    mapCam.projectionMatrix.fromArray(main).multiply(modelMatrix);
    mapCam.projectionMatrixInverse.copy(mapCam.projectionMatrix).invert();
    applyViewMode('map');
    mapRenderer.resetState();
    mapRenderer.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    mapRenderer.render(scene, mapCam);
    if (marker.visible) map.triggerRepaint(); // anima el marcador
  },
};
// Se añade en cuanto el estilo está listo ('load' depende de que carguen los mosaicos).
function addStadiumLayer() {
  if (map.getLayer(stadiumLayer.id)) return;
  map.addLayer(stadiumLayer);
  updateSun();
  if (INTRO) setTimeout(() => map.flyTo({ center: [SITE.lng, SITE.lat], zoom: 16.4, pitch: 55, bearing: -20, duration: 4200, curve: 1.2 }), 300);
}
map.on('style.load', addStadiumLayer);
map.on('load', addStadiumLayer);

// Marcador animado sobre el lugar elegido
const marker = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.6, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf2b632 }));
marker.visible = false;
root.add(marker);
const clock = new THREE.Clock();
marker.onBeforeRender = () => {
  const p = spotLocal();
  if (p) marker.position.set(p.x, p.y, p.seatZ + 3.2 + Math.sin(clock.getElapsedTime() * 3) * 0.4);
};

// ============================================================================
// Coordenadas
// ============================================================================
function localToWorld(x, y, z = 0) {
  root.updateMatrixWorld();
  return new THREE.Vector3(x, y, z).applyMatrix4(root.matrixWorld);
}
function worldToLngLat(v) {
  const lat = SITE.lat + v.y / 111320;
  const lng = SITE.lng + v.x / (111320 * Math.cos((SITE.lat * Math.PI) / 180));
  return [lng, lat];
}
// La cámara queda sobre la cancha mirando hacia el lugar, así se ve de frente.
const bearingFromCenter = (w) => (Math.atan2(w.x, w.y) * 180) / Math.PI;

// ============================================================================
// Colores de asientos y palcos
// ============================================================================
const C = {
  sun: new THREE.Color('#ff9f1c'), shade: new THREE.Color('#3a7bd5'),
  sel: new THREE.Color('#f2b632'), mine: new THREE.Color('#ffcf4a'),
  white: new THREE.Color('#ffffff'), grey: new THREE.Color('#4a4f4c'),
  free: new THREE.Color('#22c55e'), taken: new THREE.Color('#7b827e'),
  glass: new THREE.Color('#24465e'), glassFree: new THREE.Color('#58a6d6'), glassTaken: new THREE.Color('#2b3238'),
};
const c = new THREE.Color();

function recolor(sec) {
  const highlighted = sec === selSec();
  const selI = state.sel?.type === 'seat' && highlighted ? state.sel.i : -1;
  for (let i = 0; i < sec.seats.length; i++) {
    const st = sec.seats[i];
    if (state.colorMode === 'sol' && sec.sunlit) c.copy(sec.sunlit[i] ? C.sun : C.shade);
    else if (state.colorMode === 'zona') c.copy(sec.baseColor);
    else if (state.colorMode === 'libre') c.copy(st.taken ? C.taken : C.free);
    else c.copy(sec.realColor);
    if (priceOf(sec) > state.maxPrice) c.lerp(C.grey, 0.85);
    if (highlighted) c.lerp(C.white, 0.25);
    if (state.reserved.has(seatKey(sec, st))) c.copy(C.mine);
    if (i === selI) c.copy(C.sel);
    sec.mesh.setColorAt(i, c);
  }
  sec.mesh.instanceColor.needsUpdate = true;
}
function recolorPalcos() {
  const selI = state.sel?.type === 'palco' ? state.sel.i : -1;
  palcos.forEach((p, i) => {
    if (state.colorMode === 'libre') c.copy(p.taken ? C.glassTaken : C.glassFree);
    else c.copy(C.glass);
    if (state.reserved.has(palcoKey(p))) c.copy(C.mine);
    if (i === selI) c.copy(C.sel);
    stadium.palcoMesh.setColorAt(i, c);
  });
  stadium.palcoMesh.instanceColor.needsUpdate = true;
}
const recolorAll = () => { sections.forEach(recolor); recolorPalcos(); };

function computeSunMap() {
  const L = state.sunLocal;
  let lit = 0, total = 0;
  for (const sec of sections) {
    sec.sunlit = sec.sunlit || new Uint8Array(sec.seats.length);
    for (let i = 0; i < sec.seats.length; i++) {
      const st = sec.seats[i];
      const v = seatSunlit(st.x, st.y, st.z, L) ? 1 : 0;
      sec.sunlit[i] = v; lit += v;
    }
    total += sec.seats.length;
  }
  return state.sun.altitudeDeg <= 0
    ? 'El sol está bajo el horizonte: todo el estadio está en sombra.'
    : `<b>${Math.round((lit / total) * 100)}%</b> de los asientos al sol · <b>${Math.round(((total - lit) / total) * 100)}%</b> en sombra`;
}
function updateModeStats() {
  const el = $('modeStats');
  if (state.colorMode === 'sol') { el.innerHTML = computeSunMap(); el.hidden = false; }
  else if (state.colorMode === 'libre') {
    const total = stadium.totalSeats;
    const free = sections.reduce((n, sec) => n + sec.seats.filter((st) => !st.taken).length, 0);
    const pFree = palcos.filter((p) => !p.taken).length;
    el.innerHTML = `<b>${free.toLocaleString('es-MX')}</b> asientos libres de ${total.toLocaleString('es-MX')} · <b>${pFree}</b> palcos VIP libres`;
    el.hidden = false;
  } else el.hidden = true;
}

// ============================================================================
// Selección
// ============================================================================
function setSel(sel, fly) {
  const prevSec = selSec();
  state.sel = sel;
  if (prevSec && prevSec !== selSec()) recolor(prevSec);
  if (selSec()) recolor(selSec());
  recolorPalcos();
  document.querySelectorAll('.sections button').forEach((b) => b.classList.toggle('active', !!selSec() && b.dataset.id === selSec().id));
  renderTicket();
  if (fly && sel) {
    const spot = spotLocal();
    const p = spot ? localToWorld(spot.x, spot.y, spot.seatZ) : localToWorld(sel.sec.center.x, sel.sec.center.y);
    map.flyTo({ center: worldToLngLat(p), zoom: spot ? 18.6 : 17.9, pitch: 62, bearing: bearingFromCenter(p), duration: 1400 });
  }
  if (sv.active) { if (spotLocal()) aimAtPitch(); else exitSeatView(); }
  map.triggerRepaint();
}
const selectSection = (sec, seatIndex = -1, fly = true) =>
  setSel(sec ? (seatIndex >= 0 ? { type: 'seat', sec, i: seatIndex } : { type: 'section', sec }) : null, fly);
const selectPalco = (i, fly = true) => setSel({ type: 'palco', i }, fly);

// Palco VIP libre más cercano (nivel 2 preferido) a la posición actual.
function nearestFreePalco() {
  const spot = spotLocal() || { y: 0 };
  let best = -1, bd = Infinity;
  palcos.forEach((p, i) => {
    if (p.taken) return;
    const dd = Math.abs(p.y - spot.y) + (p.level === 2 ? 0 : 6);
    if (dd < bd) { bd = dd; best = i; }
  });
  return best;
}

// ============================================================================
// Boleto
// ============================================================================
function barcode(code) {
  let h = 2166136261;
  const bars = [];
  let x = 0;
  for (let k = 0; k < 46; k++) {
    h = Math.imul(h ^ code.charCodeAt(k % code.length) ^ k, 16777619);
    const w = 1 + ((h >>> 3) % 3);
    if (k % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${w}" height="40"/>`);
    x += w;
  }
  return `<svg viewBox="0 0 ${x} 40" preserveAspectRatio="none" fill="currentColor" aria-hidden="true">${bars.join('')}</svg>`;
}

function sunChip(spot) {
  if (!state.sun || state.sun.altitudeDeg <= 0) return '🌙 De noche';
  return seatSunlit(spot.x, spot.y, spot.seatZ, state.sunLocal) ? `☀️ Al sol a las ${fmt12(state.minutes)}` : `⛱️ Sombra a las ${fmt12(state.minutes)}`;
}

const field = (label, value) => `<div><small>${label}</small><b>${value}</b></div>`;

const miniBtn = () => `<button data-act="mini">${state.mini ? 'Ver boleto ▴' : 'Ocultar ▾'}</button>`;

function renderTicket() {
  const wrap = $('ticketWrap');
  const sel = state.sel;
  document.body.classList.toggle('has-ticket', !!sel);
  if (!sel) { wrap.hidden = true; return; }
  wrap.hidden = false;
  const inView = sv.active;
  const pill = $('ticketPill');
  pill.hidden = !inView;
  wrap.classList.toggle('mini', inView && state.mini);
  let html = '', actions = '';

  if (sel.type === 'palco') {
    const p = palcos[sel.i];
    const mine = state.reserved.has(palcoKey(p));
    pill.innerHTML = `Así se ve la cancha desde tu palco ${miniBtn()}`;
    html = `<article class="ticket vip">
      <button class="t-close" data-act="close" aria-label="Cerrar">×</button>
      <div class="t-main">
        <div class="t-head"><span>Estadio TSM Corona</span><span>Torreón, Coahuila</span></div>
        <h3 class="t-title">Palco VIP · Nivel ${p.level}</h3>
        <div class="t-sub">Edificio poniente · bajo techo · hasta 10 personas</div>
        <div class="t-fields">${field('Palco', p.num)}${field('Nivel', p.level)}${field('Fila', 'A')}${field('Acceso', 'Acceso Club')}</div>
        <div class="t-meta">${mine ? '<span class="mine">★ Apartado por ti</span>' : p.taken ? '<span class="no">Ocupado</span>' : '<span class="ok">Libre</span>'}<span>${sunChip(spotLocal())}</span></div>
      </div>
      <div class="t-stub"><small>Precio</small><span class="price">${money(p.price)}</span><small>por persona</small>${barcode(p.id)}<code>TSM ${p.id}</code></div>
    </article>`;
    actions = `${inView ? '' : '<button class="go" data-act="view">👁 Ver desde mi palco</button>'}
      <button class="vipb" data-act="reserve" ${p.taken && !mine ? 'disabled' : ''}>${mine ? 'Liberar mi palco' : p.taken ? 'Palco ocupado' : 'Apartar mi palco'}</button>
      <button data-act="nextPalco">Elegir otro palco</button>
      ${p.level < 3 ? '<button data-act="palcoUp">Palcos altos ▲</button>' : ''}${p.level > 1 ? '<button data-act="palcoDown">Palcos bajos ▼</button>' : ''}
      ${inView ? '<button data-act="change">Volver a gradas</button>' : ''}`;
  } else if (sel.type === 'seat') {
    const sec = sel.sec, st = sec.seats[sel.i];
    const mine = state.reserved.has(seatKey(sec, st));
    const w = localToWorld(st.x, st.y, st.z);
    pill.innerHTML = `Así se ve la cancha desde tu lugar ${miniBtn()}`;
    html = `<article class="ticket">
      <button class="t-close" data-act="close" aria-label="Cerrar">×</button>
      <div class="t-main">
        <div class="t-head"><span>Estadio TSM Corona</span><span>Torreón, Coahuila</span></div>
        <h3 class="t-title">${sec.sideName}</h3>
        <div class="t-sub">${ZONES[sec.zone].label} · ${sec.tierLabel}</div>
        <div class="t-fields">${field('Sección', sec.number)}${field('Fila', st.rowL)}${field('Asiento', st.num)}${field('Acceso', sec.gate)}</div>
        <div class="t-meta">${mine ? '<span class="mine">★ Apartado por ti</span>' : st.taken ? '<span class="no">Ocupado</span>' : '<span class="ok">Libre</span>'}<span>${sunChip(spotLocal())}</span><span>${Math.round(Math.hypot(w.x, w.y))} m al centro</span></div>
      </div>
      <div class="t-stub"><small>Precio</small><span class="price">${money(priceOf(sec))}</span><small>por boleto</small>${barcode(seatKey(sec, st))}<code>TSM ${sec.number} ${st.rowL}${String(st.num).padStart(3, '0')}</code></div>
    </article>`;
    actions = `${inView ? '' : '<button class="go" data-act="view">👁 Ver desde mi lugar</button>'}
      <button class="${inView ? 'go' : ''}" data-act="reserve" ${st.taken && !mine ? 'disabled' : ''}>${mine ? 'Liberar mi lugar' : st.taken ? 'Lugar ocupado' : 'Apartar mi lugar'}</button>
      ${inView ? '<button data-act="change">Cambiar asiento</button>' : ''}
      <button class="vipb" data-act="vip">⭐ Subir a palco VIP</button>`;
  } else {
    const sec = sel.sec;
    const free = sec.seats.filter((st) => !st.taken).length;
    html = `<article class="ticket">
      <button class="t-close" data-act="close" aria-label="Cerrar">×</button>
      <div class="t-main">
        <div class="t-head"><span>Estadio TSM Corona</span><span>Torreón, Coahuila</span></div>
        <h3 class="t-title">${sec.sideName}</h3>
        <div class="t-sub">${ZONES[sec.zone].label} · ${sec.tierLabel} · toca un asiento en el mapa para elegirlo</div>
        <div class="t-fields">${field('Sección', sec.number)}${field('Filas', sec.rowRange)}${field('Libres', free.toLocaleString('es-MX'))}${field('Acceso', sec.gate)}</div>
      </div>
      <div class="t-stub"><small>Precio</small><span class="price">${money(priceOf(sec))}</span><small>por boleto</small>${barcode(String(sec.number))}<code>TSM ${sec.number}</code></div>
    </article>`;
    actions = `<button class="go" data-act="view">👁 Ver desde aquí</button><button class="vipb" data-act="vip">⭐ Palco VIP</button>`;
  }
  $('ticket').innerHTML = html;
  $('ticketActions').innerHTML = actions;
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2600);
}

function onTicketAction(act) {
  const sel = state.sel;
  if (!sel) return;
  if (act === 'mini') { state.mini = !state.mini; renderTicket(); return; }
  if (act === 'close') { if (sv.active) exitSeatView(); setSel(null, false); return; }
  if (act === 'view') {
    if (sel.type === 'section') {
      const sec = sel.sec;
      const midRow = sec.firstRow + Math.floor(sec.rows / 2);
      const row = sec.seats.map((st, i) => [st, i]).filter(([st]) => st.row === midRow && !st.taken);
      const pick = row.length ? row[Math.floor(row.length / 2)][1] : Math.floor(sec.seats.length / 2);
      setSel({ type: 'seat', sec, i: pick }, false);
    }
    enterSeatView();
    return;
  }
  if (act === 'reserve') {
    if (sel.type === 'palco') {
      const p = palcos[sel.i], k = palcoKey(p);
      if (state.reserved.has(k)) { state.reserved.delete(k); toast(`Liberaste el palco ${p.num} · Nivel ${p.level}`); }
      else if (!p.taken) { state.reserved.add(k); toast(`Palco ${p.num} · Nivel ${p.level} apartado (en este navegador)`); }
    } else if (sel.type === 'seat') {
      const st = sel.sec.seats[sel.i], k = seatKey(sel.sec, st);
      if (state.reserved.has(k)) { state.reserved.delete(k); toast(`Liberaste Sección ${sel.sec.number} · Fila ${st.rowL} · Asiento ${st.num}`); }
      else if (!st.taken) { state.reserved.add(k); toast(`Apartaste Sección ${sel.sec.number} · Fila ${st.rowL} · Asiento ${st.num} (en este navegador)`); }
    }
    saveReserved();
    recolorAll();
    renderTicket();
    map.triggerRepaint();
    return;
  }
  if (act === 'change') {
    exitSeatView();
    const sec = selSec() || sections.find((x) => x.number === 113);
    setSel({ type: 'section', sec }, true);
    return;
  }
  if (act === 'vip') {
    const i = nearestFreePalco();
    if (i < 0) { toast('No hay palcos VIP libres'); return; }
    selectPalco(i, !sv.active);
    if (!sv.active) enterSeatView();
    return;
  }
  if (act === 'palcoUp' || act === 'palcoDown') {
    const cur = palcos[sel.i];
    const level = cur.level + (act === 'palcoUp' ? 1 : -1);
    let best = -1, bd = Infinity;
    palcos.forEach((p, i) => { if (p.level === level && !p.taken && Math.abs(p.num - cur.num) < bd) { bd = Math.abs(p.num - cur.num); best = i; } });
    if (best >= 0) selectPalco(best, !sv.active); else toast(`No hay palcos libres en el nivel ${level}`);
    return;
  }
  if (act === 'nextPalco') {
    const start = sel.type === 'palco' ? sel.i : -1;
    for (let k = 1; k <= palcos.length; k++) {
      const i = (start + k) % palcos.length;
      if (!palcos[i].taken) { selectPalco(i, !sv.active); return; }
    }
  }
}
$('ticketWrap').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b && !b.disabled) onTicketAction(b.dataset.act);
});

// ============================================================================
// Picking en el mapa
// ============================================================================
const raycaster = new THREE.Raycaster();
function pick(point) {
  if (!mapRenderer) return null;
  const canvas = map.getCanvas();
  const x = (point.x / canvas.clientWidth) * 2 - 1;
  const y = 1 - (point.y / canvas.clientHeight) * 2;
  const near = new THREE.Vector3(x, y, -1).applyMatrix4(mapCam.projectionMatrixInverse);
  const far = new THREE.Vector3(x, y, 1).applyMatrix4(mapCam.projectionMatrixInverse);
  raycaster.set(near, far.sub(near).normalize());
  const hit = raycaster.intersectObjects([...stadium.hitMeshes, stadium.palcoMesh], false)[0];
  if (!hit) return null;
  if (hit.object === stadium.palcoMesh) return { type: 'palco', i: hit.instanceId };
  const sec = hit.object.userData.section;
  const lp = root.worldToLocal(hit.point.clone());
  let best = -1, bd = Infinity;
  sec.seats.forEach((st, i) => {
    const dd = (st.x - lp.x) ** 2 + (st.y - lp.y) ** 2 + ((st.z - lp.z) * 1.5) ** 2;
    if (dd < bd) { bd = dd; best = i; }
  });
  return { type: 'seat', sec, i: best };
}

map.on('click', (e) => {
  const r = pick(e.point);
  if (r) setSel(r, true);
});

let hoverPending = false;
map.on('mousemove', (e) => {
  if (hoverPending) return;
  hoverPending = true;
  requestAnimationFrame(() => {
    hoverPending = false;
    const r = pick(e.point);
    const card = $('hovercard');
    map.getCanvas().style.cursor = r ? 'pointer' : '';
    if (!r) { card.hidden = true; return; }
    let kicker, status, title, price;
    if (r.type === 'palco') {
      const p = palcos[r.i];
      const mine = state.reserved.has(palcoKey(p));
      kicker = 'Palco VIP'; status = mine ? 'Tuyo' : p.taken ? 'Ocupado' : 'Libre';
      title = `Palco ${p.num} · Nivel ${p.level}`;
      price = `${money(p.price)} <small>por persona</small>`;
    } else {
      const st = r.sec.seats[r.i];
      const mine = state.reserved.has(seatKey(r.sec, st));
      kicker = r.sec.sideName; status = mine ? 'Tuyo' : st.taken ? 'Ocupado' : 'Libre';
      title = `Sección ${r.sec.number} · Fila ${st.rowL} · Asiento ${st.num}`;
      price = `${money(priceOf(r.sec))} <small>por boleto</small>`;
    }
    card.innerHTML = `<div class="hk"><span>${kicker}</span><span class="${status === 'Ocupado' ? 'taken' : 'free'}">${status}</span></div><div class="ht">${title}</div><div class="hp">${price}</div>`;
    card.hidden = false;
    card.style.left = `${e.point.x}px`;
    card.style.top = `${e.point.y}px`;
  });
});
map.on('mouseout', () => ($('hovercard').hidden = true));

// ============================================================================
// Sol y barra de horario
// ============================================================================
const T_MIN = 360, T_MAX = 1380;
const currentDate = () => localToDate(state.ymd, state.minutes);
function fmt12(m) {
  const h = Math.floor(m / 60) % 24, mm = Math.floor(m % 60);
  return `${h % 12 || 12}:${String(mm).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
function fmtDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const txt = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
  return txt.replace(',', '').replace(/^./, (ch) => ch.toUpperCase());
}
const pct = (m) => ((m - T_MIN) / (T_MAX - T_MIN)) * 100;
// Corrige el desfase del pulgar (16 px) para que las marcas queden sobre la posición real.
const trackLeft = (m) => `calc(${pct(m)}% + ${8 - (pct(m) / 100) * 16}px)`;

function updateSun() {
  state.sun = sunInfo(currentDate());
  state.sunLocal = worldToLocalDir(state.sun.dir);
  const { day } = stadium.setSun(state.sun.dir);
  $('timeLabel').textContent = fmt12(state.minutes);
  $('dateLabel').textContent = fmtDate(state.ymd);
  $('sunAlt').textContent = state.sun.altitudeDeg > 0
    ? `☀️ Sol a ${state.sun.altitudeDeg.toFixed(0)}° de altura`
    : '🌙 Sol bajo el horizonte';
  $('sunTimes').textContent = `Amanece ${fmtLocal(state.sun.sunrise)} · Anochece ${fmtLocal(state.sun.sunset)} · Silbatazo ${fmt12(KICKOFF)}`;
  if (map.getLayer('osm')) {
    map.setPaintProperty('osm', 'raster-brightness-max', 0.28 + 0.72 * day);
    map.setPaintProperty('osm', 'raster-saturation', -0.5 * (1 - day));
    map.setPaintProperty('fondo', 'background-color', `hsl(42, ${20 + 10 * day}%, ${12 + 60 * day}%)`);
  }
  if (state.colorMode === 'sol') { updateModeStats(); recolorAll(); }
  if (state.sel) renderTicket();
  map.triggerRepaint();
}

const timeInput = $('time');
const dateInput = $('date');
timeInput.min = T_MIN; timeInput.max = T_MAX;
timeInput.value = state.minutes;
dateInput.value = state.ymd;
$('ticks').innerHTML = [360, 540, 720, 900, 1080, 1260].map((m) => `<span style="left:${trackLeft(m)}">${fmt12(m).replace(':00', '')}</span>`).join('');
$('kickoff').style.left = trackLeft(KICKOFF);
$('kickoff').title = `Silbatazo: ${fmt12(KICKOFF)} (toca para ir)`;
$('matchBand').style.left = trackLeft(KICKOFF);
$('matchBand').style.width = `${(Math.min(110, T_MAX - KICKOFF) / (T_MAX - T_MIN)) * 100}%`;

let sunPending = false;
const scheduleSun = () => {
  if (sunPending) return;
  sunPending = true;
  requestAnimationFrame(() => { sunPending = false; updateSun(); });
};
timeInput.addEventListener('input', () => { state.minutes = +timeInput.value; scheduleSun(); });
dateInput.addEventListener('change', () => { if (dateInput.value) { state.ymd = dateInput.value; scheduleSun(); } });
$('kickoff').addEventListener('click', () => { state.minutes = KICKOFF; timeInput.value = KICKOFF; scheduleSun(); });

$('play').addEventListener('click', () => {
  state.playing = !state.playing;
  $('play').textContent = state.playing ? '❚❚' : '▶';
  let last = performance.now();
  const tick = (t) => {
    if (!state.playing) return;
    const dt = (t - last) / 1000; last = t;
    state.minutes += dt * 60; // 1 hora por segundo
    if (state.minutes > T_MAX) state.minutes = T_MIN;
    timeInput.value = Math.floor(state.minutes);
    updateSun();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

// ============================================================================
// Panel
// ============================================================================
$('capacity').textContent = stadium.totalSeats.toLocaleString('es-MX');
$('legend').innerHTML = Object.values(ZONES)
  .sort((a, b) => b.price - a.price)
  .map((z) => `<li><span class="chip" style="background:${z.color}"></span><span class="zl">${z.label}</span><span class="zp">${money(z.price)}</span></li>`)
  .join('');
$('vipFrom').textContent = `desde ${money(Math.min(...palcos.map((p) => p.price)))} p/p`;
$('vipBtn').addEventListener('click', () => {
  const i = nearestFreePalco();
  if (i >= 0) selectPalco(i, true);
});

for (const sec of sections) {
  const b = document.createElement('button');
  b.textContent = sec.number;
  b.dataset.id = sec.id;
  b.style.background = ZONES[sec.zone].color;
  b.title = `${sec.sideName} · ${ZONES[sec.zone].label} · ${money(priceOf(sec))}`;
  b.addEventListener('click', () => selectSection(sec, -1, true));
  $(sec.tier === 'upper' ? 'sectionsUpper' : 'sectionsLower').appendChild(b);
}
{
  // Presupuesto: atenúa las zonas más caras que el tope elegido.
  const prices = Object.values(ZONES).map((z) => z.price);
  const lo = Math.min(...prices), hi = Math.max(...prices);
  const range = $('budget');
  range.min = lo; range.max = hi; range.step = 10; range.value = hi;
  const label = () => {
    const v = +range.value;
    state.maxPrice = v >= hi ? Infinity : v;
    const n = sections.filter((x) => priceOf(x) <= v).reduce((a, x) => a + x.seats.filter((st) => !st.taken).length, 0);
    $('budgetLabel').textContent = v >= hi ? 'todas las zonas' : `hasta ${money(v)}`;
    $('budgetCount').textContent = `${n.toLocaleString('es-MX')} asientos libres dentro del presupuesto`;
    document.querySelectorAll('.sections button').forEach((btn) => {
      const sec = sections.find((x) => x.id === btn.dataset.id);
      btn.style.opacity = sec && priceOf(sec) > v ? 0.3 : 1;
    });
  };
  label();
  range.addEventListener('input', () => { label(); recolorAll(); map.triggerRepaint(); });
}
document.querySelectorAll('input[name="colorMode"]').forEach((el) => el.addEventListener('change', () => {
  if (!el.checked) return;
  state.colorMode = el.value;
  updateModeStats();
  recolorAll();
  map.triggerRepaint();
}));
$('optRoof').addEventListener('change', (e) => { state.roof = e.target.checked; map.triggerRepaint(); });
$('optScenery').addEventListener('change', (e) => { state.scenery = e.target.checked; map.triggerRepaint(); });
$('optShadows').addEventListener('change', (e) => {
  stadium.lights.sun.castShadow = e.target.checked;
  stadium.shadowGround.material.opacity = e.target.checked ? 0.38 : 0;
  map.triggerRepaint();
});
$('resetView').addEventListener('click', () => {
  setSel(null, false);
  map.flyTo({ center: [SITE.lng, SITE.lat], zoom: 16.4, pitch: 55, bearing: -20, duration: 1200 });
});
function showPanel(show) {
  $('panel').hidden = !show;
  $('openPanel').hidden = show;
}
$('panelToggle').addEventListener('click', () => showPanel(false));
$('openPanel').addEventListener('click', () => showPanel(true));
if (matchMedia('(max-width: 560px)').matches) showPanel(false);

// ============================================================================
// Vista desde el asiento / palco
// ============================================================================
const sv = { active: false, renderer: null, camera: new THREE.PerspectiveCamera(70, 1, 0.1, 20000), yaw: 0, pitch: 0 };
sv.camera.up.set(0, 0, 1);

function ensureSvRenderer() {
  if (sv.renderer) return;
  sv.renderer = new THREE.WebGLRenderer({ canvas: $('svCanvas'), antialias: true });
  sv.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  sv.renderer.shadowMap.enabled = true;
  sv.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  sv.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  sv.renderer.toneMappingExposure = 0.8;
}
function eyeWorld() {
  const p = spotLocal();
  return localToWorld(p.x, p.y, p.z);
}
function aimAtPitch() {
  const eye = eyeWorld();
  const d = new THREE.Vector3(0, 0, 0).sub(eye);
  sv.yaw = Math.atan2(d.y, d.x);
  // En pantalla vertical: lente más abierta y mirada más abajo para que la cancha
  // quede arriba del boleto.
  const portrait = sv.camera.aspect < 0.9;
  sv.pitch = Math.atan2(d.z, Math.hypot(d.x, d.y)) + (portrait ? -0.3 : 0.08);
  sv.camera.fov = portrait ? 92 : 72;
}
function enterSeatView() {
  if (!spotLocal()) return;
  ensureSvRenderer();
  sv.active = true;
  document.body.classList.add('in-seat');
  $('seatview').hidden = false;
  $('hovercard').hidden = true;
  resizeSv();
  aimAtPitch();
  renderTicket();
  requestAnimationFrame(svLoop);
}
function exitSeatView() {
  if (!sv.active) return;
  sv.active = false;
  document.body.classList.remove('in-seat');
  $('seatview').hidden = true;
  renderTicket();
  map.triggerRepaint();
}
function resizeSv() {
  if (!sv.renderer) return;
  const el = $('svCanvas');
  sv.renderer.setSize(el.clientWidth, el.clientHeight, false);
  sv.camera.aspect = el.clientWidth / Math.max(1, el.clientHeight);
  sv.camera.updateProjectionMatrix();
}
addEventListener('resize', resizeSv);
function svLoop() {
  if (!sv.active) return;
  const eye = eyeWorld();
  const dir = new THREE.Vector3(Math.cos(sv.pitch) * Math.cos(sv.yaw), Math.cos(sv.pitch) * Math.sin(sv.yaw), Math.sin(sv.pitch));
  sv.camera.position.copy(eye);
  sv.camera.lookAt(eye.clone().add(dir));
  sv.camera.updateProjectionMatrix();
  applyViewMode('seat');
  sv.renderer.render(scene, sv.camera);
  requestAnimationFrame(svLoop);
}
{
  const canvas = $('svCanvas');
  const pointers = new Map();
  let pinch = 0;
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); });
  canvas.addEventListener('pointerup', (e) => { pointers.delete(e.pointerId); pinch = 0; });
  canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); pinch = 0; });
  canvas.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) sv.camera.fov = THREE.MathUtils.clamp(sv.camera.fov * (pinch / dist), 15, 90);
      pinch = dist;
      return;
    }
    const k = (sv.camera.fov / 70) * 0.005;
    sv.yaw += (e.clientX - prev[0]) * k;
    sv.pitch = THREE.MathUtils.clamp(sv.pitch + (e.clientY - prev[1]) * k, -1.3, 1.3);
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    sv.camera.fov = THREE.MathUtils.clamp(sv.camera.fov * (1 + e.deltaY * 0.001), 15, 90);
  }, { passive: false });
}
$('svBack').addEventListener('click', exitSeatView);
addEventListener('keydown', (e) => { if (e.key === 'Escape' && sv.active) exitSeatView(); });
function stepSpot(delta) {
  const sel = state.sel;
  if (sel?.type === 'seat') setSel({ type: 'seat', sec: sel.sec, i: THREE.MathUtils.clamp(sel.i + delta, 0, sel.sec.seats.length - 1) }, false);
  else if (sel?.type === 'palco') setSel({ type: 'palco', i: (sel.i + delta + palcos.length) % palcos.length }, false);
}
$('svPrev').addEventListener('click', () => stepSpot(-1));
$('svNext').addEventListener('click', () => stepSpot(1));

recolorAll();
updateSun();

// Acceso para depuración desde la consola
window.__estadio = { map, stadium, state, selectSection, selectPalco, enterSeatView, pick, onTicketAction };

import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import maplibregl from 'maplibre-gl';
import * as THREE from 'three';
import { SITE, CURRENCY } from './config.js';
import { ZONES } from './layout.js';
import { createStadium } from './stadium.js';
import { sunInfo, localToDate, fmtLocal, todayLocalYMD, worldToLocalDir, seatSunlit } from './sun.js';

const $ = (id) => document.getElementById(id);
const stadium = createStadium();
const { scene, root, sections } = stadium;

// ---------------- estado ----------------
const state = {
  ymd: todayLocalYMD(),
  minutes: 17 * 60,
  sun: null,
  sunLocal: [0, 0, -1],
  sunMap: false,
  roof: true,
  section: null,
  seatIndex: -1,
  playing: false,
  maxPrice: Infinity,
};

const money = (n) => `$${n.toLocaleString('es-MX')} ${CURRENCY}`;
const priceOf = (sec) => ZONES[sec.zone].price;

// ---------------- mapa ----------------
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
  zoom: 16.6,
  pitch: 58,
  bearing: -25,
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
  // En el mapa el techo se vuelve translúcido al acercarse para dejar ver los asientos.
  const op = seat ? 1 : THREE.MathUtils.clamp(1 - (map.getZoom() - 17) * 0.6, 0.3, 1);
  stadium.roofMat.opacity = op;
  stadium.roofMat.depthWrite = op > 0.99;
  marker.visible = !seat && state.seatIndex >= 0;
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

// Se añade en cuanto el estilo está listo (no esperamos a 'load', que depende de
// que carguen todos los mosaicos).
function addStadiumLayer() {
  if (map.getLayer(stadiumLayer.id)) return;
  map.addLayer(stadiumLayer);
  updateSun();
}
map.on('style.load', addStadiumLayer);
map.on('load', addStadiumLayer);

// ---------------- marcador del asiento elegido ----------------
const marker = new THREE.Mesh(
  new THREE.ConeGeometry(0.9, 2.6, 16).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffd23f }),
);
marker.visible = false;
root.add(marker);
const clock = new THREE.Clock();
marker.onBeforeRender = () => {
  const seat = currentSeat();
  if (!seat) return;
  marker.position.set(seat.x, seat.y, seat.z + 3.2 + Math.sin(clock.getElapsedTime() * 3) * 0.4);
};

// ---------------- coordenadas ----------------
const tmp = new THREE.Vector3();
function localToWorld(x, y, z = 0) {
  root.updateMatrixWorld();
  return tmp.set(x, y, z).applyMatrix4(root.matrixWorld).clone();
}
function worldToLngLat(v) {
  const lat = SITE.lat + v.y / 111320;
  const lng = SITE.lng + v.x / (111320 * Math.cos((SITE.lat * Math.PI) / 180));
  return [lng, lat];
}
// Rumbo desde el centro de la cancha hacia el punto: la cámara queda sobre la cancha
// mirando hacia la grada, así se ven los asientos de frente.
function bearingFromCenter(w) {
  return (Math.atan2(w.x, w.y) * 180) / Math.PI;
}

// ---------------- selección y colores ----------------
const COLOR_SUN = new THREE.Color('#ff9f1c');
const COLOR_SHADE = new THREE.Color('#3a7bd5');
const COLOR_SEL = new THREE.Color('#ffd23f');
const WHITE = new THREE.Color('#ffffff');
const GREY = new THREE.Color('#4a4f4c');
const c = new THREE.Color();

function currentSeat() {
  return state.section && state.seatIndex >= 0 ? state.section.seats[state.seatIndex] : null;
}

function recolor(sec) {
  const highlighted = sec === state.section;
  for (let i = 0; i < sec.seats.length; i++) {
    if (state.sunMap && sec.sunlit) c.copy(sec.sunlit[i] ? COLOR_SUN : COLOR_SHADE);
    else c.copy(sec.baseColor);
    if (priceOf(sec) > state.maxPrice) c.lerp(GREY, 0.85);
    if (highlighted) c.lerp(WHITE, 0.35);
    if (highlighted && i === state.seatIndex) c.copy(COLOR_SEL);
    sec.mesh.setColorAt(i, c);
  }
  sec.mesh.instanceColor.needsUpdate = true;
}
const recolorAll = () => sections.forEach(recolor);

function computeSunMap() {
  const L = state.sunLocal;
  let lit = 0, total = 0;
  for (const sec of sections) {
    sec.sunlit = sec.sunlit || new Uint8Array(sec.seats.length);
    let secLit = 0;
    for (let i = 0; i < sec.seats.length; i++) {
      const st = sec.seats[i];
      const v = seatSunlit(st.x, st.y, st.z, L) ? 1 : 0;
      sec.sunlit[i] = v; secLit += v;
    }
    sec.litShare = secLit / sec.seats.length;
    lit += secLit; total += sec.seats.length;
  }
  const el = $('sunStats');
  el.hidden = false;
  el.innerHTML = state.sun.altitudeDeg <= 0
    ? 'El sol está bajo el horizonte: todo el estadio está en sombra.'
    : `<b>${Math.round((lit / total) * 100)}%</b> de los asientos al sol · <b>${Math.round(((total - lit) / total) * 100)}%</b> en sombra`;
}

function selectSection(sec, seatIndex = -1, fly = true) {
  const prev = state.section;
  state.section = sec;
  state.seatIndex = seatIndex;
  if (prev && prev !== sec) recolor(prev);
  if (sec) recolor(sec);
  document.querySelectorAll('.sections button').forEach((b) => b.classList.toggle('active', sec && b.dataset.id === sec.id));
  renderCard();
  if (fly && sec) {
    const seat = currentSeat();
    const p = seat ? localToWorld(seat.x, seat.y, seat.z) : localToWorld(sec.center.x, sec.center.y);
    map.flyTo({ center: worldToLngLat(p), zoom: seat ? 18.6 : 17.8, pitch: 62, bearing: bearingFromCenter(p), duration: 1400 });
  }
  map.triggerRepaint();
}

function sunText(seat) {
  if (!state.sun || state.sun.altitudeDeg <= 0) return { cls: '', html: '🌙 De noche: sin sol directo' };
  const lit = seatSunlit(seat.x, seat.y, seat.z, state.sunLocal);
  return lit
    ? { cls: 'sun', html: `☀️ <b>Al sol</b> a las ${fmtLocal(currentDate())}` }
    : { cls: 'shade', html: `⛱️ <b>En sombra</b> a las ${fmtLocal(currentDate())}` };
}

function renderCard() {
  const sec = state.section;
  const card = $('card');
  if (!sec) { card.hidden = true; return; }
  card.hidden = false;
  const seat = currentSeat();
  $('cardKicker').textContent = `${sec.tierLabel} · ${ZONES[sec.zone].label}`;
  const facts = [['Precio', `<b class="price">${money(priceOf(sec))}</b>`], ['Ubicación', sec.sideName], ['Filas', sec.rows], ['Asientos', sec.seats.length.toLocaleString('es-MX')]];
  if (seat) {
    $('cardTitle').textContent = `Sección ${sec.number} · Fila ${seat.row} · Asiento ${seat.num}`;
    const w = localToWorld(seat.x, seat.y, seat.z);
    facts.splice(1, 0, ['Distancia al centro', `${Math.round(Math.hypot(w.x, w.y))} m`], ['Altura', `${seat.z.toFixed(1)} m`]);
    const st = sunText(seat);
    $('cardSun').className = `sunbadge ${st.cls}`;
    $('cardSun').innerHTML = st.html;
    $('cardSun').hidden = false;
    $('cardHint').textContent = 'Mueve la barra de horario para ver cómo cambia el sol.';
  } else {
    $('cardTitle').textContent = `Sección ${sec.number}`;
    $('cardSun').hidden = true;
    $('cardHint').textContent = 'Haz clic en un asiento de esta sección, o abre la vista desde un asiento central.';
  }
  $('cardFacts').innerHTML = facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

// ---------------- picking en el mapa ----------------
const raycaster = new THREE.Raycaster();
function pick(point) {
  if (!mapRenderer) return null;
  const canvas = map.getCanvas();
  const x = (point.x / canvas.clientWidth) * 2 - 1;
  const y = 1 - (point.y / canvas.clientHeight) * 2;
  const near = new THREE.Vector3(x, y, -1).applyMatrix4(mapCam.projectionMatrixInverse);
  const far = new THREE.Vector3(x, y, 1).applyMatrix4(mapCam.projectionMatrixInverse);
  raycaster.set(near, far.sub(near).normalize());
  const hit = raycaster.intersectObjects(stadium.hitMeshes, false)[0];
  if (!hit) return null;
  const sec = hit.object.userData.section;
  const lp = root.worldToLocal(hit.point.clone());
  let best = -1, bd = Infinity;
  sec.seats.forEach((st, i) => {
    const dd = (st.x - lp.x) ** 2 + (st.y - lp.y) ** 2 + ((st.z - lp.z) * 1.5) ** 2;
    if (dd < bd) { bd = dd; best = i; }
  });
  return { sec, seatIndex: best };
}

map.on('click', (e) => {
  const r = pick(e.point);
  if (r) selectSection(r.sec, r.seatIndex, true);
});

let hoverPending = false;
map.on('mousemove', (e) => {
  if (hoverPending) return;
  hoverPending = true;
  requestAnimationFrame(() => {
    hoverPending = false;
    const r = pick(e.point);
    const tip = $('tooltip');
    map.getCanvas().style.cursor = r ? 'pointer' : '';
    if (!r) { tip.hidden = true; return; }
    const st = r.sec.seats[r.seatIndex];
    tip.hidden = false;
    tip.style.left = `${e.point.x}px`;
    tip.style.top = `${e.point.y}px`;
    tip.textContent = `Sección ${r.sec.number} · Fila ${st.row} · Asiento ${st.num} · ${money(priceOf(r.sec))}`;
  });
});
map.on('mouseout', () => ($('tooltip').hidden = true));

// ---------------- sol / horario ----------------
const currentDate = () => localToDate(state.ymd, state.minutes);

function updateSun() {
  const date = currentDate();
  state.sun = sunInfo(date);
  state.sunLocal = worldToLocalDir(state.sun.dir);
  const { day } = stadium.setSun(state.sun.dir);
  $('timeLabel').textContent = fmtLocal(date);
  $('sunAlt').textContent = state.sun.altitudeDeg > 0
    ? `☀️ Altura ${state.sun.altitudeDeg.toFixed(0)}° · Azimut ${state.sun.azimuthDeg.toFixed(0)}°`
    : '🌙 Sol bajo el horizonte';
  $('sunTimes').textContent = `Amanece ${fmtLocal(state.sun.sunrise)} · Anochece ${fmtLocal(state.sun.sunset)}`;
  if (map.getLayer('osm')) {
    map.setPaintProperty('osm', 'raster-brightness-max', 0.28 + 0.72 * day);
    map.setPaintProperty('osm', 'raster-saturation', -0.5 * (1 - day));
    map.setPaintProperty('fondo', 'background-color', `hsl(42, ${20 + 10 * day}%, ${12 + 60 * day}%)`);
  }
  if (state.sunMap) { computeSunMap(); recolorAll(); }
  if (currentSeat()) renderCard();
  if (sv.active) updateSvLabel();
  map.triggerRepaint();
}

const timeInput = $('time');
const dateInput = $('date');
timeInput.value = state.minutes;
dateInput.value = state.ymd;
let sunPending = false;
const scheduleSun = () => {
  if (sunPending) return;
  sunPending = true;
  requestAnimationFrame(() => { sunPending = false; updateSun(); });
};
timeInput.addEventListener('input', () => { state.minutes = +timeInput.value; scheduleSun(); });
dateInput.addEventListener('change', () => { if (dateInput.value) { state.ymd = dateInput.value; scheduleSun(); } });

$('play').addEventListener('click', () => {
  state.playing = !state.playing;
  $('play').textContent = state.playing ? '❚❚' : '▶';
  let last = performance.now();
  const tick = (t) => {
    if (!state.playing) return;
    const dt = (t - last) / 1000; last = t;
    state.minutes = (state.minutes + dt * 60) % 1440; // 1 hora por segundo
    timeInput.value = Math.floor(state.minutes);
    updateSun();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

// ---------------- panel ----------------
$('capacity').textContent = stadium.totalSeats.toLocaleString('es-MX');
$('legend').innerHTML = Object.values(ZONES)
  .sort((a, b) => b.price - a.price)
  .map((z) => `<li><span class="chip" style="background:${z.color}"></span><span class="zl">${z.label}</span><span class="zp">${money(z.price)}</span></li>`)
  .join('');
{
  // Filtro de presupuesto: atenúa las zonas más caras que el tope elegido.
  const prices = Object.values(ZONES).map((z) => z.price);
  const lo = Math.min(...prices), hi = Math.max(...prices);
  const range = $('budget');
  range.min = lo; range.max = hi; range.step = 10; range.value = hi;
  const label = () => {
    const v = +range.value;
    state.maxPrice = v >= hi ? Infinity : v;
    const n = sections.filter((s) => priceOf(s) <= v).reduce((a, s) => a + s.seats.length, 0);
    $('budgetLabel').textContent = v >= hi ? 'todas las zonas' : `hasta ${money(v)}`;
    $('budgetCount').textContent = `${n.toLocaleString('es-MX')} asientos dentro del presupuesto`;
    document.querySelectorAll('.sections button').forEach((btn) => {
      const sec = sections.find((s) => s.id === btn.dataset.id);
      btn.style.opacity = sec && priceOf(sec) > v ? 0.3 : 1;
    });
  };
  label();
  range.addEventListener('input', () => { label(); recolorAll(); map.triggerRepaint(); });
}
for (const sec of sections) {
  const b = document.createElement('button');
  b.textContent = sec.number;
  b.dataset.id = sec.id;
  b.style.background = ZONES[sec.zone].color;
  b.title = `${sec.sideName} · ${ZONES[sec.zone].label} · ${money(priceOf(sec))}`;
  b.addEventListener('click', () => selectSection(sec, -1, true));
  $(sec.tier === 'upper' ? 'sectionsUpper' : 'sectionsLower').appendChild(b);
}
$('optSunMap').addEventListener('change', (e) => {
  state.sunMap = e.target.checked;
  if (state.sunMap) computeSunMap(); else $('sunStats').hidden = true;
  recolorAll();
  map.triggerRepaint();
});
$('optRoof').addEventListener('change', (e) => { state.roof = e.target.checked; map.triggerRepaint(); });
$('optShadows').addEventListener('change', (e) => {
  stadium.lights.sun.castShadow = e.target.checked;
  stadium.shadowGround.material.opacity = e.target.checked ? 0.38 : 0;
  map.triggerRepaint();
});
$('resetView').addEventListener('click', () => {
  selectSection(null, -1, false);
  map.flyTo({ center: [SITE.lng, SITE.lat], zoom: 16.6, pitch: 58, bearing: -25, duration: 1200 });
});
$('panelToggle').addEventListener('click', () => {
  const mobile = matchMedia('(max-width: 720px)').matches;
  $('panel').classList.toggle(mobile ? 'open' : 'collapsed');
});
$('cardClose').addEventListener('click', () => selectSection(null, -1, false));
$('btnSeatView').addEventListener('click', () => {
  const sec = state.section;
  if (!sec) return;
  if (state.seatIndex < 0) {
    // asiento central de la fila media
    const midRow = Math.ceil(sec.rows / 2);
    const rowSeats = sec.seats.map((st, i) => [st, i]).filter(([st]) => st.row === midRow);
    selectSection(sec, rowSeats[Math.floor(rowSeats.length / 2)][1], false);
  }
  enterSeatView();
});

// ---------------- vista desde el asiento ----------------
const sv = {
  active: false,
  renderer: null,
  camera: new THREE.PerspectiveCamera(70, 1, 0.1, 20000),
  yaw: 0, pitch: 0,
};
sv.camera.up.set(0, 0, 1);

function ensureSvRenderer() {
  if (sv.renderer) return;
  sv.renderer = new THREE.WebGLRenderer({ canvas: $('svCanvas'), antialias: true });
  sv.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  sv.renderer.shadowMap.enabled = true;
  sv.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  sv.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  sv.renderer.toneMappingExposure = 0.75;
}

function seatEye() {
  const st = currentSeat();
  return localToWorld(st.x, st.y, st.z + 1.2);
}

function updateSvLabel() {
  const sec = state.section, st = currentSeat();
  if (!st) return;
  const sun = sunText(st);
  $('svLabel').innerHTML = `<b>Sección ${sec.number}</b> · Fila ${st.row} · Asiento ${st.num} · ${money(priceOf(sec))} — ${sun.html}`;
}

function aimAtPitch() {
  const eye = seatEye();
  const d = new THREE.Vector3(0, 0, 0).sub(eye);
  sv.yaw = Math.atan2(d.y, d.x);
  sv.pitch = Math.atan2(d.z, Math.hypot(d.x, d.y));
  sv.camera.fov = 70;
}

function enterSeatView() {
  ensureSvRenderer();
  $('seatview').hidden = false;
  $('card').hidden = true;
  sv.active = true;
  aimAtPitch();
  updateSvLabel();
  resizeSv();
  requestAnimationFrame(svLoop);
}

function exitSeatView() {
  sv.active = false;
  $('seatview').hidden = true;
  renderCard();
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
  const eye = seatEye();
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
function stepSeat(delta) {
  const sec = state.section;
  const i = THREE.MathUtils.clamp(state.seatIndex + delta, 0, sec.seats.length - 1);
  selectSection(sec, i, false);
  updateSvLabel();
}
$('svPrev').addEventListener('click', () => stepSeat(-1));
$('svNext').addEventListener('click', () => stepSeat(1));

recolorAll();
updateSun();

// Acceso para depuración desde la consola
window.__estadio = { map, stadium, state, selectSection, enterSeatView, pick };

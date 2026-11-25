import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Sky } from 'three/addons/objects/Sky.js';
import {
  LOWER, UPPER, AISLE, FACADE, CANOPY, PRESS, ZONES, HX, HY, R,
  buildSections, polylineOf, ringPolyline, canopyWidth, buildPalcos, PALCO,
} from './layout.js';
import { SITE, PALCO_PRICES } from './config.js';
import { createScenery, sponsorTexture } from './scenery.js';

// ---------- utilidades de geometría ----------
class Builder {
  constructor() { this.pos = []; }
  tri(a, b, c) { this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.computeVertexNormals();
    return g;
  }
}
const V = (p, z) => ({ x: p.x, y: p.y, z });

// Banda horizontal entre dos polilíneas (interior F, exterior B) a altura z.
function band(b, F, B, z) {
  for (let i = 0; i < F.length - 1; i++) b.quad(V(F[i], z), V(B[i], z), V(B[i + 1], z), V(F[i + 1], z));
}
// Muro vertical a lo largo de una polilínea.
function wall(b, P, z0, z1) {
  for (let i = 0; i < P.length - 1; i++) b.quad(V(P[i], z0), V(P[i], z1), V(P[i + 1], z1), V(P[i + 1], z0));
}
const closed = (pts) => [...pts, pts[0]];

// Grada escalonada de una sección.
function standGeometry(piece, T) {
  const b = new Builder();
  let prevZ = 0;
  for (let r = 0; r < T.rows; r++) {
    const d0 = T.d0 + r * T.depth, d1 = d0 + T.depth;
    const z = T.z0 + r * T.riser;
    const F = polylineOf(piece, d0), B = polylineOf(piece, d1);
    wall(b, F, r === 0 ? (T === LOWER ? 0 : AISLE.z) : prevZ, z); // contrahuella
    band(b, F, B, z); // huella
    prevZ = z;
  }
  const back = polylineOf(piece, T.d0 + T.rows * T.depth);
  wall(b, back, prevZ, prevZ + T.rail); // barandal trasero
  return b.geometry();
}

function seatGeometry() {
  const pan = new THREE.BoxGeometry(0.44, 0.42, 0.08).translate(0, 0.02, 0.44);
  const back = new THREE.BoxGeometry(0.44, 0.06, 0.42).translate(0, -0.2, 0.68);
  const leg = new THREE.BoxGeometry(0.06, 0.06, 0.42).translate(0, 0, 0.21);
  return mergeGeometries([pan, back, leg]);
}

function pitchTexture() {
  const W = 680, Hh = 1050, s = 10; // 10 px por metro
  const c = document.createElement('canvas');
  c.width = W; c.height = Hh;
  const g = c.getContext('2d');
  for (let i = 0; i < 14; i++) {
    g.fillStyle = i % 2 ? '#24692c' : '#2b7a34';
    g.fillRect(0, (i * Hh) / 14, W, Hh / 14 + 1);
  }
  g.strokeStyle = '#f4f4f4';
  const m = (v) => v * s;
  g.lineWidth = m(0.12);
  g.strokeRect(m(0.06), m(0.06), W - m(0.12), Hh - m(0.12));
  g.beginPath(); g.moveTo(0, Hh / 2); g.lineTo(W, Hh / 2); g.stroke();
  g.beginPath(); g.arc(W / 2, Hh / 2, m(9.15), 0, Math.PI * 2); g.stroke();
  for (const top of [true, false]) {
    const y0 = top ? 0 : Hh;
    const sg = top ? 1 : -1;
    g.strokeRect(W / 2 - m(20.16), top ? 0 : Hh - m(16.5), m(40.32), m(16.5));
    g.strokeRect(W / 2 - m(9.16), top ? 0 : Hh - m(5.5), m(18.32), m(5.5));
    g.beginPath(); g.arc(W / 2, y0 + sg * m(11), m(9.15), top ? 0.2 * Math.PI : 1.2 * Math.PI, top ? 0.8 * Math.PI : 1.8 * Math.PI); g.stroke();
    g.fillStyle = '#f4f4f4';
    g.beginPath(); g.arc(W / 2, y0 + sg * m(11), m(0.3), 0, Math.PI * 2); g.fill();
  }
  g.beginPath(); g.arc(W / 2, Hh / 2, m(0.3), 0, Math.PI * 2); g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function goal(y) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  const post = new THREE.CylinderGeometry(0.06, 0.06, 2.44, 8).rotateX(Math.PI / 2);
  for (const x of [-3.66, 3.66]) {
    const p = new THREE.Mesh(post, mat); p.position.set(x, y, 1.22); p.castShadow = true; g.add(p);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7.44, 8).rotateZ(Math.PI / 2), mat);
  bar.position.set(0, y, 2.44); bar.castShadow = true; g.add(bar);
  const net = new THREE.Mesh(
    new THREE.BoxGeometry(7.32, 2, 2.44),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false }),
  );
  net.position.set(0, y + Math.sign(y) * 1, 1.22); g.add(net);
  return g;
}

// ---------- escena ----------
export function createStadium() {
  const scene = new THREE.Scene();
  const root = new THREE.Group(); // marco local del estadio
  root.rotation.z = -(SITE.bearing * Math.PI) / 180;
  scene.add(root);

  const concrete = new THREE.MeshStandardMaterial({ color: 0xd2d6d2, roughness: 0.9, side: THREE.DoubleSide, flatShading: true });
  const darkConcrete = new THREE.MeshStandardMaterial({ color: 0x8e9496, roughness: 0.9, side: THREE.DoubleSide });

  // Suelo / campo
  const inner = new THREE.Shape(closed(ringPolyline(0)).map((p) => new THREE.Vector2(p.x, p.y)));
  const apron = new THREE.Mesh(new THREE.ShapeGeometry(inner), new THREE.MeshStandardMaterial({ color: 0x2a5cad, roughness: 0.9 }));
  apron.position.z = 0.02; apron.receiveShadow = true; root.add(apron);
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(68, 105), new THREE.MeshStandardMaterial({ map: pitchTexture(), roughness: 0.95 }));
  pitch.position.z = 0.05; pitch.receiveShadow = true; root.add(pitch);
  root.add(goal(52.5), goal(-52.5));

  // Secciones: grada + asientos instanciados
  const sections = buildSections();
  const seatGeo = seatGeometry();
  const hitMeshes = [];
  const dummy = new THREE.Object3D();
  for (const s of sections) {
    const T = s.tier === 'lower' ? LOWER : UPPER;
    const stand = new THREE.Mesh(standGeometry(s.piece, T), concrete);
    stand.castShadow = stand.receiveShadow = true;
    stand.userData.section = s;
    root.add(stand); hitMeshes.push(stand);

    const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, side: THREE.DoubleSide });
    const inst = new THREE.InstancedMesh(seatGeo, mat, s.seats.length);
    s.seats.forEach((seat, i) => {
      dummy.position.set(seat.x, seat.y, seat.z);
      dummy.rotation.set(0, 0, Math.atan2(-seat.ny, -seat.nx) - Math.PI / 2);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.castShadow = inst.receiveShadow = true;
    inst.userData.section = s;
    s.mesh = inst; s.stand = stand;
    s.baseColor = new THREE.Color(ZONES[s.zone].color);
    const greySeats = s.side === 'W' && (s.number === 113 || s.number === 213);
    s.realColor = new THREE.Color(greySeats ? '#8e9894' : s.tier === 'lower' ? '#2fb04a' : '#28a043');
    root.add(inst);
  }

  // Letreros con el número de cada sección, al fondo y mirando a la cancha
  for (const sec of sections) {
    const T = sec.tier === 'lower' ? LOWER : UPPER;
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 64;
    const g = cv.getContext('2d');
    g.fillStyle = '#0f6b34'; g.fillRect(0, 0, 128, 64);
    g.fillStyle = '#ffffff'; g.font = 'bold 44px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(sec.number), 64, 34);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25, side: THREE.DoubleSide }));
    const pt = polylineOf(sec.piece, T.d0 + T.rows * T.depth + 0.05, 2)[1];
    sign.position.set(pt.x, pt.y, T.z0 + (T.rows - 1) * T.riser + T.rail + 0.8);
    sign.rotation.z = Math.atan2(-pt.nx, pt.ny);
    root.add(sign);
  }

  // Explanada de concreto alrededor del estadio
  const plazaB = new Builder();
  band(plazaB, closed(ringPolyline(FACADE.d1, 16)), closed(ringPolyline(FACADE.d1 + 13, 16)), 0.06);
  const plaza = new THREE.Mesh(plazaB.geometry(), new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.95 }));
  plaza.receiveShadow = true; root.add(plaza);

  // Pasillo transversal entre parte baja y parte alta
  const ab = new Builder();
  band(ab, closed(ringPolyline(AISLE.d0)), closed(ringPolyline(AISLE.d1)), AISLE.z);
  const aisle = new THREE.Mesh(ab.geometry(), concrete);
  aisle.receiveShadow = true; root.add(aisle);

  // Fachada exterior (anillo que cierra el tazón)
  const fb = new Builder();
  const fo = closed(ringPolyline(FACADE.d1)), fi = closed(ringPolyline(FACADE.d0));
  wall(fb, fo, 0, FACADE.z1); wall(fb, fi, UPPER.zTop, FACADE.z1); band(fb, fi, fo, FACADE.z1);
  const facadeMat = new THREE.MeshStandardMaterial({ color: 0x22324f, roughness: 0.75, side: THREE.DoubleSide });
  const facade = new THREE.Mesh(fb.geometry(), facadeMat);
  facade.castShadow = facade.receiveShadow = true; root.add(facade);

  // Edificio poniente: tres niveles de palcos VIP con ventanal hacia la cancha
  const pressW = PRESS.xIn - PRESS.xOut, pressL = PRESS.halfLen * 2, pressX = (PRESS.xIn + PRESS.xOut) / 2;
  const facadeWhite = new THREE.MeshStandardMaterial({ color: 0xeef0ec, roughness: 0.7 });
  const press = new THREE.Mesh(new THREE.BoxGeometry(pressW, pressL, PRESS.z1).translate(pressX, 0, PRESS.z1 / 2), facadeWhite);
  press.castShadow = press.receiveShadow = true; root.add(press);
  // losas que sobresalen en cada nivel (balcones)
  for (const z of [...PALCO.levels, PALCO.levels[PALCO.levels.length - 1] + 4]) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(2.2, pressL, 0.35), facadeWhite);
    slab.position.set(PRESS.xIn + 1.1, 0, z - 0.17);
    slab.castShadow = slab.receiveShadow = true; root.add(slab);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, pressL, 1.0), new THREE.MeshStandardMaterial({ color: 0x9fb6c4, transparent: true, opacity: 0.45 }));
    rail.position.set(PRESS.xIn + 2.15, 0, z + 0.5);
    root.add(rail);
  }
  // un palco = un ventanal; InstancedMesh clicable (color por instancia: libre/ocupado/elegido)
  const palcos = buildPalcos(PALCO_PRICES);
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.5, roughness: 0.15, emissive: 0xffd28a, emissiveIntensity: 0 });
  const palcoMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, PALCO.width - 0.35, PALCO.height - 0.4), glassMat, palcos.length);
  palcos.forEach((pc, i) => {
    dummy.position.set(pc.x + 0.1, pc.y, pc.z + PALCO.height / 2); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
    palcoMesh.setMatrixAt(i, dummy.matrix);
    palcoMesh.setColorAt(i, new THREE.Color(0x24465e));
  });
  palcoMesh.userData.palcos = palcos;
  root.add(palcoMesh);
  // butacas verdes en el balcón de cada palco (2 filas × 6) y divisiones blancas entre palcos
  const balconySeats = new THREE.InstancedMesh(seatGeo, new THREE.MeshStandardMaterial({ color: 0x2fb04a, roughness: 0.55 }), palcos.length * 12);
  let bs = 0;
  for (const pc of palcos) {
    for (const [dx, dz] of [[0.55, 0.0], [1.45, -0.0]]) {
      for (let k = 0; k < 6; k++) {
        dummy.position.set(pc.x + dx, pc.y - 1.6 + k * 0.64, pc.z + dz);
        dummy.rotation.set(0, 0, -Math.PI / 2); dummy.updateMatrix();
        balconySeats.setMatrixAt(bs++, dummy.matrix);
      }
    }
  }
  balconySeats.castShadow = true; root.add(balconySeats);
  const finCount = (PALCO.count + 1) * PALCO.levels.length;
  const fins = new THREE.InstancedMesh(new THREE.BoxGeometry(2.3, 0.25, PALCO.height + 0.6), facadeWhite, finCount);
  let fi2 = 0;
  PALCO.levels.forEach((z) => {
    for (let k = 0; k <= PALCO.count; k++) {
      const y = -(PALCO.count * PALCO.width) / 2 + k * PALCO.width;
      dummy.position.set(PRESS.xIn + 1.1, y, z + (PALCO.height + 0.6) / 2 - 0.3); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
      fins.setMatrixAt(fi2++, dummy.matrix);
    }
  });
  fins.castShadow = true; root.add(fins);

  // franja bajo cada balcón con el número de cada palco (verde y blanco alternados)
  PALCO.levels.forEach((z, li) => {
    const cv = document.createElement('canvas');
    cv.width = 2048; cv.height = 64;
    const g = cv.getContext('2d');
    const cw = 2048 / PALCO.count;
    for (let k = 0; k < PALCO.count; k++) {
      g.fillStyle = k % 2 ? '#ffffff' : '#0f6b34';
      g.fillRect(k * cw, 0, cw, 64);
      g.fillStyle = k % 2 ? '#0f6b34' : '#ffffff';
      g.font = 'bold 30px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(`PALCO ${li + 1}${String(k + 1).padStart(2, '0')}`, k * cw + cw / 2, 34);
    }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(PALCO.count * PALCO.width, 0.7).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide }));
    strip.position.set(PRESS.xIn + 2.26, 0, z - 0.55);
    root.add(strip);
  });

  // franja de patrocinadores en lo alto del edificio
  {
    const mat = new THREE.MeshStandardMaterial({ map: sponsorTexture(12, 0), side: THREE.DoubleSide, emissive: 0xffffff, emissiveIntensity: 0.15 });
    mat.emissiveMap = mat.map;
    const band = new THREE.Mesh(new THREE.PlaneGeometry(pressL, 1.6).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), mat);
    band.position.set(PRESS.xIn + 0.06, 0, PALCO.levels[PALCO.levels.length - 1] + PALCO.height + 1.4);
    root.add(band);
  }

  // franja de oficinas y prensa abajo (ventanas pequeñas)
  const win = new THREE.InstancedMesh(new THREE.BoxGeometry(0.15, 2.2, 1.4), new THREE.MeshStandardMaterial({ color: 0x2a3f50, roughness: 0.2, metalness: 0.4 }), 40);
  for (let k = 0; k < 20; k++) for (let j = 0; j < 2; j++) {
    dummy.position.set(PRESS.xOut - 0.05, -40 + k * 4.2, 6 + j * 4); dummy.updateMatrix();
    win.setMatrixAt(k * 2 + j, dummy.matrix);
  }
  root.add(win);

  // Talud de pasto curvo detrás de la tribuna oriente (sigue el contorno del tazón)
  const bb = new Builder();
  const eastRing = ringPolyline(FACADE.d1, 16)
    .filter((p) => p.x > HX * 0.55)
    .sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));
  for (let i = 0; i < eastRing.length - 1; i++) {
    const p = eastRing[i], q = eastRing[i + 1];
    const out = (o, k) => ({ x: o.x + o.nx * k, y: o.y + o.ny * k });
    bb.quad(V(p, FACADE.z1 - 3), V(out(p, 14), 0), V(out(q, 14), 0), V(q, FACADE.z1 - 3));
  }
  const berm = new THREE.Mesh(bb.geometry(), new THREE.MeshStandardMaterial({ color: 0x4f8f3a, roughness: 1, side: THREE.DoubleSide }));
  berm.receiveShadow = true; root.add(berm);

  // Edificios de techo de teja junto al estadio (norponiente y surponiente)
  const tile = new THREE.MeshStandardMaterial({ color: 0xe0673e, roughness: 0.8 });
  for (const [x, y, w, l, h, rot] of [[-14, 104, 46, 14, 8, -0.12], [-72, -90, 70, 22, 9, -0.55]]) {
    const bldg = new THREE.Mesh(new THREE.BoxGeometry(w, l, h).translate(0, 0, h / 2), [darkConcrete, darkConcrete, darkConcrete, darkConcrete, tile, darkConcrete]);
    bldg.position.set(x, y, 0); bldg.rotation.z = rot;
    bldg.castShadow = bldg.receiveShadow = true; root.add(bldg);
  }

  // Techo de la tribuna principal: fila de bóvedas color crema (de la orilla hacia atrás)
  // y una caída de teja naranja detrás del edificio.
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xf3ecdc, roughness: 0.55, transparent: true, opacity: 1, side: THREE.DoubleSide, emissive: 0x2e2c28 });
  const tileRoofMat = new THREE.MeshStandardMaterial({ color: 0xe0673e, roughness: 0.8, transparent: true, opacity: 1, side: THREE.DoubleSide });
  const roof = new THREE.Group();
  {
    const vb = new Builder();
    const n = CANOPY.segments, w = (2 * CANOPY.halfLen) / n, r = w / 2, rise = 2.4;
    const xa = CANOPY.x0, xb = CANOPY.x0 - CANOPY.depth * 0.62, zb = CANOPY.z - 1.2;
    for (let k = 0; k < n; k++) {
      const yc = -CANOPY.halfLen + w * (k + 0.5);
      const arc = [];
      for (let j = 0; j <= 12; j++) { const t = (j / 12) * Math.PI; arc.push([yc + r * Math.cos(t), zb + rise * Math.sin(t)]); }
      for (let j = 0; j < 12; j++) {
        const [y0, z0] = arc[j], [y1, z1] = arc[j + 1];
        vb.quad({ x: xa, y: y0, z: z0 }, { x: xb, y: y0, z: z0 }, { x: xb, y: y1, z: z1 }, { x: xa, y: y1, z: z1 });
      }
    }
    const vaults = new THREE.Mesh(vb.geometry(), roofMat);
    vaults.castShadow = vaults.receiveShadow = true; roof.add(vaults);
    // losa plana bajo las bóvedas (cierra el techo para sombra y vista desde abajo)
    const slab = new THREE.Mesh(new THREE.BoxGeometry(xa - xb, 2 * CANOPY.halfLen, 0.4).translate((xa + xb) / 2, 0, zb), roofMat);
    slab.castShadow = true; roof.add(slab);
    // caída de teja detrás, hasta encima del edificio
    const tb = new Builder();
    const xc = CANOPY.x0 - CANOPY.depth - 6;
    tb.quad({ x: xb, y: -CANOPY.halfLen, z: zb + rise }, { x: xb, y: CANOPY.halfLen, z: zb + rise }, { x: xc, y: CANOPY.halfLen, z: PRESS.z1 + 1 }, { x: xc, y: -CANOPY.halfLen, z: PRESS.z1 + 1 });
    const tiles = new THREE.Mesh(tb.geometry(), tileRoofMat);
    tiles.castShadow = tiles.receiveShadow = true; roof.add(tiles);
  }
  {
    // Marquesina verde con letras en la orilla del techo (plano que mira a la cancha)
    const cv = document.createElement('canvas');
    cv.width = 2048; cv.height = 64;
    const g = cv.getContext('2d');
    g.fillStyle = '#0f6b34'; g.fillRect(0, 0, 2048, 64);
    g.fillStyle = '#ffffff'; g.font = 'bold 34px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const xx of [341, 1024, 1707]) g.fillText('TERRITORIO SANTOS MODELO', xx, 34);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const fasciaMat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.2, side: THREE.DoubleSide });
    const fascia = new THREE.Mesh(new THREE.PlaneGeometry(2 * CANOPY.halfLen, 1.8).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), fasciaMat);
    fascia.position.set(CANOPY.x0 + 0.05, 0, CANOPY.z - 2.2);
    roof.add(fascia);
  }
  root.add(roof);

  // Mástiles que sostienen el techo (borde exterior de la media luna)
  const masts = [];
  for (let y = -CANOPY.halfLen + 6; y <= CANOPY.halfLen - 6; y += 10.4) masts.push([CANOPY.x0 - canopyWidth(y) + 1.5, y]);
  const mastGeo = new THREE.BoxGeometry(0.9, 0.9, CANOPY.z).translate(0, 0, CANOPY.z / 2);
  const mastMesh = new THREE.InstancedMesh(mastGeo, darkConcrete, masts.length);
  masts.forEach(([x, y], i) => { dummy.position.set(x, y, 0); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); mastMesh.setMatrixAt(i, dummy.matrix); });
  mastMesh.castShadow = true; root.add(mastMesh);

  // Iluminación: luminarias bajo el borde del techo (las torres van en scenery.js)
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x555555, emissive: 0xfff4dd, emissiveIntensity: 0 });
  const lampPos = [];
  for (let y = -CANOPY.halfLen + 6; y <= CANOPY.halfLen - 6; y += 4) lampPos.push([CANOPY.x0 + 0.5, y, CANOPY.z - CANOPY.thick / 2 - 0.3]);
  const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.6, 0.6), lampMat, lampPos.length);
  lampPos.forEach(([x, y, z], i) => { dummy.position.set(x, y, z); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); lamps.setMatrixAt(i, dummy.matrix); });
  root.add(lamps);

  const scenery = createScenery();
  root.add(scenery.group);

  // Luces
  const hemi = new THREE.HemisphereLight(0xdfefff, 0x8a7a5c, 0.9);
  hemi.position.set(0, 0, 1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = -130; sc.right = 130; sc.top = 130; sc.bottom = -130; sc.near = 1; sc.far = 900;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);
  // Reflectores nocturnos: dos luces inclinadas para iluminar cancha y gradas.
  const flood = new THREE.DirectionalLight(0xfff6e8, 0);
  flood.position.set(60, 40, 100);
  const flood2 = new THREE.DirectionalLight(0xfff6e8, 0);
  flood2.position.set(-60, -40, 100);
  scene.add(flood, flood.target, flood2, flood2.target);
  const nightColor = new THREE.Color(0x0a1424);

  // Sombra sobre el mapa (sólo vista mapa) y terreno + cielo (sólo vista asiento)
  const shadowGround = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.ShadowMaterial({ opacity: 0.38 }));
  shadowGround.position.z = 0.005; shadowGround.receiveShadow = true; scene.add(shadowGround);
  const terrain = new THREE.Mesh(new THREE.CircleGeometry(4000, 64), new THREE.MeshStandardMaterial({ color: 0xbfa77d, roughness: 1 }));
  terrain.position.z = -0.02; terrain.receiveShadow = true; terrain.visible = false; scene.add(terrain);
  const sky = new Sky();
  sky.scale.setScalar(9000);
  const su = sky.material.uniforms;
  su.up.value.set(0, 0, 1); su.turbidity.value = 6; su.rayleigh.value = 1.6; su.mieCoefficient.value = 0.005; su.mieDirectionalG.value = 0.8;
  sky.visible = false; scene.add(sky);

  const totalSeats = sections.reduce((n, s) => n + s.seats.length, 0);

  return {
    scene, root, sections, hitMeshes, totalSeats,
    roof, roofMat, roofMats: [roofMat, tileRoofMat], glassMat, lampMat, palcos, palcoMesh, scenery,
    lights: { hemi, sun, flood, flood2 },
    nightColor,
    night: 0,
    shadowGround, terrain, sky,
    // Ajusta luces/cielo para una dirección del sol (ENU mundo).
    setSun(dir) {
      const alt = dir[2];
      const day = THREE.MathUtils.clamp((alt + 0.05) / 0.25, 0, 1);
      sun.position.set(dir[0] * 400, dir[1] * 400, Math.max(dir[2], 0.02) * 400);
      sun.intensity = alt > 0 ? 2.8 * THREE.MathUtils.clamp(alt / 0.12, 0, 1) : 0;
      const warm = THREE.MathUtils.clamp(alt / 0.35, 0, 1);
      sun.color.setRGB(1, 0.72 + 0.26 * warm, 0.5 + 0.42 * warm);
      const night = 1 - day;
      hemi.intensity = 0.55 + 0.55 * day;
      hemi.color.setHSL(0.6, 0.45 - 0.2 * day, 0.45 + 0.45 * day);
      flood.intensity = flood2.intensity = 1.3 * night;
      this.night = night;
      lampMat.emissiveIntensity = 3 * night;
      scenery.lampMat.emissiveIntensity = 4 * night;
      glassMat.emissiveIntensity = 0.5 * night;
      su.sunPosition.value.set(dir[0], dir[1], dir[2]);
      su.rayleigh.value = 0.6 + 1.6 * day;
      return { day, night };
    },
  };
}

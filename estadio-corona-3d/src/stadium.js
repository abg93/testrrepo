import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Sky } from 'three/addons/objects/Sky.js';
import {
  LOWER, UPPER, PALCOS, FACADE, ROOF, ZONES,
  buildSections, polylineOf, ringPolyline,
} from './layout.js';
import { SITE } from './config.js';

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
    wall(b, F, r === 0 ? (T === LOWER ? 0 : prevZ - 1.2) : prevZ, z); // contrahuella
    band(b, F, B, z); // huella
    prevZ = z;
  }
  const back = polylineOf(piece, T.d0 + T.rows * T.depth);
  wall(b, back, prevZ, prevZ + 1.1); // barandal trasero
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
    g.fillStyle = i % 2 ? '#2f8a3a' : '#38a046';
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

  const concrete = new THREE.MeshStandardMaterial({ color: 0xbfc3c4, roughness: 0.9, side: THREE.DoubleSide, flatShading: true });
  const darkConcrete = new THREE.MeshStandardMaterial({ color: 0x8e9496, roughness: 0.9, side: THREE.DoubleSide });

  // Suelo / campo
  const inner = new THREE.Shape(closed(ringPolyline(0)).map((p) => new THREE.Vector2(p.x, p.y)));
  const apron = new THREE.Mesh(new THREE.ShapeGeometry(inner), new THREE.MeshStandardMaterial({ color: 0x2c6e34, roughness: 1 }));
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
    root.add(inst);
  }

  // Palcos (anillo entre niveles con ventanal)
  const pb = new Builder();
  const pf = closed(ringPolyline(PALCOS.d0 + 0.3)), pk = closed(ringPolyline(PALCOS.d1));
  band(pb, pf, pk, PALCOS.z1); band(pb, closed(ringPolyline(PALCOS.d0)), pf, PALCOS.z0 + 0.3);
  wall(pb, pk, PALCOS.z0, PALCOS.z1);
  const palcoSlab = new THREE.Mesh(pb.geometry(), darkConcrete);
  palcoSlab.castShadow = palcoSlab.receiveShadow = true; root.add(palcoSlab);
  const gb = new Builder(); wall(gb, pf, PALCOS.z0 + 0.3, PALCOS.z1);
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x1b2d3a, metalness: 0.6, roughness: 0.15, emissive: 0xffd28a, emissiveIntensity: 0, side: THREE.DoubleSide });
  const glass = new THREE.Mesh(gb.geometry(), glassMat); root.add(glass);

  // Fachada exterior
  const fb = new Builder();
  const fo = closed(ringPolyline(FACADE.d1)), fi = closed(ringPolyline(FACADE.d0));
  wall(fb, fo, 0, FACADE.z1); wall(fb, fi, UPPER.zTop, FACADE.z1); band(fb, fi, fo, FACADE.z1);
  const facadeMat = new THREE.MeshStandardMaterial({ color: 0xe8ebec, roughness: 0.7, side: THREE.DoubleSide });
  const facade = new THREE.Mesh(fb.geometry(), facadeMat);
  facade.castShadow = facade.receiveShadow = true; root.add(facade);

  // Techo
  const roofShape = new THREE.Shape(closed(ringPolyline(ROOF.dOut, 16)).map((p) => new THREE.Vector2(p.x, p.y)));
  roofShape.holes.push(new THREE.Path(closed(ringPolyline(ROOF.dIn, 16)).map((p) => new THREE.Vector2(p.x, p.y))));
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: ROOF.thick, bevelEnabled: false, curveSegments: 1 });
  roofGeo.translate(0, 0, ROOF.z - ROOF.thick / 2);
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xf2f4f5, roughness: 0.5, metalness: 0.2, transparent: true, opacity: 1, side: THREE.DoubleSide });
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.castShadow = true; roof.receiveShadow = true; root.add(roof);

  // Columnas que sostienen el techo + luminarias en el borde interior
  const colGeo = new THREE.BoxGeometry(0.8, 0.8, ROOF.z).translate(0, 0, ROOF.z / 2);
  const ring = ringPolyline(FACADE.d1 + 0.6, 6);
  const cols = new THREE.InstancedMesh(colGeo, darkConcrete, Math.ceil(ring.length / 2));
  let ci = 0;
  for (let i = 0; i < ring.length; i += 2) { dummy.position.set(ring[i].x, ring[i].y, 0); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); cols.setMatrixAt(ci++, dummy.matrix); }
  cols.count = ci; cols.castShadow = true; root.add(cols);

  const lampRing = ringPolyline(ROOF.dIn + 0.6, 10).filter((_, i) => i % 1 === 0);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x555555, emissive: 0xfff4dd, emissiveIntensity: 0 });
  const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.6, 0.5), lampMat, lampRing.length);
  lampRing.forEach((p, i) => { dummy.position.set(p.x, p.y, ROOF.z - ROOF.thick / 2 - 0.3); dummy.rotation.set(0, 0, Math.atan2(p.ny, p.nx)); dummy.updateMatrix(); lamps.setMatrixAt(i, dummy.matrix); });
  root.add(lamps);

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
    roof, roofMat, glassMat, lampMat,
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
      glassMat.emissiveIntensity = 0.5 * night;
      su.sunPosition.value.set(dir[0], dir[1], dir[2]);
      su.rayleigh.value = 0.6 + 1.6 * day;
      return { day, night };
    },
  };
}

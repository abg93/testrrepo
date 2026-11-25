import * as THREE from 'three';
import { FACADE, HX, HY, ringPolyline, PRESS } from './layout.js';

// Entorno del estadio: torres de iluminación, pantalla, vallas publicitarias,
// estacionamientos con autos y techos solares, árboles, canchas de entrenamiento
// y una cordillera lejana para la vista desde el asiento. Todo en metros, marco local.

// Generador pseudoaleatorio con semilla: el entorno sale igual en cada carga.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stripeTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  for (let i = 0; i < 16; i++) {
    g.fillStyle = i % 2 ? '#f2f5f2' : '#1e8a3c';
    g.fillRect(0, i * 16, 64, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function screenTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 288;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 288);
  grd.addColorStop(0, '#0f6b34'); grd.addColorStop(1, '#063d1d');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 288);
  g.fillStyle = '#ffffff';
  g.font = 'bold 64px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText('TSM', 256, 110);
  g.font = 'bold 84px system-ui, sans-serif';
  g.fillText('0 – 0', 256, 220);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function fieldTexture() {
  const c = document.createElement('canvas');
  c.width = 340; c.height = 525;
  const g = c.getContext('2d');
  for (let i = 0; i < 10; i++) { g.fillStyle = i % 2 ? '#3f8f3c' : '#47a044'; g.fillRect(0, (i * 525) / 10, 340, 53); }
  g.strokeStyle = '#eef'; g.lineWidth = 3;
  g.strokeRect(4, 4, 332, 517);
  g.beginPath(); g.moveTo(0, 262); g.lineTo(340, 262); g.stroke();
  g.beginPath(); g.arc(170, 262, 46, 0, Math.PI * 2); g.stroke();
  g.strokeRect(70, 4, 200, 82); g.strokeRect(70, 439, 200, 82);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Franja de patrocinadores: nombres escritos sobre fondos de color (no son los logotipos oficiales).
export const SPONSORS = [
  { name: 'Corona', bg: '#0d2a6b', fg: '#f6d24a', font: 'italic bold 46px Georgia, serif' },
  { name: 'Soriana', bg: '#d7262e', fg: '#ffffff', font: 'bold 44px system-ui, sans-serif' },
  { name: 'Telcel', bg: '#123d8f', fg: '#ffffff', font: 'bold 44px system-ui, sans-serif' },
  { name: 'LALA', bg: '#ffffff', fg: '#1d4f9c', font: '900 48px system-ui, sans-serif' },
  { name: 'Peñoles', bg: '#0f6b34', fg: '#ffffff', font: 'bold 42px system-ui, sans-serif' },
];
export function sponsorTexture(cells = 10, offset = 0) {
  const c = document.createElement('canvas');
  c.width = cells * 256; c.height = 64;
  const g = c.getContext('2d');
  for (let k = 0; k < cells; k++) {
    const sp = SPONSORS[(k + offset) % SPONSORS.length];
    g.fillStyle = sp.bg; g.fillRect(k * 256, 0, 256, 64);
    g.fillStyle = sp.fg; g.font = sp.font; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(sp.name, k * 256 + 128, 35);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function wordTexture(text, bg, fg, font, w = 1024, h = 256) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createScenery() {
  const group = new THREE.Group();
  const r = rng(2009);
  const dummy = new THREE.Object3D();
  const steel = new THREE.MeshStandardMaterial({ color: 0x6f7570, roughness: 0.6, metalness: 0.4 });
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x8d8a82, roughness: 1 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x777777, emissive: 0xfff6e0, emissiveIntensity: 0 });

  // --- Torres de iluminación en las cuatro esquinas (estructura de celosía simplificada)
  const towerSpots = ringPolyline(FACADE.d1 + 7, 12).filter((p) => Math.abs(p.nx) > 0.55 && Math.abs(p.ny) > 0.55);
  const corners = [];
  for (const sx of [1, -1]) for (const sy of [1, -1]) {
    const cands = towerSpots.filter((p) => Math.sign(p.x) === sx && Math.sign(p.y) === sy);
    if (cands.length) corners.push(cands[Math.floor(cands.length / 2)]);
  }
  const towerH = 46;
  for (const p of corners) {
    const t = new THREE.Group();
    // 4 patas inclinadas + travesaños
    for (const [ox, oy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, towerH, 6), steel);
      leg.rotation.x = Math.PI / 2;
      leg.position.set(ox * 1.1, oy * 1.1, towerH / 2);
      leg.castShadow = true;
      t.add(leg);
    }
    for (let z = 4; z < towerH; z += 4) {
      const ring = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 0.15), steel);
      ring.position.z = z;
      t.add(ring);
    }
    // cabezal con reflectores, girado hacia el centro de la cancha
    const head = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(9, 0.6, 6), steel);
    head.add(frame);
    const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 0.5, 1.0), lampMat, 15);
    let i = 0;
    for (let a = 0; a < 5; a++) for (let b = 0; b < 3; b++) {
      dummy.position.set(-3.6 + a * 1.8, -0.5, -1.8 + b * 1.8); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
      lamps.setMatrixAt(i++, dummy.matrix);
    }
    head.add(lamps);
    head.position.z = towerH + 3;
    const spIdx = corners.indexOf(p) % SPONSORS.length;
    const sp = [SPONSORS[3], SPONSORS[2], SPONSORS[3], SPONSORS[2]][corners.indexOf(p)] || SPONSORS[spIdx];
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(5, 2.2).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ map: wordTexture(sp.name, sp.bg, sp.fg, sp.font.replace(/\d+px/, '150px'), 512, 224), side: THREE.DoubleSide }));
    panel.position.set(0, -1.6, towerH - 7);
    panel.rotation.z = Math.atan2(-p.y, -p.x) + Math.PI / 2;
    t.add(panel);
    // el frente de los reflectores es -y local: lo giramos hacia el centro y lo inclinamos abajo
    head.rotation.z = Math.atan2(-p.y, -p.x) + Math.PI / 2;
    head.rotateX(0.35);
    t.add(head);
    t.position.set(p.x, p.y, 0);
    group.add(t);
  }

  // --- Torre de pantalla con franjas verdes y blancas (esquina norponiente)
  const tower = new THREE.Group();
  const stripes = new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.7 });
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(7, 7, 24).translate(0, 0, 12), stripes);
  shaft.castShadow = true; tower.add(shaft);
  const screenMat = new THREE.MeshStandardMaterial({ map: screenTexture(), emissive: 0xffffff, emissiveMap: screenTexture(), emissiveIntensity: 0.55, roughness: 0.4 });
  const screen = new THREE.Mesh(new THREE.BoxGeometry(13, 0.8, 7.5).translate(0, 0, 0), [steel, steel, steel, screenMat, steel, steel]);
  screen.position.set(0, -3.2, 27.5);
  screen.castShadow = true; tower.add(screen);
  // dos torres, una en cada extremo de la tribuna principal, con la pantalla hacia la cancha
  for (const sy of [1, -1]) {
    const t = sy === 1 ? tower : tower.clone();
    const tpos = { x: PRESS.xIn - 4, y: sy * (PRESS.halfLen + 7) };
    t.position.set(tpos.x, tpos.y, 0);
    t.rotation.z = Math.atan2(-tpos.y, -tpos.x) + Math.PI / 2;
    t.scale.set(1.25, 1.25, 1.3);
    group.add(t);
  }

  // --- Vallas publicitarias: anillo de colores sobre la fachada y alrededor de la cancha
  const palette = [0x1e5bd6, 0xe63a2e, 0xf2c230, 0x1e8a3c, 0xffffff, 0x0d1b3a, 0xef7d1a];
  const topRing = ringPolyline(FACADE.d1 - 0.3, 10).filter((p) => p.x > -HX + 2);
  const boardGeo = new THREE.BoxGeometry(5.5, 0.25, 1.6);
  const boards = new THREE.InstancedMesh(boardGeo, new THREE.MeshStandardMaterial({ roughness: 0.6, emissive: 0x222222 }), topRing.length);
  topRing.forEach((p, k) => {
    dummy.position.set(p.x, p.y, FACADE.z1 + 0.8);
    dummy.rotation.set(0, 0, Math.atan2(p.ny, p.nx) + Math.PI / 2);
    dummy.updateMatrix();
    boards.setMatrixAt(k, dummy.matrix);
    boards.setColorAt(k, new THREE.Color(palette[Math.floor(r() * palette.length)]));
  });
  group.add(boards);
  // vallas a nivel de cancha
  // [x, y, largo, ángulo]: el frente (normal) mira hacia la cancha
  for (const [x, y, len, rot, off] of [[0, 55.5, 78, 0, 0], [0, -55.5, 78, Math.PI, 2], [37.5, 0, 106, -Math.PI / 2, 1], [-37.5, 0, 106, Math.PI / 2, 3]]) {
    const cells = Math.round(len / 6);
    const mat = new THREE.MeshStandardMaterial({ map: sponsorTexture(cells, off), emissive: 0xffffff, roughness: 0.5 });
    mat.emissiveMap = mat.map; mat.emissiveIntensity = 0.25;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.95).rotateX(Math.PI / 2).rotateZ(rot), mat);
    board.position.set(x, y, 0.55);
    group.add(board);
    const back = new THREE.Mesh(new THREE.BoxGeometry(rot === 0 || rot === Math.PI ? len : 0.15, rot === 0 || rot === Math.PI ? 0.15 : len, 1.0), steel);
    back.position.set(x + Math.sin(rot) * 0.1, y + -Math.cos(rot) * -0.1, 0.5);
    group.add(back);
  }

  // Letras de Corona sobre el talud de pasto del oriente (como se ven desde el aire).
  // El talud baja hacia el oriente: el plano se recuesta con su normal hacia arriba y al este.
  {
    const run = 14, drop = FACADE.z1 - 3;
    const slope = Math.atan2(drop, run);
    // texto a lo largo de y (de sur a norte) y recostado sobre la pendiente
    const geo = new THREE.PlaneGeometry(80, Math.hypot(run, drop) * 0.85).rotateZ(Math.PI / 2).rotateY(slope);
    const word = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ map: wordTexture('Corona', null, '#f7f3e6', 'italic bold 230px Georgia, serif', 2048, 300), alphaTest: 0.4, side: THREE.DoubleSide }),
    );
    const nx = Math.sin(slope), nz = Math.cos(slope);
    word.position.set(HX + FACADE.d1 + run / 2 + nx * 0.5, 0, drop / 2 + nz * 0.5);
    group.add(word);
  }

  // --- Estacionamientos (oriente y sur) con techos solares y autos
  const lots = [
    { x0: 92, x1: 170, y0: -125, y1: 105 },
    { x0: -40, x1: 88, y0: 112, y1: 168 },
  ];
  const carColors = [0xf4f4f4, 0x1b1b1b, 0x9aa0a6, 0xb3261e, 0x2b4fa0, 0xd9d4c7, 0x5a5f63];
  const carGeo = new THREE.BoxGeometry(1.9, 4.4, 1.5).translate(0, 0, 0.75);
  const carSpots = [];
  const solarSpots = [];
  for (const L of lots) {
    const pave = new THREE.Mesh(new THREE.PlaneGeometry(L.x1 - L.x0, L.y1 - L.y0), asphalt);
    pave.position.set((L.x0 + L.x1) / 2, (L.y0 + L.y1) / 2, 0.03);
    pave.receiveShadow = true; group.add(pave);
    const vertical = L.y1 - L.y0 > L.x1 - L.x0;
    if (vertical) {
      for (let x = L.x0 + 6; x < L.x1 - 3; x += 13) {
        solarSpots.push({ x: x + 2.5, y: (L.y0 + L.y1) / 2, w: 6, l: L.y1 - L.y0 - 14, rot: 0 });
        for (let y = L.y0 + 4; y < L.y1 - 3; y += 2.7) for (const dx of [0, 5]) if (r() < 0.62) carSpots.push([x + dx, y, Math.PI / 2 + (r() < 0.5 ? 0 : Math.PI)]);
      }
    } else {
      for (let y = L.y0 + 6; y < L.y1 - 3; y += 13) {
        solarSpots.push({ x: (L.x0 + L.x1) / 2, y: y + 2.5, w: L.x1 - L.x0 - 14, l: 6, rot: 0 });
        for (let x = L.x0 + 4; x < L.x1 - 3; x += 2.7) for (const dy of [0, 5]) if (r() < 0.62) carSpots.push([x, y + dy, r() < 0.5 ? 0 : Math.PI]);
      }
    }
  }
  const cars = new THREE.InstancedMesh(carGeo, new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.3 }), carSpots.length);
  carSpots.forEach(([x, y, rot], k) => {
    dummy.position.set(x, y, 0); dummy.rotation.set(0, 0, rot + Math.PI / 2); dummy.updateMatrix();
    cars.setMatrixAt(k, dummy.matrix);
    cars.setColorAt(k, new THREE.Color(carColors[Math.floor(r() * carColors.length)]));
  });
  cars.castShadow = true; group.add(cars);
  const solarMat = new THREE.MeshStandardMaterial({ color: 0x1d2a4a, roughness: 0.25, metalness: 0.6 });
  for (const sp of solarSpots) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(sp.w, sp.l, 0.25), solarMat);
    panel.position.set(sp.x, sp.y, 4.2);
    panel.castShadow = true; group.add(panel);
  }

  // --- Canchas de entrenamiento al poniente
  const fieldMat = new THREE.MeshStandardMaterial({ map: fieldTexture(), roughness: 1 });
  const FIELDS = [[-96, -158], [-22, -158], [58, -165]]; // al sur del estadio
  for (const [fx, fy] of FIELDS) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(68, 105), fieldMat);
    f.position.set(fx, fy, 0.04); f.receiveShadow = true; group.add(f);
  }

  // --- Postes de luz en las canchas de entrenamiento
  const fieldPoles = [];
  for (const [fx, fy] of FIELDS) for (const dx of [-37, 37]) for (const dy of [-40, 40]) fieldPoles.push([fx + dx, fy + dy]);
  const fpole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.25, 18, 6).rotateX(Math.PI / 2).translate(0, 0, 9), steel, fieldPoles.length);
  const fhead = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.5, 1.2), lampMat, fieldPoles.length);
  fieldPoles.forEach(([x, y], k) => {
    dummy.position.set(x, y, 0); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); fpole.setMatrixAt(k, dummy.matrix);
    dummy.position.set(x, y, 18.4); dummy.updateMatrix(); fhead.setMatrixAt(k, dummy.matrix);
  });
  fpole.castShadow = true; group.add(fpole, fhead);

  // --- Colonia de casas (bloques bajos) al poniente y al norte
  const houses = [];
  for (let x = -300; x >= -430; x -= 13) for (let y = -170; y <= 190; y += 11) if (r() < 0.85) houses.push([x + r() * 2, y, 6 + r() * 3, 8 + r() * 2, 3 + r() * 3.5]);
  for (let y = 190; y <= 270; y += 12) for (let x = -280; x <= 160; x += 12) if (r() < 0.8) houses.push([x, y + r() * 2, 7 + r() * 3, 6 + r() * 3, 3 + r() * 3]);
  const houseMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5), new THREE.MeshStandardMaterial({ roughness: 0.9 }), houses.length);
  const houseCols = [0xf1ede4, 0xe6dccb, 0xd8cfc0, 0xf5f2ea, 0xe9d6bf];
  houses.forEach(([x, y, w, l, h], k) => {
    dummy.position.set(x, y, 0); dummy.rotation.set(0, 0, 0); dummy.scale.set(w, l, h); dummy.updateMatrix();
    houseMesh.setMatrixAt(k, dummy.matrix);
    houseMesh.setColorAt(k, new THREE.Color(houseCols[Math.floor(r() * houseCols.length)]));
  });
  dummy.scale.set(1, 1, 1);
  houseMesh.castShadow = houseMesh.receiveShadow = true;
  group.add(houseMesh);

  // --- Árboles (copa esférica + tronco), en bordes de estacionamientos y caminos
  const treeSpots = [];
  for (let y = -150; y <= 140; y += 9) { treeSpots.push([86 + r() * 3, y]); treeSpots.push([176 + r() * 3, y]); }
  for (let y = -110; y <= 120; y += 8) treeSpots.push([-112 + r() * 4, y]);
  for (let x = -140; x <= 100; x += 9) treeSpots.push([x, -222 + r() * 3]);
  for (let k = 0; k < 60; k++) treeSpots.push([-260 + r() * 130, -80 + r() * 160]);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.6, 0), new THREE.MeshStandardMaterial({ color: 0x3f6b2a, roughness: 1, flatShading: true }), treeSpots.length);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.3, 3, 5).rotateX(Math.PI / 2).translate(0, 0, 1.5), new THREE.MeshStandardMaterial({ color: 0x6b4f33 }), treeSpots.length);
  treeSpots.forEach(([x, y], k) => {
    const s = 0.8 + r() * 0.6;
    dummy.position.set(x, y, 0); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, s); dummy.updateMatrix();
    trunk.setMatrixAt(k, dummy.matrix);
    dummy.position.set(x, y, 3 + 2 * s); dummy.scale.setScalar(s); dummy.updateMatrix();
    crown.setMatrixAt(k, dummy.matrix);
    crown.setColorAt(k, new THREE.Color().setHSL(0.26 + r() * 0.05, 0.35, 0.25 + r() * 0.1));
  });
  dummy.scale.setScalar(1);
  crown.castShadow = trunk.castShadow = true;
  group.add(crown, trunk);

  // --- Cordillera lejana (sólo en la vista desde el asiento)
  const segs = 160, R0 = 3200, R1 = 3600;
  const pos = [];
  const hAt = (a) => 90 + 120 * Math.sin(a * 3 + 1) ** 2 + 70 * Math.sin(a * 7.3) ** 2 + 40 * Math.sin(a * 17.1 + 2) ** 2;
  for (let k = 0; k < segs; k++) {
    const a0 = (k / segs) * Math.PI * 2, a1 = ((k + 1) / segs) * Math.PI * 2;
    const p = (a, rad, z) => [Math.cos(a) * rad, Math.sin(a) * rad, z];
    const v = [p(a0, R0, 0), p(a1, R0, 0), p(a1, R1, hAt(a1)), p(a0, R1, hAt(a0))];
    pos.push(...v[0], ...v[1], ...v[2], ...v[0], ...v[2], ...v[3]);
  }
  const hg = new THREE.BufferGeometry();
  hg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hg.computeVertexNormals();
  const hills = new THREE.Mesh(hg, new THREE.MeshStandardMaterial({ color: 0xb79c79, roughness: 1, side: THREE.DoubleSide, flatShading: true }));
  hills.visible = false;
  group.add(hills);

  return { group, hills, lampMat, screenMat };
}

// Trazado paramétrico del estadio en coordenadas locales (metros):
// x = "oriente", y = "norte" (eje largo de la cancha), z = arriba.
// Todo se define como desplazamientos "d" hacia afuera de un rectángulo redondeado
// que rodea la cancha, de modo que filas, palcos, fachada y techo comparten trazo.

export const HX = 42; // medio ancho del borde interior de la grada
export const HY = 62; // medio largo
export const R = 10; // radio de esquina en d = 0
const LX = HX - R;
const LY = HY - R;

// El TSM es un solo tazón continuo alrededor de la cancha. Se divide en parte baja
// (filas 1–17) y parte alta (filas 18–32), separadas por un pasillo transversal.
export const LOWER = { rows: 17, depth: 0.85, riser: 0.42, z0: 1.2, d0: 0, firstRow: 1, rail: 0.5 };
LOWER.dEnd = LOWER.d0 + LOWER.rows * LOWER.depth;
LOWER.zTop = LOWER.z0 + (LOWER.rows - 1) * LOWER.riser;

export const AISLE = { d0: LOWER.dEnd, d1: LOWER.dEnd + 1.6, z: LOWER.zTop };

export const UPPER = { rows: 15, depth: 0.85, riser: 0.5, d0: AISLE.d1, firstRow: LOWER.rows + 1, rail: 1.1 };
UPPER.z0 = LOWER.zTop + 0.9;
UPPER.dEnd = UPPER.d0 + UPPER.rows * UPPER.depth;
UPPER.zTop = UPPER.z0 + (UPPER.rows - 1) * UPPER.riser;

export const FACADE = { d0: UPPER.dEnd, d1: UPPER.dEnd + 0.8, z1: UPPER.zTop + 1.2 };

// Techo: media luna blanca que sólo cubre la tribuna poniente (x < 0 en el marco local).
// Su borde interior es recto sobre la parte media de la grada y el exterior es elíptico.
export const CANOPY = { x0: -(HX + 10), depth: 40, halfLen: 58, z: 26, thick: 1.0 };
export function canopyWidth(y) {
  const t = y / CANOPY.halfLen;
  return t >= 1 || t <= -1 ? 0 : CANOPY.depth * Math.sqrt(1 - t * t);
}
export function inCanopy(x, y) {
  return Math.abs(y) < CANOPY.halfLen && x <= CANOPY.x0 && x >= CANOPY.x0 - canopyWidth(y);
}

// Edificio de palcos y prensa detrás de la tribuna poniente, bajo el techo.
export const PRESS = { xIn: -(HX + FACADE.d1), xOut: -(HX + FACADE.d1 + 10), halfLen: 40, z1: 22 };
export function inPress(x, y) {
  return x <= PRESS.xIn && x >= PRESS.xOut && Math.abs(y) <= PRESS.halfLen;
}

export const SEAT_PITCH = 0.5; // ancho por asiento
const SIDE_AISLE = 0.6; // pasillo en cada extremo de sección

// ---- Piezas base del perímetro (sentido antihorario, empezando en el SE del lateral oriente)
const line = (a, b, n) => ({ kind: 'line', a, b, n });
const arc = (c, a0, a1) => ({ kind: 'arc', c, a0, a1 });
const H = Math.PI / 2;

const SIDES = [
  { key: 'E', name: 'Lateral Oriente', piece: line([HX, -LY], [HX, LY], [1, 0]), split: 5, type: 'lateral' },
  { key: 'NE', name: 'Esquina Nororiente', piece: arc([LX, LY], 0, H), split: 1, type: 'esquina' },
  { key: 'N', name: 'Cabecera Norte', piece: line([LX, HY], [-LX, HY], [0, 1]), split: 3, type: 'cabecera' },
  { key: 'NW', name: 'Esquina Norponiente', piece: arc([-LX, LY], H, 2 * H), split: 1, type: 'esquina' },
  { key: 'W', name: 'Lateral Poniente', piece: line([-HX, LY], [-HX, -LY], [-1, 0]), split: 5, type: 'lateral' },
  { key: 'SW', name: 'Esquina Surponiente', piece: arc([-LX, -LY], 2 * H, 3 * H), split: 1, type: 'esquina' },
  { key: 'S', name: 'Cabecera Sur', piece: line([-LX, -HY], [LX, -HY], [0, -1]), split: 3, type: 'cabecera' },
  { key: 'SE', name: 'Esquina Suroriente', piece: arc([LX, -LY], 3 * H, 4 * H), split: 1, type: 'esquina' },
];

function splitPiece(p, k) {
  const out = [];
  for (let i = 0; i < k; i++) {
    const t0 = i / k, t1 = (i + 1) / k;
    if (p.kind === 'line') {
      const lerp = (t) => [p.a[0] + (p.b[0] - p.a[0]) * t, p.a[1] + (p.b[1] - p.a[1]) * t];
      out.push(line(lerp(t0), lerp(t1), p.n));
    } else {
      out.push(arc(p.c, p.a0 + (p.a1 - p.a0) * t0, p.a0 + (p.a1 - p.a0) * t1));
    }
  }
  return out;
}

export function pieceLength(p, d) {
  if (p.kind === 'line') return Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]);
  return (R + d) * Math.abs(p.a1 - p.a0);
}

// Punto y normal (hacia afuera) a fracción s ∈ [0,1] de la pieza, desplazado d.
export function pointOn(p, d, s) {
  if (p.kind === 'line') {
    return {
      x: p.a[0] + (p.b[0] - p.a[0]) * s + p.n[0] * d,
      y: p.a[1] + (p.b[1] - p.a[1]) * s + p.n[1] * d,
      nx: p.n[0], ny: p.n[1],
    };
  }
  const a = p.a0 + (p.a1 - p.a0) * s;
  const c = Math.cos(a), si = Math.sin(a);
  return { x: p.c[0] + (R + d) * c, y: p.c[1] + (R + d) * si, nx: c, ny: si };
}

export function polylineOf(p, d, arcSteps = 10) {
  const n = p.kind === 'line' ? 1 : arcSteps;
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(pointOn(p, d, i / n));
  return pts;
}

// Perímetro completo a desplazamiento d (polilínea cerrada, sin punto repetido).
export function ringPolyline(d, arcSteps = 12) {
  const pts = [];
  for (const s of SIDES) {
    const pl = polylineOf(s.piece, d, arcSteps);
    pts.push(...pl.slice(0, -1));
  }
  return pts;
}

// Distancia con signo al borde interior (d = 0). Valores > 0 quedan hacia afuera.
export function sdf(x, y) {
  const qx = Math.abs(x) - LX, qy = Math.abs(y) - LY;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - R;
}

// Altura aproximada de la estructura sólida a desplazamiento d (para cálculo de sombra).
export function structureHeight(d) {
  if (d < 0) return 0;
  if (d < LOWER.dEnd) return LOWER.z0 + Math.floor(d / LOWER.depth) * LOWER.riser;
  if (d < AISLE.d1) return AISLE.z;
  if (d < UPPER.dEnd) return UPPER.z0 + Math.floor((d - UPPER.d0) / UPPER.depth) * UPPER.riser;
  if (d < FACADE.d1) return FACADE.z1;
  return 0;
}

// ---- Secciones y asientos
import { PRICES } from './config.js';

export const ZONES = {
  preferente: { label: 'Preferente', color: '#1f9d55' },
  lateral: { label: 'Lateral', color: '#47c27f' },
  esquina: { label: 'Esquina', color: '#9ad7b0' },
  cabecera: { label: 'Cabecera', color: '#e6efe9' },
  alta: { label: 'Alta lateral', color: '#0f5c35' },
  altaCab: { label: 'Alta cabecera / esquina', color: '#7a9c8b' },
};
for (const [k, z] of Object.entries(ZONES)) z.price = PRICES[k] ?? 0;

function zoneFor(side, idx, tier) {
  if (tier === 'upper') return side.type === 'lateral' ? 'alta' : 'altaCab';
  if (side.type === 'lateral') return idx >= 1 && idx <= 3 ? 'preferente' : 'lateral';
  return side.type;
}

function buildSeats(piece, tier) {
  const T = tier === 'lower' ? LOWER : UPPER;
  const seats = [];
  for (let r = 0; r < T.rows; r++) {
    const d = T.d0 + r * T.depth + T.depth * 0.6;
    const z = T.z0 + r * T.riser;
    const L = pieceLength(piece, d);
    const n = Math.floor((L - 2 * SIDE_AISLE) / SEAT_PITCH);
    const start = (L - n * SEAT_PITCH) / 2 + SEAT_PITCH / 2;
    for (let k = 0; k < n; k++) {
      const p = pointOn(piece, d, (start + k * SEAT_PITCH) / L);
      seats.push({ row: T.firstRow + r, num: k + 1, x: p.x, y: p.y, z, nx: p.nx, ny: p.ny, d });
    }
  }
  return seats;
}

export function buildSections() {
  const sections = [];
  for (const tier of ['lower', 'upper']) {
    let number = tier === 'lower' ? 101 : 201;
    for (const side of SIDES) {
      const parts = splitPiece(side.piece, side.split);
      parts.forEach((piece, i) => {
        const zone = zoneFor(side, i, tier);
        const seats = buildSeats(piece, tier);
        const T = tier === 'lower' ? LOWER : UPPER;
        const mid = pointOn(piece, T.d0 + (T.rows * T.depth) / 2, 0.5);
        sections.push({
          id: String(number),
          number: number++,
          tier,
          tierLabel: tier === 'lower' ? 'Parte baja' : 'Parte alta',
          side: side.key,
          sideName: side.name,
          zone,
          piece,
          seats,
          rows: T.rows,
          firstRow: T.firstRow,
          rowRange: `${T.firstRow}–${T.firstRow + T.rows - 1}`,
          center: mid,
        });
      });
    }
  }
  return sections;
}

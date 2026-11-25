import SunCalc from 'suncalc';
import { SITE } from './config.js';
import { sdf, structureHeight, FACADE, CANOPY, PRESS, inCanopy, inPress } from './layout.js';

const OFF = SITE.utcOffsetHours * 3600e3;

// Fecha (YYYY-MM-DD) + minutos locales del estadio → Date (instante UTC).
export function localToDate(ymd, minutes) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, minutes) - OFF);
}

export function fmtLocal(date) {
  if (!date || isNaN(date)) return '--:--';
  const t = new Date(date.getTime() + OFF);
  return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
}

export function todayLocalYMD() {
  const t = new Date(Date.now() + OFF);
  return t.toISOString().slice(0, 10);
}

// Dirección del sol en coordenadas ENU del mundo (x=este, y=norte, z=arriba).
export function sunInfo(date) {
  const p = SunCalc.getPosition(date, SITE.lat, SITE.lng);
  const azN = p.azimuth + Math.PI; // SunCalc mide desde el sur hacia el oeste
  const alt = p.altitude;
  const dir = [Math.sin(azN) * Math.cos(alt), Math.cos(azN) * Math.cos(alt), Math.sin(alt)];
  const times = SunCalc.getTimes(date, SITE.lat, SITE.lng);
  return {
    dir,
    altitudeDeg: (alt * 180) / Math.PI,
    azimuthDeg: ((azN * 180) / Math.PI + 360) % 360,
    sunrise: times.sunrise,
    sunset: times.sunset,
  };
}

// Pasa la dirección del mundo al marco local del estadio (girado por SITE.bearing).
export function worldToLocalDir(dir) {
  const b = (SITE.bearing * Math.PI) / 180;
  const c = Math.cos(b), s = Math.sin(b);
  // el grupo está rotado -b; para ir a local se rota +b
  return [dir[0] * c - dir[1] * s, dir[0] * s + dir[1] * c, dir[2]];
}

const EYE = 0.9; // altura de la cabeza (sentado) sobre la grada
const canopyBottom = CANOPY.z - CANOPY.thick / 2;
const zMax = Math.max(FACADE.z1, PRESS.z1);

// ¿Le da el sol a la cabeza de quien se sienta en (x,y,z)? Cálculo analítico:
// intersección con el techo poniente + marcha sobre la grada y el edificio de prensa.
export function seatSunlit(x, y, z, L) {
  if (L[2] <= 0.0) return false;
  const ez = z + EYE;
  if (ez < canopyBottom) {
    const t = (canopyBottom - ez) / L[2];
    if (inCanopy(x + L[0] * t, y + L[1] * t)) return false;
  }
  for (let t = 0.8; t < 450; t += 0.7) {
    const pz = ez + L[2] * t;
    if (pz > zMax) break;
    const px = x + L[0] * t, py = y + L[1] * t;
    if (pz < PRESS.z1 && inPress(px, py)) return false;
    const d = sdf(px, py);
    if (d > 0 && pz < structureHeight(d)) return false;
  }
  return true;
}

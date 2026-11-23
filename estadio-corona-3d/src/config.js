// Configuración del sitio: Estadio TSM Corona (Territorio Santos Modelo, inaugurado en 2009),
// Torreón, Coahuila — Calzada Territorio Santos Modelo #1, al norte de la ciudad.
// Wikipedia: 25°37′44″N 103°22′44″W. No confundir con el antiguo Estadio Corona (1970),
// en 25.5550, -103.4031.
// Pueden ajustarse sin recompilar con parámetros de URL:
//   ?lat=25.6291&lng=-103.3794&bearing=0
const params = new URLSearchParams(location.search);
const num = (k, d) => (params.has(k) && !isNaN(+params.get(k)) ? +params.get(k) : d);

export const SITE = {
  name: 'Estadio TSM Corona',
  city: 'Torreón, Coahuila',
  lat: num('lat', 25.629145),
  lng: num('lng', -103.379417),
  // Rumbo (grados desde el norte, sentido horario) del eje largo de la cancha.
  // Valor aproximado: ajústalo con ?bearing= para alinearlo con la huella de OSM.
  bearing: num('bearing', 0),
  // Torreón usa America/Monterrey: UTC-6 todo el año (sin horario de verano desde 2022).
  utcOffsetHours: -6,
};

// Precios por zona (MXN, por boleto). SON PRECIOS DE EJEMPLO: cámbialos aquí
// según el partido. Las claves coinciden con las zonas de src/layout.js.
export const PRICES = {
  preferente: 650,
  lateral: 480,
  esquina: 350,
  cabecera: 260,
  alta: 380,
  altaCab: 220,
};
export const CURRENCY = 'MXN';

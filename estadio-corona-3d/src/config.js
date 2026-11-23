// Configuración del sitio. Las coordenadas son las del Estadio Corona (TSM),
// Torreón, Coahuila (Wikipedia: 25°37′44″N 103°22′44″W).
// Pueden ajustarse sin recompilar con parámetros de URL:
//   ?lat=25.6291&lng=-103.3794&bearing=0
const params = new URLSearchParams(location.search);
const num = (k, d) => (params.has(k) && !isNaN(+params.get(k)) ? +params.get(k) : d);

export const SITE = {
  name: 'Estadio Corona · TSM',
  city: 'Torreón, Coahuila',
  lat: num('lat', 25.629145),
  lng: num('lng', -103.379417),
  // Rumbo (grados desde el norte, sentido horario) del eje largo de la cancha.
  // Valor aproximado: ajústalo con ?bearing= para alinearlo con la huella de OSM.
  bearing: num('bearing', 0),
  // Torreón usa America/Monterrey: UTC-6 todo el año (sin horario de verano desde 2022).
  utcOffsetHours: -6,
};

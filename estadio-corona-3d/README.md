# Estadio TSM Corona 3D

App web (Vite + Three.js + MapLibre GL) que coloca un modelo 3D del **Estadio TSM Corona** (Territorio Santos Modelo,
2009) de Torreón, Coahuila, sobre el mapa de **OpenStreetMap**.

## Qué hace

- **Estadio 3D sobre OpenStreetMap.** Una capa personalizada de MapLibre comparte el contexto WebGL con
  Three.js, georreferenciada en 25.629145, -103.379417.
- **Forma del TSM** a partir de la foto satelital: un solo tazón (filas A–Q abajo, R–AF arriba), techo
  en media luna sobre la tribuna poniente con marquesina, edificio principal con 3 niveles de palcos,
  talud de pasto al oriente, explanada, torres de iluminación, torre con pantalla, banderas, vallas,
  estacionamientos con autos y techos solares, canchas de entrenamiento, árboles y cerros a lo lejos.
- **Boletos.** Al tocar un asiento aparece un boleto con sección, fila, asiento, puerta de acceso,
  precio y código de barras. *Apartar mi lugar* lo guarda en ese navegador (es una demostración, no
  una venta). Los asientos ocupados son de ejemplo.
- **Palcos VIP** (60, en 3 niveles) con precio por persona, boleto propio y vista desde el palco.
- **Vista desde el lugar** con cielo, sombras y cerros; se mira arrastrando y se acerca con la rueda o
  pellizcando.
- **Barra de horario** con la marca de *silbatazo* (cámbiala con `?silbatazo=19:00`). El sol se
  mueve con [SunCalc](https://github.com/mourner/suncalc) y el boleto dice si el lugar queda al sol.
- **Ver asientos por:** color real, libres/ocupados, zona de precio o sol/sombra.
- **Precios de ejemplo** por zona y presupuesto máximo (`PRICES` y `PALCO_PRICES` en `src/config.js`).

## Uso

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # genera dist/ estático
```

### Ajustes por URL

Las coordenadas y la orientación salen de `src/config.js`. También pueden cambiarse sin
recompilar:

```
?lat=25.629145&lng=-103.379417&bearing=0
```

`bearing` es el rumbo del eje largo de la cancha, en grados desde el norte. El valor `4` se midió
sobre la foto satelital; se puede afinar hasta que el modelo coincida con el estadio en el mapa.

## Estructura

| Archivo | Contenido |
|---|---|
| `src/config.js` | Coordenadas, orientación y zona horaria |
| `src/layout.js` | Trazado paramétrico: niveles, palcos, techo, secciones y asientos |
| `src/stadium.js` | Construcción de la escena Three.js (gradas, asientos, techo, cancha, luces, cielo) |
| `src/sun.js` | Posición solar y prueba sol/sombra por asiento |
| `src/scenery.js` | Entorno: torres de luz, pantalla, banderas, estacionamientos, árboles, cerros |
| `src/main.js` | Mapa, capa 3D, selección, vista desde el asiento y barra de horario |

## Limitaciones

- El modelo es **paramétrico y aproximado**, ajustado a ojo sobre una foto satelital. Las
  dimensiones, la numeración de secciones, los precios y el número de asientos son ilustrativos,
  no el plano oficial.
- Los mosaicos vienen de `tile.openstreetmap.org`. Para uso con mucho tráfico conviene usar un
  proveedor propio, según la [política de uso de mosaicos de OSM](https://operations.osmfoundation.org/policies/tiles/).

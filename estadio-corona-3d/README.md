# Estadio TSM Corona 3D

App web (Vite + Three.js + MapLibre GL) que coloca un modelo 3D del **Estadio TSM Corona** (Territorio Santos Modelo,
2009) de Torreón, Coahuila, sobre el mapa de **OpenStreetMap**.

## Qué hace

- **Estadio 3D sobre OpenStreetMap.** Una capa personalizada de MapLibre comparte el contexto WebGL con
  Three.js, georreferenciada en 25.629145, -103.379417.
- **Forma del TSM** a partir de la foto satelital: un solo tazón (filas A–Q abajo, R–AF arriba),
  tribuna principal al poniente con techo de bóvedas y teja, edificio con 3 niveles de palcos, dos
  torres con pantalla en sus extremos, talud de pasto al oriente con las letras de Corona, franja azul
  alrededor de la cancha, explanada, torres de iluminación, banderas, vallas con patrocinadores,
  estacionamientos con autos y techos solares, canchas de entrenamiento al sur (Centro de Formación),
  colonia de casas, árboles y cerros a lo lejos. Al abrir, la cámara llega volando (`?sinintro` lo omite).
- **Patrocinadores:** son los nombres escritos con una tipografía parecida, no los logotipos oficiales.
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

## Publicar con contraseña (GitHub Pages)

```bash
TSM_PASSWORD='la-contraseña' npm run build:privado   # genera dist-privado/
```

`dist-privado/` contiene sólo un formulario de contraseña y la app **cifrada** (AES-256-GCM con
clave PBKDF2). Sin la contraseña correcta el contenido no se puede leer. Para cambiar la contraseña,
vuelve a correr el comando con otra y publica de nuevo `dist-privado/` en la rama `gh-pages`.
El código fuente del repositorio sigue siendo público si el repositorio lo es.

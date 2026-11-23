# Estadio TSM Corona 3D

App web (Vite + Three.js + MapLibre GL) que coloca un modelo 3D del **Estadio TSM Corona** (Territorio Santos Modelo,
2009) de Torreón, Coahuila, sobre el mapa de **OpenStreetMap**.

## Qué hace

- **Estadio 3D en el mapa.** Una capa personalizada de MapLibre comparte el contexto WebGL con
  Three.js. La escena está en metros y se georreferencia en 25.629145, -103.379417.
- **Asientos clicables por sección.** Son 40 secciones (101–120 en el nivel inferior y 201–220
  en el superior), cada una con sus asientos instanciados. Al pasar el cursor se ve sección, fila
  y asiento. Al hacer clic se elige el asiento, se resalta su sección y el mapa vuela hasta él.
  Las secciones del panel izquierdo llevan directo a cada una.
- **Vista desde el asiento.** Abre una cámara en primera persona a la altura de los ojos del
  asiento elegido, con cielo físico (`Sky`) y sombras. Se mira arrastrando y se acerca con la
  rueda o pellizcando. ◀ ▶ cambian al asiento contiguo.
- **Barra de horario.** Elige fecha y hora local (UTC−6) y el sol se mueve con
  [SunCalc](https://github.com/mourner/suncalc). Las sombras del techo y las gradas se proyectan
  sobre la cancha y el mapa. De noche se encienden las luminarias y el mapa se oscurece. ▶
  reproduce el día a una hora por segundo.
- **Precios por zona.** Cada zona tiene un precio de ejemplo en MXN (editable en `src/config.js`,
  constante `PRICES`). Se ve en la leyenda, el tooltip, la tarjeta y la vista desde el asiento.
  El control *Mi presupuesto* atenúa las secciones que cuestan más.
- **¿Sol o sombra?** La tarjeta del asiento dice si le da el sol a esa hora. La opción
  *Colorear asientos por sol / sombra* pinta todo el estadio y da el porcentaje de asientos al sol.
  El cálculo es analítico: el rayo hacia el sol se cruza con el techo y con la silueta de las gradas.

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

`bearing` es el rumbo del eje largo de la cancha, en grados desde el norte. El valor `0` es
provisional: ajústalo hasta que el modelo coincida con la huella del estadio en el mapa.

## Estructura

| Archivo | Contenido |
|---|---|
| `src/config.js` | Coordenadas, orientación y zona horaria |
| `src/layout.js` | Trazado paramétrico: niveles, palcos, techo, secciones y asientos |
| `src/stadium.js` | Construcción de la escena Three.js (gradas, asientos, techo, cancha, luces, cielo) |
| `src/sun.js` | Posición solar y prueba sol/sombra por asiento |
| `src/main.js` | Mapa, capa 3D, selección, vista desde el asiento y barra de horario |

## Limitaciones

- El modelo es **paramétrico y aproximado**: dos niveles con palcos y techo perimetral. Las
  dimensiones, la numeración de secciones y el número de asientos son ilustrativos, no el plano
  oficial.
- Los mosaicos vienen de `tile.openstreetmap.org`. Para uso con mucho tráfico conviene usar un
  proveedor propio, según la [política de uso de mosaicos de OSM](https://operations.osmfoundation.org/policies/tiles/).

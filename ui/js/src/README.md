# Código de la interfaz (`ui/js/src`)

`ui/js/app.js` **se genera** a partir de estos módulos. No lo edites a mano:
cambia el módulo correspondiente y ejecuta:

```bash
npm run build:js     # genera ui/js/app.js
npm run check:js     # comprueba que app.js está al día (útil antes de un commit)
```

`npm start`, `npm run dev` y `npm run dist` lo regeneran solos.

## Cómo funciona

Los módulos se unen, en el orden de [`modules.json`](modules.json), dentro de
**un único ámbito de función**. Por eso comparten variables y funciones sin
`import`/`export`, y no hay empaquetador ni transpilador: el resultado es un
solo archivo ES5 que también corre en los WebView viejos de Android TV y
Fire TV.

### Reglas

1. **El orden importa** para las sentencias que se ejecutan al cargar
   (`var x = …` con valor, llamadas como `loadLocalProfile()`). Las
   declaraciones `function` se pueden mover entre módulos libremente.
2. **Un módulo nuevo** debe añadirse a `modules.json`; el build falla si hay
   archivos `.js` sin listar.
3. **Solo ES5:** `var`, `function`; nada de `let`/`const`, flechas, clases,
   plantillas con comillas invertidas ni `async` (`tests/bundle.test.cjs` lo
   comprueba).
4. **Capacidades, no plataformas:** `platformHas('torrents')`,
   `platformIsTv()`, `isPhone()`. Lo pesado o exclusivo de PC va detrás de
   una capacidad y no corre en la tele.
5. **Ventanas sobre la app** (paneles, avisos): móntalas con
   `mountOverlay(root)` para que también se vean en el celular.
6. Para depurar o probar desde fuera, las funciones no son globales: usa
   `window.__opentv` (definido en `main.js`).

## Mapa

| Carpeta | Contenido |
| --- | --- |
| `core/` | utilidades DOM, perfiles, configuración (pestañas, menú de Ajustes), estado global, foco y navegación con teclado o control |
| `data/` | `VOD` vacío al arrancar (lo llenan los addons) |
| `services/` | `vod-api.js`: addons (manifiestos, catálogos, fichas, búsqueda, Kitsu para Anime, orden de resultados); `portal.js`: carga del catálogo y fichas desde los addons y llamadas al servicio local |
| `screens/` | bienvenida, inicio, ficha, búsqueda, Ajustes (`settings-hub.js` con sus pestañas), Addons (`account.js`), guía de inicio, actualizaciones de Android, historial |
| `home/` | pósteres, filas, portada, tendencias de TMDB y páginas de cada sección |
| `live/` | TV en vivo: listas M3U, categorías, guía de canales y "Buscar listas" |
| `player/` | reproductor: barras, audio y subtítulos, episodios, `source-rank.js` (qué fuente es mejor y preferencias), `stremio-sources.js` ("Elegir fuente", torrents, subtítulos del archivo), `downloads.js` (descargas) |
| `desktop/` | diseño de PC y tele: barra de título, escalado de ventana, PiP, tooltips, tarjeta al pasar el ratón, gestos |
| `mobile/` | diseño de celular: pantallas táctiles propias sobre el mismo estado y servicios |
| `main.js` | arranque, `ping` del servicio en Android (activa torrents y descargas), `window.__opentv` y enlaces profundos |

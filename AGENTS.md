# AGENTS.md

Guía para agentes de código (Claude Code, Codex, Copilot…) que trabajan en
este repositorio. Para personas, empieza por el [README](README.md).

## Qué es

OpenTV es un reproductor tipo streaming sin contenido propio: películas,
series y anime salen de **addons compatibles con Stremio** que agrega el
usuario, y la TV en vivo de **listas M3U**. Una sola interfaz (`ui/`) y un
solo servicio (`service/`) para todas las plataformas:

| Plataforma | Envoltorio | Carpeta |
|---|---|---|
| Windows | Electron 44 | `platforms/electron/` |
| Android, Android TV, Fire TV | Capacitor 6 + servicio nativo en Java + ExoPlayer | `platforms/android/` |

Cómo funciona por dentro y qué hay en cada plataforma:
[docs/PLATAFORMAS.md](docs/PLATAFORMAS.md). (Empezó como un port de la
interfaz de otra app de IPTV; de eso solo quedan algunos recursos gráficos en
`ui/assets/original/`, ver `licenses/upstream-THIRD_PARTY.md`.)

## Prioridad: fluidez en la tele

El aparato de referencia es un **Fire TV Stick de 1 GB**. Cualquier cambio en
la interfaz compartida debe mantener fluidos los menús y el reproductor ahí.
Lo pesado o exclusivo de PC va detrás de `platformHas(...)` y no se ejecuta
en TV. Si dudas, mide en el aparato (CPU con `top`, `dumpsys gfxinfo`).

## Comandos

```bash
npm install
npm run dev            # app de PC (regenera el bundle y los estilos antes)
npm run build          # ui/js/app.js + ui/desktop/tailwind.css
npm test               # pruebas unitarias (node --test tests/*.test.cjs)
npm run test:e2e       # abre la interfaz real en Electron y recorre las pantallas
npm run check:js       # falla si ui/js/app.js no está al día
npm run build:android  # interfaz para Android + cap sync
npm run build:apk      # APK de release con R8 → dist/OpenTV-<versión>.apk
```

Android necesita `JAVA_HOME` (JDK 17) y el Android SDK. Antes de dar un
cambio por terminado: `npm run build`, `npm test`, `npm run test:e2e` y, si
toca la tele, una prueba en el aparato.

## Reglas del código de la interfaz

- **`ui/js/app.js` se genera.** No lo edites. El código está en
  `ui/js/src/**` y se une en el orden de `ui/js/src/modules.json` dentro de un
  solo ámbito de función (sin `import`/`export`). Un módulo nuevo se añade a
  `modules.json` o el build falla. Detalles: [ui/js/src/README.md](ui/js/src/README.md).
- **Solo ES5** en `ui/js/**`: `var`, `function`; nada de `let`/`const`,
  flechas, clases, plantillas con comillas invertidas ni `async`. Las teles
  viejas lo necesitan, y `tests/bundle.test.cjs` lo comprueba.
- **Las funciones no son globales.** Para depurar o probar desde fuera usa
  `window.__opentv` (definido en `ui/js/src/main.js`).
- **Plataformas:** no compares nombres de plataforma, pregunta capacidades:
  `platformHas('window' | 'pip' | 'mouse' | 'native-player' | 'addons' | 'torrents' …)`
  y `platformIsTv()`. La lista está en `ui/js/platform.js`. Para simular otra
  plataforma en PC: `?platform=android-tv` o `?platform=android`.
- **Estilos:** `ui/desktop/tw/input.css` solo importa las capas de
  `ui/desktop/tw/capas/` en orden. Lo exclusivo de tele va en `10-teles.css`
  (bajo `.desktop.is-tv`, lienzo de 1920×1080). Antes de crear una clase nueva,
  busca que no exista ya en `ui/css/style.css` (la base heredada usa prefijos
  cortos como `.sp-`).
- **Ventanas sobre la app** (paneles, avisos): móntalas con
  `mountOverlay(root)`. En el celular el lienzo está oculto hasta que se
  reproduce algo; si van dentro de `#app` no se ven.
- **Textos visibles en español.** Los comentarios del código, en inglés.

## Servicio (`service/`)

- Corre dentro de Electron (`platforms/electron/service.cjs`). En Android lo
  sustituye el port en Java
  (`platforms/android/android/app/src/main/java/com/techpoint/opentv/service`).
  Si añades un método al servicio de Node que también necesita Android, hay que
  portarlo a Java.
- `service/torrents.js` (torrent-stream) **solo se carga en Electron**.
- Todo escucha en **127.0.0.1**. No abras puertos a la red local.

## Películas, series y anime: addons

Películas, series y anime salen **solo de los addons** del usuario
(compatibles con Stremio), en todas las plataformas. No hay catálogo
integrado ni portal.
Reglas:

- Solo vienen instalados **Cinemeta** (catálogo), **Anime Kitsu** (catálogo
  de anime, llena la sección Anime) y **OpenSubtitles** (subtítulos); **no se
  pueden quitar**: si faltan, `seedDefaultVodAddons()` los vuelve a poner, y
  la interfaz muestra "Incluido" en lugar de Quitar (`isBuiltinVodAddon()`).
  No añadas addons de fuentes (Torrentio y similares) preinstalados: los
  agrega cada usuario.
- Las listas de tipo `anime` de un addon solo van a la sección Anime
  (`_animeCat`), no a Inicio, Películas ni Series. El género "Animation" no
  es Anime ni Kids (tiene series para adultos); a Kids solo va "Family".
- Sin un addon de fuentes la app funciona: la ficha muestra la información y
  dice dónde agregar uno (`hasSourceAddons()`), sin botones de reproducir;
  cualquier otro "Reproducir" abre `showNoSourcesNotice()`.
- "Stremio" es una marca de otra empresa: solo se menciona como
  compatibilidad ("compatible con Stremio"), nunca como nombre de un modo,
  botón o etiqueta. En Ajustes la sección se llama **Addons**.
- Torrents: PC y Android 9+ con ARM (en Android la capacidad `torrents` se
  activa si el `ping` del servicio dice `torrents: true`; motor libtorrent4j
  en `Torrents.java`). Descargas (`downloads`): PC y Android (en Android se
  activa igual, con `downloads: true` en el `ping`).
- La elección de fuente (idioma, calidad, semillas, preferencias tipo
  Torrentio) está en `ui/js/src/player/source-rank.js`.
- Búsqueda: `searchTitles()` (todos los addons, resultados según llegan,
  ordenados por `rankSearchResults()`); con clave de TMDB traduce títulos en
  español al original (`tmdb.list('search:<texto>')`, también en `Tmdb.java`).
- TV en vivo es independiente: solo las listas M3U del usuario
  (`service/m3u.js`).

Cómo funciona: [docs/PLATAFORMAS.md](docs/PLATAFORMAS.md#películas-series-y-anime-addons).

## No cambiar

- El protocolo `opentv://` y las claves de `localStorage` existentes
  (`opentv_*`): borrarían los datos guardados de los usuarios. Las
  instalaciones viejas usaban `xuper://` y claves `xuper_*`; se pasan solas
  a los nombres nuevos al arrancar (`ui/js/migrate-storage.js` y
  `migrateLegacyOrigin()` en `platforms/electron/main.cjs`). No quites esa
  migración.
- Los ids `stremio:<id>` de los títulos de addons.

## Secretos

- `config/tmdb.json` (clave de TMDB) está ignorado por git: no lo subas, no lo
  imprimas y no copies la clave a otros archivos.
- La firma de Android: `platforms/android/android/keystore.properties` y los
  `.jks` están ignorados; la clave vive fuera del repositorio.
- Antes de un commit:
  `git diff --cached | grep -c "<los primeros caracteres de la clave>"` debe dar 0.

## Git

- **No hagas commits ni push sin que el dueño lo pida.** Deja los cambios sin
  confirmar para que los revise.
- Commits pequeños y con mensaje en inglés que diga qué y por qué.

## Windows

- El shell puede ser Git Bash o PowerShell 5.1. Para editar archivos usa las
  herramientas de edición, no `Set-Content` de PowerShell (cambia la
  codificación) ni `node -e` con código entre comillas.
- Si una consola tiene `ELECTRON_RUN_AS_NODE` definido, quítalo antes de
  `npm run dev` o `npm run test:e2e`; si no, Electron arranca como Node.
- FFmpeg para Windows está en `bin/ffmpeg.exe` (lo usa el modo compatible).

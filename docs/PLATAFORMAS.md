# OpenTV por dentro: plataformas y cómo funciona

Una sola base de código (`ui/` + `service/`) y un envoltorio por plataforma:

| Plataforma | Envoltorio | Carpeta |
|---|---|---|
| Windows | Electron 44 | `platforms/electron/` |
| Android, Android TV, Fire TV | Capacitor 6 + servicio nativo en Java + ExoPlayer | `platforms/android/` |

Regla: si algo se puede hacer en `ui/` o `service/`, va ahí; las carpetas de
`platforms/` solo tienen lo que de verdad es distinto.

## Estructura

```
ui/                  interfaz compartida (HTML, CSS, JS ES5)
  js/platform.js     qué dispositivo es y qué puede hacer (platformHas)
  js/src/            módulos de la interfaz (ver ui/js/src/README.md)
  desktop/tw/capas/  estilos por capas; 10-teles.css = diseño de tele
  mobile/mobile.css  diseño de celular
service/             servicio local de PC (Node, en 127.0.0.1)
platforms/
  electron/          main.cjs, preload, actualizador e instalador de Windows
  android/           proyecto Capacitor: el servicio portado a Java + ExoPlayer
scripts/             build y empaquetado por plataforma
tests/               pruebas compartidas
```

## Qué hay en cada plataforma

| Función | PC (Electron) | Android TV / Fire TV / Android |
|---|---|---|
| Películas, series y anime de addons (compatibles con Stremio) | ✅ | ✅ |
| Fuentes con enlace directo (HTTP / HLS) | ✅ | ✅ |
| Torrents | ✅ torrent-stream | ✅ Android 9+ con ARM, libtorrent4j |
| Descargas | ✅ | ✅ (con notificación) |
| Subtítulos del archivo | ✅ relay FFmpeg | ✅ ExoPlayer |
| Subtítulos de addons e importados | ✅ | ✅ |
| TV en vivo (listas M3U) | ✅ | ✅ |
| Búsqueda en español (TMDB) y tendencias | ✅ | ✅ |
| Actualizaciones | ✅ automáticas | ✅ desde la app |
| Ventana flotante, barra de título, ratón | ✅ | — |

La interfaz no compara nombres de plataforma: pregunta capacidades con
`platformHas('addons' | 'torrents' | 'downloads' | 'native-player' | 'mouse' | 'pip' …)`
y `platformIsTv()`. En Android, `torrents` y `downloads` se activan solo si el
`ping` del servicio responde `torrents: true` / `downloads: true` (en
`ui/js/src/main.js`). Para probar otra plataforma en el PC:
`?platform=android-tv` (tele) o `?platform=android` (celular).

## Películas, series y anime: addons

No hay catálogo integrado: todo sale de los addons del usuario (compatibles
con Stremio: `manifest.json` → `catalog` / `meta` / `stream` / `subtitles`).
Código en `ui/js/src/services/vod-api.js` y `ui/js/src/player/stremio-sources.js`.

1. **Addons instalados.** Vienen siempre y no se pueden quitar
   **Cinemeta** (catálogo), **Anime Kitsu** (catálogo de anime) y
   **OpenSubtitles** (subtítulos). Ninguno da vídeos y no se preinstala ningún
   addon de fuentes; si alguno falta, la app lo vuelve a poner. El usuario
   agrega más en **Ajustes →
   Addons** pegando la URL del `manifest.json`; se guarda lo que ofrece cada
   uno (catálogos, géneros, recursos, prefijos de id).
2. **Inicio y secciones.** Una fila por catálogo, en el orden del addon
   ("Popular · Películas"). Kids pide además las listas por género "Family".
   Las listas de tipo `anime` (Kitsu: Tendencias, En emisión, Más
   populares, Mejor valorados) solo van a **Anime**; el género "Animation"
   no cuenta como anime ni como Kids. Los títulos llevan id `stremio:<id>`.
3. **Ficha.** Los datos y capítulos los da el primer addon con `meta` para
   ese id. Sin addon de fuentes (`hasSourceAddons()`) la ficha muestra solo la
   información y un botón **Ir a Addons**; *Reproducir* desde otro sitio abre
   el aviso "Agrega un addon para reproducir".
4. **Elegir fuente.** Las fuentes de todos los addons, agrupadas, con una
   **Recomendada** (`player/source-rank.js`: idioma > calidad > salud del
   torrent; CAM solo si no hay otra; penaliza lo que el aparato no decodifica
   o no cabe). Las **Preferencias de addons** (Ajustes) imitan la página
   *configure* de Torrentio. La elección se recuerda por película o capítulo.
5. **Reproducir** (`resolveExternal` en el servicio). HLS, MP4 y WebM tal cual.
   En PC, MKV/AVI pasan por el relay FFmpeg (`service/ffmpeg-relay.js`): copia
   el vídeo desde el keyframe, convierte el audio, mide dónde empezó de verdad
   para no desfasar audio y vídeo, y escribe los subtítulos del archivo como
   WebVTT. En Android todo lo reproduce ExoPlayer.
6. **Torrents.** Aviso la primera vez; uno a la vez; se sirven en `127.0.0.1`
   con Range y se borran al salir, al cambiar de fuente o al cerrar la app.
7. **Subtítulos.** Primero los del archivo, luego los de los addons (con el
   hash de OpenSubtitles del vídeo para que coincidan), o un archivo propio.
   El proxy sigue redirecciones, descomprime y corrige la codificación.
8. **Búsqueda.** En todos los addons a la vez; los resultados salen según
   contesta cada uno, ordenados por parecido y sin duplicados. Si hay clave de
   TMDB, el título en español se traduce a su título original
   (`tmdb.list('search:<texto>')`) y ese título se busca en los addons.

"Stremio" es una marca de otra empresa: en la interfaz solo aparece como
"compatible con Stremio"; la sección se llama **Addons**.

## TV en vivo

Independiente de los addons: solo listas M3U (`service/m3u.js`,
`M3u.java`). La app empieza con una lista pública de
[iptv-org](https://github.com/iptv-org/iptv) y ofrece más en "Buscar listas";
el usuario agrega las suyas en **Ajustes → Addons → TV en vivo** (o en el
celular, **Mi cuenta → Addons y listas**).

## Celular

`ui/js/src/mobile/` dibuja su propia capa táctil encima del lienzo de
1920×1080, que se oculta hasta que se abre el reproductor. Por eso las
ventanas de la app (elegir fuente, avisos, guía, descargas) se montan con
`mountOverlay()`: en PC y tele dentro del lienzo, en el celular sobre el
`body`, como una hoja que sube desde abajo (`mobile.css`).

## Android

El servicio de Node se portó a Java en lugar de usar nodejs-mobile (pesado
para 1 GB de RAM): `android/app/src/main/java/com/techpoint/opentv/service`,
un servidor local en `127.0.0.1:8910` con listas M3U, fuentes de addons,
proxy de vídeo y subtítulos, hash de vídeo, DoH, TMDB, torrents
(`Torrents.java`, libtorrent4j, ventana de 8 MB y lectura anticipada),
descargas (`Downloads.java` + servicio en primer plano con notificación) y
actualizaciones (`AppUpdate.java`, descarga el APK de la release e instala).
Si un método nuevo del servicio de Node también hace falta en Android, hay que
portarlo a Java.

El reproductor es `NativePlayerPlugin.java` (Media3, una SurfaceView detrás
del WebView transparente) con `ui/js/native-player.js`, que hace que los
`<video>` hablen con él (capacidad `'native-player'`). Volver a hls.js para
comparar: `localStorage.opentv_player = 'web'`.

Medido en un Fire TV Stick 3.ª gen. (1 GB): con ExoPlayer la CPU al
reproducir bajó de ~300 % a ~77 %. La navegación del inicio se queda en unos
18 ms por fotograma; no baja con zoom, capas ni render a 720p.

### Compilar, firmar e instalar

```bash
npm run build:apk     # interfaz + cap sync + APK de release → dist/OpenTV-<versión>.apk
```

- **Requisitos:** JDK 17 en `JAVA_HOME` y el Android SDK (`ANDROID_HOME` o
  `platforms/android/android/local.properties`).
- **R8** está activado en el release. Las reglas de OpenTV (incluidas las de
  libtorrent4j) están en `android/app/proguard-rules.pro`; si algo falla solo
  en release, falta una regla `-keep`.
- **Firma:** `platforms/android/android/keystore.properties` (ignorado por git):
  ```properties
  storeFile=C:/ruta/fuera/del/repo/opentv-release.jks
  storePassword=…
  keyAlias=opentv
  keyPassword=…
  ```
  Sin ese archivo se usa la clave de depuración. Un APK con otra firma no se
  instala encima del que ya hay: habría que desinstalar y se pierden los datos.
- **Versiones:** cada release sube `versionCode` en `android/app/build.gradle`;
  en Fire TV eso también refresca el icono del lanzador.
- **WebView:** la depuración remota (chrome://inspect) solo está en el build
  de depuración (`gradlew assembleDebug`).
- **Instalar en la Fire TV:** ver el README (Downloader o `adb install -r`).

## Pendiente

- macOS y Linux (builds de Electron con el FFmpeg de cada sistema).
- Android TV de otras marcas y uso largo en el Fire TV (memoria).
- Una política de seguridad de contenido (CSP) para la ventana de Electron.

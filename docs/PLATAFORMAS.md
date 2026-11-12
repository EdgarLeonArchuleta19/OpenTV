# OpenTV en varias plataformas — plan por fases

Una sola base de código (`ui/` + `service/`) y un envoltorio por plataforma:

| Plataforma | Envoltorio | Carpeta |
|---|---|---|
| Windows (después macOS y Linux) | Electron | `platforms/electron/` |
| Android TV, Fire TV, Android | Capacitor | `platforms/android/` |
| TV LG | webOS | `platforms/webos/` |

## Estructura

```
ui/                  interfaz compartida (HTML, CSS, JS ES5)
  js/platform.js     qué dispositivo es y qué puede hacer
  js/src/mobile/     diseño de celular
  desktop/tw/capas/  estilos por capas; 10-teles.css = diseño de tele
service/             servicio Node compartido (portal, proxy, relay, TMDB; torrents.js solo en PC)
platforms/
  electron/          main.cjs, preload, instalador de Windows
  android/           proyecto Capacitor: servicio nativo en Java + plugin ExoPlayer
  webos/             appinfo.json y empaquetado para la TV LG
scripts/             build y empaquetado por plataforma (lib/ui-package.cjs: copia y minifica)
tests/               pruebas compartidas
```

Regla: si algo se puede hacer en `ui/` o `service/`, va ahí; las carpetas de
`platforms/` solo tienen lo que de verdad es distinto.

## Qué hay en cada plataforma

| Función | PC (Electron) | Android TV / Fire TV / Android | TV LG |
|---|---|---|---|
| Catálogo integrado (películas, series, TV en vivo) | ✅ | ✅ | ✅ |
| Listas M3U propias para TV en vivo | ✅ | ✅ | ✅ |
| Modos de películas y series: automático / Addons (compatible con Stremio) | ✅ | — (siempre automático) | — (siempre automático) |
| Torrents en el modo manual | ✅ | — | — |

Los modos dependen de la capacidad `'addons'` y los torrents de `'torrents'`
(`ui/js/platform.js`); solo Electron las tiene. En las demás plataformas la
sección no aparece en Ajustes y, si quedara guardado el modo manual, se usa
el automático. El servicio de PC es el único que carga el motor de torrents
(`service/torrents.js`, con `torrent-stream`); el de la TV LG responde que no
está disponible y el de Android (Java) no tiene esos métodos.

### Modo Addons, cómo funciona

1. **Ajustes → Fuentes**: el usuario pega la URL del `manifest.json` de un
   addon. Se guarda lo que ofrece (catálogos, fichas, fuentes, subtítulos).
   Vienen instalados, una sola vez y se pueden quitar, Cinemeta (catálogo) y
   OpenSubtitles (subtítulos), como en Stremio. Ningún addon de fuentes.
   Al elegir el modo Addons, un aviso dice de qué addons depende.
   En la interfaz el modo se llama "Addons" (con una línea "compatible con
   Stremio"): "Stremio" es una marca de otra empresa y no se usa como nombre
   de nada de OpenTV.
2. **Inicio**: una fila por catálogo del addon, con su nombre ("Popular ·
   Películas"). Los títulos llevan id `stremio:<id>` para no mezclarse con el
   catálogo integrado en el historial y Mi lista.
3. **Reproducir**: panel "Elegir fuente" con las fuentes de todos los addons
   (calidad, tamaño, número de fuentes del torrent). La elección se recuerda por
   película o capítulo; "Cambiar fuente" en la ficha la cambia. El siguiente
   capítulo usa el mismo addon y calidad.
4. **Servicio** (`resolveExternal`): HLS tal cual; MP4/WebM tal cual; MKV/AVI
   y lo que el addon marca como no apto para navegador, por el relay FFmpeg
   (copia el vídeo y convierte solo el audio; si aun así falla, convierte todo).
   Torrents: `torrentStart` → URL local → el mismo camino.
5. **Torrents**: aviso la primera vez; uno a la vez; la descarga está en la
   carpeta temporal y se borra al salir de las películas, al cambiar de fuente
   o al cerrar la app (y tras 10 min sin leerse).

## Fases

| # | Fase | Resultado | Estado |
|---|---|---|---|
| 1 | **Carpetas** | `desktop/` → `platforms/electron/`, `appinfo.json` → `platforms/webos/`, `npm run build:webos` arma el paquete de la TV. Nada cambia para el usuario. | hecha |
| 2 | **Capa `platform`** | `ui/js/platform.js` detecta Electron / webOS / Android y sus capacidades (`platformHas('window')`, `'pip'`, `'mouse'`…). El diseño nuevo se usa en todas; lo exclusivo de PC (ventana, PiP, barra de título) se oculta en TV. Probar otra plataforma en el PC: `?platform=webos` o `?platform=android-tv`. | hecha |
| 3 | **Modo ligero en TV** | Ya se enciende solo en TV (fase 2). Falta: compatibilidad con el navegador de webOS 5 (Chromium 68: sin `gap` en flex, `inset`, `:has`…), imágenes más ligeras y listas largas en TV. | siguiente |
| 4 | **Proyecto Capacitor** | `platforms/android/`: abre la app en el Fire Stick, aparece en el menú de la tele (leanback + banner), control remoto y botón Atrás. Diseño de celular en `ui/js/src/mobile/`. | hecha |
| 5 | **Servicio en Android** | En lugar de nodejs-mobile (pesado para 1 GB de RAM), `service/` se portó a Java (`android/app/src/main/java/com/techpoint/opentv/service`): servidor local en `127.0.0.1:8910` con portal, proxy HLS, DoH y TMDB; la interfaz lo usa por HTTP (`vodApi.devServiceUrl`, lo pone `build-android.cjs`). | hecha |
| 6 | **Reproductor ExoPlayer** | `NativePlayerPlugin.java` (Media3 1.4.1, una SurfaceView detrás del WebView transparente) y `ui/js/native-player.js`, que hace que los `<video>` del reproductor y de la vista previa de TV en vivo hablen con él (capacidad `'native-player'`; sin hls.js). Películas MPEG-TS como archivo (todas las pistas de audio, búsqueda nativa), canales HLS, subtítulos de la página, calidad HLS. Volver a hls.js para comparar: `localStorage.opentv_player = 'web'`. | hecha |
| 7 | **Prueba en Fire Stick** | Probado en el aparato real (Fire TV Stick 3ª gen., 1 GB): con ExoPlayer la CPU al reproducir bajó de ~300 % a ~77 %. APK de release con R8 (11,3 → 3,6 MB) y firmado: `npm run build:apk`. Falta: medir memoria con uso largo, probar en un celular y en Android TV de otra marca. | casi |
| 8 | **macOS y Linux** (opcional) | Builds de Electron (dmg, AppImage) con FFmpeg de cada sistema. | pendiente |

Cada fase termina con: build, `npm test`, `npm run test:e2e`, prueba en la
app y commit propio.

## Android: compilar, firmar e instalar

```bash
npm run build:apk     # interfaz + cap sync + APK de release → dist/OpenTV-<versión>.apk
```

- **Requisitos:** JDK 17 en `JAVA_HOME` y el Android SDK (`ANDROID_HOME` o
  `platforms/android/android/local.properties`).
- **R8** está activado en el release (`minifyEnabled` + `shrinkResources` en
  `android/app/build.gradle`). Capacitor y Media3 traen sus propias reglas; las de
  OpenTV están en `android/app/proguard-rules.pro`. Si un plugin nuevo falla solo en
  release, falta una regla `-keep` para él.
- **Firma:** `platforms/android/android/keystore.properties` (ignorado por git)
  indica la clave:
  ```properties
  storeFile=C:/ruta/fuera/del/repo/opentv-release.jks
  storePassword=…
  keyAlias=opentv
  keyPassword=…
  ```
  Sin ese archivo se usa la clave de depuración. Un APK con otra firma no se puede
  instalar encima del que ya hay: hay que desinstalar (se pierden los datos).
- **WebView en release:** la depuración remota (chrome://inspect) solo está en el
  build de depuración (`gradlew assembleDebug`).
- **Instalar en la Fire TV:** ver el README (Downloader o `adb install -r`).

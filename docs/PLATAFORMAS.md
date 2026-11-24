# Plataformas y arquitectura de OpenTV v2

## 1. Núcleo unificado en Rust (`core/`)

Todo el backend vive una sola vez en `core/crates/opentv-core`:

- **Torrents (`torrents.rs`):** motor `librqbit` 9.1 con arranque y carrera de fuentes en paralelo (`tokio::spawn`, máx. 2 en TV), `TcpAndUtp` + DHT persistente, trackers embebidos en el magnet (`&tr=`) y prefetch secuencial cabeza + cola (`moov`/`Cues`).
- **Proxy multimedia (`proxy.rs`, `resolve.rs`):** cliente HTTP/2 con pool compartido, detección `#EXTM3U` en listas ofuscadas, reescritura de segmentos `/hls/`, cabeceras personalizadas, `forceProxy` para canales con bloqueo CORS (Pluto TV) y cancelación por token (`exceptToken`).
- **TV en vivo y guía (`m3u.js` → `m3u.rs`, `epg.rs`):** lectura M3U con filtro adulto, EPG "Ahora / Después" y consulta bajo demanda de 12 h (`epgSchedule`).
- **Seguridad (`netguard.rs`, `dnsx.rs`):** resolución DNS (sistema + DoH de respaldo) con IPv4 primero, bloqueo de loopback (`127.0.0.0/8`, `::1`) y control por plugin de la red local (`Red de tu casa`). `pluginFetch` fija cada conexión a una IP validada y prueba la siguiente si esa no responde, porque hay redes con IPv6 asignado pero sin salida.
- **Descargas, Subtítulos, TMDB, `/img` y Actualizador:** `downloads.rs`, `subtitles.rs`, `tmdb.rs`, `images.rs` y `app_update.rs`.

## 2. Windows PC (`apps/desktop/`)

- App **Tauri v2** con `opentv-core` compilado e iniciado en el mismo proceso (sin Node, sin Electron, sin ejecutable hijo).
- Usa **WebView2** del sistema (aceleración GPU + decodificadores Windows Media Foundation para HEVC y E-AC-3/Dolby).
- Volumen del sistema vía COM Core Audio (`audio_win.rs`), captura aislada (`capture.rs`) y apertura de enlaces vía `ShellExecuteW`.
- Interfaz moderna en **React 19 + TypeScript + Vite 6 + Tailwind CSS v4 + Zustand** (`apps/desktop/frontend/` → compila a `apps/desktop/dist-ui/` con CSP estricta y división de chunks) conectada vía IPC tipado (`src/services/tauri.ts`).

## 3. Android, Android TV y Fire TV (`apps/android/`)

- App **100 % nativa en Kotlin** (`minSdk 23`, `targetSdk 35`) con **Jetpack Compose + Compose for TV** replicando pixel a pixel el diseño de escritorio de OpenTV (`#0E0E11`, 6 acentos, logo vectorial, Hero, Ficha 2 columnas, Elegir fuente con badges blancos, Guía de canales y Buscador).
- Se comunica con `libopentv_service.so` vía JNI directo (`callRpcNative`, `startNative`, `stopTorrentNative`, `netguardRefusalNative`).
- Reproductor **Media3 ExoPlayer** sobre `SurfaceView` directo con passthrough HDMI (AC-3, E-AC-3, Dolby Atmos, TrueHD, DTS), AFR en TV, `DefaultLoadControl` adaptado a 1 GB RAM, subtítulos estilizados y PiP en móvil.
- Plugins JS (`kino-plugin.json`) ejecutados con el mismo runtime que la PC (`assets/js/plugin-runtime.js`), **un WebView oculto por plugin** sin red propia (`JsPluginHost.kt`), creado al usarse y destruido tras 60 s sin uso (máx. 4 en equipos de poca memoria): toda petición pasa por Rust `pluginFetch`.

## 4. Plugins y elección de fuente (PC y TV)

- **Stremio** (`manifest.json`): catálogos, metadatos, fuentes y subtítulos. Se incluyen siempre Cinemeta, Anime Kitsu y OpenSubtitles v3.
- **Plugins JS** (`kino-plugin.json`): corren con el runtime compartido `plugin-runtime.js` (`apps/desktop/frontend/public/js/` y `apps/android/app/src/main/assets/js/`), **cada plugin aislado en su propio sandbox** (un iframe `allow-scripts` por plugin en PC, un WebView por plugin en Android). El host identifica al plugin por el marco que envía el mensaje (nunca por lo que el plugin dice ser), usa ids de llamada aleatorios y guarda las cookies y el almacenamiento por plugin (`jsPlugins.ts`, `jsPluginSecurity.ts`, `JsPluginHost.kt`, `JsPluginSecurity.kt`). Ofrecen `kino.fetch` (vía `pluginFetch`), `kino.storage`, `kino.config`, `kino.crypto` y `kino.plugins.call`. Las cookies y el `Accept-Language` de cada dominio se conservan para el stream.
- **Plugins auxiliares** (`consumes.<puerta>.repo`, p. ej. Kino Resolver): solo se cargan los de una lista aprobada. Corren en su propio sandbox, siempre sin acceso a la red local, y reciben solo datos JSON. Si el manifiesto fija `commit` o `sha256`, se respeta y se verifica. Los plugins solo pueden consultar a TMDB por una lista cerrada de rutas de lectura.
- **Búsqueda progresiva:** Stremio y los plugins JS se consultan en paralelo y cada respuesta se publica en cuanto llega (`sourceSearch.ts` en PC, `PlayerScreen.kt` en TV).
- **Elección automática** (`sourceRanker.ts` / `SourceRanker.kt`):
  1. Idioma preferido primero.
  2. Calidad objetivo según el equipo y la red (`deviceProfile.ts` / `PlaybackProfile.kt`): 1080p en PC capaz con buena red y 720p en equipos modestos. 4K, HEVC y 10-bit no se eligen solos si no se pueden decodificar.
  3. Una fuente directa gana a los torrents del mismo idioma o peor. Las CAM nunca suben.
- **Espera:** se elige en cuanto llega una fuente directa en el primer idioma preferido. Si no, se espera unos 10 s en PC (22 s en TV de 1 GB) después de los primeros resultados, o hasta 70 s si no llegó nada.
- **Reproducción y respaldo:** la carga ocurre dentro del reproductor. Antes de usar una fuente directa se pide un rango de 2 bytes: si el servidor responde 401/403/404/410/429/5xx, se salta. El siguiente intento prefiere otro servidor, con hasta 8 directas y luego el mejor torrent.

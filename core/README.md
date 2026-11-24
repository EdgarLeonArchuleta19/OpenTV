# core — el servicio local de OpenTV en Rust

Un solo código para PC y Android. Reemplaza al servicio de Node (`service/`)
y a su port en Java de OpenTV 1. La interfaz (`ui/`) no sabe quién contesta:
llama a los mismos métodos por HTTP en `127.0.0.1`.

## Crates

| Crate | Qué es | Sale como |
|---|---|---|
| `opentv-core` | Toda la lógica y el servidor HTTP (axum + Tokio) | biblioteca |
| `opentv-service` | Arranque en PC: lee argumentos, imprime `OPENTV_READY` | `bin/opentv-service.exe` |
| `opentv-android` | Entradas JNI para `RustServiceBridge.kt` | `jniLibs/<abi>/libopentv_service.so` |

Módulos de `opentv-core/src`:

| Módulo | Hace |
|---|---|
| `rpc.rs` | Rutas, filtro de origen, token y `dispatch` (la lista de métodos) |
| `config.rs` | `ServiceConfig`: puerto, token, orígenes permitidos, carpetas |
| `resolve.rs`, `proxy.rs` | `resolveExternal`, proxy de vídeo (`/media/…`) y subtítulos (`/sub/…`) |
| `torrents.rs` | Torrents con librqbit: carrera de fuentes, `torrentProbe`, trackers |
| `downloads.rs` | Descargas directas, HLS sin FFmpeg y torrents |
| `m3u.rs`, `epg.rs` | Listas M3U y guía XMLTV |
| `tmdb.rs` | Tendencias y búsqueda en español |
| `netguard.rs`, `dnsx.rs` | Reglas de red de los plugins JS y DNS sobre HTTPS |
| `plugin_fetch.rs` | `pluginFetch`: red de los plugins JS, IP fijada en cada salto |
| `images.rs` | `/img`: pósters al tamaño en que se muestran, con caché en disco |
| `subtitlecat.rs`, `video_hash.rs` | Subtítulos de SubtitleCat y hash de OpenSubtitles |
| `mpv.rs` | Control de libmpv en Windows (`mpv*` y `/mpv/events`) |
| `app_update.rs` | Actualizaciones del APK en Android |

## Compilar

```bash
npm run build:service        # release → bin/opentv-service.exe (PC)
npm run build:rust:android   # release → jniLibs de armeabi-v7a y arm64-v8a (NDK)
npm run fetch:libmpv         # bin/mpv-2.dll, versión fija y con SHA-256
npm run test:service         # cargo test (pruebas de Rust)
npm test                     # incluye tests/core.test.cjs (el .exe por HTTP)
```

`cargo build --workspace` avisa de un choque de nombres de `.pdb` en debug
(el binario `opentv-service` y la biblioteca `opentv_service` de Android): es
solo el archivo de depuración y no afecta a nada; los scripts compilan cada
crate por separado.

## Cómo arranca

- **PC** (Tauri, `apps/desktop/src-tauri/src/main.rs`): el núcleo va embebido
  en el proceso de la app (`opentv_core::start_server_with_state`) y escucha en
  `127.0.0.1` con un puerto al azar. La interfaz lo llama por IPC con el comando
  `desktop_service` (`commands.rs`). El binario `opentv-service.exe`
  (`--port 0 --token <al azar> …`, imprime `OPENTV_READY port=<n>`) se usa solo
  para las pruebas HTTP de `tests/core.test.cjs`.
- **Android** (`RustServiceBridge.kt` → `startNative`): puerto 8910, token
  al azar por proceso (sin token no arranca: devuelve `-5`), carpetas de la
  app, credenciales de TMDB descifradas en memoria, capacidades del aparato.

Códigos de error de `startNative`: `-1` candado roto, `-2` no se pudo crear
Tokio, `-3` no se pudo abrir el puerto, `-4` pánico al arrancar, `-5` sin
token.

## Seguridad

1. **Solo 127.0.0.1.** Nunca escuchar en la red local.
2. **Token en cada método:** cabecera `X-OpenTV-Token` (PC, Java) o parámetro
   `__token` (la página en Android; una cabecera obligaría a una petición
   previa de CORS en cada llamada). Sin token: `401`.
3. **Origen:** `origin_guard` rechaza con `403`, en todas las rutas, cualquier
   petición con un `Origin` que no esté en `allowed_origins`
   (`opentv://app`, `http://localhost`, `https://localhost`,
   `capacitor://localhost`). El iframe de los plugins JS tiene origen `null` y
   también queda fuera. Las peticiones sin `Origin` (ExoPlayer, mpv, Java)
   pasan.
4. **`/img` no aplica reglas de red** a propósito: un addon que corre en la
   misma PC sirve sus pósters desde `127.0.0.1`. Lo que la hacía peligrosa
   (que cualquier web leyera sus respuestas) lo corta el punto 3.
5. **`pluginFetch` y el navegador oculto** pasan siempre por `netguard.rs`.

## Agregar un método

1. Un brazo nuevo en `dispatch` (`rpc.rs`); responde con `ok(json!({...}))`
   o `fail("texto en español")`.
2. En PC, añádelo a `ALLOWED_METHODS` en
   `apps/desktop/src-tauri/src/commands.rs` (la lista de lo que la interfaz
   puede pedir por `desktop_service`).
3. Una prueba en `tests/core.test.cjs` con la forma de la respuesta que
   lee la interfaz.
4. Si cambias una función JNI, cambia también su `native` en
   `RustServiceBridge.kt` y regenera las `.so`.

## Errores graves (pánicos)

El perfil de release usa `panic = "unwind"`, no `"abort"`: un pánico en una
petición termina solo esa tarea de Tokio y el servicio sigue. En Android las
entradas JNI lo atrapan (`guarded()` en `opentv-android`), porque el servicio
vive dentro del proceso de la app y un aborto la cerraría entera. Cuesta
peso: el `.exe` pasa de unos 6.8 a 9.6 MB y las `.so` crecen alrededor de
1 MB cada una.

## libmpv

`scripts/fetch-libmpv.cjs` baja una versión **LGPL** fija de
[media-kit/libmpv-win32-video-build](https://github.com/media-kit/libmpv-win32-video-build)
(`2023-09-24`, `mpv -Dgpl=false` y FFmpeg `--disable-gpl --disable-nonfree
--enable-version3`, solo decodificación/reproducción con D3D11VA/DXVA2/NVDEC/AMF/QSV)
y comprueba su SHA-256. Pesa **28.39 MB** descomprimida (**8.38 MB** comprimida),
frente a los 116–122 MB de la compilación GPL completa. Las licencias y la receta
de compilación están en `licenses/`.

En Windows el reproductor por defecto sigue siendo `<video>` + `hls.js` sobre la
ventana opaca nativa (`titleBarOverlay`, pantalla completa y `Esc` nativos); el
modo experimental de ventana transparente con `libmpv` se activa con `OPENTV_MPV=1`.

## Pendiente

- `mediaDuration` fue retirado de la interfaz y del servicio (el reproductor lee
  duración y pistas directo del stream).
- La integración de `libmpv` en Windows sin ventana transparente (render directo
  dentro de Electron o ventana hija nativa sin romper `titleBarOverlay`) queda
  como paso posterior detrás de `OPENTV_MPV=1`.

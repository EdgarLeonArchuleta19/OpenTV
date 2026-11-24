# AGENTS.md — OpenTV v2

Guía técnica para trabajar en `OpenTV-v2`.

## Arquitectura

OpenTV v2 comparte un solo núcleo en **Rust** (`core/crates/opentv-core`) y entrega una app nativa optimizada por plataforma:

| Plataforma | Envoltorio / UI | Carpeta |
|---|---|---|
| **Windows PC** | **Tauri v2** + **React 19 + TypeScript + Vite 6 + Tailwind v4 + Zustand** + `opentv-core` embebido | `apps/desktop/` (`frontend/` + `src-tauri/`) |
| **Android, Android TV y Fire TV** | **Kotlin 2.1** + Jetpack Compose / Compose for TV + Media3 ExoPlayer + JNI `libopentv_service.so` | `apps/android/` |
| **Núcleo compartido** | Rust (`librqbit`, proxy HTTP/2, M3U, EPG, TMDB, NetGuard, descargas, subtítulos, `/img`) | `core/` |

## Prioridad: fluidez en la tele y paridad visual

- El aparato de referencia es un **Fire TV Stick de 1 GB** (`armeabi-v7a` / Fire OS 6–8, `minSdk 23`).
- En `apps/android/` la UI es **100 % nativa en Jetpack Compose** (cero WebView para UI), con `RGB_565` en Coil 3, `SurfaceView` directo en Media3, sin `blur` costoso en TV y `callRpcNative` por JNI directo.
- En `apps/desktop/frontend/` la UI de PC usa **React 19 + TypeScript estricto + Vite 6 + Tailwind CSS v4 + Zustand**, compilando a `apps/desktop/dist-ui/` con CSP estricta en producción (`strictCspPlugin`) y división de chunks (`vendor-react`, `vendor-icons`, `vendor-hls`).
- Ambas interfaces (PC Tauri y Android/TV Kotlin) mantienen **paridad visual 1:1** con el diseño oscuro monocromo `#0E0E11` de OpenTV, los 6 acentos, texto +12 % y margen TV.

## Comandos

```bash
npm run dev                # PC en desarrollo (Vite React HMR + Tauri v2)
npm run build:ui           # Verifica TypeScript (tsc --noEmit) + compila Vite → apps/desktop/dist-ui/
npm run build:pc           # Compila React/TS + instalador NSIS PC → dist/OpenTV-Setup-<ver>.exe
npm run build:android      # JUnit + APKs Release (R8) → dist/OpenTV-<ver>.apk (universal), -firetv-armv7.apk, -arm64.apk
npm run build:rust:android # Compila libopentv_service.so (arm64-v8a + armeabi-v7a)
npm test                   # Vitest + cargo test + contrato HTTP Rust
npm run test:frontend      # Pruebas unitarias Vitest (apps/desktop/frontend/)
npm run test:rust          # cargo test en core/
npm run test:android       # Pruebas JUnit Kotlin
```

## Reglas clave

- **Textos visibles en español** (siempre decir **"plugin"**, nunca "addon"; mencionar "Stremio" solo como *"compatible con Stremio"*). Comentarios en inglés.
- **3 plugins incluidos e inborrables:** Cinemeta, Anime Kitsu y OpenSubtitles v3 (`Incluido`).
- **Secciones:** `anime` solo va a Anime (Kitsu); `Kids` solo incluye género `Family` (nunca `Animation` general).
- **Seguridad:** el servicio Rust escucha solo en `127.0.0.1` con token por sesión. Los plugins JS (`kino-plugin.json`) corren siempre aislados (`public/plugin-sandbox.html` con `sandbox="allow-scripts"` sin `allow-same-origin` en PC; WebView bajo demanda sin red propia en Android) y pasan por `NetGuard` en Rust.
- **Secretos:** `config/tmdb.json`, `apps/android/keystore.properties` y `*.jks` están ignorados por git; nunca subirlos ni copiarlos.
- **Pruebas en TV:** usar un emulador de Android TV (AVD 1080p con poca RAM). Nunca instalar ni controlar builds en el Fire TV real del dueño.
- **Git:** no hacer `commit` ni `push` sin petición explícita del dueño. La v1 vive en la rama `legacy` (etiqueta `v1-legacy`).

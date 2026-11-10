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
  js/src/platform/   lo único que cambia por plataforma (fase 2)
service/             servicio Node compartido (portal, proxy, relay)
platforms/
  electron/          main.cjs, preload, instalador de Windows
  android/           proyecto Capacitor + plugin ExoPlayer (fase 4+)
  webos/             appinfo.json y empaquetado para la TV LG
scripts/             build y empaquetado por plataforma
tests/               pruebas compartidas
```

Regla: si algo se puede hacer en `ui/` o `service/`, va ahí; las carpetas de
`platforms/` solo tienen lo que de verdad es distinto.

## Fases

| # | Fase | Resultado | Estado |
|---|---|---|---|
| 1 | **Carpetas** | `desktop/` → `platforms/electron/`, `appinfo.json` → `platforms/webos/`, `npm run build:webos` arma el paquete de la TV. Nada cambia para el usuario. | en curso |
| 2 | **Capa `platform`** | `ui/js/src/platform/`: detecta escritorio / webOS / Android y da una sola API (atrás, pantalla completa, reproductor, servicio). Las comprobaciones `window.XUPER_DESKTOP` pasan a capacidades (`platform.has('mouse')`, …). | pendiente |
| 3 | **Modo ligero en TV** | Activo solo en TV LG y Android TV/Fire TV; reglas para el CSS de TV. En PC sigue siendo opcional (Ajustes). | pendiente |
| 4 | **Proyecto Capacitor** | `platforms/android/`: abre la app en el Fire Stick, aparece en el menú de la tele (leanback + banner), control remoto y botón Atrás. | pendiente |
| 5 | **Servicio en Android** | `service/` corriendo con nodejs-mobile (Capacitor-NodeJS) y el puente `platform.service`. | pendiente |
| 6 | **Reproductor ExoPlayer** | Plugin Kotlin (Media3) detrás de `platform.player`: TV en vivo, películas, series, subtítulos, audio. | pendiente |
| 7 | **Prueba en Fire Stick** | Medir fluidez y memoria en el aparato real (Fire TV Stick 3ª gen., 1 GB) y ajustar; APK firmado. | pendiente |
| 8 | **macOS y Linux** (opcional) | Builds de Electron (dmg, AppImage) con FFmpeg de cada sistema. | pendiente |

Cada fase termina con: build, `npm test`, `npm run test:e2e`, prueba en la
app y commit propio.

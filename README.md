# OpenTV Desktop

**OpenTV Desktop** es una aplicación de escritorio para Windows (x64) diseñada para reproducir TV en vivo, películas, series y listas M3U personalizadas con interfaz moderna adaptada a teclado y ratón.

## Características principales

- **TV en vivo y Catálogo VOD**: Navegación por categorías, favoritos e historial de reproducción persistente.
- **Inicio**: fila *Seguir viendo* (con progreso; se puede quitar cada título) y en Destacados una fila por cada estante del portal. En *Mi cuenta → Apariencia* se eligen pósteres normales o compactos (más títulos por fila).
- **Buscador**: sugerencias del catálogo mientras se escribe (sin consultar al servidor) y búsquedas recientes; el portal se consulta al pulsar `Enter` o *Buscar*.
- **Guía de canales** (`G` o el botón *Guía*): todos los canales por país o tema, filtro por nombre, *Favoritos* y *Recientes*. El portal no publica la programación (EPG), así que la guía muestra los canales en vivo, no horarios.
- **Reproductor**: volumen (controla el de Windows cuando está disponible; también con la rueda del ratón), tiempo al pasar por la barra, calidad, cuenta atrás al siguiente episodio.
- **Barra de título propia** con los botones nativos de Windows; desaparece en pantalla completa.
- **Reproducción automática con modo compatible**:
  - **Automática (predeterminada)**: reproducción nativa mediante HLS.js y proxy local con recuperación ante microcortes de red.
  - **Cambio automático**: si un vídeo no arranca en 15 s, se congela varias veces, no tiene sonido o falla el HLS, se reinicia una vez en *modo compatible* en la misma posición, y el título se recuerda en este equipo.
  - **Compatibilidad máxima** (manual, en Ajustes del reproductor): recodifica en tiempo real a MP4 fragmentado con `ffmpeg.exe` integrado. Usa más CPU; recomendado solo si un vídeo se corta o no tiene sonido.
- **Ventana flotante (PiP)** desde películas, series y TV en vivo.
- **Gestor de Addons M3U**: Soporte integrado para agregar, actualizar o eliminar listas `.m3u` / `.m3u8` personalizadas o preconfiguradas.
- **DNS seguro (DoH) integrado**: Resolución automática mediante Cloudflare y Google DNS-over-HTTPS con respaldo al DNS del sistema en Windows.
- **Modo Portable y Persistente**: Conserva favoritos, historial y configuración en `%APPDATA%\OpenTV` o en la carpeta portable `OpenTV - datos` (con migración automática de perfiles previos).

## Controles de teclado y ratón

| Acción | Atajo / Gesto |
| --- | --- |
| Navegar y abrir | Ratón o flechas + `Enter` |
| Reproducir / Pausar | Un clic sobre el vídeo o `Espacio` |
| Pantalla completa | Doble clic sobre el vídeo, `F` o `F11` (salir con `Esc`) |
| Silenciar / Activar audio | `M` |
| Retroceder / Adelantar (VOD) | Flechas `←` / `→` o mantener pulsado el tercio izquierdo/derecho del vídeo |
| Ventana flotante (PiP) | `Ctrl + P` |
| Buscar | `Ctrl + F` |
| Historial | `Ctrl + J` |
| Inicio | `Ctrl + H` |
| Ajustes | `Ctrl + ,` |
| Guía de canales (TV) | `G` |
| Volumen (reproductor y TV) | Rueda del ratón sobre el vídeo |
| Recargar | `Ctrl + R` o `F5` |
| Volver / Cerrar panel | `Esc`, `Backspace` o `Alt + ←` |

## Estructura del proyecto

- `desktop/`: Proceso principal de Electron (`main.cjs`), puente seguro (`preload.cjs`) y adaptador del servicio local (`service.cjs`).
- `service/`: Cliente del portal (`magis.js`), proxy HTTP/HLS (`proxy.js`), relay FFmpeg (`ffmpeg-relay.js`), DNS-over-HTTPS (`dnsx.js`), indexador MPEG-TS (`ts-indexer.js`), duración por FFmpeg (`media-duration.js`) y diagnóstico de red (`netdiag.js`).
- `ui/`: Interfaz gráfica compartida por la TV (LG webOS) y el escritorio. El código está en `ui/js/src/` (módulos en `core/`, `services/`, `screens/`, `home/`, `live/`, `player/`, `desktop/`) y se une en `ui/js/app.js` con `npm run build:js` (ver `ui/js/src/README.md`). Estilos: `css/style.css` (base TV) + capas de escritorio en `desktop/` (`tailwind.css` se genera desde `desktop/tw/input.css`).
- `bin/`: Binario `ffmpeg.exe` para Windows x64.

## Desarrollo y compilación

```bash
# Instalar dependencias
npm install

# Ejecutar en modo desarrollo
npm start

# Regenerar app.js (desde ui/js/src) y los estilos de Tailwind
npm run build       # = build:js + build:css
npm run check:js    # comprueba que app.js está al día

# Pruebas automáticas
npm test            # bundle ES5 para la TV, módulos, catálogo, búsqueda, guía, M3U
npm run test:e2e    # abre la interfaz real en Electron y recorre las pantallas

# Actualizar la copia del catálogo incluida en la app (necesita internet)
npm run snapshot    # --dry para ver el resultado sin escribir ui/data/portal.js

# Generar ejecutable / portable para Windows
npm run dist
npm run release     # catálogo + build + pruebas + instaladores y paquete
```

## Actualizaciones automáticas

La versión **instalada** (NSIS) busca una versión nueva al abrirse y cada 6 horas, la descarga en segundo plano y la instala al cerrar la app (o al pulsar *Reiniciar y actualizar* en el aviso o en *Ajustes → Acerca de*). La versión **portable** solo avisa de que hay una nueva.

Para activarlas hace falta un sitio donde publicar las versiones. Con GitHub Releases (gratis), añade en `package.json → build`:

```json
"publish": [{ "provider": "github", "owner": "TU_USUARIO", "repo": "opentv-releases" }]
```

y publica cada versión subiendo el número en `package.json → version` y ejecutando (con un token de GitHub en `GH_TOKEN`):

```bash
npx electron-builder --win nsis --publish always
```

Sirve también cualquier servidor de archivos: `{ "provider": "generic", "url": "https://tu-servidor/opentv/" }` y copiar allí el instalador, su `.blockmap` y `latest.yml` de `dist/`. Sin `publish` la app funciona igual y *Acerca de* indica que las actualizaciones no están configuradas. La primera versión con actualizador se instala a mano; las siguientes llegan solas.

## Licencia

Distribuido bajo licencia MIT (`LICENSE`). Desarrollado y mantenido por **TECHPOINT**.

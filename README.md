# OpenTV Desktop

**OpenTV Desktop** es una aplicación de escritorio para Windows (x64) diseñada para reproducir TV en vivo, películas, series y listas M3U personalizadas con interfaz moderna adaptada a teclado y ratón.

## Características principales

- **TV en vivo y Catálogo VOD**: Navegación por categorías, buscador instantáneo, favoritos e historial de reproducción persistente.
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
| Volver / Cerrar panel | `Esc`, `Backspace` o `Alt + ←` |

## Estructura del proyecto

- `desktop/`: Proceso principal de Electron (`main.cjs`), puente seguro (`preload.cjs`) y adaptador del servicio local (`service.cjs`).
- `service/`: Cliente del portal (`magis.js`), proxy HTTP/HLS (`proxy.js`), relay FFmpeg (`ffmpeg-relay.js`), DNS-over-HTTPS (`dnsx.js`), indexador MPEG-TS (`ts-indexer.js`), duración por FFmpeg (`media-duration.js`) y diagnóstico de red (`netdiag.js`).
- `ui/`: Interfaz gráfica (`index.html`, `js/app.js`, `css/style.css`, `desktop/modern.css`, `desktop/theme.css`, `desktop/tailwind.css` generado desde `desktop/tw/input.css`, `desktop/player.js`, `desktop/input.js`, `desktop/bridge.js`).
- `bin/`: Binario `ffmpeg.exe` para Windows x64.

## Desarrollo y compilación

```bash
# Instalar dependencias
npm install

# Ejecutar en modo desarrollo
npm start

# Recompilar los estilos (Tailwind → ui/desktop/tailwind.css)
npm run build:css   # o: npm run watch:css

# Generar ejecutable / portable para Windows
npm run dist
```

## Licencia

Distribuido bajo licencia MIT (`LICENSE`). Desarrollado y mantenido por **TECHPOINT**.

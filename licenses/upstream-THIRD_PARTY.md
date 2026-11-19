# Terceros y procedencia

El código propio de OpenTV es de TECHPOINT Software™, con todos los derechos
reservados (ver `LICENSE`). Este repositorio también contiene o usa material
de terceros, con su propia licencia, que esa licencia **no** cambia.

## 1. Origen del proyecto

OpenTV empezó como un fork de un port de escritorio de la interfaz de la app
XuperTV. El código que venga de ese proyecto sigue bajo su licencia MIT, cuyo
aviso se conserva en `upstream-LICENSE`. Desde
entonces es una app independiente: ya no usa el portal ni el catálogo de esa
app, y películas, series y TV en vivo salen de los addons y listas M3U de
cada usuario.

## 2. Recursos gráficos de XuperTV

- Ruta: `ui/assets/original/**` (algunos iconos y fondos del reproductor,
  la búsqueda, el inicio y los ajustes que aún usa la interfaz).
- Origen: APK público `com.xuper.netxxus` versión `4.34.4` (`43404`), sin
  modificar, con SHA-256
  `e70ce12782eec9f43393b69d88e2d243d8812ae38d2acf08856baa877c1ab856`.
- Los derechos siguen siendo de sus autores. Si eres titular y quieres que se
  retire algún recurso, abre un issue y se elimina.

## 3. Componentes incluidos en las apps

| Componente | Dónde | Licencia | Texto |
|---|---|---|---|
| FFmpeg 6.1.1 (build de gyan.dev) | `bin/ffmpeg.exe`, app de Windows | GPL v3 | `FFmpeg-GPLv3.txt`, `FFmpeg-build-and-sources.txt` |
| HLS.js | `ui/desktop/` | Apache 2.0 | `HLS.js-LICENSE` |
| torrent-stream | `service/torrents.js`, app de Windows | MIT | `torrent-stream-LICENSE` |
| libtorrent4j (con libtorrent nativo) | app de Android | MIT | `libtorrent4j-LICENSE` |
| Electron | app de Windows | MIT | en el instalador |
| Capacitor, AndroidX Media3 / ExoPlayer | app de Android | MIT / Apache 2.0 | en sus paquetes |
| Tailwind CSS | solo para compilar los estilos | MIT | dependencia de desarrollo |

## 4. Servicios externos

La app no incluye contenido audiovisual ni credenciales. En tiempo de
ejecución consulta:

- **Cinemeta**, **Anime Kitsu** y **OpenSubtitles**: addons públicos
  compatibles con Stremio, preinstalados (solo catálogo y subtítulos).
- Los addons y las listas M3U que agrega cada usuario.
- **TMDB**, para tendencias y búsqueda por título, solo si la build lleva una
  clave (`config/tmdb.json`, fuera de git). Este producto usa la API de TMDB,
  pero TMDB no lo respalda ni lo certifica.
- Las releases de este repositorio en GitHub, para las actualizaciones.

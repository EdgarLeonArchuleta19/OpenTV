# Cambios

## Sin publicar

### Contenido
- **Kids:** solo títulos para todo público. Películas con clasificación mexicana AA/A (y G/PG de EE. UU. con género familiar como respaldo), series del género infantil sin animación para adultos y sin títulos sin traducir. Filas: "Películas para todos", "Series infantiles", "Animadas para niños" y "Las favoritas de los niños".
- **Anime:** "Tendencias de la temporada" con lo más seguido de la temporada actual (Kitsu). Los banners de Kids y Anime rotan cada día.

### Rendimiento (escritorio)
- Las filas aparecen a medida que llegan. Los catálogos se guardan y se refrescan en segundo plano, y las demás pestañas y pantallas se precargan. Películas y Series abren en menos de 0,1 s y reabrir la app tarda unos 0,26 s.
- En el reproductor, la revisión del servidor y la resolución del enlace van en paralelo, y hay un solo análisis de FFmpeg por URL.
- Las carátulas de TMDB, Cinemeta y Kitsu se cargan directo de su CDN, como en la v1, en lugar de pasar por el redimensionador local. Al pasar el cursor por un póster se precarga su imagen grande, y la ficha ya no deja ver la imagen del título anterior. La barra superior ya no usa desenfoque.
- `npm run dev` compila el núcleo y sus dependencias optimizados, y el núcleo de PC usa `opt-level = 3`. Nuevo `npm run preview:pc` para probar la velocidad real de la app instalada sin generar instalador.
- Mientras se reproduce, los mensajes salen solo dentro del reproductor y nunca como aviso negro global.

### Seguridad
- Cada plugin JS corre aislado en su propio sandbox (un iframe por plugin en PC, un WebView por plugin en Android). La identidad se toma del marco que envía el mensaje, los ids de llamada son aleatorios y las cookies y el almacenamiento van por plugin.
- Los plugins auxiliares solo se cargan desde una lista aprobada (Kino Resolver), sin acceso a la red local y con fijación por commit o SHA-256 cuando el manifiesto la declara. Los plugins solo pueden hacer consultas de lectura a TMDB.
- FFmpeg solo lee a través del proxy local, con `-protocol_whitelist`, y cada salto pasa por NetGuard. Se quitó el reintento sin verificar TLS.
- NetGuard cubre NAT64, 6to4, direcciones compatibles con IPv4, rangos reservados y metadatos de nube.
- El servidor local exige que la cabecera `Host` sea la suya y tiene orígenes permitidos por plataforma.
- Imágenes con límite de tamaño (contra imágenes bomba), `/img` sin tipos de contenido ajenos y `nosniff`.
- Nombres reservados de Windows en descargas, rutas de red solo si se eligen en el selector, trackers de torrent filtrados y UPnP apagado por defecto.
- FFmpeg y libmpv solo se buscan en las carpetas de la app.
- Actualizador de PC: el `SHA256SUMS` de cada release se verifica con una firma Ed25519 (`scripts/sign-release.cjs`, llave pública en `scripts/release-public-key.txt`) y el instalador se vuelve a comprobar justo antes de ejecutarse.

### Correcciones
- Escritorio: la lista de temporadas tiene altura máxima con scroll y abre en la temporada elegida.
- Escritorio: Atrás (y Esc) sigue el historial real. Desde la ficha regresa a donde se abrió (Inicio, la sección, Mi lista o Buscar) aunque se hayan abierto varios recomendados. Desde Ajustes, Plugins, Buscar o el reproductor regresa a la pantalla anterior.
- Android: la guía de TV en vivo ("Ahora · Después" y programación) no funcionaba porque la app y el núcleo usaban nombres de campos distintos.
- La guía EPG y la conversión con FFmpeg respetan el permiso de red local de cada lista o plugin.

## 2.0.0-alpha.1 — v2 pasa a ser el proyecto principal (2026-11-23)

La v2 reemplaza a la v1 (Electron), que queda en la rama `legacy` y en la etiqueta `v1-legacy`.

### Estructura
- `service-rs/` → `core/` y `platforms/` → `apps/` (`platforms/tauri/` → `apps/desktop/`).

### Plugins y fuentes (PC y TV)
- Pelispedia y Cuevana Pro vuelven a dar fuentes: el host de plugins JS ahora ofrece `kino.plugins.call` (plugin auxiliar Kino Resolver), un `globalThis.kino` por plugin, cookies y `Accept-Language` por dominio, y tiempos de espera realistas (búsqueda 16 s, resolución 65 s).
- Android ejecuta el mismo runtime JS que la PC (antes fallaba con cualquier plugin ESM).
- **Núcleo:** NetGuard y `pluginFetch` prefieren IPv4 y prueban la siguiente IP si una no responde. Esto arregla redes con IPv6 sin salida, como la del Fire TV, donde ningún plugin JS se podía instalar.
- La reproducción automática espera a las fuentes directas de los plugins JS y las prefiere sobre los torrents del mismo idioma.
- Antes de reproducir una fuente directa se revisa que el servidor no la rechace (403/429). Si falla, se pasa a otra fuente, empezando por otro servidor, con hasta 8 intentos.
- Selección automática de calidad según el equipo y la red: Full HD en PC capaz con buena red, HD en equipos modestos y en el Fire TV Stick de 1 GB.
- Las fuentes de calidad desconocida se muestran como "Auto".
- Comunidad se divide en "Recomendados", "Películas y series" y "TV en vivo". El botón de encendido muestra un icono distinto cuando el plugin está apagado.

### Escritorio
- Subtítulos: la lista ya no se duplica cada 10 s y el subtítulo elegido corresponde a su idioma. Lee Latin-1/Windows-1252, UTF-16 y gzip, y carga archivos `.ass`/`.ssa`. Los idiomas llevan su nombre en español.
- Sinopsis y títulos en español (TMDB es-MX) en Inicio, Ficha y episodios.
- Sin color azul en ventana pequeña: borde de ventana oscuro, foco y barras de desplazamiento del tema. Se desactivó la barra de estado de WebView2 (la que mostraba "localhost").
- Formatos: HLS sin `.m3u8`, recuperación de errores de hls.js, conversión automática cuando no hay imagen (HEVC sin extensión), WebM nativo y mensajes de error claros.
- La carga ocurre dentro del reproductor. "Seguir viendo" abre la ficha con "Reanudar · 38:09" o "Reanudar · T1·E3".
- TV en vivo con caché: volver a entrar es instantáneo. El buscador busca mientras escribes.
- "Bloqueo y modo Kids" dentro de Mi cuenta y "Borrar caché" en Ayuda.

### Android TV y Fire TV
- Rendimiento: catálogos en caché en memoria y en disco, filas que aparecen a medida que llegan y precarga de Películas y Series.
- Navegación con el control: el foco de las filas queda centrado y se puede volver al primer póster, la izquierda lleva siempre al menú activo, Atrás tiene un comportamiento coherente y hay confirmación para salir.
- Se corrigió un cierre de la app al cambiar de pestaña (`focusRestorer` de Compose 1.7).
- Los campos de texto ya no atrapan el foco y el teclado solo se abre al pulsar OK.
- Avatares iguales a los de PC. Ficha con Reproducir/fuentes, Idioma y subtítulos, Favoritos y Mi lista, sin el botón de descarga en TV. El foco de los botones es más discreto.
- TV en vivo rediseñada. Mi cuenta, Mi lista (con Historial) y Acerca de con el diseño de PC. Las letras de Ajustes son un 25 % más grandes en TV.
- La carga ocurre dentro del reproductor, se puede cancelar con Atrás y "Seguir viendo" abre la ficha con "Reanudar".
- Se quitó el aviso "Perfil: …".

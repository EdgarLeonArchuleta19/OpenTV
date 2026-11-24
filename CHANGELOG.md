# Cambios

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

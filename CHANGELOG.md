# Cambios

## Sin publicar

### Contenido
- **Kids:** solo títulos para todo público. Películas con clasificación mexicana AA/A (y G/PG de EE. UU. con género familiar como respaldo), series del género infantil sin animación para adultos y sin títulos sin traducir. Filas: "Películas para todos", "Series infantiles", "Animadas para niños" y "Las favoritas de los niños".
- **Anime:** "Tendencias de la temporada" con lo más seguido de la temporada actual (Kitsu). Los banners de Kids y Anime rotan cada día.

### Fuentes, plugins y ajustes (PC, Android y TV)
- Selector de fuentes más simple: fila con calidad, idioma en español claro ("Latino", "Subtitulado"…), "Directo" o "Torrent" y tamaño. La mejor opción va arriba como "Recomendada". Los filtros (Calidad, Idioma, Tipo) son listas desplegables.
- Ya no se listan torrents con menos de 5 semillas, ni CAM/TS/TC/screener, ni torrents repetidos.
- Plugins igual en PC y TV: "Instalados" (Mis plugins, dividido en Películas y series / TV en vivo) y "Comunidad". Los plugins de sistema no se muestran.
- Android: el panel "Audio y subtítulos" del reproductor es una sola pantalla con columnas (Audio, Subtítulos, Opciones) y mejor navegación con el control. Ajustes sin textos explicativos y Ayuda sin la sección de atajos.

### Apariencia (PC, Android y TV)
- Tema Oscuro (por defecto) o Claro en Ajustes → Apariencia. En claro, el acento "Blanco" pasa a negro. El reproductor y el video de TV en vivo siempre quedan oscuros.
- "Texto aumentado" escala toda la interfaz, Ajustes incluidos (zoom de la ventana en PC, escala de letra global en Android), sin reiniciar.

### Reproductor: final de episodio e intros (PC, Android y TV)
- Al llegar a los créditos aparece un botón "Siguiente episodio", igual al de "Omitir intro" (en PC se rellena durante la cuenta regresiva si está activo el siguiente automático). Al terminar el video: "Siguiente episodio", "Salir" o "Volver a ver"; en el último capítulo, "Has llegado al final". Pasa también a la siguiente temporada.
- "Omitir intro" / "Omitir resumen" con tiempos reales: AniSkip (anime), IntroDB y TheIntroDB (series), y en PC los capítulos del archivo. Sin datos reales no aparece el botón. Nueva opción "Omitir intro automáticamente" (apagada por defecto).

### Catálogo con TMDB (PC, Android y TV)
- Inicio, Películas, Series, Kids y Anime salen de TMDB a través del núcleo: títulos, sinopsis y episodios en español, mejores carátulas y fondos. Cada fila usa Cinemeta o Kitsu solo si TMDB falla.
- Fichas desde TMDB: reparto, director, duración, temporadas y recomendadas. Los episodios se cargan por temporada (con foto) y la siguiente se precarga.
- Anime desde TMDB: "Tendencias de la temporada", "En emisión", "Más populares", "Mejor valorados" y "Películas de anime". Lo guardado con ids de Kitsu sigue abriendo.
- Las filas y las recomendadas solo muestran títulos ya estrenados (fecha de estreno o primera emisión hasta hoy).
- Cinemeta, Anime Kitsu y OpenSubtitles ya no aparecen en Plugins: son parte del sistema.
- Subtítulos: incrustados, OpenSubtitles, SubDL (cuando hay clave en `config/subdl.json`) y SubtitleCat, con el español latino primero.

### TV en vivo (nuevo diseño, PC, Android y TV)
- TV a la izquierda, lista de canales a la derecha (desplegables de grupo y de lista, buscador, canal actual marcado "VIENDO") y la programación del canal abajo en tarjetas: Ahora (con progreso), Después y las dos siguientes.

### Buscador y reproductor
- El buscador usa TMDB a través del núcleo: títulos en español con carátula real y solo resultados con público e ID de IMDb, así que todos abren y encuentran fuentes. Cinemeta queda como respaldo (sin los resultados sin carátula). El anime sigue saliendo de Kitsu, solo si el título coincide.
- Orden de resultados: primero los que coinciden mejor con lo escrito (título igual, empieza igual, lo contiene) y, dentro de cada grupo, los más nuevos primero.
- Android/TV: se corrigió el cierre de la app al abrir títulos cuyo `director` viene vacío en Cinemeta (p. ej. Rick y Morty).
- El reproductor ya no dice a qué plugin o servidor se conecta ni la calidad mientras carga: solo "Buscando la mejor fuente…" / "Cargando…".

### Modo ligero (PC, Android y TV)
- Pensado para equipos modestos e internet lento: pósters a ~60 % del tamaño, fichas con el póster en lugar de la imagen de fondo, banner de Inicio sin imagen, episodios en la misma fila de tarjetas horizontales con un diseño sin imagen (etiqueta "Episodio N", título y sinopsis), sin animaciones ni desenfoques, sin precarga de menús ni de imágenes y calidad objetivo HD.

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
- Siguiente automático: la cuenta regresiva solo corre con tiempos reales de créditos; sin ellos el botón aparece sin cuenta y el capítulo pasa al terminar, sin cortar el final.
- TV en vivo: los logos de letras conservan los números ("Canal 10" → C10) y son iguales en PC y TV. En la TV, el botón "Buscar" del teclado solo se rellena cuando tiene el foco.
- TV en vivo: cuando la guía de un canal no existe o solo trae relleno (p. ej. "Azteca UNO -1" con "TBD" en Pluto TV), se usa la guía pública epgshare01 del país, con coincidencia segura por nombre y ajuste de horario para señales "-1 hora"/"-2 horas".
- Si una fuente directa de un episodio dura muy distinto de lo que indica TMDB (más de 4 min y del 18 %), se toma como otra versión u otra serie y se pasa sola a otra fuente (p. ej. DeepFlix entregaba "La Oficina" mexicana en la T1 de The Office).
- Torrents en español/latino se aceptan desde 1 semilla (el latino es escaso); los demás siguen pidiendo 5.
- Plugins JS: una serie con el mismo título pero de otra época ya no se toma por la que abriste ("La oficina" de México en lugar de "The Office").
- Los logos con fondo transparente (p. ej. ADN) ya no salen como cuadros blancos: el redimensionador los guarda en PNG.
- Plugins JS: al abrir una película de una saga (p. ej. "Los juegos del hambre") ya no se mezclan fuentes de otra película de la misma saga ("En llamas"). Si el sitio tiene el título exacto, solo se usa ese; un título que contiene al otro solo cuenta con el mismo año.
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

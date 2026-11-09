<div align="center">

<img src="ui/images/logo.svg" width="112" alt="OpenTV">

# OpenTV

**TV en vivo, películas y series en una app de escritorio para Windows.**
Interfaz moderna estilo streaming, rápida con ratón y teclado.

[![Descargar](https://img.shields.io/github/v/release/EdgarLeonArchuleta19/OpenTV?label=Descargar&style=for-the-badge&color=ffffff&labelColor=0e0e11)](https://github.com/EdgarLeonArchuleta19/OpenTV/releases/latest)
![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011-0e0e11?style=for-the-badge&logo=windows&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-44-0e0e11?style=for-the-badge&logo=electron&logoColor=white)
![Licencia](https://img.shields.io/badge/Licencia-MIT-0e0e11?style=for-the-badge)

<img src="docs/screenshots/inicio.jpg" alt="Inicio de OpenTV" width="100%">

</div>

---

## ✨ Qué tiene

| | |
|---|---|
| 🎬 **Inicio estilo streaming** | Portada a todo el ancho que rota entre títulos, **Seguir viendo** con progreso, **Top 10** con números grandes y filas por temas. Al dejar el ratón sobre un póster aparece una tarjeta con reproducir, Mi lista y detalles. |
| 📺 **TV en vivo** | Más de 1000 canales por país y tema, vista previa sin salir del inicio, **Guía de canales** (tecla `G`) con buscador, **Favoritos** y **Recientes**. |
| 🔎 **Buscador** | Sugerencias del catálogo mientras escribes y búsquedas recientes. |
| ▶️ **Reproductor** | Controles tipo Netflix, volumen (controla el de Windows), velocidad 0,5×–2×, calidad, audio y subtítulos, siguiente episodio automático, ventana flotante y pantalla completa. Si un vídeo falla, cambia solo a un modo compatible. |
| 🗂️ **Episodios** | Panel lateral con temporadas y episodios mientras ves la serie. |
| 🔒 **Privacidad** | Sin cuentas ni registro: tu lista, historial y preferencias se guardan solo en tu equipo. Contenido para adultos oculto y protegido con PIN (desactivado por defecto). |
| 🔄 **Actualizaciones automáticas** | La versión instalada se actualiza sola desde las releases de este repositorio. |
| ⚡ **Rápida** | 60 fps al navegar, carga diferida de pósteres y listas, y un registro de errores local para depurar. |

## 📸 Capturas

<table>
  <tr>
    <td><img src="docs/screenshots/top10.jpg" alt="Seguir viendo y Top 10"></td>
    <td><img src="docs/screenshots/peliculas.jpg" alt="Películas"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/guia.jpg" alt="Guía de canales"></td>
    <td><img src="docs/screenshots/buscador.jpg" alt="Buscador con sugerencias"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/reproductor.jpg" alt="Reproductor"></td>
    <td><img src="docs/screenshots/episodios.jpg" alt="Panel de episodios"></td>
  </tr>
  <tr>
    <td colspan="2"><img src="docs/screenshots/ficha.jpg" alt="Ficha de una serie"></td>
  </tr>
</table>

## ⬇️ Descargar e instalar

1. Entra en **[Releases](https://github.com/EdgarLeonArchuleta19/OpenTV/releases/latest)** y descarga **`OpenTV-Setup-x.y.z.zip`**.
2. Descomprime el `.zip` y abre **`OpenTV-Setup-x.y.z.exe`**.
3. Si Windows muestra *"Windows protegió su PC"*, pulsa **Más información → Ejecutar de todas formas** (la app no está firmada con un certificado de pago).

¿Sin instalar? Descarga **`OpenTV-Portable-x.y.z.zip`**: es un solo `.exe` que se abre directamente y guarda tus datos en una carpeta a su lado.

> La versión instalada busca actualizaciones al abrirse y cada 6 horas, y las instala al cerrar la app. La portable avisa cuando hay una nueva.

## ⌨️ Atajos

| Acción | Atajo |
|---|---|
| Reproducir / pausar | `Espacio` o clic en el vídeo |
| Retroceder / adelantar 10 s | `←` / `→` (o mantener pulsado un lado del vídeo) |
| Volumen | Rueda del ratón sobre el vídeo · `M` silencia |
| Pantalla completa | `F`, `F11` o doble clic (salir con `Esc`) |
| Ventana flotante | `Ctrl + P` |
| Guía de canales (TV) | `G` |
| Buscar / Inicio / Historial / Ajustes | `Ctrl + F` / `Ctrl + H` / `Ctrl + J` / `Ctrl + ,` |
| Volver | `Esc`, `Backspace` o `Alt + ←` |
| Ayuda y lista completa de atajos | `F1` |

## 🛠️ Desarrollo

Requisitos: **Node.js 22+** y Windows 10/11 x64.

```bash
npm install          # dependencias
npm run dev          # abrir la app en modo desarrollo
npm run build        # regenerar ui/js/app.js y los estilos (Tailwind)
npm test             # pruebas: bundle ES5 para TV, catálogo, búsqueda, guía, M3U…
npm run test:e2e     # abre la interfaz real en Electron y recorre las pantallas
npm run snapshot     # actualizar la copia del catálogo incluida (necesita internet)
npm run dist         # instalador + portable en dist/
```

### Estructura

```
desktop/   Proceso principal de Electron: ventana y barra de título, atajos,
           actualizaciones, volumen de Windows, registro de errores, puente seguro
service/   Servicio local: catálogo, proxy HLS, relay FFmpeg, DNS seguro (DoH), diagnóstico
ui/        Interfaz (compartida con la versión para TV LG webOS)
  js/src/  Código en módulos ES5 → se une en ui/js/app.js (ver ui/js/src/README.md)
  desktop/ Estilos de escritorio (Tailwind en desktop/tw/input.css), HLS.js y adaptadores
tests/     Pruebas unitarias (node --test) y de extremo a extremo (Electron)
scripts/   Build del bundle, copia del catálogo, publicación de versiones
bin/       ffmpeg.exe (Windows x64)
```

### Publicar una versión

1. Sube `version` en `package.json` (por ejemplo `1.0.1`).
2. Compila y prueba:
   ```bash
   npm run build && npm test
   npx electron-builder --win nsis portable
   ```
3. Crea la release `v1.0.1` y sube **el `.zip` del instalador** (para descargar) junto con
   `OpenTV-Setup-1.0.1.exe`, su `.blockmap` y `latest.yml`, que usa el actualizador automático.

También hay un workflow de GitHub Actions listo en [`scripts/ci/github-release.yml`](scripts/ci/github-release.yml): cópialo a `.github/workflows/` y cada etiqueta `v*` compilará y publicará sola.

## ⚖️ Aviso

OpenTV es un reproductor. **No aloja, sube ni distribuye contenido**: muestra catálogos y emisiones de servicios de terceros, y las listas M3U que añada cada usuario. Los títulos, imágenes y marcas pertenecen a sus respectivos dueños. Úsala de acuerdo con las leyes de tu país.

Componentes de código abierto: [Electron](https://www.electronjs.org/) (MIT), [HLS.js](https://github.com/video-dev/hls.js) (Apache 2.0), [FFmpeg](https://ffmpeg.org/) (GPL v3) y [Tailwind CSS](https://tailwindcss.com/) (MIT). Las licencias completas están en [`licenses/`](licenses).

## 📄 Licencia

[MIT](LICENSE) · Desarrollado por **TECHPOINT Software™**

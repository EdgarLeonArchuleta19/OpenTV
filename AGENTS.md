# AGENTS.md

Guía para agentes de código (Claude Code, Codex, Copilot…) que trabajan en
este repositorio. Para personas, empieza por el [README](README.md).

## Qué es

OpenTV: TV en vivo, películas y series con una sola interfaz (`ui/`) y un
solo servicio (`service/`) para todas las plataformas:

| Plataforma | Envoltorio | Carpeta |
|---|---|---|
| Windows | Electron 44 | `platforms/electron/` |
| Android, Android TV, Fire TV | Capacitor 6 + servicio nativo en Java + ExoPlayer | `platforms/android/` |
| TV LG | webOS | `platforms/webos/` |

Plan y estado por plataforma: [docs/PLATAFORMAS.md](docs/PLATAFORMAS.md).

## Prioridad: fluidez en la tele

El aparato de referencia es un **Fire TV Stick de 1 GB**. Cualquier cambio en
la interfaz compartida debe mantener fluidos los menús y el reproductor ahí.
Lo pesado o exclusivo de PC va detrás de `platformHas(...)` y no se ejecuta
en TV. Si dudas, mide en el aparato (CPU con `top`, `dumpsys gfxinfo`).

## Comandos

```bash
npm install
npm run dev            # app de PC (regenera el bundle y los estilos antes)
npm run build          # ui/js/app.js + ui/desktop/tailwind.css
npm test               # pruebas unitarias (node --test tests/*.test.cjs)
npm run test:e2e       # abre la interfaz real en Electron y recorre las pantallas
npm run check:js       # falla si ui/js/app.js no está al día
npm run build:webos    # paquete de la TV LG (dist/webos)
npm run build:android  # interfaz para Android + cap sync
npm run build:apk      # APK de release con R8 → dist/OpenTV-<versión>.apk
```

Android necesita `JAVA_HOME` (JDK 17) y el Android SDK. Antes de dar un
cambio por terminado: `npm run build`, `npm test`, `npm run test:e2e` y, si
toca la tele, una prueba en el aparato.

## Reglas del código de la interfaz

- **`ui/js/app.js` se genera.** No lo edites. El código está en
  `ui/js/src/**` y se une en el orden de `ui/js/src/modules.json` dentro de un
  solo ámbito de función (sin `import`/`export`). Un módulo nuevo se añade a
  `modules.json` o el build falla. Detalles: [ui/js/src/README.md](ui/js/src/README.md).
- **Solo ES5** en `ui/js/**`: `var`, `function`; nada de `let`/`const`,
  flechas, clases, plantillas con comillas invertidas ni `async`. Las teles
  viejas lo necesitan, y `tests/bundle.test.cjs` lo comprueba.
- **Las funciones no son globales.** Para depurar o probar desde fuera usa
  `window.__xuper` (definido en `ui/js/src/main.js`).
- **Plataformas:** no compares nombres de plataforma, pregunta capacidades:
  `platformHas('window' | 'pip' | 'mouse' | 'native-player' | 'addons' | 'torrents' …)`
  y `platformIsTv()`. La lista está en `ui/js/platform.js`. Para simular otra
  plataforma en PC: `?platform=webos` o `?platform=android-tv`.
- **Estilos:** `ui/desktop/tw/input.css` solo importa las capas de
  `ui/desktop/tw/capas/` en orden. Lo exclusivo de tele va en `10-teles.css`
  (bajo `.desktop.is-tv`, lienzo de 1920×1080). Antes de crear una clase nueva,
  busca que no exista ya en `ui/css/style.css` (la base heredada usa prefijos
  cortos como `.sp-`).
- **Textos visibles en español.** Los comentarios del código, en inglés.

## Servicio (`service/`)

- Corre dentro de Electron (`platforms/electron/service.cjs`) y en la TV LG.
  En Android lo sustituye el port en Java
  (`platforms/android/android/app/src/main/java/com/techpoint/opentv/service`).
  Si añades un método al servicio de Node que también necesita Android, hay que
  portarlo a Java.
- `service/torrents.js` (torrent-stream) **solo se carga en Electron**.
- Todo escucha en **127.0.0.1**. No abras puertos a la red local.

## Modos de películas y series (solo PC)

Dos modos: **Modo automático** (catálogo integrado de `service/magis.js`) y
**Modo Addons** (compatible con Stremio; solo los addons que agrega el usuario; fuentes
directas o torrents). Reglas:

- Solo vienen instalados **Cinemeta** y **OpenSubtitles** (como en Stremio;
  se instalan una vez y el usuario puede quitarlos). No añadas addons de
  fuentes (Torrentio y similares) preinstalados: los agrega cada usuario.
- En textos visibles el modo se llama **Addons**. "Stremio" es una marca de
  otra empresa: solo se menciona como compatibilidad ("compatible con
  Stremio"), nunca como nombre de un modo, botón o etiqueta.
- Teles y Android usan siempre el modo automático (capacidades `addons` y
  `torrents` solo en Electron).
- TV en vivo es independiente: tiene sus propias listas M3U.

Cómo funciona: [docs/PLATAFORMAS.md](docs/PLATAFORMAS.md#modo-addons-cómo-funciona).

## No cambiar

- El protocolo `xuper://` y las claves de `localStorage` existentes
  (`xuper_*`, `opentv_*`): borrarían los datos guardados de los usuarios.
- Los ids `stremio:<id>` de los títulos de addons.

## Secretos

- `config/tmdb.json` (clave de TMDB) está ignorado por git: no lo subas, no lo
  imprimas y no copies la clave a otros archivos.
- La firma de Android: `platforms/android/android/keystore.properties` y los
  `.jks` están ignorados; la clave vive fuera del repositorio.
- Antes de un commit:
  `git diff --cached | grep -c "<los primeros caracteres de la clave>"` debe dar 0.

## Git

- **No hagas commits ni push sin que el dueño lo pida.** Deja los cambios sin
  confirmar para que los revise.
- Commits pequeños y con mensaje en inglés que diga qué y por qué.

## Windows

- El shell puede ser Git Bash o PowerShell 5.1. Para editar archivos usa las
  herramientas de edición, no `Set-Content` de PowerShell (cambia la
  codificación) ni `node -e` con código entre comillas.
- Si una consola tiene `ELECTRON_RUN_AS_NODE` definido, quítalo antes de
  `npm run dev` o `npm run test:e2e`; si no, Electron arranca como Node.
- FFmpeg para Windows está en `bin/ffmpeg.exe` (lo usa el modo compatible).

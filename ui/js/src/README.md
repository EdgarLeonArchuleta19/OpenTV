# Código de la interfaz (`ui/js/src`)

`ui/js/app.js` **se genera** a partir de estos módulos. No lo edites a mano:
cambia el módulo correspondiente y ejecuta:

```bash
npm run build:js     # genera ui/js/app.js
npm run check:js     # comprueba que app.js está al día (útil antes de un commit)
```

`npm start`, `npm run dev` y `npm run dist` lo regeneran solos.

## Cómo funciona

Los módulos se unen, en el orden de [`modules.json`](modules.json), dentro de
**un único ámbito de función**, exactamente como funcionaba la app antes de
separarla. Por eso comparten variables y funciones sin `import`/`export`.

Se hizo así a propósito:

- **TV LG webOS:** su navegador (Chromium 53) solo admite ES5. El resultado
  sigue siendo un único archivo ES5, sin empaquetador ni transpilador.
- **Sin cambios de comportamiento:** la división se verificó comparando el
  árbol sintáctico del `app.js` original con el generado (idénticos).

### Reglas

1. **El orden importa** para las sentencias que se ejecutan al cargar
   (`var x = …` con valor, llamadas como `addVod(...)` o `loadLocalProfile()`).
   Las declaraciones `function` se pueden mover entre módulos libremente.
2. **Un módulo nuevo** debe añadirse a `modules.json`; el build falla si hay
   archivos `.js` sin listar.
3. **Solo ES5:** `var`, `function`, nada de `let`/`const`, flechas, clases,
   plantillas con comillas invertidas ni `async`.
4. Lo exclusivo del escritorio va en `desktop/` o detrás de
   `window.XUPER_DESKTOP`; la versión de TV usa el mismo código.

## Mapa

| Carpeta | Contenido |
| --- | --- |
| `core/` | utilidades DOM, configuración, estado global, foco y navegación con teclado/mando |
| `data/` | catálogo de demostración integrado |
| `services/` | API VOD y servicio del portal (Luna en TV / IPC en escritorio) |
| `screens/` | bienvenida, inicio, ficha, búsqueda, ajustes, historial, diagnóstico |
| `home/` | pósteres, TV del inicio y páginas de catálogo |
| `live/` | canales en vivo, listas M3U y diálogo de addons |
| `player/` | reproductor: barras, audio/subtítulos, episodios, reproducción, modo compatible |
| `desktop/` | solo escritorio: escalado de ventana, PiP, botones flotantes, gestos del ratón |
| `main.js` | arranque (`boot`), API de depuración `window.__xuper` y enlaces profundos |

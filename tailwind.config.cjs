/** Tailwind se compila a ui/desktop/tailwind.css (npm run build:css).
 *  La app no carga Tailwind en tiempo de ejecución ni necesita internet.
 *  Preflight queda desactivado: la interfaz heredada de TV define su propio
 *  reset y medidas en un lienzo de 1920×1080. */
module.exports = {
  // Solo se usa @apply sobre clases existentes: sin escaneo, para que no se
  // generen utilidades sueltas (.hidden, .grid, .block…) que choquen con las
  // clases propias de la app.
  content: [{ raw: '' }],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      fontFamily: {
        ui: ['"Segoe UI Variable Text"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        display: ['"Segoe UI Variable Display"', '"Segoe UI"', 'system-ui', 'sans-serif']
      },
      colors: {
        ink: { 950: '#000000', 900: '#0b0b0b', 850: '#111111', 800: '#161616', 700: '#1f1f1f', 600: '#2a2a2a' }
      },
      transitionTimingFunction: { fluent: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      keyframes: {
        'fade-up': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } }
      },
      animation: { 'fade-up': 'fade-up .32s cubic-bezier(0.16, 1, 0.3, 1) both' }
    }
  }
};

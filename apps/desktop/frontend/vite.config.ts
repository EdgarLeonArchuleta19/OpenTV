import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** Injects strict production CSP into built index.html without breaking Vite HMR in dev. */
function strictCspPlugin(): Plugin {
  const csp =
    '<meta http-equiv="Content-Security-Policy" content="default-src \'self\' https: http://127.0.0.1:* data: blob:; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' https: http: data: blob:; media-src \'self\' https: http: blob:; connect-src \'self\' https: http: blob:; worker-src \'self\' blob:; object-src \'none\'; base-uri \'none\'; form-action \'none\'; frame-src \'self\'" />';
  return {
    name: 'opentv-strict-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('</head>', `    ${csp}\n  </head>`);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), strictCspPlugin()],
  base: './',
  build: {
    outDir: '../dist-ui',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 620,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'zustand'],
          'vendor-icons': ['lucide-react'],
          'vendor-hls': ['hls.js'],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});

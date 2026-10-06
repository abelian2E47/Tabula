import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// base './' keeps every emitted asset reference relative, which is what an
// extension page loaded from moz-extension://<uuid>/ requires.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'firefox128',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        board: resolve(__dirname, 'index.html'),
        // The standalone views a widget opens. Relative asset paths in the
        // emitted HTML resolve against the extension root exactly as the board
        // page's do, because all three sit at the root of the package.
        bookmarks: resolve(__dirname, 'bookmarks.html'),
        history: resolve(__dirname, 'history.html'),
      },
    },
  },
  server: {
    port: 5180,
    strictPort: true,
    // Browser probe profiles are created beside the source tree and contain
    // locked temporary files on Windows; watching them can crash Vite with
    // EBUSY while the page is being inspected.
    watch: {
      ignored: [
        // Browser probes and TypeScript's atomic temp files can stay locked
        // briefly on Windows; watching them makes Vite terminate with EBUSY.
        '**/.probe-profile/**',
        '**/.blurprofile*/**',
        '**/.types.ts.*.tmpdir/**',
        '**/*.tmp',
      ],
    },
  },
})

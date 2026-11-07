import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { WEBVIEW_SCRIPT, WEBVIEW_STYLESHEET } from './extension/src/webview-assets'

/**
 * Builds the viewer for the VS Code webview. The extension host generates the HTML document with
 * a nonce-based CSP, so this build emits a stable script and stylesheet name instead of a page.
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: 'extension/dist/webview',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2024',
    rolldownOptions: {
      input: 'src/webview.tsx',
      output: {
        entryFileNames: WEBVIEW_SCRIPT,
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: ({ names }) =>
          names.includes(WEBVIEW_STYLESHEET) ? WEBVIEW_STYLESHEET : 'assets/[name]-[hash][extname]',
      },
    },
  },
})

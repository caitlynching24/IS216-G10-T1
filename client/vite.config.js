import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  // MapLibre loads its worker relative to its own file; pre-bundling moves
  // the file into .vite/deps and the worker can no longer be found
  optimizeDeps: {
    exclude: ['maplibre-gl']
  },
  server: {
    // Allow devices on the same local network to open the development site.
    host: '0.0.0.0',
    port: 5173,
    // allows client server to accept requests from cloudflare addresses
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      // Forwards /api requests to the Express server during development
      '/api': {
        // (the e2e tests run their own server and set API_PROXY_TARGET to it, see e2e/e2eEnv.js)
        target: process.env.API_PROXY_TARGET || 'http://localhost:5000',
        changeOrigin: true
      }
    }
  
  }
})

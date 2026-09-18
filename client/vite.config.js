import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      // Forwards /api requests to the Express server during development
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true
      }
    }
  }
})

import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    port: 5173,
    // The Go API runs on :8080; proxying keeps cookies same-origin in development.
    proxy: { '/api': { target: 'http://localhost:8080', changeOrigin: false } },
  },
})

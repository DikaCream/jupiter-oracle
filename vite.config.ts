import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite dev-server proxy → eliminates CORS entirely for Jupiter API calls.
// All fetch('/jup/...') calls are transparently forwarded to api.jup.ag.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/jup': {
        target: 'https://api.jup.ag',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/jup/, ''),
        secure: true,
      },
    },
  },
})

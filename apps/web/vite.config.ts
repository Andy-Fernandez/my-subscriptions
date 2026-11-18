import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'

const workerOrigin = 'http://127.0.0.1:8787'

export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    proxy: {
      '/api': {
        target: workerOrigin,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (proxyRequest, request) => {
            if (request.headers.origin === 'http://' + request.headers.host) {
              proxyRequest.setHeader('Origin', workerOrigin)
            }
          })
        },
      },
    },
  },
})

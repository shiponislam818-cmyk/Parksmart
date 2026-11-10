import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies the API and Socket.IO to the Express server on port 5000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': 'http://localhost:5000',
      '/socket.io': { target: 'http://localhost:5000', ws: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 900,
  },
});

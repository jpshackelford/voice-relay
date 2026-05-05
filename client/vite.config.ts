import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const wsPort = process.env.VITE_WS_PORT || '3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // Listen on all interfaces
    allowedHosts: ['.local'],  // Allow all *.local mDNS hostnames
    proxy: {
      '/ws': {
        target: `ws://localhost:${wsPort}`,
        ws: true,
      },
      '/api': {
        target: `http://localhost:${wsPort}`,
      },
      '/auth': {
        target: `http://localhost:${wsPort}`,
      },
    },
  },
});

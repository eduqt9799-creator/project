import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The dev server proxies /api to the Express backend and binds every network
 * interface, so the same build works from:
 *   http://localhost:5173
 *   http://<your-lan-ip>:5173   (phone/tablet on the same Wi-Fi)
 *
 * Because the browser only ever calls its own origin, CORS never enters the
 * picture and no host-specific API URL has to be configured.
 */
const API_TARGET = process.env.VITE_PROXY_TARGET || 'http://localhost:5000';

const proxy = {
  '/api': {
    target: API_TARGET,
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy,
  },
  preview: {
    host: true,
    port: 4173,
    proxy,
  },
});
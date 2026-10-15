// vite.config.js — in development, /api and /covers are proxied to a MyLib
// server (default http://localhost:3099, override with MYLIB_API).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = process.env.MYLIB_API || 'http://localhost:3099';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': target,
      '/covers': target,
      '/download': target,
    },
  },
});

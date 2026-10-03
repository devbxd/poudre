import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'admin',
  base: '/admin/',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist/admin', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787', '/uploads': 'http://localhost:8787' },
  },
});

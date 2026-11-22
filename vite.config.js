import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const frontend = fileURLToPath(new URL('./frontend', import.meta.url));
export default defineConfig({
  root: frontend,
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./frontend/src', import.meta.url)) } },
  build: { outDir: 'dist', emptyOutDir: true }
});

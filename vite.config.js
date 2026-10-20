import { defineConfig } from 'vite';

// Served from https://ognjenhtw.github.io/local-guide/
export default defineConfig({
  base: '/local-guide/',
  server: { port: 5173, strictPort: true },
});

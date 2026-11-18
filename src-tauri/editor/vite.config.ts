import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist', emptyOutDir: true, assetsInlineLimit: 0 },
  test: { environment: 'jsdom', clearMocks: true, restoreMocks: true },
});

import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5174 },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 700, // three-vendor legitimately large
    rollupOptions: {
      output: {
        manualChunks(id) {
          // All three.js core + addons in one vendor chunk
          // Rapier stays auto-split (lazy import on Enter Arena)
          if (id.includes('/three/') || id.includes('three/addons')) return 'three-vendor';
        }
      }
    }
  },
  // Silence Rolldown codeSplitting suggestion — we're handling it manually
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'] // don't pre-bundle Rapier — it's lazy
  },
  // Vitest config (v0.2.120). Node environment — the unit suite covers pure
  // logic seams (state machine, event bus, headshot classifier) only, so no
  // jsdom/Three/Rapier/browser is needed. `npm test` runs `vitest run`.
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Ratcheted to just under what the suite actually covers today, measured
      // on a clean `npm ci` tree: statements 75.85, branches 65.11,
      // functions 72.98, lines 77.46. The old 60/50/60/60 had never been
      // enforced by CI (which ran `npm run test`, not `test:coverage`), so it
      // was decorative — and set well below reality, which meant coverage
      // could have fallen by a sixth without anything noticing.
      //
      // The margin is deliberate but small: raise these as coverage rises,
      // and never lower them to make a build pass.
      thresholds: {
        statements: 75,
        branches: 64,
        functions: 72,
        lines: 77,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});

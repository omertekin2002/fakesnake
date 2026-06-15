import { defineConfig } from 'vitest/config';

// Standalone test config so the app's Vite plugins (React, Tailwind) aren't
// loaded for the pure-logic unit tests.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.test.ts', 'tests/e2e/**/*.test.ts'],
    testTimeout: 10000,
  },
});

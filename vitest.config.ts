import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'relayer/test/**/*.test.ts', 'watcher/test/**/*.test.ts', 'api/test/**/*.test.ts'],
    environment: 'node',
  },
});

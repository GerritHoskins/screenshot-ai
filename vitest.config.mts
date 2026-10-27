import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 10000,
    hookTimeout: 30000,
    // Native desktop suites share the OS shortcut namespace.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts', 'apps/desktop/src/**/*.ts', 'packages/core/src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/index.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': resolve(root, 'src'),
      '@shared-types': resolve(root, 'src/types'),
      '@providers': resolve(root, 'src/providers'),
      '@security': resolve(root, 'src/security'),
      '@logging': resolve(root, 'src/logging'),
      '@errors': resolve(root, 'src/errors'),
      '@context': resolve(root, 'src/context'),
      '@settings': resolve(root, 'src/settings'),
      '@prompts': resolve(root, 'src/prompts'),
      '@utils': resolve(root, 'src/utils'),
    },
  },
});

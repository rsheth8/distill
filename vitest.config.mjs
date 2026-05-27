import { defineConfig, defineProject } from 'vitest/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = dirname(fileURLToPath(import.meta.url));

/** Two projects: Node (unit + backend HTTP) and happy-dom (front + chrome mock). */
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: join(root, 'coverage'),
      include: ['extension/utils/**/*.js', 'backend/**/*.js'],
      exclude: [
        'backend/node_modules/**',
        '**/node_modules/**',
        'backend/data/**'
      ],
      thresholds: {
        lines: 12,
        functions: 12,
        branches: 6,
        statements: 12
      }
    },
    projects: [
      defineProject({
        name: 'node',
        root,
        test: {
          environment: 'node',
          include: ['tests/unit/**/*.test.mjs', 'tests/backend/**/*.test.mjs'],
          testTimeout: 20_000,
          hookTimeout: 20_000,
          pool: 'forks',
          globals: false,
          env: { TZ: 'UTC' }
        }
      }),
      defineProject({
        name: 'front',
        root,
        test: {
          environment: 'happy-dom',
          include: ['tests/front/**/*.test.mjs'],
          setupFiles: [join(root, 'tests/front/setup.mjs')],
          testTimeout: 20_000,
          pool: 'forks',
          globals: false,
          env: { TZ: 'UTC' }
        }
      })
    ]
  }
});

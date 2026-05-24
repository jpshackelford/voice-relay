import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/storage/**/*.ts', 
        'src/auth/**/*.ts', 
        'src/keepalive.ts',
        'src/registry.ts',
        'src/devices/**/*.ts',
        'src/sessions/**/*.ts',
        'src/workspaces/**/*.ts',
      ],
      exclude: [
        'src/**/*.test.ts',
        'src/storage/types.ts',       // Pure types, no runtime code
        'src/auth/types.ts',          // Pure types, no runtime code
        'src/auth/index.ts',          // Re-exports only
        'src/auth/router.ts',         // Integration routes, tested via e2e
        'src/devices/types.ts',       // Pure types, no runtime code
        'src/devices/index.ts',       // Re-exports only
        'src/devices/router.ts',      // Integration routes, tested via e2e
        'src/sessions/types.ts',      // Pure types, no runtime code
        'src/sessions/index.ts',      // Re-exports only
        'src/sessions/router.ts',     // Integration routes, tested via e2e
        'src/workspaces/types.ts',    // Pure types, no runtime code
        'src/workspaces/index.ts',    // Re-exports only
        'src/workspaces/router.ts',   // Integration routes, tested via e2e
      ],
      reporter: ['text', 'html'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});

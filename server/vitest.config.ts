import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/storage/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/storage/redis.ts',      // Not part of Phase 1
        'src/storage/firestore.ts',  // Not part of Phase 1
        'src/storage/index.ts',      // Factory function, tested indirectly
        'src/storage/types.ts',      // Pure types, no runtime code
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

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  resolve: {
    tsconfigPaths: true, // 替代 vite-tsconfig-paths 插件
  },

  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
  },
});

// vitest.config.e2e.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'], // 从 ** 收紧到 test/
    setupFiles: ['./test/setup-e2e.ts'],
    mockReset: true, // 替换 clearMocks
    fileParallelism: false, // e2e 串行：共享一个测试库，不能并行清数据
    testTimeout: 30_000, // 起应用 + 连库比单测慢一个数量级
  },
});

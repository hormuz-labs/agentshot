import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      electron: resolve('test/stubs/electron.ts'), // main-process modules run under plain Node in tests
      '@': resolve('src/renderer/src'),
    },
  },
  test: { include: ['test/**/*.test.ts'], testTimeout: 30_000, hookTimeout: 30_000 },
})

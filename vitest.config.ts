import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      electron: resolve('test/stubs/electron.ts'), // main-process modules run under plain Node in tests
      '@': resolve('src/renderer/src'),
    },
  },
  // tsconfig.json's options that matter to esbuild, given here so a test can import the phone app's code (mobile/)
  // without its tsconfig, which extends Expo's and so needs mobile/node_modules
  esbuild: { tsconfigRaw: JSON.stringify({ compilerOptions: { target: 'ES2023', jsx: 'react-jsx' } }) },
  test: { include: ['test/**/*.test.ts'], testTimeout: 30_000 },
})

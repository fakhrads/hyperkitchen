import { defineConfig } from 'vitest/config'

// Tests against real ROMs on local disks. Never part of `pnpm test`.
export default defineConfig({
  test: { include: ['tests/local/**/*.test.ts'], environment: 'node', testTimeout: 3_600_000 }
})

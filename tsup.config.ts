import { defineConfig } from 'tsup'

export default defineConfig([
  {
    // CLI entry — needs shebang so it can be executed directly
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    target: 'node18',
    clean: true,
    dts: true,
    sourcemap: true,
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    // Library entries — no shebang
    entry: {
      server: 'src/server.ts',
      'plugin/index': 'src/plugin/index.ts',
      'support/index': 'support/index.ts',
    },
    format: ['esm'],
    target: 'node18',
    clean: false,
    dts: true,
    sourcemap: true,
  },
])

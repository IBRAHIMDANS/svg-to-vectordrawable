import { defineConfig } from 'tsup';

export default defineConfig([
    // Node build: library + CLI, ESM + CJS + types.
    {
        entry: ['src/index.ts', 'src/cli.ts'],
        format: ['esm', 'cjs'],
        dts: true,
        clean: true,
        sourcemap: true,
        target: 'node18',
    },
    // Browser build: same API, but svgo resolves to its browser bundle (no Node built-ins).
    {
        entry: { browser: 'src/browser.ts' },
        format: ['esm', 'iife'],
        globalName: 'svgvd',
        dts: false,
        sourcemap: true,
        platform: 'browser',
        esbuildOptions(o) {
            o.alias = { ...(o.alias ?? {}), svgo: 'svgo/browser' };
        },
    },
]);

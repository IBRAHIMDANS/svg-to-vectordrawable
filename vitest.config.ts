import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        coverage: {
            provider: 'v8',
            include: ['src/**'],
            reporter: ['text', 'lcov', 'json', 'json-summary'],
        },
    },
});

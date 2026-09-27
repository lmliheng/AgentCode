// vitest.config.ts
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        testTimeout: 35000,
        hookTimeout: 10000,
        exclude: [...configDefaults.exclude, '**/.qwen/**'],
    },
});

// vitest.config.ts
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        testTimeout: 35000,
        hookTimeout: 10000,
        exclude: [
            ...configDefaults.exclude,
            // src/test/ds.test.ts 是手动冒烟脚本（由 package.json 的 test:ds 经 tsx 调用），
            // 不含任何用例。被 vitest 收集时会以「No test suite found」让整次运行报红。
            '**/ds.test.ts',
            // .qwen/ 是工具临时目录，其中的一次性工作区可能含 src/ 副本；
            // 不排除会让整套测试被重复收集执行（集成测试会重复发起真实调用）。
            '**/.qwen/**',
        ],
    },
});

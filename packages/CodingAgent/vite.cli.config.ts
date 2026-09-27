// vite.cli.config.ts
//
// 全局命令行（acode）的构建配置。
//
// 与 vite.config.ts 分开：那个构建 Vue TUI（产物进 src/cli/dist），这个构建
// readline 版 CLI（产物进 dist/cli.js，由 package.json 的 bin 指向）。
//
// 为什么用 vite 而不是直接调 esbuild：src/cli.ts 的导入用的是 TS 的 NodeNext
// 写法（`./persistence/session-store.js` 实际指向 .ts 源文件）。本仓库里只有 vite
// 被证明能解析这种写法（vite.config.ts 用同一套风格构建成功过）。
// 另外 shebang 用 output.banner 声明，绕开了在 npm script 里处理引号与 # 的麻烦。


import { defineConfig } from 'vite';

export default defineConfig({
    build: {
        outDir: 'dist',
        // 面向 node：内置模块与 node_modules 依赖都不打包。后者因此必须留在
        // package.json 的 dependencies 里（当前只有 chalk），否则装包后解析不到。
        ssr: true,
        target: 'node20',
        minify: false,
        rollupOptions: {
            input: 'src/cli.ts',
            output: {
                entryFileNames: 'cli.js',
                format: 'es',
                // 入口脚本的可执行头。npm 在 Windows 上生成的 .cmd shim 用 node
                // 直接跑这个文件，shebang 对 Unix 下直接执行才是必要的。
                banner: '#!/usr/bin/env node',
            },
        },
    },
});

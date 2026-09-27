# @lmliheng/acode-core

AgentCode 的零依赖地基：跨包共享的类型契约、输出预算（`output-budget`）。
其余 acode 包（providers / tools / runtime / cli）都依赖它，它自己不依赖任何仓库内代码。

- 仓库内开发：`exports` 指向 `src/index.ts`，直接 `tsx` / `vitest` / `tsc` 消费。
- 发布：`pnpm build` 用 `tsc -p tsconfig.build.json` 产出 `dist/`（含 `.d.ts`），
  `publishConfig` 会把入口改写成 `dist`。

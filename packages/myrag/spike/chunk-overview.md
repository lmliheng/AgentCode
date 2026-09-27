# MyRAG 分块结果检查单 + 速览

参数：`maxChunkChars=3600`　`chunkOverlapChars=540`

这个文件两部分：**先看第 0 节的检查清单**，再带着清单看后面三节的数据。
要看某个 chunk 的完整文本，去同目录的 `chunk-samples.md`。

## 0. 检查清单

| # | 检查项 | 正确表现 | 异常信号 | 调哪个文件 |
|---|---|---|---|---|
| 1 | 语义完整 | 一个 chunk 自成一个可读懂的小节（标题+正文） | 中间断在句子或代码里 | `src/chunk/index.ts` 的 `DEFAULT_CHUNK_OPTIONS` |
| 2 | 标题路径 | `scope` 是「父 > 子」，与文档结构一致 | 原文有标题但 scope 为空，或层级错乱 | `src/parse/markdown.ts` 的标题栈 |
| 3 | 元信息进向量文本 | `embedText` 前 3 行是 `heading:` / `heading_level:` / `scope:` | 没有这些前缀（标题就不参与语义匹配） | `src/chunk/text.ts` |
| 4 | 代码块完整 | 代码 fence 配平 ✅、多行保留、语言标记在 | ❌ 不配平；代码被压成一行 | `src/chunk/window.ts` 的 fence 修补 |
| 5 | 表格原子性 | 表格单独成块、以 `\|` 开头、表头+分隔行+数据行齐全 | 表格与正文混排；表头被切走 | `src/chunk/table.ts` |
| 6 | outline 块 | 只有标题路径、无正文，用于让纯标题也能被检索命中 | 数量太多，把检索结果冲淡 | `src/chunk/index.ts` 的 outline 分支 |
| 7 | 短块 | 原文本身就短的完整小节 | 大量无意义的碎片 | 见第三节逐条清单 |
| 8 | 无标题文档 | 全部内容落进 1 个 section，再靠滑窗聚合 | 被切成逐段落碎片 | `src/parse/ast.ts` 的兜底 |

**需要人主观判断的只有 3 条**（机械项都已预检通过）：

1. **outline 块要不要留** —— 会让一个多窗 section 多出一条「只有标题路径」的检索结果（靠 `group` 归并）。好处：纯标题也能被语义检索命中；代价：结果多一条噪音。看第一节 `ast.md` / `emitter.md` 的那两行。
2. **`resume.pdf` 整篇变成 1 个 2032 字符的 chunk** 是否可接受。若你认为一页简历该按「教育背景 / 技能特长 / 项目经历」拆细，需要新增策略。
3. **切分粒度** —— 现在中位 393 字符，单位是「一个标题下的小节」。若想让相邻小节合并，需要新增「兄弟 section 合并」策略（当前没有，zg 也没有）。

## 一、样本文件逐个 chunk 一览

### ast.md

典型 md：标题 + 代码块 + 表格　—　sections 8　chunks 11

| # | kind | 字符 | scope（标题路径） | heading | 内容首行 |
|---|---|---|---|---|---|
| 1 | text | 374 | 抽象语法树 | Node 节点 | ### Node 节点 |
| 2 | text | 119 | 抽象语法树 | SourceFile | ### SourceFile |
| 3 | text | 1260 | 抽象语法树 | AST 技巧：访问子节点 | ## AST 技巧：访问子节点 |
| 4 | text | 521 | 抽象语法树 | AST 技巧：SyntaxKind 枚举 | ## AST 技巧：SyntaxKind 枚举 |
| 5 | text | 133 | 抽象语法树 | AST 杂项 | ## AST 杂项 |
| 6 | text | 179 | 抽象语法树::AST 杂项 | 杂项的所有权 | ### 杂项的所有权 |
| 7 | outline | 23 | 抽象语法树::AST 杂项 | 杂项 API | 抽象语法树 > AST 杂项 > 杂项 API |
| 8 | text | 50 | 抽象语法树::AST 杂项 | 杂项 API | ### 杂项 API |
| 9 | table | 232 | 抽象语法树::AST 杂项 | 杂项 API | \| 函数 \| 描述 \| |
| 10 | text | 223 | 抽象语法树::AST 杂项 | 杂项 API | 假设下面是某个源文件的一部分： |
| 11 | text | 390 | 抽象语法树::AST 杂项 | Token Start 和 Full S… | ### Token Start 和 Full Start 位置 |

### infer.md

曾被 officeparser 压平，检查代码块完整性　—　sections 4　chunks 4

| # | kind | 字符 | scope（标题路径） | heading | 内容首行 |
|---|---|---|---|---|---|
| 1 | text | 542 | infer | 介绍 | ## 介绍 |
| 2 | text | 1063 | infer | 内置类型 | ## 内置类型 |
| 3 | text | 2614 | infer | 一些用例 | ## 一些用例 |
| 4 | text | 1310 | infer | LeetCode 的一道 TypeScr… | ## LeetCode 的一道 TypeScript 面试题 |

### emitter.md

多窗归并（outline）机制　—　sections 6　chunks 9

| # | kind | 字符 | scope（标题路径） | heading | 内容首行 |
|---|---|---|---|---|---|
| 1 | text | 183 | — | 发射器 | # 发射器 |
| 2 | text | 339 | 发射器 | Promgram 对发射器的使用 | ### Promgram 对发射器的使用 |
| 3 | text | 449 | 发射器::发射器函数 | `emitFiles` | ### `emitFiles` |
| 4 | text | 3046 | 发射器::发射器函数 | `emitJavaScript` | ### `emitJavaScript` |
| 5 | outline | 36 | 发射器::发射器函数 | `emitJavaScriptWorke… | 发射器 > 发射器函数 > `emitJavaScriptWorker` |
| 6 | text | 3515 | 发射器::发射器函数 | `emitJavaScriptWorke… | ### `emitJavaScriptWorker` |
| 7 | text | 3522 | 发射器::发射器函数 | `emitJavaScriptWorke… | ```ts |
| 8 | text | 3038 | 发射器::发射器函数 | `emitJavaScriptWorke… | ```ts |
| 9 | text | 2319 | 发射器 | 发射器源映射（SourceMaps） | ## 发射器源映射（SourceMaps） |

### truthy.md

表格原子性　—　sections 2　chunks 3

| # | kind | 字符 | scope（标题路径） | heading | 内容首行 |
|---|---|---|---|---|---|
| 1 | text | 182 | — | Truthy | # Truthy |
| 2 | table | 300 | — | Truthy | \| **Variable Type** \| **When it is falsy** \|… |
| 3 | text | 317 | Truthy | 明确的 | ## 明确的 |

### 报告.docx

无标题结构：走聚合兜底 + 6 个表格块　—　sections 1　chunks 14

| # | kind | 字符 | scope（标题路径） | heading | 内容首行 |
|---|---|---|---|---|---|
| 1 | outline | 16 | — | — | document section |
| 2 | text | 223 | — | — | 地球物理实习报告 |
| 3 | table | 1546 | — | — | \| 探 测 编 号 \| 目标体 \| \| 直径/m \| 长/m \| 埋深/m \| 覆土情况… |
| 4 | text | 1354 | — | — | 磁法勘探 |
| 5 | table | 343 | — | — | \| 主机重量 \| 1.9kg \| |
| 6 | text | 1728 | — | — | 探头 主机 采集软件 |
| 7 | table | 252 | — | — | \| 温纳装置（Wenner） \| 水平探测分辨率较高，对电性变化反应灵敏。 \| |
| 8 | text | 646 | — | — | 仪器 |
| 9 | table | 615 | — | — | \| 无损性：由于探地雷达是利用高频电磁波来探测地下目标和结构的，因而其探测 具有非破坏性… |
| 10 | text | 9 | — | — | 优点 |
| 11 | table | 311 | — | — | \| 探地雷达采用高频电磁波进行探测，在高导介质中传播具有较大的衰减，限制雷达波的穿透能力… |
| 12 | text | 1703 | — | — | 缺点 |
| 13 | table | 12 | — | — | \| \| |
| 14 | text | 78 | — | — | 瞬变电磁 |

### resume.pdf

PDF 路径 + 页码溯源　—　sections 1　chunks 1

| # | kind | 字符 | scope（标题路径） | heading | 内容首行 |
|---|---|---|---|---|---|
| 1 | text | 2032 | — | — | 李恒 |

## 二、全语料每文件汇总（找离群文件）

看「标记」列有没有 `⚠`。合计：80 篇　387 个 chunk　中位 393 字符　<100 字符占比 8.0%

| 文件 | sections | chunks | 中位 | 最小 | 最大 | <100 | 标记 |
|---|---|---|---|---|---|---|---|
| outFileCaution.md | 11 | 11 | 137 | 47 | 438 | 4 | — |
| declarationspaces.md | 3 | 3 | 417 | 59 | 433 | 1 | — |
| literals.md | 6 | 6 | 428 | 28 | 845 | 2 | — |
| interpreting.md | 5 | 5 | 236 | 36 | 721 | 1 | — |
| generices.md | 5 | 5 | 884 | 71 | 2139 | 1 | — |
| typeInference.md | 10 | 10 | 291 | 58 | 705 | 2 | — |
| types.md | 5 | 5 | 138 | 87 | 372 | 1 | — |
| ast.md | 8 | 11 | 223 | 23 | 1260 | 2 | 含 1 表格块；含 1 outline |
| common.md | 6 | 6 | 240 | 42 | 306 | 1 | — |
| functions.md | 6 | 6 | 323 | 55 | 1447 | 1 | — |
| typeAssertion.md | 6 | 6 | 476 | 93 | 655 | 1 | — |
| typeGuard.md | 6 | 6 | 452 | 29 | 852 | 1 | — |
| exceptionsHanding.md | 13 | 13 | 163 | 55 | 499 | 2 | — |
| avoidExportDefault.md | 7 | 7 | 177 | 86 | 441 | 1 | — |
| overview.md | 16 | 16 | 393 | 71 | 1245 | 2 | — |
| emitter.md | 6 | 9 | 2319 | 36 | 3522 | 1 | 含 1 outline |
| modules.md | 19 | 19 | 366 | 48 | 994 | 2 | — |
| parser.md | 10 | 10 | 236 | 74 | 1032 | 1 | — |
| class.md | 12 | 12 | 432 | 65 | 1035 | 1 | — |
| typeCompatibility.md | 13 | 13 | 483 | 33 | 1323 | 1 | — |
| binder.md | 14 | 14 | 361 | 67 | 3431 | 1 | — |
| lib.md | 15 | 15 | 316 | 50 | 1110 | 1 | — |
| checker.md | 5 | 5 | 340 | 106 | 672 | 0 | — |
| overview.md | 7 | 7 | 208 | 141 | 445 | 0 | — |
| program.md | 3 | 3 | 124 | 112 | 271 | 0 | — |
| scanner.md | 4 | 4 | 645 | 108 | 926 | 0 | — |
| commandline-behavior.md | 3 | 3 | 438 | 256 | 727 | 0 | — |
| comments.md | 0 | 0 | 0 | Infinity | 0 | 0 | — |
| common-bug-not-bugs.md | 1 | 1 | 1812 | 1812 | 1812 | 0 | — |
| common-feature-request.md | 1 | 1 | 530 | 530 | 530 | 0 | — |
| decorators.md | 0 | 0 | 0 | Infinity | 0 | 0 | — |
| enums.md | 1 | 1 | 199 | 199 | 199 | 0 | — |
| function.md | 1 | 1 | 572 | 572 | 572 | 0 | — |
| generics.md | 3 | 3 | 635 | 502 | 862 | 0 | — |
| glossary-and-terms.md | 0 | 0 | 0 | Infinity | 0 | 0 | — |
| jsx-and-react.md | 1 | 1 | 644 | 644 | 644 | 0 | — |
| modules.md | 2 | 2 | 515 | 442 | 515 | 0 | — |
| thing-that-dont-work.md | 2 | 2 | 515 | 423 | 515 | 0 | — |
| tsconfig-behavior.md | 3 | 3 | 563 | 146 | 645 | 0 | — |
| type-guards.md | 1 | 1 | 506 | 506 | 506 | 0 | — |
| type-system-behavior.md | 13 | 13 | 610 | 233 | 1582 | 0 | — |
| typescript-3.7.md | 9 | 9 | 1618 | 410 | 3082 | 0 | — |
| typescript-3.8.md | 9 | 9 | 1230 | 167 | 3315 | 0 | — |
| typescript-3.9.md | 1 | 1 | 103 | 103 | 103 | 0 | — |
| compilationContext.md | 5 | 5 | 294 | 144 | 2919 | 0 | — |
| dynamicImportExpressions.md | 1 | 1 | 2084 | 2084 | 2084 | 0 | — |
| namespaces.md | 1 | 1 | 1126 | 1126 | 1126 | 0 | — |
| barrel.md | 2 | 2 | 734 | 668 | 734 | 0 | — |
| bind.md | 2 | 2 | 723 | 684 | 723 | 0 | — |
| buildToggles.md | 1 | 1 | 1077 | 1077 | 1077 | 0 | — |
| classAreUseful.md | 1 | 1 | 878 | 878 | 878 | 0 | — |
| covarianceAndContravariance.md | 4 | 4 | 596 | 374 | 914 | 0 | — |
| createArrays.md | 1 | 1 | 201 | 201 | 201 | 0 | — |
| curry.md | 1 | 1 | 189 | 189 | 189 | 0 | — |
| functionParameters.md | 1 | 1 | 421 | 421 | 421 | 0 | — |
| infer.md | 4 | 4 | 1310 | 542 | 2614 | 0 | — |
| lazyObjectLiteralInitializatio… | 4 | 4 | 446 | 179 | 509 | 0 | — |
| limitPropertySetters.md | 1 | 1 | 442 | 442 | 442 | 0 | — |
| metadata.md | 5 | 5 | 728 | 633 | 1959 | 0 | — |
| nominalTyping.md | 4 | 4 | 792 | 239 | 813 | 0 | — |
| singletonPatern.md | 1 | 1 | 948 | 948 | 948 | 0 | — |
| statefulFunctions.md | 1 | 1 | 531 | 531 | 531 | 0 | — |
| staticConstructors.md | 1 | 1 | 187 | 187 | 187 | 0 | — |
| stringBasedEmuns.md | 1 | 1 | 167 | 167 | 167 | 0 | — |
| truthy.md | 2 | 3 | 300 | 182 | 317 | 0 | 含 1 表格块 |
| typeInstantiation.md | 2 | 2 | 484 | 346 | 484 | 0 | — |
| typesafeEventEmitter.md | 2 | 2 | 968 | 714 | 968 | 0 | — |
| ambient.md | 3 | 3 | 608 | 356 | 715 | 0 | — |
| callable.md | 4 | 4 | 264 | 198 | 806 | 0 | — |
| discrominatedUnion.md | 5 | 5 | 719 | 325 | 1823 | 0 | — |
| enums.md | 10 | 10 | 563 | 235 | 1696 | 0 | — |
| freshness.md | 3 | 3 | 677 | 142 | 1580 | 0 | — |
| indexSignatures.md | 8 | 8 | 822 | 278 | 1024 | 0 | — |
| interfaces.md | 3 | 3 | 571 | 424 | 587 | 0 | — |
| migrating.md | 5 | 5 | 484 | 301 | 852 | 0 | — |
| mixins.md | 3 | 3 | 166 | 115 | 1431 | 0 | — |
| movingTypes.md | 6 | 6 | 324 | 161 | 396 | 0 | — |
| neverType.md | 3 | 3 | 536 | 264 | 739 | 0 | — |
| readonly.md | 6 | 6 | 649 | 320 | 702 | 0 | — |
| thisType.md | 1 | 1 | 2328 | 2328 | 2328 | 0 | — |

## 三、所有小于 100 字符的 chunk 清单

共 31 个。需要判断：这些是「语义完整的小节」，还是「本该被合并进相邻块的碎片」。

| 文件 | # | kind | 字符 | heading | 完整内容 |
|---|---|---|---|---|---|
| ast.md | 7 | outline | 23 | 杂项 API | 抽象语法树 > AST 杂项 > 杂项 API |
| literals.md | 6 | text | 28 | 辨析联合类型 | ## 辨析联合类型 我们将会在此书的稍后章节讲解它。 |
| typeGuard.md | 1 | text | 29 | 类型保护 | # 类型保护 类型保护允许你使用更小范围下的对象类型。 |
| typeCompatibility.md | 5 | text | 33 | 函数 | ## 函数 当你在比较两个函数时，这有一些你需要考虑到的事情。 |
| emitter.md | 5 | outline | 36 | `emitJavaScriptWor… | 发射器 > 发射器函数 > `emitJavaScriptWorker` |
| interpreting.md | 2 | text | 36 | 错误分类 | ## 错误分类 TypeScript 错误信息分为两类：简洁和详细。 |
| literals.md | 1 | text | 38 | 字面量类型 | # 字面量类型 字面量是 JavaScript 本身提供的一个准确变量。 |
| common.md | 1 | text | 42 | 常见的 Error | # 常见的 Error 在此章节中，我们学习在实际应用中将会遇到的常见错误代码。 |
| outFileCaution.md | 6 | text | 47 | 难以扩展 | ## 难以扩展 实际上这是运行时的随机错误 + 编译时间时间慢 + 难以理解的代码的结果。 |
| modules.md | 3 | text | 48 | 文件模块详情 | ## 文件模块详情 文件模块拥有强大的功能和较强的可用性。下面我们来讨论它的功能及一些用法。 |
| outFileCaution.md | 5 | text | 48 | 难以分析 | ## 难以分析 我们希望提供更多代码分析工具。如果你提供调用链的依赖关系，这些将会变得简单。 |
| ast.md | 8 | text | 50 | 杂项 API | ### 杂项 API 注释在多数基本使用中，都是让人关注的杂项。节点的注释可以通过以下函数获取： |
| outFileCaution.md | 8 | text | 50 | 代码重用 | ## 代码重用 如果你想在另一个项目中重用存在隐式依赖关系的代码，如果没有错误提示，很难移植它。 |
| lib.md | 13 | text | 50 | 命令行 | ### 命令行 ```ts tsc --target es5 --lib dom,es6 ``` |
| exceptionsHanding.md | 2 | text | 55 | 错误子类型 | ## 错误子类型 除内置的 `Error` 类外，还有一些额外的内置错误，它们继承自 `Error` 类： |
| functions.md | 1 | text | 55 | 函数 | # 函数 函数类型在 TypeScript 类型系统中扮演着非常重要的角色，它们是可组合系统的核心构建块。 |
| typeInference.md | 1 | text | 58 | 类型推断 | # 类型推断 TypeScript 能根据一些简单的规则推断（检查）变量的类型，你可以通过实践，很快的了解它们。 |
| declarationspaces.md | 1 | text | 59 | 声明空间 | # 声明空间 在 TypeScript 里存在两种声明空间：类型声明空间与变量声明空间。下文将分别讨论这两个概念。 |
| class.md | 6 | text | 65 | 声明类和接口有什么区别？ | ## 声明类和接口有什么区别？ 参阅: http://stackoverflow.com/a/14348084/1704166 |
| binder.md | 4 | text | 67 | 绑定器函数 | ## 绑定器函数 `bindSourceFile` 和 `mergeSymbolTable` 是两个关键的绑定器函数，我们来看下： |
| generices.md | 1 | text | 71 | 泛型 | # 泛型 设计泛型的关键目的是在成员之间提供有意义的约束，这些成员可以是： - 类的实例成员 - 类的方法 - 函数参数 - 函数返回值 |
| overview.md | 16 | text | 71 | 最后 | ## 最后 现在你已经能够为你的大部分 JavaScript 代码添加类型注解，接着，让我们深入了解 TypeScript 的类型系统吧。 |
| parser.md | 4 | text | 74 | 解析器函数 | ## 解析器函数 如前所述，`parseSourceFile` 设置初始状态并将工作交给 `parseSourceFileWorker` 函数。 |
| avoidExportDefault.md | 3 | text | 86 | 自动完成 | ## 自动完成 不管你是否了解导出，你都可以在 `import { /* here */ } from './foo'` 的 `here` 位置，来了解导出模块的信息。 |
| types.md | 3 | text | 87 | 全局 `@types` | ### 全局 `@types` 默认情况下，TypeScript 会自动包含支持全局使用的任何声明定义。例如，对于 jquery，你应该能够在项目中开始全局使用 `$`。 |
| modules.md | 13 | text | 89 | 例子 1 | #### 例子 1 ```ts import foo = require('foo'); ``` 将会编译成 JavaScript： 这是正确的，一个没有被使用的空文件。 |
| outFileCaution.md | 11 | text | 90 | 总结 | ## 总结 `--out` 做的是一些构建工具的工作，这些构建工具也可以受益于外部模块所提供的依赖，因此如果你愿意，我们推荐你使用外部模块，让构建工具创建单文件的 `.js`。 |
| overview.md | 7 | text | 90 | 特殊类型 | ## 特殊类型 除了被提到的一些原始类型，在 TypeScript 中，还存在一些特殊的类型，它们是 `any`、 `null`、 `undefined` 以及 `void`。 |
| typeAssertion.md | 3 | text | 93 | 类型断言与类型转换 | ## 类型断言与类型转换 它之所以不被称为「类型转换」，是因为转换通常意味着某种运行时的支持。但是，类型断言纯粹是一个编译时语法，同时，它也是一种为编译器提供关于如何分析代码的方法… |
| typeInference.md | 7 | text | 93 | 类型保护 | ## 类型保护 在前面章节[类型保护](./typeGuard.md)中，我们已经知道它如何帮助我们改变和缩小类型范围（特别是在联合类型下）。类型保护只是一个块中变量另一种推断形式… |
| exceptionsHanding.md | 10 | text | 97 | 优秀的用例 | ## 优秀的用例 「Exceptions should be exceptional」是计算机科学中常用用语。这里有一些原因说明在 JavaScript(TypeScript) 中… |
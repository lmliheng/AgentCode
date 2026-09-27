# 长沙今日天气查询结果

- 查询时间：2026-09-21 22:5x（本地时间）
- 数据来源：`curl wttr.in/Changsha`（wttr.in 在线天气服务）
- 查询命令：`curl -s "wttr.in/Changsha?format=j1"`

## 一、今日天气（长沙）

| 项目 | 数值 |
| --- | --- |
| 地点 | Changshashih, Hunan, China |
| 观测日期 | 2026-09-21 |
| 天气 | 晴 (Clear) |
| 当前温度 | 22 °C (体感 22 °C) |
| 今日最高/最低 | 30 °C / 21 °C |
| 湿度 | 90 % |
| 风向风速 | NNW 18 km/h |
| 气压 | 1016 hPa |
| 能见度 | 10 km |
| 降水量 | 0.0 mm |
| 紫外线指数 | 0 |
| 日出/日落 | 06:16 AM / 06:26 PM |

### 逐时预报（今天）

| 时间 | 温度 | 体感 | 天气 | 降水 | 风 | 湿度 |
| --- | --- | --- | --- | --- | --- | --- |
| 0000 | 24 °C | 26 °C | 晴 | 0.0 mm | NNW 8 km/h | 86 % |
| 0300 | 23 °C | 25 °C | 烟霾 | 0.0 mm | NNW 7 km/h | 87 % |
| 0600 | 23 °C | 25 °C | 烟霾 | 0.0 mm | NW 9 km/h | 85 % |
| 0900 | 26 °C | 28 °C | 烟霾 | 0.0 mm | NNW 15 km/h | 76 % |
| 1200 | 29 °C | 33 °C | 局部多云 | 0.0 mm | NNW 16 km/h | 63 % |
| 1500 | 28 °C | 31 °C | 附近有零星降雨 | 0.0 mm | NNW 21 km/h | 66 % |
| 1800 | 24 °C | 26 °C | 多云 | 0.0 mm | NNW 16 km/h | 83 % |
| 2100 | 23 °C | 25 °C | 阴 | 0.0 mm | NNW 17 km/h | 86 % |

## 二、当前目录结构

```text
C:.
|   .env
|   .env.example
|   current.code-workspace
|   package-lock.json
|   package.json
|   README.md
|   tsconfig.json
|   vite.config.ts
|   vitest.config.ts
|   
+---.qwen
|   +---commands
|   |       opsx-apply.md
|   |       opsx-archive.md
|   |       opsx-explore.md
|   |       opsx-propose.md
|   |       opsx-sync.md
|   |       opsx-update.md
|   |       
|   +---skills
|   |   +---openspec-apply-change
|   |   |       SKILL.md
|   |   |       
|   |   +---openspec-archive-change
|   |   |       SKILL.md
|   |   |       
|   |   +---openspec-explore
|   |   |       SKILL.md
|   |   |       
|   |   +---openspec-propose
|   |   |       SKILL.md
|   |   |       
|   |   +---openspec-sync-specs
|   |   |       SKILL.md
|   |   |       
|   |   \---openspec-update-change
|   |           SKILL.md
|   |           
|   \---tmp
|       \---s-8262eaf2-b5d6-4dad-ae6f-3d41d5c04ec9
+---node_modules/   (依赖目录，内容已省略)
|   +---.bin
|   |       esbuild
|   |       esbuild.cmd
|   |       esbuild.ps1
|   |       nanoid
|   |       nanoid.cmd
|   |       nanoid.ps1
|   |       parser
|   |       parser.cmd
|   |       parser.ps1
|   |       rolldown
|   |       rolldown.cmd
|   |       rolldown.ps1
|   |       tsc
|   |       tsc.cmd
|   |       tsc.ps1
|   |       tsx
|   |       tsx.cmd
|   |       tsx.ps1
|   |       vite
|   |       vite.cmd
|   |       vite.ps1
|   |       vitest
|   |       vitest.cmd
|   |       vitest.ps1
|   |       why-is-node-running
|   |       why-is-node-running.cmd
|   |       why-is-node-running.ps1
|   |       
|   +---.vite
|   |   +---deps
|   |   |       package.json
|   |   |       _metadata.json
|   |   |       
|   |   \---vitest
|   |       \---da39a3ee5e6b4b0d3255bfef95601890afd80709
|   |               results.json
|   |               
|   +---.vite-temp
|   +---@alcalzone
|   |   \---ansi-tokenize
|   |       |   LICENSE
|   |       |   package.json
|   |       |   README.md
|   |       |   
|   |       \---build
|   |               ansiCodes.d.ts
|   |               ansiCodes.js
|   |               ansiCodes.js.map
|   |               consts.d.ts
|   |               consts.js
|   |               consts.js.map
|   |               diff.d.ts
|   |               diff.js
|   |               diff.js.map
|   |               index.d.ts
|   |               index.js
|   |               index.js.map
|   |               reduce.d.ts
|   |               reduce.js
|   |               reduce.js.map
|   |               styledChars.d.ts
|   |               styledChars.js
|   |               styledChars.js.map
|   |               tokenize.d.ts
|   |               tokenize.js
|   |               tokenize.js.map
|   |               undo.d.ts
|   |               undo.js
|   |               undo.js.map
|   |               
|   +---@babel
|   |   +---helper-string-parser
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   README.md
|   |   |   |   
|   |   |   \---lib
|   |   |           index.js
|   |   |           index.js.map
|   |   |           
|   |   +---helper-validator-identifier
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   README.md
|   |   |   |   
|   |   |   \---lib
|   |   |           identifier.js
|   |   |           identifier.js.map
|   |   |           index.js
|   |   |           index.js.map
|   |   |           keyword.js
|   |   |           keyword.js.map
|   |   |           
|   |   +---parser
|   |   |   |   CHANGELOG.md
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   README.md
|   |   |   |   
|   |   |   +---bin
|   |   |   |       babel-parser.js
|   |   |   |       
|   |   |   +---lib
|   |   |   |       index.js
|   |   |   |       index.js.map
|   |   |   |       
|   |   |   \---typings
|   |   |           babel-parser.d.ts
|   |   |           
|   |   \---types
|   |       |   LICENSE
|   |       |   package.json
|   |       |   README.md
|   |       |   
|   |       \---lib
|   |           |   index-legacy.d.ts
|   |           |   index.d.ts
|   |           |   index.js
|   |           |   index.js.flow
|   |           |   index.js.map
|   |           |   
|   |           +---asserts
|   |           |   |   assertNode.js
|   |           |   |   assertNode.js.map
|   |           |   |   
|   |           |   \---generated
|   |           |           index.js
|   |           |           index.js.map
|   |           |           
|   |           +---ast-types
|   |           |   \---generated
|   |           |           index.js
|   |           |           index.js.map
|   |           |           
|   |           +---builders
|   |           |   |   productions.js
|   |           |   |   productions.js.map
|   |           |   |   validateNode.js
|   |           |   |   validateNode.js.map
|   |           |   |   
|   |           |   +---flow
|   |           |   |       createFlowUnionType.js
|   |           |   |       createFlowUnionType.js.map
|   |           |   |       createTypeAnnotationBasedOnTypeof.js
|   |           |   |       createTypeAnnotationBasedOnTypeof.js.map
|   |           |   |       
|   |           |   +---generated
|   |           |   |       index.js
|   |           |   |       index.js.map
|   |           |   |       lowercase.js
|   |           |   |       lowercase.js.map
|   |           |   |       uppercase.js
|   |           |   |       uppercase.js.map
|   |           |   |       
|   |           |   +---react
|   |           |   |       buildChildren.js
|   |           |   |       buildChildren.js.map
|   |           |   |       
|   |           |   \---typescript
|   |           |           createTSUnionType.js
|   |           |           createTSUnionType.js.map
|   |           |           
|   |           +---clone
|   |           |       clone.js
|   |           |       clone.js.map
|   |           |       cloneDeep.js
|   |           |       cloneDeep.js.map
|   |           |       cloneDeepWithoutLoc.js
|   |           |       cloneDeepWithoutLoc.js.map
|   |           |       cloneNode.js
|   |           |       cloneNode.js.map
|   |           |       cloneWithoutLoc.js
|   |           |       cloneWithoutLoc.js.map
|   |           |       
|   |           +---comments
|   |           |       addComment.js
|   |           |       addComment.js.map
|   |           |       addComments.js
|   |           |       addComments.js.map
|   |           |       inheritInnerComments.js
|   |           |       inheritInnerComments.js.map
|   |           |       inheritLeadingComments.js
|   |           |       inheritLeadingComments.js.map
|   |           |       inheritsComments.js
|   |           |       inheritsComments.js.map
|   |           |       inheritTrailingComments.js
|   |           |       inheritTrailingComments.js.map
|   |           |       removeComments.js
|   |           |       removeComments.js.map
|   |           |       
|   |           +---constants
|   |           |   |   index.js
|   |           |   |   index.js.map
|   |           |   |   
|   |           |   \---generated
|   |           |           index.js
|   |           |           index.js.map
|   |           |           
|   |           +---converters
|   |           |       ensureBlock.js
|   |           |       ensureBlock.js.map
|   |           |       gatherSequenceExpressions.js
|   |           |       gatherSequenceExpressions.js.map
|   |           |       toBindingIdentifierName.js
|   |           |       toBindingIdentifierName.js.map
|   |           |       toBlock.js
|   |           |       toBlock.js.map
|   |           |       toComputedKey.js
|   |           |       toComputedKey.js.map
|   |           |       toExpression.js
|   |           |       toExpression.js.map
|   |           |       toIdentifier.js
|   |           |       toIdentifier.js.map
|   |           |       toKeyAlias.js
|   |           |       toKeyAlias.js.map
|   |           |       toSequenceExpression.js
|   |           |       toSequenceExpression.js.map
|   |           |       toStatement.js
|   |           |       toStatement.js.map
|   |           |       valueToNode.js
|   |           |       valueToNode.js.map
|   |           |       
|   |           +---definitions
|   |           |       core.js
|   |           |       core.js.map
|   |           |       deprecated-aliases.js
|   |           |       deprecated-aliases.js.map
|   |           |       experimental.js
|   |           |       experimental.js.map
|   |           |       flow.js
|   |           |       flow.js.map
|   |           |       index.js
|   |           |       index.js.map
|   |           |       jsx.js
|   |           |       jsx.js.map
|   |           |       misc.js
|   |           |       misc.js.map
|   |           |       placeholders.js
|   |           |       placeholders.js.map
|   |           |       typescript.js
|   |           |       typescript.js.map
|   |           |       utils.js
|   |           |       utils.js.map
|   |           |       
|   |           +---modifications
|   |           |   |   appendToMemberExpression.js
|   |           |   |   appendToMemberExpression.js.map
|   |           |   |   inherits.js
|   |           |   |   inherits.js.map
|   |           |   |   prependToMemberExpression.js
|   |           |   |   prependToMemberExpression.js.map
|   |           |   |   removeProperties.js
|   |           |   |   removeProperties.js.map
|   |           |   |   removePropertiesDeep.js
|   |           |   |   removePropertiesDeep.js.map
|   |           |   |   
|   |           |   +---flow
|   |           |   |       removeTypeDuplicates.js
|   |           |   |       removeTypeDuplicates.js.map
|   |           |   |       
|   |           |   \---typescript
|   |           |           removeTypeDuplicates.js
|   |           |           removeTypeDuplicates.js.map
|   |           |           
|   |           +---retrievers
|   |           |       getAssignmentIdentifiers.js
|   |           |       getAssignmentIdentifiers.js.map
|   |           |       getBindingIdentifiers.js
|   |           |       getBindingIdentifiers.js.map
|   |           |       getFunctionName.js
|   |           |       getFunctionName.js.map
|   |           |       getOuterBindingIdentifiers.js
|   |           |       getOuterBindingIdentifiers.js.map
|   |           |       
|   |           +---traverse
|   |           |       traverse.js
|   |           |       traverse.js.map
|   |           |       traverseFast.js
|   |           |       traverseFast.js.map
|   |           |       
|   |           +---utils
|   |           |   |   deprecationWarning.js
|   |           |   |   deprecationWarning.js.map
|   |           |   |   inherit.js
|   |           |   |   inherit.js.map
|   |           |   |   shallowEqual.js
|   |           |   |   shallowEqual.js.map
|   |           |   |   
|   |           |   \---react
|   |           |           cleanJSXElementLiteralChild.js
|   |           |           cleanJSXElementLiteralChild.js.map
|   |           |           
|   |           \---validators
|   |               |   buildMatchMemberExpression.js
|   |               |   buildMatchMemberExpression.js.map
|   |               |   is.js
|   |               |   is.js.map
|   |               |   isBinding.js
|   |               |   isBinding.js.map
|   |               |   isBlockScoped.js
|   |               |   isBlockScoped.js.map
|   |               |   isImmutable.js
|   |               |   isImmutable.js.map
|   |               |   isLet.js
|   |               |   isLet.js.map
|   |               |   isNode.js
|   |               |   isNode.js.map
|   |               |   isNodesEquivalent.js
|   |               |   isNodesEquivalent.js.map
|   |               |   isPlaceholderType.js
|   |               |   isPlaceholderType.js.map
|   |               |   isReferenced.js
|   |               |   isReferenced.js.map
|   |               |   isScope.js
|   |               |   isScope.js.map
|   |               |   isSpecifierDefault.js
|   |               |   isSpecifierDefault.js.map
|   |               |   isType.js
|   |               |   isType.js.map
|   |               |   isValidES3Identifier.js
|   |               |   isValidES3Identifier.js.map
|   |               |   isValidIdentifier.js
|   |               |   isValidIdentifier.js.map
|   |               |   isVar.js
|   |               |   isVar.js.map
|   |               |   matchesPattern.js
|   |               |   matchesPattern.js.map
|   |               |   validate.js
|   |               |   validate.js.map
|   |               |   
|   |               +---generated
|   |               |       index.js
|   |               |       index.js.map
|   |               |       
|   |               \---react
|   |                       isCompatTag.js
|   |                       isCompatTag.js.map
|   |                       isReactComponent.js
|   |                       isReactComponent.js.map
|   |                       
|   +---@esbuild
|   |   \---win32-x64
|   |           esbuild.exe
|   |           package.json
|   |           README.md
|   |           
|   +---@inquirer
|   |   +---ansi
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   README.md
|   |   |   |   
|   |   |   \---dist
|   |   |           index.d.ts
|   |   |           index.js
|   |   |           
|   |   +---checkbox
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   README.md
|   |   |   |   
|   |   |   \---dist
|   |   |           index.d.ts
|   |   |           index.js
|   |   |           
|   |   +---confirm
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   README.md
|   |   |   |   
|   |   |   \---dist
|   |   |           index.d.ts
|   |   |           index.js
|   |   |           
|   |   +---core
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   README.md
|   |   |   |   
|   |   |   \---dist
|   |   |       |   index.d.ts
|   |   |       |   index.js
|   |   |       |   
|   |   |       \---lib
|   |   |           |   create-prompt.d.ts
|   |   |           |   create-prompt.js
|   |   |           |   errors.d.ts
|   |   |           |   errors.js
|   |   |           |   hook-engine.d.ts
|   |   |           |   hook-engine.js
|   |   |           |   key.d.ts
|   |   |           |   key.js
|   |   |           |   make-theme.d.ts
|   |   |           |   make-theme.js
|   |   |           |   promise-polyfill.d.ts
|   |   |           |   promise-polyfill.js
|   |   |           |   screen-manager.d.ts
|   |   |           |   screen-manager.js
|   |   |           |   Separator.d.ts
|   |   |           |   Separator.js
|   |   |           |   theme.d.ts
|   |   |           |   theme.js
|   |   |           |   use-effect.d.ts
|   |   |           |   use-effect.js
|   |   |           |   use-keypress.d.ts
|   |   |           |   use-keypress.js
|   |   |           |   use-memo.d.ts
|   |   |           |   use-memo.js
|   |   |           |   use-prefix.d.ts
|   |   |           |   use-prefix.js
|   |   |           |   use-ref.d.ts
|   |   |           |   use-ref.js
|   |   |           |   use-state.d.ts
|   |   |           |   use-state.js
|   |   |           |   utils.d.ts
|   |   |           |   utils.js
|   |   |           |   
|   |   |           \---pagination
|   |   |                   use-pagination.d.ts
|   |   |                   use-pagination.js
|   |   |                   
|   |   +---editor
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   README.md
|   |   |   |   
|   |   |   \---dist
|   |   |           index.d.ts
|   |   |           index.js
|   |   |           
|   |   +---expand
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   README.md
|   |   |   |   
|   |   |   \---dist
|   |   |           index.d.ts
|   |   |           index.js
|   |   |           
|   |   +---external-editor
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   README.md
|   |   |   |   
|   |   |   \---dist
|   |   |           errors.d.ts
|   |   |           errors.js
|   |   |           index.d.ts
|   |   |           index.js
|   |   |           parse-editor-command.d.ts
|   |   |           parse-editor-command.js
|   |   |           
|   |   +---figures
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   
|   |   |   \---dist
|   |   |           index.d.ts
|   |   |           index.js
|   |   |           
|   |   +---input
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   README.md
|   |   |   |   
|   |   |   \---dist
|   |   |           index.d.ts
|   |   |           index.js
|   |   |           
|   |   +---number
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   README.md
|   |   |   |   
|   |   |   \---dist
|   |   |           index.d.ts
|   |   |           index.js
|   |   |           is-step-of.d.ts
|   |   |           is-step-of.js
|   |   |           
|   |   +---password
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   README.md
|   |   |   |   
|   |   |   \---dist
|   |   |           index.d.ts
|   |   |           index.js
|   |   |           
|   |   +---prompts
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   README.md
|   |   |   |   
|   |   |   \---dist
|   |   |           index.d.ts
|   |   |           index.js
|   |   |           
|   |   +---rawlist
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   README.md
|   |   |   |   
|   |   |   \---dist
|   |   |           index.d.ts
|   |   |           index.js
|   |   |           
|   |   +---search
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   README.md
|   |   |   |   
|   |   |   \---dist
|   |   |           index.d.ts
|   |   |           index.js
|   |   |           
|   |   +---select
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   README.md
|   |   |   |   
|   |   |   \---dist
|   |   |           index.d.ts
|   |   |           index.js
|   |   |           
|   |   \---type
|   |       |   LICENSE
|   |       |   package.json
|   |       |   
|   |       \---dist
|   |               index.d.ts
|   |               index.js
|   |               inquirer.d.ts
|   |               inquirer.js
|   |               utils.d.ts
|   |               utils.js
|   |               
|   +---@jridgewell
|   |   +---resolve-uri
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   README.md
|   |   |   |   
|   |   |   \---dist
|   |   |       |   resolve-uri.mjs
|   |   |       |   resolve-uri.mjs.map
|   |   |       |   resolve-uri.umd.js
|   |   |       |   resolve-uri.umd.js.map
|   |   |       |   
|   |   |       \---types
|   |   |               resolve-uri.d.ts
|   |   |               
|   |   +---sourcemap-codec
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   README.md
|   |   |   |   
|   |   |   +---dist
|   |   |   |       sourcemap-codec.mjs
|   |   |   |       sourcemap-codec.mjs.map
|   |   |   |       sourcemap-codec.umd.js
|   |   |   |       sourcemap-codec.umd.js.map
|   |   |   |       
|   |   |   +---src
|   |   |   |       range-mappings.ts
|   |   |   |       scopes.ts
|   |   |   |       sourcemap-codec.ts
|   |   |   |       strings.ts
|   |   |   |       vlq.ts
|   |   |   |       
|   |   |   \---types
|   |   |           range-mappings.d.cts
|   |   |           range-mappings.d.cts.map
|   |   |           range-mappings.d.mts
|   |   |           range-mappings.d.mts.map
|   |   |           scopes.d.cts
|   |   |           scopes.d.cts.map
|   |   |           scopes.d.mts
|   |   |           scopes.d.mts.map
|   |   |           sourcemap-codec.d.cts
|   |   |           sourcemap-codec.d.cts.map
|   |   |           sourcemap-codec.d.mts
|   |   |           sourcemap-codec.d.mts.map
|   |   |           strings.d.cts
|   |   |           strings.d.cts.map
|   |   |           strings.d.mts
|   |   |           strings.d.mts.map
|   |   |           vlq.d.cts
|   |   |           vlq.d.cts.map
|   |   |           vlq.d.mts
|   |   |           vlq.d.mts.map
|   |   |           
|   |   \---trace-mapping
|   |       |   LICENSE
|   |       |   package.json
|   |       |   README.md
|   |       |   
|   |       +---dist
|   |       |       trace-mapping.mjs
|   |       |       trace-mapping.mjs.map
|   |       |       trace-mapping.umd.js
|   |       |       trace-mapping.umd.js.map
|   |       |       
|   |       +---src
|   |       |       binary-search.ts
|   |       |       by-source.ts
|   |       |       flatten-map.ts
|   |       |       resolve.ts
|   |       |       sort.ts
|   |       |       sourcemap-segment.ts
|   |       |       strip-filename.ts
|   |       |       trace-mapping.ts
|   |       |       types.ts
|   |       |       
|   |       \---types
|   |               binary-search.d.cts
|   |               binary-search.d.cts.map
|   |               binary-search.d.mts
|   |               binary-search.d.mts.map
|   |               by-source.d.cts
|   |               by-source.d.cts.map
|   |               by-source.d.mts
|   |               by-source.d.mts.map
|   |               flatten-map.d.cts
|   |               flatten-map.d.cts.map
|   |               flatten-map.d.mts
|   |               flatten-map.d.mts.map
|   |               resolve.d.cts
|   |               resolve.d.cts.map
|   |               resolve.d.mts
|   |               resolve.d.mts.map
|   |               sort.d.cts
|   |               sort.d.cts.map
|   |               sort.d.mts
|   |               sort.d.mts.map
|   |               sourcemap-segment.d.cts
|   |               sourcemap-segment.d.cts.map
|   |               sourcemap-segment.d.mts
|   |               sourcemap-segment.d.mts.map
|   |               strip-filename.d.cts
|   |               strip-filename.d.cts.map
|   |               strip-filename.d.mts
|   |               strip-filename.d.mts.map
|   |               trace-mapping.d.cts
|   |               trace-mapping.d.cts.map
|   |               trace-mapping.d.mts
|   |               trace-mapping.d.mts.map
|   |               types.d.cts
|   |               types.d.cts.map
|   |               types.d.mts
|   |               types.d.mts.map
|   |               
|   +---@oxc-project
|   |   \---types
|   |           LICENSE
|   |           package.json
|   |           README.md
|   |           types.d.ts
|   |           
|   +---@rolldown
|   |   +---binding-win32-x64-msvc
|   |   |       package.json
|   |   |       README.md
|   |   |       rolldown-binding.win32-x64-msvc.node
|   |   |       
|   |   \---pluginutils
|   |       |   LICENSE
|   |       |   package.json
|   |       |   README.md
|   |       |   
|   |       \---dist
|   |           |   filter-B_mD-HGz.mjs
|   |           |   index.d.mts
|   |           |   index.mjs
|   |           |   
|   |           \---filter
|   |                   index.d.mts
|   |                   index.mjs
|   |                   
|   +---@types
|   |   +---chai
|   |   |       index.d.ts
|   |   |       LICENSE
|   |   |       package.json
|   |   |       README.md
|   |   |       register-should.d.ts
|   |   |       
|   |   +---deep-eql
|   |   |       index.d.ts
|   |   |       LICENSE
|   |   |       package.json
|   |   |       README.md
|   |   |       
|   |   +---estree
|   |   |       flow.d.ts
|   |   |       index.d.ts
|   |   |       LICENSE
|   |   |       package.json
|   |   |       README.md
|   |   |       
|   |   \---node
|   |       |   assert.d.ts
|   |       |   async_hooks.d.ts
|   |       |   buffer.buffer.d.ts
|   |       |   buffer.d.ts
|   |       |   child_process.d.ts
|   |       |   cluster.d.ts
|   |       |   console.d.ts
|   |       |   constants.d.ts
|   |       |   crypto.d.ts
|   |       |   dgram.d.ts
|   |       |   diagnostics_channel.d.ts
|   |       |   dns.d.ts
|   |       |   domain.d.ts
|   |       |   events.d.ts
|   |       |   fs.d.ts
|   |       |   globals.d.ts
|   |       |   globals.typedarray.d.ts
|   |       |   http.d.ts
|   |       |   http2.d.ts
|   |       |   https.d.ts
|   |       |   index.d.ts
|   |       |   inspector.d.ts
|   |       |   inspector.generated.d.ts
|   |       |   LICENSE
|   |       |   module.d.ts
|   |       |   net.d.ts
|   |       |   os.d.ts
|   |       |   package.json
|   |       |   path.d.ts
|   |       |   perf_hooks.d.ts
|   |       |   process.d.ts
|   |       |   punycode.d.ts
|   |       |   querystring.d.ts
|   |       |   readline.d.ts
|   |       |   README.md
|   |       |   repl.d.ts
|   |       |   sea.d.ts
|   |       |   sqlite.d.ts
|   |       |   stream.d.ts
|   |       |   string_decoder.d.ts
|   |       |   test.d.ts
|   |       |   timers.d.ts
|   |       |   tls.d.ts
|   |       |   trace_events.d.ts
|   |       |   tty.d.ts
|   |       |   url.d.ts
|   |       |   util.d.ts
|   |       |   v8.d.ts
|   |       |   vm.d.ts
|   |       |   wasi.d.ts
|   |       |   worker_threads.d.ts
|   |       |   zlib.d.ts
|   |       |   
|   |       +---assert
|   |       |       strict.d.ts
|   |       |       
|   |       +---compatibility
|   |       |       disposable.d.ts
|   |       |       index.d.ts
|   |       |       indexable.d.ts
|   |       |       iterators.d.ts
|   |       |       
|   |       +---dns
|   |       |       promises.d.ts
|   |       |       
|   |       +---fs
|   |       |       promises.d.ts
|   |       |       
|   |       +---readline
|   |       |       promises.d.ts
|   |       |       
|   |       +---stream
|   |       |       consumers.d.ts
|   |       |       promises.d.ts
|   |       |       web.d.ts
|   |       |       
|   |       +---timers
|   |       |       promises.d.ts
|   |       |       
|   |       +---ts5.6
|   |       |       buffer.buffer.d.ts
|   |       |       globals.typedarray.d.ts
|   |       |       index.d.ts
|   |       |       
|   |       \---web-globals
|   |               abortcontroller.d.ts
|   |               domexception.d.ts
|   |               events.d.ts
|   |               fetch.d.ts
|   |               navigator.d.ts
|   |               storage.d.ts
|   |               streams.d.ts
|   |               
|   +---@typescript
|   |   \---typescript-win32-x64
|   |       |   LICENSE
|   |       |   NOTICE.txt
|   |       |   package.json
|   |       |   README.md
|   |       |   
|   |       \---lib
|   |               lib.d.ts
|   |               lib.decorators.d.ts
|   |               lib.decorators.legacy.d.ts
|   |               lib.dom.asynciterable.d.ts
|   |               lib.dom.d.ts
|   |               lib.dom.iterable.d.ts
|   |               lib.es2015.collection.d.ts
|   |               lib.es2015.core.d.ts
|   |               lib.es2015.d.ts
|   |               lib.es2015.generator.d.ts
|   |               lib.es2015.iterable.d.ts
|   |               lib.es2015.promise.d.ts
|   |               lib.es2015.proxy.d.ts
|   |               lib.es2015.reflect.d.ts
|   |               lib.es2015.symbol.d.ts
|   |               lib.es2015.symbol.wellknown.d.ts
|   |               lib.es2016.array.include.d.ts
|   |               lib.es2016.d.ts
|   |               lib.es2016.full.d.ts
|   |               lib.es2016.intl.d.ts
|   |               lib.es2017.arraybuffer.d.ts
|   |               lib.es2017.d.ts
|   |               lib.es2017.date.d.ts
|   |               lib.es2017.full.d.ts
|   |               lib.es2017.intl.d.ts
|   |               lib.es2017.object.d.ts
|   |               lib.es2017.sharedmemory.d.ts
|   |               lib.es2017.string.d.ts
|   |               lib.es2017.typedarrays.d.ts
|   |               lib.es2018.asyncgenerator.d.ts
|   |               lib.es2018.asynciterable.d.ts
|   |               lib.es2018.d.ts
|   |               lib.es2018.full.d.ts
|   |               lib.es2018.intl.d.ts
|   |               lib.es2018.promise.d.ts
|   |               lib.es2018.regexp.d.ts
|   |               lib.es2019.array.d.ts
|   |               lib.es2019.d.ts
|   |               lib.es2019.full.d.ts
|   |               lib.es2019.intl.d.ts
|   |               lib.es2019.object.d.ts
|   |               lib.es2019.string.d.ts
|   |               lib.es2019.symbol.d.ts
|   |               lib.es2020.bigint.d.ts
|   |               lib.es2020.d.ts
|   |               lib.es2020.date.d.ts
|   |               lib.es2020.full.d.ts
|   |               lib.es2020.intl.d.ts
|   |               lib.es2020.number.d.ts
|   |               lib.es2020.promise.d.ts
|   |               lib.es2020.sharedmemory.d.ts
|   |               lib.es2020.string.d.ts
|   |               lib.es2020.symbol.wellknown.d.ts
|   |               lib.es2021.d.ts
|   |               lib.es2021.full.d.ts
|   |               lib.es2021.intl.d.ts
|   |               lib.es2021.promise.d.ts
|   |               lib.es2021.string.d.ts
|   |               lib.es2021.weakref.d.ts
|   |               lib.es2022.array.d.ts
|   |               lib.es2022.d.ts
|   |               lib.es2022.error.d.ts
|   |               lib.es2022.full.d.ts
|   |               lib.es2022.intl.d.ts
|   |               lib.es2022.object.d.ts
|   |               lib.es2022.regexp.d.ts
|   |               lib.es2022.string.d.ts
|   |               lib.es2023.array.d.ts
|   |               lib.es2023.collection.d.ts
|   |               lib.es2023.d.ts
|   |               lib.es2023.full.d.ts
|   |               lib.es2023.intl.d.ts
|   |               lib.es2024.arraybuffer.d.ts
|   |               lib.es2024.collection.d.ts
|   |               lib.es2024.d.ts
|   |               lib.es2024.full.d.ts
|   |               lib.es2024.object.d.ts
|   |               lib.es2024.promise.d.ts
|   |               lib.es2024.regexp.d.ts
|   |               lib.es2024.sharedmemory.d.ts
|   |               lib.es2024.string.d.ts
|   |               lib.es2025.collection.d.ts
|   |               lib.es2025.d.ts
|   |               lib.es2025.float16.d.ts
|   |               lib.es2025.full.d.ts
|   |               lib.es2025.intl.d.ts
|   |               lib.es2025.iterator.d.ts
|   |               lib.es2025.promise.d.ts
|   |               lib.es2025.regexp.d.ts
|   |               lib.es5.d.ts
|   |               lib.es6.d.ts
|   |               lib.esnext.array.d.ts
|   |               lib.esnext.collection.d.ts
|   |               lib.esnext.d.ts
|   |               lib.esnext.date.d.ts
|   |               lib.esnext.decorators.d.ts
|   |               lib.esnext.disposable.d.ts
|   |               lib.esnext.error.d.ts
|   |               lib.esnext.full.d.ts
|   |               lib.esnext.intl.d.ts
|   |               lib.esnext.sharedmemory.d.ts
|   |               lib.esnext.temporal.d.ts
|   |               lib.esnext.typedarrays.d.ts
|   |               lib.scripthost.d.ts
|   |               lib.webworker.asynciterable.d.ts
|   |               lib.webworker.d.ts
|   |               lib.webworker.importscripts.d.ts
|   |               lib.webworker.iterable.d.ts
|   |               tsc.exe
|   |               
|   +---@vitejs
|   |   \---plugin-vue
|   |       |   LICENSE
|   |       |   package.json
|   |       |   README.md
|   |       |   
|   |       \---dist
|   |               index.d.mts
|   |               index.mjs
|   |               
|   +---@vitest
|   |   +---mocker
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   README.md
|   |   |   |   
|   |   |   \---dist
|   |   |           auto-register.d.ts
|   |   |           auto-register.js
|   |   |           automock.d.ts
|   |   |           automock.js
|   |   |           browser.d.ts
|   |   |           browser.js
|   |   |           chunk-automock.js
|   |   |           chunk-helpers.js
|   |   |           chunk-hoistMocks.js
|   |   |           chunk-interceptor-native.js
|   |   |           chunk-mocker.js
|   |   |           chunk-pathe.M-eThtNZ.js
|   |   |           chunk-registry.js
|   |   |           chunk-utils.js
|   |   |           hoistMocks.d-h98GpQUH.d.ts
|   |   |           index.d-D4wtotQw.d.ts
|   |   |           index.d.ts
|   |   |           index.js
|   |   |           mocker.d-CMHJLkLP.d.ts
|   |   |           node.d.ts
|   |   |           node.js
|   |   |           redirect.d.ts
|   |   |           redirect.js
|   |   |           register.d.ts
|   |   |           register.js
|   |   |           registry.d-xLx_FoyF.d.ts
|   |   |           transforms.d.ts
|   |   |           transforms.js
|   |   |           
|   |   \---spy
|   |       |   LICENSE
|   |       |   optional-types.d.ts
|   |       |   package.json
|   |       |   README.md
|   |       |   
|   |       \---dist
|   |               index.d.ts
|   |               index.js
|   |               
|   +---@vue
|   |   +---compiler-core
|   |   |   |   index.js
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   README.md
|   |   |   |   
|   |   |   +---dist
|   |   |   |       compiler-core.cjs.js
|   |   |   |       compiler-core.cjs.prod.js
|   |   |   |       compiler-core.d.ts
|   |   |   |       compiler-core.esm-bundler.js
|   |   |   |       
|   |   |   \---node_modules
|   |   |       \---estree-walker
|   |   |           |   CHANGELOG.md
|   |   |           |   LICENSE
|   |   |           |   package.json
|   |   |           |   README.md
|   |   |           |   
|   |   |           +---dist
|   |   |           |   +---esm
|   |   |           |   |       estree-walker.js
|   |   |           |   |       package.json
|   |   |           |   |       
|   |   |           |   \---umd
|   |   |           |           estree-walker.js
|   |   |           |           
|   |   |           +---src
|   |   |           |       async.js
|   |   |           |       index.js
|   |   |           |       package.json
|   |   |           |       sync.js
|   |   |           |       walker.js
|   |   |           |       
|   |   |           \---types
|   |   |                   async.d.ts
|   |   |                   index.d.ts
|   |   |                   sync.d.ts
|   |   |                   tsconfig.tsbuildinfo
|   |   |                   walker.d.ts
|   |   |                   
|   |   +---compiler-dom
|   |   |   |   index.js
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   README.md
|   |   |   |   
|   |   |   \---dist
|   |   |           compiler-dom.cjs.js
|   |   |           compiler-dom.cjs.prod.js
|   |   |           compiler-dom.d.ts
|   |   |           compiler-dom.esm-browser.js
|   |   |           compiler-dom.esm-browser.prod.js
|   |   |           compiler-dom.esm-bundler.js
|   |   |           compiler-dom.global.js
|   |   |           compiler-dom.global.prod.js
|   |   |           
|   |   +---compiler-sfc
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   README.md
|   |   |   |   
|   |   |   +---dist
|   |   |   |       compiler-sfc.cjs.js
|   |   |   |       compiler-sfc.d.ts
|   |   |   |       compiler-sfc.esm-browser.js
|   |   |   |       
|   |   |   \---node_modules
|   |   |       +---estree-walker
|   |   |       |   |   CHANGELOG.md
|   |   |       |   |   LICENSE
|   |   |       |   |   package.json
|   |   |       |   |   README.md
|   |   |       |   |   
|   |   |       |   +---dist
|   |   |       |   |   +---esm
|   |   |       |   |   |       estree-walker.js
|   |   |       |   |   |       package.json
|   |   |       |   |   |       
|   |   |       |   |   \---umd
|   |   |       |   |           estree-walker.js
|   |   |       |   |           
|   |   |       |   +---src
|   |   |       |   |       async.js
|   |   |       |   |       index.js
|   |   |       |   |       package.json
|   |   |       |   |       sync.js
|   |   |       |   |       walker.js
|   |   |       |   |       
|   |   |       |   \---types
|   |   |       |           async.d.ts
|   |   |       |           index.d.ts
|   |   |       |           sync.d.ts
|   |   |       |           tsconfig.tsbuildinfo
|   |   |       |           walker.d.ts
|   |   |       |           
|   |   |       \---magic-string
|   |   |           |   LICENSE
|   |   |           |   package.json
|   |   |           |   README.md
|   |   |           |   
|   |   |           \---dist
|   |   |                   magic-string.cjs.d.ts
|   |   |                   magic-string.cjs.js
|   |   |                   magic-string.cjs.js.map
|   |   |                   magic-string.es.d.mts
|   |   |                   magic-string.es.mjs
|   |   |                   magic-string.es.mjs.map
|   |   |                   magic-string.umd.js
|   |   |                   magic-string.umd.js.map
|   |   |                   
|   |   +---compiler-ssr
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   README.md
|   |   |   |   
|   |   |   \---dist
|   |   |           compiler-ssr.cjs.js
|   |   |           compiler-ssr.d.ts
|   |   |           
|   |   +---reactivity
|   |   |   |   index.js
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   README.md
|   |   |   |   
|   |   |   \---dist
|   |   |           reactivity.cjs.js
|   |   |           reactivity.cjs.prod.js
|   |   |           reactivity.d.ts
|   |   |           reactivity.esm-browser.js
|   |   |           reactivity.esm-browser.prod.js
|   |   |           reactivity.esm-bundler.js
|   |   |           reactivity.global.js
|   |   |           reactivity.global.prod.js
|   |   |           
|   |   +---runtime-core
|   |   |   |   index.js
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   README.md
|   |   |   |   
|   |   |   \---dist
|   |   |           runtime-core.cjs.js
|   |   |           runtime-core.cjs.prod.js
|   |   |           runtime-core.d.ts
|   |   |           runtime-core.esm-bundler.js
|   |   |           
|   |   +---runtime-dom
|   |   |   |   index.js
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   README.md
|   |   |   |   
|   |   |   \---dist
|   |   |           runtime-dom.cjs.js
|   |   |           runtime-dom.cjs.prod.js
|   |   |           runtime-dom.d.ts
|   |   |           runtime-dom.esm-browser.js
|   |   |           runtime-dom.esm-browser.prod.js
|   |   |           runtime-dom.esm-bundler.js
|   |   |           runtime-dom.global.js
|   |   |           runtime-dom.global.prod.js
|   |   |           
|   |   +---server-renderer
|   |   |   |   index.js
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   README.md
|   |   |   |   
|   |   |   \---dist
|   |   |           server-renderer.cjs.js
|   |   |           server-renderer.cjs.prod.js
|   |   |           server-renderer.d.ts
|   |   |           server-renderer.esm-browser.js
|   |   |           server-renderer.esm-browser.prod.js
|   |   |           server-renderer.esm-bundler.js
|   |   |           
|   |   \---shared
|   |       |   index.js
|   |       |   LICENSE
|   |       |   package.json
|   |       |   README.md
|   |       |   
|   |       \---dist
|   |               shared.cjs.js
|   |               shared.cjs.prod.js
|   |               shared.d.ts
|   |               shared.esm-bundler.js
|   |               
|   +---@vue-tui
|   |   +---runtime
|   |   |   |   CHANGELOG.md
|   |   |   |   LICENSE
|   |   |   |   package.json
|   |   |   |   README.md
|   |   |   |   THIRD_PARTY_NOTICES.md
|   |   |   |   
|   |   |   +---dist
|   |   |   |   |   hmr-Dink2d1-.d.mts
|   |   |   |   |   hmr-DkwXW6VI.mjs
|   |   |   |   |   index.d.mts
|   |   |   |   |   index.mjs
|   |   |   |   |   inline.d.mts
|   |   |   |   |   inline.mjs
|   |   |   |   |   internal-mount-options-BewKQAyc.mjs
|   |   |   |   |   render-Bfq_buOu.d.mts
|   |   |   |   |   render-DcLsRAlX.mjs
|   |   |   |   |   with-children-BX8-sFPH.d.mts
|   |   |   |   |   
|   |   |   |   \---internal
|   |   |   |           devtools.d.mts
|   |   |   |           devtools.mjs
|   |   |   |           testing.d.mts
|   |   |   |           testing.mjs
|   |   |   |           
|   |   |   \---node_modules
|   |   |       \---chalk
|   |   |           |   license
|   |   |           |   package.json
|   |   |           |   readme.md
|   |   |           |   
|   |   |           \---source
|   |   |               |   index.d.ts
|   |   |               |   index.js
|   |   |               |   utilities.js
|   |   |               |   
|   |   |               \---vendor
|   |   |                   +---ansi-styles
|   |   |                   |       index.d.ts
|   |   |                   |       index.js
|   |   |                   |       
|   |   |                   \---supports-color
|   |   |                           browser.d.ts
|   |   |                           browser.js
|   |   |                           index.d.ts
|   |   |                           index.js
|   |   |                           
|   |   \---vite
|   |       |   CHANGELOG.md
|   |       |   LICENSE
|   |       |   package.json
|   |       |   README.md
|   |       |   
|   |       \---dist
|   |               index.d.mts
|   |               index.mjs
|   |               
|   +---ansi-escapes
|   |       base.d.ts
|   |       base.js
|   |       index.d.ts
|   |       index.js
|   |       license
|   |       package.json
|   |       readme.md
|   |       
|   +---ansi-regex
|   |       index.d.ts
|   |       index.js
|   |       license
|   |       package.json
|   |       readme.md
|   |       
|   +---ansi-styles
|   |       index.d.ts
|   |       index.js
|   |       license
|   |       package.json
|   |       readme.md
|   |       
|   +---assertion-error
|   |       index.d.ts
|   |       index.js
|   |       LICENSE
|   |       package.json
|   |       README.md
|   |       
|   +---chai
|   |       index.js
|   |       LICENSE
|   |       package.json
|   |       README.md
|   |       register-assert.js
|   |       register-expect.js
|   |       register-should.js
|   |       
|   +---chalk
|   |   |   license
|   |   |   package.json
|   |   |   readme.md
|   |   |   
|   |   \---source
|   |       |   index.d.ts
|   |       |   index.js
|   |       |   utilities.js
|   |       |   
|   |       \---vendor
|   |           +---ansi-styles
|   |           |       index.d.ts
|   |           |       index.js
|   |           |       
|   |           \---supports-color
|   |                   browser.d.ts
|   |                   browser.js
|   |                   index.d.ts
|   |                   index.js
|   |                   
|   +---chardet
|   |   |   LICENSE
|   |   |   package.json
|   |   |   README.md
|   |   |   
|   |   \---lib
|   |       |   index.d.ts
|   |       |   index.js
|   |       |   index.js.map
|   |       |   match.d.ts
|   |       |   match.js
|   |       |   match.js.map
|   |       |   utils.d.ts
|   |       |   utils.js
|   |       |   utils.js.map
|   |       |   
|   |       +---encoding
|   |       |       ascii.d.ts
|   |       |       ascii.js
|   |       |       ascii.js.map
|   |       |       index.d.ts
|   |       |       index.js
|   |       |       index.js.map
|   |       |       iso2022.d.ts
|   |       |       iso2022.js
|   |       |       iso2022.js.map
|   |       |       mbcs.d.ts
|   |       |       mbcs.js
|   |       |       mbcs.js.map
|   |       |       sbcs.d.ts
|   |       |       sbcs.js
|   |       |       sbcs.js.map
|   |       |       unicode.d.ts
|   |       |       unicode.js
|   |       |       unicode.js.map
|   |       |       utf8.d.ts
|   |       |       utf8.js
|   |       |       utf8.js.map
|   |       |       
|   |       \---fs
|   |               browser.d.ts
|   |               browser.js
|   |               browser.js.map
|   |               node.d.ts
|   |               node.js
|   |               node.js.map
|   |               
|   +---cli-boxes
|   |       boxes.json
|   |       index.d.ts
|   |       index.js
|   |       license
|   |       package.json
|   |       readme.md
|   |       
|   +---cli-truncate
|   |       index.d.ts
|   |       index.js
|   |       license
|   |       package.json
|   |       readme.md
|   |       
|   +---cli-width
|   |       index.d.ts
|   |       index.js
|   |       LICENSE
|   |       package.json
|   |       README.md
|   |       
|   +---commander
|   |   |   index.js
|   |   |   LICENSE
|   |   |   package-support.json
|   |   |   package.json
|   |   |   Readme.md
|   |   |   
|   |   +---lib
|   |   |       argument.js
|   |   |       command.js
|   |   |       error.js
|   |   |       help.js
|   |   |       option.js
|   |   |       suggestSimilar.js
|   |   |       
|   |   \---typings
|   |           index.d.ts
|   |           
|   +---csstype
|   |       index.d.ts
|   |       index.js.flow
|   |       LICENSE
|   |       package.json
|   |       README.md
|   |       
|   +---detect-libc
|   |   |   index.d.ts
|   |   |   LICENSE
|   |   |   package.json
|   |   |   README.md
|   |   |   
|   |   \---lib
|   |           detect-libc.js
|   |           elf.js
|   |           filesystem.js
|   |           process.js
|   |           
|   +---entities
|   |   |   decode.d.ts
|   |   |   decode.js
|   |   |   escape.d.ts
|   |   |   escape.js
|   |   |   LICENSE
|   |   |   package.json
|   |   |   readme.md
|   |   |   
|   |   +---dist
|   |   |   +---commonjs
|   |   |   |   |   decode-codepoint.d.ts
|   |   |   |   |   decode-codepoint.d.ts.map
|   |   |   |   |   decode-codepoint.js
|   |   |   |   |   decode-codepoint.js.map
|   |   |   |   |   decode.d.ts
|   |   |   |   |   decode.d.ts.map
|   |   |   |   |   decode.js
|   |   |   |   |   decode.js.map
|   |   |   |   |   encode.d.ts
|   |   |   |   |   encode.d.ts.map
|   |   |   |   |   encode.js
|   |   |   |   |   encode.js.map
|   |   |   |   |   escape.d.ts
|   |   |   |   |   escape.d.ts.map
|   |   |   |   |   escape.js
|   |   |   |   |   escape.js.map
|   |   |   |   |   index.d.ts
|   |   |   |   |   index.d.ts.map
|   |   |   |   |   index.js
|   |   |   |   |   index.js.map
|   |   |   |   |   package.json
|   |   |   |   |   
|   |   |   |   +---generated
|   |   |   |   |       decode-data-html.d.ts
|   |   |   |   |       decode-data-html.d.ts.map
|   |   |   |   |       decode-data-html.js
|   |   |   |   |       decode-data-html.js.map
|   |   |   |   |       decode-data-xml.d.ts
|   |   |   |   |       decode-data-xml.d.ts.map
|   |   |   |   |       decode-data-xml.js
|   |   |   |   |       decode-data-xml.js.map
|   |   |   |   |       encode-html.d.ts
|   |   |   |   |       encode-html.d.ts.map
|   |   |   |   |       encode-html.js
|   |   |   |   |       encode-html.js.map
|   |   |   |   |       
|   |   |   |   \---internal
|   |   |   |           bin-trie-flags.d.ts
|   |   |   |           bin-trie-flags.d.ts.map
|   |   |   |           bin-trie-flags.js
|   |   |   |           bin-trie-flags.js.map
|   |   |   |           decode-shared.d.ts
|   |   |   |           decode-shared.d.ts.map
|   |   |   |           decode-shared.js
|   |   |   |           decode-shared.js.map
|   |   |   |           encode-shared.d.ts
|   |   |   |           encode-shared.d.ts.map
|   |   |   |           encode-shared.js
|   |   |   |           encode-shared.js.map
|   |   |   |           
|   |   |   \---esm
|   |   |       |   decode-codepoint.d.ts
|   |   |       |   decode-codepoint.d.ts.map
|   |   |       |   decode-codepoint.js
|   |   |       |   decode-codepoint.js.map
|   |   |       |   decode.d.ts
|   |   |       |   decode.d.ts.map
|   |   |       |   decode.js
|   |   |       |   decode.js.map
|   |   |       |   encode.d.ts
|   |   |       |   encode.d.ts.map
|   |   |       |   encode.js
|   |   |       |   encode.js.map
|   |   |       |   escape.d.ts
|   |   |       |   escape.d.ts.map
|   |   |       |   escape.js
|   |   |       |   escape.js.map
|   |   |       |   index.d.ts
|   |   |       |   index.d.ts.map
|   |   |       |   index.js
|   |   |       |   index.js.map
|   |   |       |   package.json
|   |   |       |   
|   |   |       +---generated
|   |   |       |       decode-data-html.d.ts
|   |   |       |       decode-data-html.d.ts.map
|   |   |       |       decode-data-html.js
|   |   |       |       decode-data-html.js.map
|   |   |       |       decode-data-xml.d.ts
|   |   |       |       decode-data-xml.d.ts.map
|   |   |       |       decode-data-xml.js
|   |   |       |       decode-data-xml.js.map
|   |   |       |       encode-html.d.ts
|   |   |       |       encode-html.d.ts.map
|   |   |       |       encode-html.js
|   |   |       |       encode-html.js.map
|   |   |       |       
|   |   |       \---internal
|   |   |               bin-trie-flags.d.ts
|   |   |               bin-trie-flags.d.ts.map
|   |   |               bin-trie-flags.js
|   |   |               bin-trie-flags.js.map
|   |   |               decode-shared.d.ts
|   |   |               decode-shared.d.ts.map
|   |   |               decode-shared.js
|   |   |               decode-shared.js.map
|   |   |               encode-shared.d.ts
|   |   |               encode-shared.d.ts.map
|   |   |               encode-shared.js
|   |   |               encode-shared.js.map
|   |   |               
|   |   \---src
|   |       |   decode-codepoint.ts
|   |       |   decode.ts
|   |       |   encode.ts
|   |       |   escape.ts
|   |       |   index.ts
|   |       |   
|   |       +---generated
|   |       |       .eslintrc.json
|   |       |       decode-data-html.ts
|   |       |       decode-data-xml.ts
|   |       |       encode-html.ts
|   |       |       
|   |       \---internal
|   |               bin-trie-flags.ts
|   |               decode-shared.ts
|   |               encode-shared.ts
|   |               
|   +---environment
|   |       index.d.ts
|   |       index.js
|   |       license
|   |       package.json
|   |       readme.md
|   |       
|   +---es-module-lexer
|   |   |   lexer.js
|   |   |   LICENSE
|   |   |   package.json
|   |   |   README.md
|   |   |   
|   |   +---dist
|   |   |       lexer.asm.js
|   |   |       lexer.cjs
|   |   |       lexer.js
|   |   |       lexer.minimal.asm.js
|   |   |       lexer.minimal.cjs
|   |   |       lexer.minimal.js
|   |   |       
|   |   \---types
|   |           lexer.d.ts
|   |           lexer.minimal.d.ts
|   |           
|   +---esbuild
|   |   |   install.js
|   |   |   LICENSE.md
|   |   |   package.json
|   |   |   README.md
|   |   |   
|   |   +---bin
|   |   |       esbuild
|   |   |       
|   |   \---lib
|   |           main.d.ts
|   |           main.js
|   |           
|   +---estree-walker
|   |   |   LICENSE
|   |   |   package.json
|   |   |   README.md
|   |   |   
|   |   +---src
|   |   |       async.js
|   |   |       index.js
|   |   |       sync.js
|   |   |       walker.js
|   |   |       
|   |   \---types
|   |           async.d.ts
|   |           index.d.ts
|   |           sync.d.ts
|   |           walker.d.ts
|   |           
|   +---expect-type
|   |   |   LICENSE
|   |   |   package.json
|   |   |   README.md
|   |   |   SECURITY.md
|   |   |   
|   |   \---dist
|   |           branding.d.ts
|   |           branding.js
|   |           index.d.ts
|   |           index.js
|   |           messages.d.ts
|   |           messages.js
|   |           overloads.d.ts
|   |           overloads.js
|   |           utils.d.ts
|   |           utils.js
|   |           
|   +---fast-string-truncated-width
|   |   |   license
|   |   |   package.json
|   |   |   readme.md
|   |   |   
|   |   \---dist
|   |           index.d.ts
|   |           index.js
|   |           types.d.ts
|   |           types.js
|   |           utils.d.ts
|   |           utils.js
|   |           
|   +---fast-string-width
|   |   |   license
|   |   |   package.json
|   |   |   readme.md
|   |   |   
|   |   \---dist
|   |           index.d.ts
|   |           index.js
|   |           
|   +---fast-wrap-ansi
|   |   |   LICENSE
|   |   |   package.json
|   |   |   README.md
|   |   |   
|   |   \---lib
|   |           main.d.ts
|   |           main.js
|   |           
|   +---fdir
|   |   |   LICENSE
|   |   |   package.json
|   |   |   README.md
|   |   |   
|   |   \---dist
|   |           index.cjs
|   |           index.d.cts
|   |           index.d.mts
|   |           index.mjs
|   |           
|   +---get-east-asian-width
|   |       index.d.ts
|   |       index.js
|   |       license
|   |       lookup-data.js
|   |       lookup.js
|   |       package.json
|   |       readme.md
|   |       utilities.js
|   |       
|   +---iconv-lite
|   |   |   LICENSE
|   |   |   package.json
|   |   |   README.md
|   |   |   
|   |   +---encodings
|   |   |   |   dbcs-codec.js
|   |   |   |   dbcs-data.js
|   |   |   |   index.js
|   |   |   |   internal.js
|   |   |   |   sbcs-codec.js
|   |   |   |   sbcs-data-generated.js
|   |   |   |   sbcs-data.js
|   |   |   |   utf16.js
|   |   |   |   utf32.js
|   |   |   |   utf7.js
|   |   |   |   
|   |   |   \---tables
|   |   |           big5-added.json
|   |   |           cp936.json
|   |   |           cp949.json
|   |   |           cp950.json
|   |   |           eucjp.json
|   |   |           gb18030-ranges.json
|   |   |           gbk-added.json
|   |   |           shiftjis.json
|   |   |           
|   |   +---lib
|   |   |   |   bom-handling.js
|   |   |   |   index.d.ts
|   |   |   |   index.js
|   |   |   |   streams.js
|   |   |   |   
|   |   |   \---helpers
|   |   |           merge-exports.js
|   |   |           
|   |   \---types
|   |           encodings.d.ts
|   |           
|   +---inquirer
|   |   |   LICENSE
|   |   |   package.json
|   |   |   README.md
|   |   |   
|   |   \---dist
|   |       |   index.d.ts
|   |       |   index.js
|   |       |   types.d.ts
|   |       |   types.js
|   |       |   
|   |       +---ui
|   |       |       prompt.d.ts
|   |       |       prompt.js
|   |       |       
|   |       \---utils
|   |               observable.d.ts
|   |               observable.js
|   |               
|   +---is-fullwidth-code-point
|   |       index.d.ts
|   |       index.js
|   |       license
|   |       package.json
|   |       readme.md
|   |       
|   +---lightningcss
|   |   |   LICENSE
|   |   |   package.json
|   |   |   README.md
|   |   |   
|   |   \---node
|   |           ast.d.ts
|   |           ast.js.flow
|   |           browserslistToTargets.js
|   |           composeVisitors.js
|   |           flags.js
|   |           index.d.ts
|   |           index.js
|   |           index.js.flow
|   |           index.mjs
|   |           targets.d.ts
|   |           targets.js.flow
|   |           
|   +---lightningcss-win32-x64-msvc
|   |       LICENSE
|   |       lightningcss.win32-x64-msvc.node
|   |       package.json
|   |       README.md
|   |       
|   +---magic-string
|   |   |   LICENSE
|   |   |   package.json
|   |   |   README.md
|   |   |   
|   |   \---dist
|   |           index.d.mts
|   |           index.mjs
|   |           
|   +---mute-stream
|   |   |   LICENSE
|   |   |   package.json
|   |   |   README.md
|   |   |   
|   |   \---lib
|   |           index.js
|   |           
|   +---nanoid
|   |   |   index.browser.cjs
|   |   |   index.browser.js
|   |   |   index.cjs
|   |   |   index.d.cts
|   |   |   index.d.ts
|   |   |   index.js
|   |   |   LICENSE
|   |   |   nanoid.js
|   |   |   package.json
|   |   |   README.md
|   |   |   
|   |   +---async
|   |   |       index.browser.cjs
|   |   |       index.browser.js
|   |   |       index.cjs
|   |   |       index.d.ts
|   |   |       index.js
|   |   |       index.native.js
|   |   |       package.json
|   |   |       
|   |   +---bin
|   |   |       nanoid.cjs
|   |   |       
|   |   +---non-secure
|   |   |       index.cjs
|   |   |       index.d.ts
|   |   |       index.js
|   |   |       package.json
|   |   |       
|   |   \---url-alphabet
|   |           index.cjs
|   |           index.js
|   |           package.json
|   |           
|   +---obug
|   |   |   LICENSE
|   |   |   package.json
|   |   |   README.md
|   |   |   
|   |   \---dist
|   |           ansi.d.ts
|   |           ansi.js
|   |           browser.d.ts
|   |           browser.js
|   |           browser.min.js
|   |           core.d.ts
|   |           core.js
|   |           plain.d.ts
|   |           plain.js
|   |           
|   +---patch-console
|   |   |   license
|   |   |   package.json
|   |   |   readme.md
|   |   |   
|   |   \---dist
|   |           index.d.ts
|   |           index.js
|   |           index.js.map
|   |           
|   +---picocolors
|   |       LICENSE
|   |       package.json
|   |       picocolors.browser.js
|   |       picocolors.d.ts
|   |       picocolors.js
|   |       README.md
|   |       types.d.ts
|   |       
|   +---picomatch
|   |   |   index.js
|   |   |   LICENSE
|   |   |   package.json
|   |   |   posix.js
|   |   |   README.md
|   |   |   
|   |   \---lib
|   |           constants.js
|   |           parse.js
|   |           picomatch.js
|   |           scan.js
|   |           utils.js
|   |           
|   +---postcss
|   |   |   LICENSE
|   |   |   package.json
|   |   |   README.md
|   |   |   
|   |   \---lib
|   |           at-rule.d.ts
|   |           at-rule.js
|   |           comment.d.ts
|   |           comment.js
|   |           container.d.ts
|   |           container.js
|   |           css-syntax-error.d.ts
|   |           css-syntax-error.js
|   |           declaration.d.ts
|   |           declaration.js
|   |           document.d.ts
|   |           document.js
|   |           fromJSON.d.ts
|   |           fromJSON.js
|   |           input.d.ts
|   |           input.js
|   |           lazy-result.d.ts
|   |           lazy-result.js
|   |           list.d.ts
|   |           list.js
|   |           map-generator.js
|   |           no-work-result.d.ts
|   |           no-work-result.js
|   |           node.d.ts
|   |           node.js
|   |           parse.d.ts
|   |           parse.js
|   |           parser.js
|   |           postcss.d.mts
|   |           postcss.d.ts
|   |           postcss.js
|   |           postcss.mjs
|   |           previous-map.d.ts
|   |           previous-map.js
|   |           processor.d.ts
|   |           processor.js
|   |           result.d.ts
|   |           result.js
|   |           root.d.ts
|   |           root.js
|   |           rule.d.ts
|   |           rule.js
|   |           stringifier.d.ts
|   |           stringifier.js
|   |           stringify.d.ts
|   |           stringify.js
|   |           symbols.js
|   |           terminal-highlight.js
|   |           tokenize.js
|   |           warn-once.js
|   |           warning.d.ts
|   |           warning.js
|   |           
|   +---rolldown
|   |   |   LICENSE
|   |   |   package.json
|   |   |   README.md
|   |   |   THIRD-PARTY-LICENSE
|   |   |   
|   |   +---bin
|   |   |       cli.mjs
|   |   |       
|   |   \---dist
|   |       |   cli.d.mts
|   |       |   cli.mjs
|   |       |   config.d.mts
|   |       |   config.mjs
|   |       |   experimental-default-runtime.mjs
|   |       |   experimental-index.d.mts
|   |       |   experimental-index.mjs
|   |       |   experimental-runtime-base.mjs
|   |       |   experimental-runtime-types.d.ts
|   |       |   experimental-runtime.d.ts
|   |       |   experimental-runtime.mjs
|   |       |   filter-index.d.mts
|   |       |   filter-index.mjs
|   |       |   get-log-filter.d.mts
|   |       |   get-log-filter.mjs
|   |       |   index.d.mts
|   |       |   index.mjs
|   |       |   parallel-plugin-worker.d.mts
|   |       |   parallel-plugin-worker.mjs
|   |       |   parallel-plugin.d.mts
|   |       |   parallel-plugin.mjs
|   |       |   parse-ast-index.d.mts
|   |       |   parse-ast-index.mjs
|   |       |   plugins-index.d.mts
|   |       |   plugins-index.mjs
|   |       |   utils-index.d.mts
|   |       |   utils-index.mjs
|   |       |   
|   |       \---shared
|   |               binding-BbrDfv1x.mjs
|   |               binding-BTa6BPQe.d.mts
|   |               bindingify-input-options-D4l624og.mjs
|   |               constructors-CmDKpWIU.d.mts
|   |               constructors-D9jwEbE4.mjs
|   |               create-bundler-option-DJpvtSqr.mjs
|   |               define-config-BFdLpVut.d.mts
|   |               define-config-Demdg3_4.mjs
|   |               dist-DKbukT1H.mjs
|   |               error-CGhV1ebk.mjs
|   |               get-log-filter-AjBknEEO.d.mts
|   |               load-config-qRezutA0.mjs
|   |               logging-xuHO4mAy.d.mts
|   |               logs-DmYCAKcW.mjs
|   |               misc-DOSKtd97.mjs
|   |               normalize-string-or-regex-zc1bUto6.mjs
|   |               parse-DltPb1DL.mjs
|   |               prompt-CH6TK0bC.mjs
|   |               resolve-tsconfig-Bf6oL9fm.mjs
|   |               rolldown-Ld3ZGGCt.mjs
|   |               transform-DK_nCt9j.d.mts
|   |               watch-BDSxrMiV.mjs
|   |               
|   +---run-async
|   |       index.d.ts
|   |       index.js
|   |       LICENSE
|   |       package.json
|   |       README.md
|   |       
|   +---safer-buffer
|   |       dangerous.js
|   |       LICENSE
|   |       package.json
|   |       Porting-Buffer.md
|   |       Readme.md
|   |       safer.js
|   |       tests.js
|   |       
|   +---siginfo
|   |       .travis.yml
|   |       index.js
|   |       LICENSE
|   |       package.json
|   |       README.md
|   |       test.js
|   |       
|   +---signal-exit
|   |   |   LICENSE.txt
|   |   |   package.json
|   |   |   README.md
|   |   |   
|   |   \---dist
|   |       +---cjs
|   |       |       browser.d.ts
|   |       |       browser.d.ts.map
|   |       |       browser.js
|   |       |       browser.js.map
|   |       |       index.d.ts
|   |       |       index.d.ts.map
|   |       |       index.js
|   |       |       index.js.map
|   |       |       package.json
|   |       |       signals.d.ts
|   |       |       signals.d.ts.map
|   |       |       signals.js
|   |       |       signals.js.map
|   |       |       
|   |       \---mjs
|   |               browser.d.ts
|   |               browser.d.ts.map
|   |               browser.js
|   |               browser.js.map
|   |               index.d.ts
|   |               index.d.ts.map
|   |               index.js
|   |               index.js.map
|   |               package.json
|   |               signals.d.ts
|   |               signals.d.ts.map
|   |               signals.js
|   |               signals.js.map
|   |               
|   +---slice-ansi
|   |       index.d.ts
|   |       index.js
|   |       license
|   |       package.json
|   |       readme.md
|   |       tokenize-ansi.js
|   |       
|   +---source-map-js
|   |   |   LICENSE
|   |   |   package.json
|   |   |   README.md
|   |   |   source-map.d.ts
|   |   |   source-map.js
|   |   |   
|   |   \---lib
|   |           array-set.js
|   |           base64-vlq.js
|   |           base64.js
|   |           binary-search.js
|   |           mapping-list.js
|   |           quick-sort.js
|   |           source-map-consumer.d.ts
|   |           source-map-consumer.js
|   |           source-map-generator.d.ts
|   |           source-map-generator.js
|   |           source-node.d.ts
|   |           source-node.js
|   |           util.js
|   |           
|   +---stackback
|   |       .npmignore
|   |       .travis.yml
|   |       formatstack.js
|   |       index.js
|   |       package.json
|   |       README.md
|   |       test.js
|   |       
|   +---std-env
|   |   |   LICENCE
|   |   |   package.json
|   |   |   README.md
|   |   |   
|   |   \---dist
|   |           index.d.mts
|   |           index.mjs
|   |           
|   +---string-width
|   |       index.d.ts
|   |       index.js
|   |       license
|   |       package.json
|   |       readme.md
|   |       
|   +---strip-ansi
|   |       index.d.ts
|   |       index.js
|   |       license
|   |       package.json
|   |       readme.md
|   |       
|   +---tinybench
|   |   |   LICENSE
|   |   |   package.json
|   |   |   README.md
|   |   |   
|   |   \---dist
|   |           index.d.ts
|   |           index.js
|   |           
|   +---tinyexec
|   |   |   LICENSE
|   |   |   package.json
|   |   |   README.md
|   |   |   
|   |   \---dist
|   |           main.d.mts
|   |           main.mjs
|   |           
|   +---tinyglobby
|   |   |   LICENSE
|   |   |   package.json
|   |   |   README.md
|   |   |   
|   |   \---dist
|   |           index.cjs
|   |           index.d.cts
|   |           index.d.mts
|   |           index.mjs
|   |           
|   +---tsx
|   |   |   LICENSE
|   |   |   package.json
|   |   |   README.md
|   |   |   
|   |   \---dist
|   |       |   cli.mjs
|   |       |   client-XItNFmsq.cjs
|   |       |   index-Bqjv9TxC.mjs
|   |       |   index-DE3OBZuV.mjs
|   |       |   lexer-CanA6ArK.mjs
|   |       |   lexer-CGfpMDSb.cjs
|   |       |   loader.mjs
|   |       |   package-Dj0mHsMt.mjs
|   |       |   patch-repl.cjs
|   |       |   preflight.cjs
|   |       |   register-B1c7OH6V.cjs
|   |       |   register-nyXW-TH3.mjs
|   |       |   repl.mjs
|   |       |   require-CBjy4Foe.mjs
|   |       |   require-CVaYn9z3.cjs
|   |       |   suppress-warnings.cjs
|   |       |   temporary-directory-Du7LpLp9.mjs
|   |       |   
|   |       +---cjs
|   |       |   |   index.cjs
|   |       |   |   
|   |       |   \---api
|   |       |           index.cjs
|   |       |           index.d.cts
|   |       |           index.d.mts
|   |       |           index.mjs
|   |       |           
|   |       \---esm
|   |           |   index.mjs
|   |           |   
|   |           \---api
|   |                   index.cjs
|   |                   index.d.cts
|   |                   index.d.mts
|   |                   index.mjs
|   |                   
|   +---typescript
|   |   |   LICENSE
|   |   |   NOTICE.txt
|   |   |   package.json
|   |   |   README.md
|   |   |   
|   |   +---bin
|   |   |       tsc
|   |   |       
|   |   +---dist
|   |   |   +---api
|   |   |   |   |   compilerOptions.d.ts
|   |   |   |   |   compilerOptions.d.ts.map
|   |   |   |   |   compilerOptions.js
|   |   |   |   |   compilerOptions.js.map
|   |   |   |   |   fs.d.ts
|   |   |   |   |   fs.d.ts.map
|   |   |   |   |   fs.js
|   |   |   |   |   fs.js.map
|   |   |   |   |   options.d.ts
|   |   |   |   |   options.d.ts.map
|   |   |   |   |   options.js
|   |   |   |   |   options.js.map
|   |   |   |   |   path.d.ts
|   |   |   |   |   path.d.ts.map
|   |   |   |   |   path.js
|   |   |   |   |   path.js.map
|   |   |   |   |   proto.d.ts
|   |   |   |   |   proto.d.ts.map
|   |   |   |   |   proto.js
|   |   |   |   |   proto.js.map
|   |   |   |   |   sourceFileCache.d.ts
|   |   |   |   |   sourceFileCache.d.ts.map
|   |   |   |   |   sourceFileCache.js
|   |   |   |   |   sourceFileCache.js.map
|   |   |   |   |   syncChannel.d.ts
|   |   |   |   |   syncChannel.d.ts.map
|   |   |   |   |   syncChannel.js
|   |   |   |   |   syncChannel.js.map
|   |   |   |   |   timing.d.ts
|   |   |   |   |   timing.d.ts.map
|   |   |   |   |   timing.js
|   |   |   |   |   timing.js.map
|   |   |   |   |   
|   |   |   |   +---async
|   |   |   |   |       api.d.ts
|   |   |   |   |       api.d.ts.map
|   |   |   |   |       api.js
|   |   |   |   |       api.js.map
|   |   |   |   |       client.d.ts
|   |   |   |   |       client.d.ts.map
|   |   |   |   |       client.js
|   |   |   |   |       client.js.map
|   |   |   |   |       types.d.ts
|   |   |   |   |       types.d.ts.map
|   |   |   |   |       types.js
|   |   |   |   |       types.js.map
|   |   |   |   |       
|   |   |   |   +---node
|   |   |   |   |       encoder.d.ts
|   |   |   |   |       encoder.d.ts.map
|   |   |   |   |       encoder.generated.d.ts
|   |   |   |   |       encoder.generated.d.ts.map
|   |   |   |   |       encoder.generated.js
|   |   |   |   |       encoder.generated.js.map
|   |   |   |   |       encoder.js
|   |   |   |   |       encoder.js.map
|   |   |   |   |       msgpack.d.ts
|   |   |   |   |       msgpack.d.ts.map
|   |   |   |   |       msgpack.js
|   |   |   |   |       msgpack.js.map
|   |   |   |   |       node.d.ts
|   |   |   |   |       node.d.ts.map
|   |   |   |   |       node.generated.d.ts
|   |   |   |   |       node.generated.d.ts.map
|   |   |   |   |       node.generated.js
|   |   |   |   |       node.generated.js.map
|   |   |   |   |       node.infrastructure.d.ts
|   |   |   |   |       node.infrastructure.d.ts.map
|   |   |   |   |       node.infrastructure.js
|   |   |   |   |       node.infrastructure.js.map
|   |   |   |   |       node.js
|   |   |   |   |       node.js.map
|   |   |   |   |       protocol.d.ts
|   |   |   |   |       protocol.d.ts.map
|   |   |   |   |       protocol.generated.d.ts
|   |   |   |   |       protocol.generated.d.ts.map
|   |   |   |   |       protocol.generated.js
|   |   |   |   |       protocol.generated.js.map
|   |   |   |   |       protocol.js
|   |   |   |   |       protocol.js.map
|   |   |   |   |       wtf8.d.ts
|   |   |   |   |       wtf8.d.ts.map
|   |   |   |   |       wtf8.js
|   |   |   |   |       wtf8.js.map
|   |   |   |   |       
|   |   |   |   \---sync
|   |   |   |           api.d.ts
|   |   |   |           api.d.ts.map
|   |   |   |           api.js
|   |   |   |           api.js.map
|   |   |   |           client.d.ts
|   |   |   |           client.d.ts.map
|   |   |   |           client.js
|   |   |   |           client.js.map
|   |   |   |           types.d.ts
|   |   |   |           types.d.ts.map
|   |   |   |           types.js
|   |   |   |           types.js.map
|   |   |   |           
|   |   |   +---ast
|   |   |   |       ast.d.ts
|   |   |   |       ast.d.ts.map
|   |   |   |       ast.generated.d.ts
|   |   |   |       ast.generated.d.ts.map
|   |   |   |       ast.generated.js
|   |   |   |       ast.generated.js.map
|   |   |   |       ast.js
|   |   |   |       ast.js.map
|   |   |   |       astnav.d.ts
|   |   |   |       astnav.d.ts.map
|   |   |   |       astnav.js
|   |   |   |       astnav.js.map
|   |   |   |       clone.d.ts
|   |   |   |       clone.d.ts.map
|   |   |   |       clone.js
|   |   |   |       clone.js.map
|   |   |   |       factory.generated.d.ts
|   |   |   |       factory.generated.d.ts.map
|   |   |   |       factory.generated.js
|   |   |   |       factory.generated.js.map
|   |   |   |       index.d.ts
|   |   |   |       index.d.ts.map
|   |   |   |       index.js
|   |   |   |       index.js.map
|   |   |   |       is.d.ts
|   |   |   |       is.d.ts.map
|   |   |   |       is.generated.d.ts
|   |   |   |       is.generated.d.ts.map
|   |   |   |       is.generated.js
|   |   |   |       is.generated.js.map
|   |   |   |       is.js
|   |   |   |       is.js.map
|   |   |   |       jsdoc.d.ts
|   |   |   |       jsdoc.d.ts.map
|   |   |   |       jsdoc.js
|   |   |   |       jsdoc.js.map
|   |   |   |       scanner.d.ts
|   |   |   |       scanner.d.ts.map
|   |   |   |       scanner.js
|   |   |   |       scanner.js.map
|   |   |   |       utils.d.ts
|   |   |   |       utils.d.ts.map
|   |   |   |       utils.js
|   |   |   |       utils.js.map
|   |   |   |       visitor.d.ts
|   |   |   |       visitor.d.ts.map
|   |   |   |       visitor.generated.d.ts
|   |   |   |       visitor.generated.d.ts.map
|   |   |   |       visitor.generated.js
|   |   |   |       visitor.generated.js.map
|   |   |   |       visitor.js
|   |   |   |       visitor.js.map
|   |   |   |       
|   |   |   +---enums
|   |   |   |       characterCodes.d.ts
|   |   |   |       characterCodes.d.ts.map
|   |   |   |       characterCodes.enum.d.ts
|   |   |   |       characterCodes.enum.d.ts.map
|   |   |   |       characterCodes.enum.js
|   |   |   |       characterCodes.enum.js.map
|   |   |   |       characterCodes.js
|   |   |   |       characterCodes.js.map
|   |   |   |       commentDirectiveType.d.ts
|   |   |   |       commentDirectiveType.d.ts.map
|   |   |   |       commentDirectiveType.enum.d.ts
|   |   |   |       commentDirectiveType.enum.d.ts.map
|   |   |   |       commentDirectiveType.enum.js
|   |   |   |       commentDirectiveType.enum.js.map
|   |   |   |       commentDirectiveType.js
|   |   |   |       commentDirectiveType.js.map
|   |   |   |       completionItemKind.d.ts
|   |   |   |       completionItemKind.d.ts.map
|   |   |   |       completionItemKind.enum.d.ts
|   |   |   |       completionItemKind.enum.d.ts.map
|   |   |   |       completionItemKind.enum.js
|   |   |   |       completionItemKind.enum.js.map
|   |   |   |       completionItemKind.js
|   |   |   |       completionItemKind.js.map
|   |   |   |       diagnosticCategory.d.ts
|   |   |   |       diagnosticCategory.d.ts.map
|   |   |   |       diagnosticCategory.enum.d.ts
|   |   |   |       diagnosticCategory.enum.d.ts.map
|   |   |   |       diagnosticCategory.enum.js
|   |   |   |       diagnosticCategory.enum.js.map
|   |   |   |       diagnosticCategory.js
|   |   |   |       diagnosticCategory.js.map
|   |   |   |       elementFlags.d.ts
|   |   |   |       elementFlags.d.ts.map
|   |   |   |       elementFlags.enum.d.ts
|   |   |   |       elementFlags.enum.d.ts.map
|   |   |   |       elementFlags.enum.js
|   |   |   |       elementFlags.enum.js.map
|   |   |   |       elementFlags.js
|   |   |   |       elementFlags.js.map
|   |   |   |       internalSymbolName.d.ts
|   |   |   |       internalSymbolName.d.ts.map
|   |   |   |       internalSymbolName.enum.d.ts
|   |   |   |       internalSymbolName.enum.d.ts.map
|   |   |   |       internalSymbolName.enum.js
|   |   |   |       internalSymbolName.enum.js.map
|   |   |   |       internalSymbolName.js
|   |   |   |       internalSymbolName.js.map
|   |   |   |       jsxEmit.d.ts
|   |   |   |       jsxEmit.d.ts.map
|   |   |   |       jsxEmit.enum.d.ts
|   |   |   |       jsxEmit.enum.d.ts.map
|   |   |   |       jsxEmit.enum.js
|   |   |   |       jsxEmit.enum.js.map
|   |   |   |       jsxEmit.js
|   |   |   |       jsxEmit.js.map
|   |   |   |       languageVariant.d.ts
|   |   |   |       languageVariant.d.ts.map
|   |   |   |       languageVariant.enum.d.ts
|   |   |   |       languageVariant.enum.d.ts.map
|   |   |   |       languageVariant.enum.js
|   |   |   |       languageVariant.enum.js.map
|   |   |   |       languageVariant.js
|   |   |   |       languageVariant.js.map
|   |   |   |       modifierFlags.d.ts
|   |   |   |       modifierFlags.d.ts.map
|   |   |   |       modifierFlags.enum.d.ts
|   |   |   |       modifierFlags.enum.d.ts.map
|   |   |   |       modifierFlags.enum.js
|   |   |   |       modifierFlags.enum.js.map
|   |   |   |       modifierFlags.js
|   |   |   |       modifierFlags.js.map
|   |   |   |       moduleDetectionKind.d.ts
|   |   |   |       moduleDetectionKind.d.ts.map
|   |   |   |       moduleDetectionKind.enum.d.ts
|   |   |   |       moduleDetectionKind.enum.d.ts.map
|   |   |   |       moduleDetectionKind.enum.js
|   |   |   |       moduleDetectionKind.enum.js.map
|   |   |   |       moduleDetectionKind.js
|   |   |   |       moduleDetectionKind.js.map
|   |   |   |       moduleKind.d.ts
|   |   |   |       moduleKind.d.ts.map
|   |   |   |       moduleKind.enum.d.ts
|   |   |   |       moduleKind.enum.d.ts.map
|   |   |   |       moduleKind.enum.js
|   |   |   |       moduleKind.enum.js.map
|   |   |   |       moduleKind.js
|   |   |   |       moduleKind.js.map
|   |   |   |       moduleResolutionKind.d.ts
|   |   |   |       moduleResolutionKind.d.ts.map
|   |   |   |       moduleResolutionKind.enum.d.ts
|   |   |   |       moduleResolutionKind.enum.d.ts.map
|   |   |   |       moduleResolutionKind.enum.js
|   |   |   |       moduleResolutionKind.enum.js.map
|   |   |   |       moduleResolutionKind.js
|   |   |   |       moduleResolutionKind.js.map
|   |   |   |       newLineKind.d.ts
|   |   |   |       newLineKind.d.ts.map
|   |   |   |       newLineKind.enum.d.ts
|   |   |   |       newLineKind.enum.d.ts.map
|   |   |   |       newLineKind.enum.js
|   |   |   |       newLineKind.enum.js.map
|   |   |   |       newLineKind.js
|   |   |   |       newLineKind.js.map
|   |   |   |       nodeBuilderFlags.d.ts
|   |   |   |       nodeBuilderFlags.d.ts.map
|   |   |   |       nodeBuilderFlags.enum.d.ts
|   |   |   |       nodeBuilderFlags.enum.d.ts.map
|   |   |   |       nodeBuilderFlags.enum.js
|   |   |   |       nodeBuilderFlags.enum.js.map
|   |   |   |       nodeBuilderFlags.js
|   |   |   |       nodeBuilderFlags.js.map
|   |   |   |       nodeFlags.d.ts
|   |   |   |       nodeFlags.d.ts.map
|   |   |   |       nodeFlags.enum.d.ts
|   |   |   |       nodeFlags.enum.d.ts.map
|   |   |   |       nodeFlags.enum.js
|   |   |   |       nodeFlags.enum.js.map
|   |   |   |       nodeFlags.js
|   |   |   |       nodeFlags.js.map
|   |   |   |       objectFlags.d.ts
|   |   |   |       objectFlags.d.ts.map
|   |   |   |       objectFlags.enum.d.ts
|   |   |   |       objectFlags.enum.d.ts.map
|   |   |   |       objectFlags.enum.js
|   |   |   |       objectFlags.enum.js.map
|   |   |   |       objectFlags.js
|   |   |   |       objectFlags.js.map
|   |   |   |       outerExpressionKinds.d.ts
|   |   |   |       outerExpressionKinds.d.ts.map
|   |   |   |       outerExpressionKinds.enum.d.ts
|   |   |   |       outerExpressionKinds.enum.d.ts.map
|   |   |   |       outerExpressionKinds.enum.js
|   |   |   |       outerExpressionKinds.enum.js.map
|   |   |   |       outerExpressionKinds.js
|   |   |   |       outerExpressionKinds.js.map
|   |   |   |       regularExpressionFlags.d.ts
|   |   |   |       regularExpressionFlags.d.ts.map
|   |   |   |       regularExpressionFlags.enum.d.ts
|   |   |   |       regularExpressionFlags.enum.d.ts.map
|   |   |   |       regularExpressionFlags.enum.js
|   |   |   |       regularExpressionFlags.enum.js.map
|   |   |   |       regularExpressionFlags.js
|   |   |   |       regularExpressionFlags.js.map
|   |   |   |       scriptKind.d.ts
|   |   |   |       scriptKind.d.ts.map
|   |   |   |       scriptKind.enum.d.ts
|   |   |   |       scriptKind.enum.d.ts.map
|   |   |   |       scriptKind.enum.js
|   |   |   |       scriptKind.enum.js.map
|   |   |   |       scriptKind.js
|   |   |   |       scriptKind.js.map
|   |   |   |       scriptTarget.d.ts
|   |   |   |       scriptTarget.d.ts.map
|   |   |   |       scriptTarget.enum.d.ts
|   |   |   |       scriptTarget.enum.d.ts.map
|   |   |   |       scriptTarget.enum.js
|   |   |   |       scriptTarget.enum.js.map
|   |   |   |       scriptTarget.js
|   |   |   |       scriptTarget.js.map
|   |   |   |       signatureFlags.d.ts
|   |   |   |       signatureFlags.d.ts.map
|   |   |   |       signatureFlags.enum.d.ts
|   |   |   |       signatureFlags.enum.d.ts.map
|   |   |   |       signatureFlags.enum.js
|   |   |   |       signatureFlags.enum.js.map
|   |   |   |       signatureFlags.js
|   |   |   |       signatureFlags.js.map
|   |   |   |       signatureKind.d.ts
|   |   |   |       signatureKind.d.ts.map
|   |   |   |       signatureKind.enum.d.ts
|   |   |   |       signatureKind.enum.d.ts.map
|   |   |   |       signatureKind.enum.js
|   |   |   |       signatureKind.enum.js.map
|   |   |   |       signatureKind.js
|   |   |   |       signatureKind.js.map
|   |   |   |       symbolFlags.d.ts
|   |   |   |       symbolFlags.d.ts.map
|   |   |   |       symbolFlags.enum.d.ts
|   |   |   |       symbolFlags.enum.d.ts.map
|   |   |   |       symbolFlags.enum.js
|   |   |   |       symbolFlags.enum.js.map
|   |   |   |       symbolFlags.js
|   |   |   |       symbolFlags.js.map
|   |   |   |       syntaxKind.d.ts
|   |   |   |       syntaxKind.d.ts.map
|   |   |   |       syntaxKind.enum.d.ts
|   |   |   |       syntaxKind.enum.d.ts.map
|   |   |   |       syntaxKind.enum.js
|   |   |   |       syntaxKind.enum.js.map
|   |   |   |       syntaxKind.js
|   |   |   |       syntaxKind.js.map
|   |   |   |       tokenFlags.d.ts
|   |   |   |       tokenFlags.d.ts.map
|   |   |   |       tokenFlags.enum.d.ts
|   |   |   |       tokenFlags.enum.d.ts.map
|   |   |   |       tokenFlags.enum.js
|   |   |   |       tokenFlags.enum.js.map
|   |   |   |       tokenFlags.js
|   |   |   |       tokenFlags.js.map
|   |   |   |       typeFlags.d.ts
|   |   |   |       typeFlags.d.ts.map
|   |   |   |       typeFlags.enum.d.ts
|   |   |   |       typeFlags.enum.d.ts.map
|   |   |   |       typeFlags.enum.js
|   |   |   |       typeFlags.enum.js.map
|   |   |   |       typeFlags.js
|   |   |   |       typeFlags.js.map
|   |   |   |       typePredicateKind.d.ts
|   |   |   |       typePredicateKind.d.ts.map
|   |   |   |       typePredicateKind.enum.d.ts
|   |   |   |       typePredicateKind.enum.d.ts.map
|   |   |   |       typePredicateKind.enum.js
|   |   |   |       typePredicateKind.enum.js.map
|   |   |   |       typePredicateKind.js
|   |   |   |       typePredicateKind.js.map
|   |   |   |       
|   |   |   \---internal
|   |   |           utils.d.ts
|   |   |           utils.d.ts.map
|   |   |           utils.js
|   |   |           utils.js.map
|   |   |           
|   |   +---lib
|   |   |       getExePath.d.ts
|   |   |       getExePath.js
|   |   |       tsc.js
|   |   |       version.cjs
|   |   |       version.d.cts
|   |   |       
|   |   \---vendor
|   |       \---vscode-jsonrpc
|   |           |   License.txt
|   |           |   package.json
|   |           |   README.md
|   |           |   
|   |           +---lib
|   |           |   +---browser
|   |           |   |       main.d.ts
|   |           |   |       main.js
|   |           |   |       ril.d.ts
|   |           |   |       ril.js
|   |           |   |       
|   |           |   +---common
|   |           |   |       api.d.ts
|   |           |   |       api.js
|   |           |   |       cancellation.d.ts
|   |           |   |       cancellation.js
|   |           |   |       connection.d.ts
|   |           |   |       connection.js
|   |           |   |       disposable.d.ts
|   |           |   |       disposable.js
|   |           |   |       encoding.d.ts
|   |           |   |       encoding.js
|   |           |   |       events.d.ts
|   |           |   |       events.js
|   |           |   |       is.d.ts
|   |           |   |       is.js
|   |           |   |       linkedMap.d.ts
|   |           |   |       linkedMap.js
|   |           |   |       messageBuffer.d.ts
|   |           |   |       messageBuffer.js
|   |           |   |       messageReader.d.ts
|   |           |   |       messageReader.js
|   |           |   |       messages.d.ts
|   |           |   |       messages.js
|   |           |   |       messageWriter.d.ts
|   |           |   |       messageWriter.js
|   |           |   |       ral.d.ts
|   |           |   |       ral.js
|   |           |   |       semaphore.d.ts
|   |           |   |       semaphore.js
|   |           |   |       sharedArrayCancellation.d.ts
|   |           |   |       sharedArrayCancellation.js
|   |           |   |       
|   |           |   \---node
|   |           |           main.d.ts
|   |           |           main.js
|   |           |           ril.d.ts
|   |           |           ril.js
|   |           |           
|   |           \---typings
|   |                   thenable.d.ts
|   |                   
|   +---undici-types
|   |       agent.d.ts
|   |       api.d.ts
|   |       balanced-pool.d.ts
|   |       cache.d.ts
|   |       client.d.ts
|   |       connector.d.ts
|   |       content-type.d.ts
|   |       cookies.d.ts
|   |       diagnostics-channel.d.ts
|   |       dispatcher.d.ts
|   |       env-http-proxy-agent.d.ts
|   |       errors.d.ts
|   |       eventsource.d.ts
|   |       fetch.d.ts
|   |       file.d.ts
|   |       filereader.d.ts
|   |       formdata.d.ts
|   |       global-dispatcher.d.ts
|   |       global-origin.d.ts
|   |       handlers.d.ts
|   |       header.d.ts
|   |       index.d.ts
|   |       interceptors.d.ts
|   |       LICENSE
|   |       mock-agent.d.ts
|   |       mock-client.d.ts
|   |       mock-errors.d.ts
|   |       mock-interceptor.d.ts
|   |       mock-pool.d.ts
|   |       package.json
|   |       patch.d.ts
|   |       pool-stats.d.ts
|   |       pool.d.ts
|   |       proxy-agent.d.ts
|   |       readable.d.ts
|   |       README.md
|   |       retry-agent.d.ts
|   |       retry-handler.d.ts
|   |       util.d.ts
|   |       webidl.d.ts
|   |       websocket.d.ts
|   |       
|   +---vite
|   |   |   client.d.ts
|   |   |   LICENSE.md
|   |   |   package.json
|   |   |   README.md
|   |   |   
|   |   +---bin
|   |   |       openChrome.js
|   |   |       vite.js
|   |   |       
|   |   +---dist
|   |   |   +---client
|   |   |   |       bundledDevClient.mjs
|   |   |   |       client.mjs
|   |   |   |       env.mjs
|   |   |   |       
|   |   |   \---node
|   |   |       |   cli.js
|   |   |       |   index.d.ts
|   |   |       |   index.js
|   |   |       |   internal.d.ts
|   |   |       |   internal.js
|   |   |       |   module-runner.d.ts
|   |   |       |   module-runner.js
|   |   |       |   
|   |   |       \---chunks
|   |   |               build.js
|   |   |               dist.js
|   |   |               lib.js
|   |   |               moduleRunnerTransport.d.ts
|   |   |               node.js
|   |   |               postcss-import.js
|   |   |               
|   |   +---misc
|   |   |       false.js
|   |   |       true.js
|   |   |       
|   |   \---types
|   |       |   customEvent.d.ts
|   |       |   hmrPayload.d.ts
|   |       |   hot.d.ts
|   |       |   import-meta.d.ts
|   |       |   importGlob.d.ts
|   |       |   importMeta.d.ts
|   |       |   metadata.d.ts
|   |       |   
|   |       \---internal
|   |               cssPreprocessorOptions.d.ts
|   |               esbuildOptions.d.ts
|   |               lightningcssOptions.d.ts
|   |               rollupTypeCompat.d.ts
|   |               terserOptions.d.ts
|   |               
|   +---vitest
|   |   |   config.d.ts
|   |   |   coverage.d.ts
|   |   |   environments.d.ts
|   |   |   globals.d.ts
|   |   |   import-meta.d.ts
|   |   |   importMeta.d.ts
|   |   |   index.cjs
|   |   |   index.d.cts
|   |   |   jsdom.d.ts
|   |   |   LICENSE.md
|   |   |   mocker.d.ts
|   |   |   node.d.ts
|   |   |   optional-runtime-types.d.ts
|   |   |   optional-types.d.ts
|   |   |   package.json
|   |   |   README.md
|   |   |   reporters.d.ts
|   |   |   runners.d.ts
|   |   |   snapshot.d.ts
|   |   |   suite.d.ts
|   |   |   suppress-warnings.cjs
|   |   |   vitest.mjs
|   |   |   worker.d.ts
|   |   |   
|   |   +---browser
|   |   |       context.d.ts
|   |   |       context.js
|   |   |       
|   |   \---dist
|   |       |   browser.d.ts
|   |       |   browser.js
|   |       |   cli.js
|   |       |   config.cjs
|   |       |   config.d.ts
|   |       |   config.js
|   |       |   index.d.ts
|   |       |   index.js
|   |       |   module-evaluator.d.ts
|   |       |   module-evaluator.js
|   |       |   node.d.ts
|   |       |   node.js
|   |       |   nodejs-worker-loader.js
|   |       |   path.js
|   |       |   runtime.d.ts
|   |       |   runtime.js
|   |       |   spy.js
|   |       |   task-utils.js
|   |       |   traces.js
|   |       |   worker.d.ts
|   |       |   worker.js
|   |       |   
|   |       +---chunks
|   |       |       acorn.C1kjbUFw.js
|   |       |       base.Cc3oda2V.js
|   |       |       browser.d.g5Thl309.d.ts
|   |       |       cac.fSuRXrAx.js
|   |       |       cli-api.DcLieX4F.js
|   |       |       config.d.CU_b-wJj.d.ts
|   |       |       console.B09ye7y0.js
|   |       |       constants.-juJ8b_4.js
|   |       |       coverage.AipniaqB.js
|   |       |       coverage.CX7NN5s7.js
|   |       |       creator.BEj8pIIH.js
|   |       |       defaults.D2ip7f-X.js
|   |       |       display.pkpxlVcY.js
|   |       |       doctor.DR3u0Z_G.js
|   |       |       env.DzFJjrmK.js
|   |       |       environment.d.C6xYahWA.d.ts
|   |       |       evaluatedModules.d.BxJ5omdx.d.ts
|   |       |       globals.D9ucJdZZ.js
|   |       |       index.D4dXTzh9.js
|   |       |       index.DmDMHCg8.js
|   |       |       index.DNv8WNGe.js
|   |       |       index.DXQx-kDM.js
|   |       |       index.DzobfTyw.js
|   |       |       index.M2dsQ_UQ.js
|   |       |       index.m3L2HgmY.js
|   |       |       init-forks.DgHqDQHC.js
|   |       |       init-threads.B-t1iYCi.js
|   |       |       init.3UJvPvQg.js
|   |       |       inspector.CvyFGlXm.js
|   |       |       modules.BJuCwlRJ.js
|   |       |       native.CF4uT5hY.js
|   |       |       nativeModuleMocker.B20FEd-E.js
|   |       |       nativeModuleRunner.J0QLzNtK.js
|   |       |       node.CfQ_OGWr.js
|   |       |       offset.Dy-5Fdfn.js
|   |       |       pathe.M-eThtNZ.DwEga6ro.js
|   |       |       plugin.d.CN87HSxv.d.ts
|   |       |       plugins.Cigb0uSy.js
|   |       |       resolver.NpfwMKt9.js
|   |       |       rpc.Bvs-iVxs.js
|   |       |       rpc.d.DA9Utv4e.d.ts
|   |       |       run.C5UmxDPh.js
|   |       |       setup-common.BkQOiNcI.js
|   |       |       source-map.BH0bbrs9.js
|   |       |       source-map.d.YqWNcp4e.d.ts
|   |       |       spy.DQ0ZsPbi.js
|   |       |       task-utils.d.BZm4GSQD.d.ts
|   |       |       tinyrainbow.Ht9iggcq.js
|   |       |       utils.CJ0JImL8.js
|   |       |       utils.DYj33du9.js
|   |       |       vm.W4G5WMTl.js
|   |       |       worker.d.MLmnzOJE.d.ts
|   |       |       
|   |       \---workers
|   |               forks.js
|   |               runVmTests.js
|   |               threads.js
|   |               vmForks.js
|   |               vmThreads.js
|   |               
|   +---vue
|   |   |   index.js
|   |   |   index.mjs
|   |   |   jsx.d.ts
|   |   |   LICENSE
|   |   |   package.json
|   |   |   README.md
|   |   |   
|   |   +---compiler-sfc
|   |   |       index.browser.js
|   |   |       index.browser.mjs
|   |   |       index.d.mts
|   |   |       index.d.ts
|   |   |       index.js
|   |   |       index.mjs
|   |   |       package.json
|   |   |       register-ts.js
|   |   |       
|   |   +---dist
|   |   |       vue.cjs.js
|   |   |       vue.cjs.prod.js
|   |   |       vue.d.mts
|   |   |       vue.d.ts
|   |   |       vue.esm-browser.js
|   |   |       vue.esm-browser.prod.js
|   |   |       vue.esm-bundler.js
|   |   |       vue.global.js
|   |   |       vue.global.prod.js
|   |   |       vue.runtime.esm-browser.js
|   |   |       vue.runtime.esm-browser.prod.js
|   |   |       vue.runtime.esm-bundler.js
|   |   |       vue.runtime.global.js
|   |   |       vue.runtime.global.prod.js
|   |   |       
|   |   +---jsx-runtime
|   |   |       index.d.ts
|   |   |       index.js
|   |   |       index.mjs
|   |   |       package.json
|   |   |       
|   |   \---server-renderer
|   |           index.d.mts
|   |           index.d.ts
|   |           index.js
|   |           index.mjs
|   |           package.json
|   |           
|   +---why-is-node-running
|   |   |   cli.js
|   |   |   example.js
|   |   |   include.js
|   |   |   index.js
|   |   |   LICENSE
|   |   |   package.json
|   |   |   README.md
|   |   |   
|   |   \---.github
|   |           FUNDING.yml
|   |           
|   +---wrap-ansi
|   |       index.d.ts
|   |       index.js
|   |       license
|   |       package.json
|   |       readme.md
|   |       
|   \---yoga-layout
|       |   package.json
|       |   README.md
|       |   
|       +---dist
|       |   +---binaries
|       |   |       yoga-wasm-base64-esm.js
|       |   |       
|       |   \---src
|       |       |   index.d.ts
|       |       |   index.js
|       |       |   index.js.map
|       |       |   load.d.ts
|       |       |   load.js
|       |       |   load.js.map
|       |       |   wrapAssembly.d.ts
|       |       |   wrapAssembly.js
|       |       |   wrapAssembly.js.map
|       |       |   
|       |       \---generated
|       |               YGEnums.d.ts
|       |               YGEnums.js
|       |               YGEnums.js.map
|       |               
|       \---src
|           |   Config.cpp
|           |   Config.h
|           |   embind.cpp
|           |   index.ts
|           |   Layout.h
|           |   load.ts
|           |   Node.cpp
|           |   Node.h
|           |   Size.h
|           |   Value.h
|           |   wrapAssembly.ts
|           |   
|           \---generated
|                   YGEnums.ts
|                   
+---openspec
|   |   config.yaml
|   |   
|   +---changes
|   |   +---archive
|   |   |   |   .gitkeep
|   |   |   |   
|   |   |   \---2026-09-20-runtime-foundation
|   |   |       |   .openspec.yaml
|   |   |       |   design.md
|   |   |       |   proposal.md
|   |   |       |   tasks.md
|   |   |       |   
|   |   |       \---specs
|   |   |           +---agent-runtime
|   |   |           |       spec.md
|   |   |           |       
|   |   |           +---human-approval
|   |   |           |       spec.md
|   |   |           |       
|   |   |           +---task-verification
|   |   |           |       spec.md
|   |   |           |       
|   |   |           \---tool-calling-protocol
|   |   |                   spec.md
|   |   |                   
|   |   \---context-budget
|   |       |   .openspec.yaml
|   |       |   design.md
|   |       |   proposal.md
|   |       |   tasks.md
|   |       |   
|   |       \---specs
|   |           +---context-metrics
|   |           |       spec.md
|   |           |       
|   |           \---tool-output-budget
|   |                   spec.md
|   |                   
|   \---specs
|       |   .gitkeep
|       |   
|       +---agent-runtime
|       |       spec.md
|       |       
|       +---context-metrics
|       |       spec.md
|       |       
|       +---human-approval
|       |       spec.md
|       |       
|       +---task-verification
|       |       spec.md
|       |       
|       +---tool-calling-protocol
|       |       spec.md
|       |       
|       \---tool-output-budget
|               spec.md
|               
+---run_test
|   |   9.21.task.md
|   |   9.21_1.md
|   |   9.21_2.md
|   |   9.21_3.md
|   |   9.21_4.md
|   |   9.21_5.md
|   |   9.21_6.md
|   |   9.21_7.md
|   |   9.21_8.md
|   |   file_sizes.md
|   |   git_log.md
|   |   PRD.md
|   |   request_result.md
|   |   temp_note.txt
|   |   tools_list.md
|   |   _tree.txt
|   |   _weather_ascii.txt
|   |   _weather_one.txt
|   |   _weather_raw.json
|   |   _weather_summary.txt
|   |   
|   \---log
|           09212250ÎÄ¼þ¶ÁÈ¡ÓëËÑË÷Àà.log
|           09212251´úÂë±à¼­Àà.log
|           09212251¶à²½ÎÄ¼þ²Ù×÷Àà.log
|           09212252Git ²Ù×÷Àà.log
|           09212252Ä¿Â¼±éÀúÓëÍ³¼ÆÀà.log
|           09212253ÍøÂçÇëÇóÀà.log
|           09212253¿çÄ¿Â¼ÒÆ¶¯ÎÄ¼þÀà.log
|           
\---src
    |   index.ts
    |   output-budget.ts
    |   
    +---cli
    |   |   App.vue
    |   |   main.ts
    |   |   shims-vue.d.ts
    |   |   
    |   +---components
    |   |       ApprovalModal.vue
    |   |       ChatView.vue
    |   |       ToolCallCard.vue
    |   |       
    |   +---composable
    |   |       useAgent.ts
    |   |       
    |   \---dist
    |           main.mjs
    |           
    +---memoery
    +---provider
    |       deepseek.provider.ts
    |       openai.provider.ts
    |       Provider.ts
    |       
    +---runtime
    |       agent.runtime.ts
    |       
    +---test
    |   |   ds.example.ts
    |   |   setup.ts
    |   |   task-runner.ts
    |   |   tasks.ts
    |   |   
    |   +---integration
    |   |       agent-runtime.test.ts
    |   |       ds_provider.test.ts
    |   |       react_loop.test.ts
    |   |       
    |   +---provider
    |   |       deepseek-translation.test.ts
    |   |       
    |   +---runtime
    |   |       approval.test.ts
    |   |       context-metrics.test.ts
    |   |       initial-plan.test.ts
    |   |       message-sequence.test.ts
    |   |       output-budget.test.ts
    |   |       tool-budgets.test.ts
    |   |       verification.test.ts
    |   |       
    |   \---tools
    |           apply_diff.test.ts
    |           create_file.test.ts
    |           delete_file.test.ts
    |           edit_file.test.ts
    |           fetch_url.test.ts
    |           git_operation.test.ts
    |           list_files.test.ts
    |           move_file.test.ts
    |           read_directory.test.ts
    |           read_file.test.ts
    |           run_command.test.ts
    |           search_code.test.ts
    |           
    +---tools
    |       apply_diff.ts
    |       create_file.ts
    |       delete_file.ts
    |       edit_file.ts
    |       fetch_url.ts
    |       git_operation.ts
    |       index.ts
    |       list_files.ts
    |       move_file.ts
    |       read_directory.ts
    |       read_file.ts
    |       run_command.ts
    |       search_code.ts
    |       
    \---types
            AgentProvider.ts
            Message.ts
            ReAct.ts
            Runtime.ts
            Tool.ts
```

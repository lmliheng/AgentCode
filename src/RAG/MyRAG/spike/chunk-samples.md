# MyRAG 分块结果人工审核样本

参数：`maxChunkChars=3600`，`chunkOverlapChars=540`

每个 chunk 都列出「送去 embedding 的完整文本」，因为那才是真正参与语义匹配的内容。
| 文件 | sections | chunks | text | outline | table | 说明 |
|---|---|---|---|---|---|---|
| `ast.md` | 8 | 11 | 9 | 1 | 1 | 典型 md（有 heading / 代码块 / 表格） |
| `infer.md` | 4 | 4 | 4 | 0 | 0 | 曾被 officeparser 压平的文件 |
| `emitter.md` | 6 | 9 | 8 | 1 | 0 | 含 1 个 outline / 0 个表格块 |
| `truthy.md` | 2 | 3 | 2 | 0 | 1 | 含 0 个 outline / 1 个表格块 |
| `报告.docx` | 1 | 14 | 7 | 1 | 6 | 无标题结构文档（heading 节点为 0） |
| `resume.pdf` | 1 | 1 | 1 | 0 | 0 | PDF 文档 |


## 汇总

## 1. ast.md

- 说明：典型 md（有 heading / 代码块 / 表格） —— 代表绝大多数语料的形态
- 格式：`md`　文档标题：`Node 节点`
- sections：8　chunks：11

### chunk 1 / 11　`text`　374 字符

- id：`ast-v1-001-61472c71f0a0`
- scope（标题路径）：`抽象语法树`
- heading：`Node 节点`（level 3）
- group：（无）
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
heading: Node 节点
heading_level: 3
scope: 抽象语法树
### Node 节点

节点是抽象语法树（AST） 的基本构造块。语法上，通常 `Node` 表示非末端（non-terminals）节点。但是，有些末端节点，如：标识符和字面量也会保留在树中。

AST 节点文档由两个关键部分构成。一是节点的 `SyntaxKind` 枚举，用于标识 AST 中的类型。二是其接口，即实例化 AST 时节点提供的 API。

这里是 `interface Node` 的一些关键成员：

- `TextRange` 标识该节点在源文件中的起止位置。
- `parent?: Node` 当前节点（在 AST 中）的父节点

`Node` 还有一些其他的成员，标志（flags）和修饰符（modifiers）等。你可以在源码中搜索 `interface Node` 来查看，而上面提到对节点的遍历是非常重要的。

`````

</details>

### chunk 2 / 11　`text`　119 字符

- id：`ast-v1-002-142b4171fb17`
- scope（标题路径）：`抽象语法树`
- heading：`SourceFile`（level 3）
- group：（无）
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
heading: SourceFile
heading_level: 3
scope: 抽象语法树
### SourceFile

- `SyntaxKind.SourceFile`
- `interface SourceFile`.

每个 `SourceFile` 都是一棵 AST 的顶级节点，它们包含在 `Program` 中。

`````

</details>

### chunk 3 / 11　`text`　1260 字符

- id：`ast-v1-003-d0559e0c9d20`
- scope（标题路径）：`抽象语法树`
- heading：`AST 技巧：访问子节点`（level 2）
- group：（无）
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
heading: AST 技巧：访问子节点
heading_level: 2
scope: 抽象语法树
## AST 技巧：访问子节点

有个工具函数 `ts.forEachChild`，可以用来访问 AST 任一节点的所有子节点。

下面是简化的代码片段，用于演示如何工作：

```ts
export function forEachChild<T>(node: Node, cbNode: (node: Node) => T, cbNodeArray?: (nodes: Node[]) => T): T {
    if (!node) {
        return;
    }
    switch (node.kind) {
        case SyntaxKind.BinaryExpression:
            return visitNode(cbNode, (<BinaryExpression>node).left) ||
                visitNode(cbNode, (<BinaryExpression>node).operatorToken) ||
                visitNode(cbNode, (<BinaryExpression>node).right);
        case SyntaxKind.IfStatement:
            return visitNode(cbNode, (<IfStatement>node).expression) ||
                visitNode(cbNode, (<IfStatement>node).thenStatement) ||
                visitNode(cbNode, (<IfStatement>node).elseStatement);

        // .... 更多
```

该函数主要检查 `node.kind` 并据此判断 node 的接口，然后在其子节点上调用 `cbNode`。但是，要注意该函数不会为*所有*子节点调用 `visitNode`（例如：SyntaxKind.SemicolonToken）。想获得某 AST 节点的*所有*子节点，只要调用该节点的成员函数 `.getChildren`。

如下函数会打印 AST 节点详细信息：

```ts
function printAllChildren(node: ts.Node, depth = 0) {
  console.log(new Array(depth + 1).join('----'), ts.syntaxKindToName(node.kind), node.pos, node.end);
  depth++;
  node.getChildren().forEach(c => printAllChildren(c, depth));
}
```

我们进一步讨论解析器时会看到该函数的使用示例。

`````

</details>

### chunk 4 / 11　`text`　521 字符

- id：`ast-v1-004-95f3b96e9343`
- scope（标题路径）：`抽象语法树`
- heading：`AST 技巧：SyntaxKind 枚举`（level 2）
- group：（无）
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
heading: AST 技巧：SyntaxKind 枚举
heading_level: 2
scope: 抽象语法树
## AST 技巧：SyntaxKind 枚举

`SyntaxKind` 被定义为一个常量枚举，如下所示：

```ts
export const enum SyntaxKind {
    Unknown,
    EndOfFileToken,
    SingleLineCommentTrivia,
    // ... 更多
```

这是个[常量枚举](../typings/enums.md#常量枚举)，方便*内联*（例如：`ts.SyntaxKind.EndOfFileToken` 会变为 `1`），这样在使用 AST 时就不会有处理引用的额外开销。但编译时需要使用 --preserveConstEnums 编译标志，以便枚举*在运行时仍可用*。JavaScript 中你也可以根据需要使用 `ts.SyntaxKind.EndOfFileToken`。另外，可以用以下函数，将枚举成员转化为可读的字符串：

```ts
export function syntaxKindToName(kind: ts.SyntaxKind) {
  return (<any>ts).SyntaxKind[kind];
}
```

`````

</details>

### chunk 5 / 11　`text`　133 字符

- id：`ast-v1-005-8774b0cdf2fb`
- scope（标题路径）：`抽象语法树`
- heading：`AST 杂项`（level 2）
- group：（无）
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
heading: AST 杂项
heading_level: 2
scope: 抽象语法树
## AST 杂项

杂项（Trivia）是指源文本中对正常理解代码不太重要的部分，例如：空白，注释，冲突标记。（为了保持轻量）杂项*不会存储*在 AST 中。但是可以*视需要*使用一些 `ts.*` API 来获取。

展示这些 API 前，你需要理解以下内容：

`````

</details>

### chunk 6 / 11　`text`　179 字符

- id：`ast-v1-006-c58a639abf0e`
- scope（标题路径）：`抽象语法树::AST 杂项`
- heading：`杂项的所有权`（level 3）
- group：（无）
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
heading: 杂项的所有权
heading_level: 3
scope: 抽象语法树::AST 杂项
### 杂项的所有权

通常：

- token 拥有它后面 _同一行_ 到下一个 token 之前的所有杂项
- 该行之后的注释都与下个的 token 相关

对于文件中的前导（leading）和结束（ending）注释：

- 源文件中的第一个 token 拥有所有开始的杂项
- 而文件最后的一些列杂项则附加到文件结束符上，该 token 长度为 0

`````

</details>

### chunk 7 / 11　`outline`　23 字符

- id：`ast-v1-007-74638e74a01b`
- scope（标题路径）：`抽象语法树::AST 杂项`
- heading：`杂项 API`（level 3）
- group：`grp-006-ast.md`
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
heading: 杂项 API
heading_level: 3
scope: 抽象语法树::AST 杂项
抽象语法树 > AST 杂项 > 杂项 API
`````

</details>

### chunk 8 / 11　`text`　50 字符

- id：`ast-v1-008-a0886b0d6068`
- scope（标题路径）：`抽象语法树::AST 杂项`
- heading：`杂项 API`（level 3）
- group：`grp-006-ast.md`
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
heading: 杂项 API
heading_level: 3
scope: 抽象语法树::AST 杂项
### 杂项 API

注释在多数基本使用中，都是让人关注的杂项。节点的注释可以通过以下函数获取：

`````

</details>

### chunk 9 / 11　`table`　232 字符

- id：`ast-v1-009-52cb4c4759b8`
- scope（标题路径）：`抽象语法树::AST 杂项`
- heading：`杂项 API`（level 3）
- group：（无）
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
heading: 杂项 API
heading_level: 3
scope: 抽象语法树::AST 杂项
| 函数 | 描述 |
| --- | --- |
| `ts.getLeadingCommentRanges` | 给定源文本及其位置，返回给定位置后第一个换行符到 token 本身之间的注释范围（可能需要结合 `ts.Node.getFullStart` 使用）。 |
| `ts.getTrailingCommentRanges` | 给定源文本及其位置，返回给定位置后第一个换行符之前的注释范围（可能需要结合 `ts.Node.getEnd` 使用）。 |
`````

</details>

### chunk 10 / 11　`text`　223 字符

- id：`ast-v1-010-d5ae8b70cee8`
- scope（标题路径）：`抽象语法树::AST 杂项`
- heading：`杂项 API`（level 3）
- group：`grp-006-ast.md`
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
heading: 杂项 API
heading_level: 3
scope: 抽象语法树::AST 杂项
假设下面是某个源文件的一部分：

```ts
debugger;/*hello*/
    //bye
  /*hi*/    function
```

对 `function` 而言，`getLeadingCommentRanges` 仅返回最后的两个注释 `//bye` 和 `/*hi*/`。
另外，而在 `debugger` 语句结束位置调用 `getTrailingCommentRanges` 会得到注释 `/*hello*/`。

`````

</details>

### chunk 11 / 11　`text`　390 字符

- id：`ast-v1-011-6c8595aad294`
- scope（标题路径）：`抽象语法树::AST 杂项`
- heading：`Token Start 和 Full Start 位置`（level 3）
- group：（无）
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
heading: Token Start 和 Full Start 位置
heading_level: 3
scope: 抽象语法树::AST 杂项
### Token Start 和 Full Start 位置

节点有所谓的 "token start" 和 "full start" 位置。

- Token Start：比较自然的版本，即文件中一个 token 的文本开始的位置。
- Full Start：是指扫描器从上一个重要 token 开始扫描的位置。

AST 节点有 `getStart` 和 `getFullStart` API 用于获取以上两种位置，还是这个例子：

```ts
debugger;/*hello*/
    //bye
  /*hi*/    function
```

对 `function` 而言，token start 即 `function` 的位置，而 _full_ start 是 `/*hello*/` 的位置。要注意，full start 甚至会包含前一节点拥有的杂项。

`````

</details>

## 2. infer.md

- 说明：曾被 officeparser 压平的文件 —— 验证「列表内缩进的代码块」现在是否完整保留
- 格式：`md`　文档标题：`介绍`
- sections：4　chunks：4

### chunk 1 / 4　`text`　542 字符

- id：`infer-v1-001-3c8439e24c3c`
- scope（标题路径）：`infer`
- heading：`介绍`（level 2）
- group：（无）
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
heading: 介绍
heading_level: 2
scope: infer
## 介绍

`infer` 最早出现在此 [PR](https://github.com/Microsoft/TypeScript/pull/21496) 中，表示在 `extends` 条件语句中待推断的类型变量。

简单示例如下：

```ts
type ParamType<T> = T extends (arg: infer P) => any ? P : T;
```

在这个条件语句 `T extends (arg: infer P) => any ? P : T` 中，`infer P` 表示待推断的函数参数。

整句表示为：如果 `T` 能赋值给 `(arg: infer P) => any`，则结果是 `(arg: infer P) => any` 类型中的参数 `P`，否则返回为 `T`。

```ts
interface User {
  name: string;
  age: number;
}

type Func = (user: User) => void;

type Param = ParamType<Func>; // Param = User
type AA = ParamType<string>; // string
```

`````

</details>

### chunk 2 / 4　`text`　1063 字符

- id：`infer-v1-002-8b8a82d984d0`
- scope（标题路径）：`infer`
- heading：`内置类型`（level 2）
- group：（无）
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
heading: 内置类型
heading_level: 2
scope: infer
## 内置类型

在 2.8 版本中，TypeScript 内置了一些与 `infer` 有关的映射类型：

- 用于提取函数类型的返回值类型：

```ts
type ReturnType<T> = T extends (...args: any[]) => infer P ? P : any;
```

相比于文章开始给出的示例，`ReturnType<T>` 只是将 `infer P` 从参数位置移动到返回值位置，因此此时 `P` 即是表示待推断的返回值类型。

```ts
type Func = () => User;
  type Test = ReturnType<Func>; // Test = User
```

- 用于提取构造函数中参数（实例）类型：

一个构造函数可以使用 `new` 来实例化，因此它的类型通常表示如下：

```ts
type Constructor = new (...args: any[]) => any;
```

当 `infer` 用于构造函数类型中，可用于参数位置 `new (...args: infer P) => any;` 和返回值位置 `new (...args: any[]) => infer P;`。

因此就内置如下两个映射类型：

```ts
// 获取参数类型
  type ConstructorParameters<T extends new (...args: any[]) => any> = T extends new (...args: infer P) => any
    ? P
    : never;

  // 获取实例类型
  type InstanceType<T extends new (...args: any[]) => any> = T extends new (...args: any[]) => infer R ? R : any;

  class TestClass {
    constructor(public name: string, public age: number) {}
  }

  type Params = ConstructorParameters<typeof TestClass>; // [string, number]

  type Instance = InstanceType<typeof TestClass>; // TestClass
```

`````

</details>

### chunk 3 / 4　`text`　2614 字符

- id：`infer-v1-003-389e3dd7e417`
- scope（标题路径）：`infer`
- heading：`一些用例`（level 2）
- group：（无）
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
heading: 一些用例
heading_level: 2
scope: infer
## 一些用例

至此，相信你已经对 `infer` 已有基本了解，我们来看看一些使用它的「骚操作」：

- **tuple** 转 **union** ，如：`[string, number]` -> `string | number`

解答之前，我们需要了解 tuple 类型在一定条件下，是可以赋值给数组类型：

```ts
type TTuple = [string, number];
  type TArray = Array<string | number>;

  type Res = TTuple extends TArray ? true : false; // true
  type ResO = TArray extends TTuple ? true : false; // false
```

因此，在配合 `infer` 时，这很容易做到：

```ts
type ElementOf<T> = T extends Array<infer E> ? E : never;

  type TTuple = [string, number];

  type ToUnion = ElementOf<TTuple>; // string | number
```

在 [stackoverflow](https://stackoverflow.com/questions/44480644/typescript-string-union-to-string-array/45486495#45486495) 上看到另一种解法，比较简（牛）单（逼）：

```ts
type TTuple = [string, number];
  type Res = TTuple[number]; // string | number
```

- **union** 转 **intersection**，如：`T1 | T2` -> `T1 & T2`

这个可能要稍微麻烦一点，需要 `infer` 配合「 [Distributive conditional types](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-8.html#distributive-conditional-types) 」使用。

在[相关链接](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-8.html#distributive-conditional-types)中，我们可以了解到「Distributive conditional types」是由「naked type parameter」构成的条件类型。而「naked type parameter」表示没有被 `Wrapped` 的类型（如：`Array<T>`、`[T]`、`Promise<T>` 等都是不是「naked type parameter」）。「Distributive conditional types」主要用于拆分 `extends` 左边部分的联合类型，举个例子：在条件类型 `T extends U ? X : Y` 中，当 `T` 是 `A | B` 时，会拆分成 `A extends U ? X : Y | B extends U ? X : Y`；

有了这个前提，再利用在逆变位置上，[同一类型变量的多个候选类型将会被推断为交叉类型](https://github.com/Microsoft/TypeScript/pull/21496)的特性，即

```ts
type T1 = { name: string };
  type T2 = { age: number };

  type Bar<T> = T extends { a: (x: infer U) => void; b: (x: infer U) => void } ? U : never;
  type T20 = Bar<{ a: (x: string) => void; b: (x: string) => void }>; // string
  type T21 = Bar<{ a: (x: T1) => void; b: (x: T2) => void }>; // T1 & T2
```

因此，综合以上几点，我们可以得到在 [stackoverflow](https://stackoverflow.com/questions/50374908/transform-union-type-to-intersection-type) 上的一个答案：

```ts
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never;

  type Result = UnionToIntersection<T1 | T2>; // T1 & T2
```

当传入 `T1 | T2` 时：

- 第一步：`(U extends any ? (k: U) => void : never)` 会把 union 拆分成 `(T1 extends any ? (k: T1) => void : never) | (T2 extends any ? (k: T2)=> void : never)`，即是得到 `(k: T1) => void | (k: T2) => void`；

- 第二步：`(k: T1) => void | (k: T2) => void extends ((k: infer I) => void) ? I : never`，根据上文，可以推断出 `I` 为 `T1 & T2`。

当然，你可以玩出更多花样，比如 [**union** 转 **tuple**](https://zhuanlan.zhihu.com/p/58704376)。

`````

</details>

### chunk 4 / 4　`text`　1310 字符

- id：`infer-v1-004-bad7cb601e73`
- scope（标题路径）：`infer`
- heading：`LeetCode 的一道 TypeScript 面试题`（level 2）
- group：（无）
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
heading: LeetCode 的一道 TypeScript 面试题
heading_level: 2
scope: infer
## LeetCode 的一道 TypeScript 面试题

前段时间，在 [GitHub](https://github.com/LeetCode-OpenSource/hire/blob/master/typescript_zh.md) 上，发现一道来自 LeetCode TypeScript 的面试题，比较有意思，题目的大致意思是：

假设有一个这样的类型（原题中给出的是类，这里简化为 interface）：

```ts
interface Module {
  count: number;
  message: string;
  asyncMethod<T, U>(input: Promise<T>): Promise<Action<U>>;
  syncMethod<T, U>(action: Action<T>): Action<U>;
}
```

在经过 `Connect` 函数之后，返回值类型为

```ts
type Result = {
  asyncMethod<T, U>(input: T): Action<U>;
  syncMethod<T, U>(action: T): Action<U>;
}
```

其中 `Action<T>` 的定义为：

```ts
interface Action<T> {
  payload?: T;
  type: string;
}
```

这里主要考察两点

- 挑选出函数
- 此篇文章所提及的 `infer`

挑选函数的方法，已经在 [handbook](http://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-8.html) 中已经给出，只需判断 value 能赋值给 Function 就行了：

```ts
type FuncName<T> = { [P in keyof T]: T[P] extends Function ? P : never }[keyof T];

type Connect = (module: Module) => { [T in FuncName<Module>]: Module[T] };
/*
 * type Connect = (module: Module) => {
 *   asyncMethod: <T, U>(input: Promise<T>) => Promise<Action<U>>;
 *   syncMethod: <T, U>(action: Action<T>) => Action<U>;
 * }
*/
```

接下来就比较简单了，主要是利用条件类型 + `infer`，如果函数可以赋值给 `asyncMethod<T, U>(input: Promise<T>): Promise<Action<U>>`，则取值为 `asyncMethod<T, U>(input: T): Action<U>`。具体答案就不给出了，感兴趣的小伙伴可以尝试一下。

`````

</details>

## 3. emitter.md

- 说明：含 1 个 outline / 0 个表格块 —— 确认多窗归并与表格原子性
- 格式：`md`　文档标题：`发射器`
- sections：6　chunks：9

### chunk 1 / 9　`text`　183 字符

- id：`emitter-v1-001-6371db0fe9ad`
- scope（标题路径）：（无）
- heading：`发射器`（level 1）
- group：（无）
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
heading: 发射器
heading_level: 1
# 发射器

TypeScript 编译器提供了两个发射器：

- `emitter.ts`：可能是你最感兴趣的发射器，它是 TS -> JavaScript 的发射器
- `declarationEmitter.ts`：这个发射器用于为 _TypeScript 源文件（`.ts`）_ 创建*声明文件（`.d.ts`）*

本节我们介绍 `emitter.ts`

`````

</details>

### chunk 2 / 9　`text`　339 字符

- id：`emitter-v1-002-c42166a582cb`
- scope（标题路径）：`发射器`
- heading：`Promgram 对发射器的使用`（level 3）
- group：（无）
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
heading: Promgram 对发射器的使用
heading_level: 3
scope: 发射器
### Promgram 对发射器的使用

Program 提供了一个 `emit` 函数。该函数主要将功能委托给 `emitter.ts`中的 `emitFiles` 函数。下面是调用栈：

```
Program.emit ->
    `emitWorker` （在 program.ts 中的 createProgram） ->
        `emitFiles` （emitter.ts 中的函数）
```

`emitWorker`（通过 `emitFiles` 参数）给发射器提供一个 `EmitResolver`。 `EmitResolver` 由程序的 TypeChecker 提供，基本上它是一个来自 `createChecker` 的本地函数的子集。

`````

</details>

### chunk 3 / 9　`text`　449 字符

- id：`emitter-v1-003-5abdc35c54fe`
- scope（标题路径）：`发射器::发射器函数`
- heading：``emitFiles``（level 3）
- group：（无）
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
heading: `emitFiles`
heading_level: 3
scope: 发射器::发射器函数
### `emitFiles`

定义在 `emitter.ts` 中，下面是该函数的签名：

```ts
// targetSourceFile 当用户想发射项目中的某个文件时指定，保存时编译（compileOnSave）功能使用此参数
export function emitFiles(resolver: EmitResolver, host: EmitHost, targetSourceFile?: SourceFile): EmitResult {
```

`EmitHost` 是 `CompilerHost` 的简化版（运行时，很多用例实际上都是 `CompilerHost`）

`emitFiles` 中的最有趣的调用栈如下所示：

```
emitFiles ->
    emitFile(jsFilePath, targetSourceFile) ->
        emitJavaScript(jsFilePath, targetSourceFile);
```

`````

</details>

### chunk 4 / 9　`text`　3046 字符

- id：`emitter-v1-004-4d08c3995e5d`
- scope（标题路径）：`发射器::发射器函数`
- heading：``emitJavaScript``（level 3）
- group：（无）
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
heading: `emitJavaScript`
heading_level: 3
scope: 发射器::发射器函数
### `emitJavaScript`

该函数有良好的注释，我们下面给出它：

```ts
function emitJavaScript(jsFilePath: string, root?: SourceFile) {
  let writer = createTextWriter(newLine);
  let write = writer.write;
  let writeTextOfNode = writer.writeTextOfNode;
  let writeLine = writer.writeLine;
  let increaseIndent = writer.increaseIndent;
  let decreaseIndent = writer.decreaseIndent;

  let currentSourceFile: SourceFile;
  // 导出器函数的名称，如果文件是个系统外部模块的话
  // System.register([...], function (<exporter>) {...})
  // System 模块中的导出像这样：
  // export var x; ... x = 1
  // =>
  // var x;... exporter("x", x = 1)
  let exportFunctionForFile: string;

  let generatedNameSet: Map<string> = {};
  let nodeToGeneratedName: string[] = [];
  let computedPropertyNamesToGeneratedNames: string[];

  let extendsEmitted = false;
  let decorateEmitted = false;
  let paramEmitted = false;
  let awaiterEmitted = false;
  let tempFlags = 0;
  let tempVariables: Identifier[];
  let tempParameters: Identifier[];
  let externalImports: (ImportDeclaration | ImportEqualsDeclaration | ExportDeclaration)[];
  let exportSpecifiers: Map<ExportSpecifier[]>;
  let exportEquals: ExportAssignment;
  let hasExportStars: boolean;

  /** 将发射输出写入磁盘 */
  let writeEmittedFiles = writeJavaScriptFile;

  let detachedCommentsInfo: { nodePos: number; detachedCommentEndPos: number }[];

  let writeComment = writeCommentRange;

  /** 发射一个节点 */
  let emit = emitNodeWithoutSourceMap;

  /** 在发射节点前调用 */
  let emitStart = function(node: Node) {};

  /** 发射结点完成后调用 */
  let emitEnd = function(node: Node) {};

  /** 从 startPos 位置开始，为指定的 token 发射文本。默认写入的文本由 tokenKind 提供，
   * 但是如果提供了可选的 emitFn 回调，将使用该回调来代替默认方式发射文本。
   * @param tokenKind 要搜索并发射的 token 的类别
   * @param startPos 源码中搜索 token 的起始位置
   * @param emitFn 如果给出，会被调用来进行文本的发射。
   */
  let emitToken = emitTokenText;

  /** 该函数由于节点的缘故，在被发射的代码中的函数或类中，会在启用词法作用域前被调用
   * @param scopeDeclaration 启动词法作用域的节点
   * @param scopeName 可选的作用域的名称，默认从节点声明中推导
   */
  let scopeEmitStart = function(scopeDeclaration: Node, scopeName?: string) {};

  /** 出了作用域后调用 */
  let scopeEmitEnd = function() {};

  /** 会被编码的 Sourcemap 数据 */
  let sourceMapData: SourceMapData;

  if (compilerOptions.sourceMap || compilerOptions.inlineSourceMap) {
    initializeEmitterWithSourceMaps();
  }

  if (root) {
    // 不要直接调用 emit，那样不会设置 currentSourceFile
    emitSourceFile(root);
  } else {
    forEach(host.getSourceFiles(), sourceFile => {
      if (!isExternalModuleOrDeclarationFile(sourceFile)) {
        emitSourceFile(sourceFile);
      }
    });
  }

  writeLine();
  writeEmittedFiles(writer.getText(), /*writeByteOrderMark*/ compilerOptions.emitBOM);
  return;

  /// 一批本地函数
}
```

它主要设置了一批本地变量和函数（这些函数构成 `emitter.ts` 的*大部分*内容），接着交给本地函数 `emitSourceFile` 发射文本。`emitSourceFile` 函数设置 `currentSourceFile` 然后交给本地函数 `emit` 去处理。

```ts
function emitSourceFile(sourceFile: SourceFile): void {
  currentSourceFile = sourceFile;
  exportFunctionForFile = undefined;
  emit(sourceFile);
}
```

`emit` 函数处理 _注释_ 和 _实际 JavaScript_ 的发射。_实际 JavaScript_ 的发射是 emitJavaScriptWorker 函数的工作。

`````

</details>

### chunk 5 / 9　`outline`　36 字符

- id：`emitter-v1-005-e25f4641ebb0`
- scope（标题路径）：`发射器::发射器函数`
- heading：``emitJavaScriptWorker``（level 3）
- group：`grp-004-emitter.md`
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
heading: `emitJavaScriptWorker`
heading_level: 3
scope: 发射器::发射器函数
发射器 > 发射器函数 > `emitJavaScriptWorker`
`````

</details>

### chunk 6 / 9　`text`　3515 字符

- id：`emitter-v1-006-9301e4004390`
- scope（标题路径）：`发射器::发射器函数`
- heading：``emitJavaScriptWorker``（level 3）
- group：`grp-004-emitter.md`
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
heading: `emitJavaScriptWorker`
heading_level: 3
scope: 发射器::发射器函数
### `emitJavaScriptWorker`

完整的函数：

```ts
function emitJavaScriptWorker(node: Node) {
  // 检查节点是否可以忽略 ScriptTarget 发射
  switch (node.kind) {
    case SyntaxKind.Identifier:
      return emitIdentifier(<Identifier>node);
    case SyntaxKind.Parameter:
      return emitParameter(<ParameterDeclaration>node);
    case SyntaxKind.MethodDeclaration:
    case SyntaxKind.MethodSignature:
      return emitMethod(<MethodDeclaration>node);
    case SyntaxKind.GetAccessor:
    case SyntaxKind.SetAccessor:
      return emitAccessor(<AccessorDeclaration>node);
    case SyntaxKind.ThisKeyword:
      return emitThis(node);
    case SyntaxKind.SuperKeyword:
      return emitSuper(node);
    case SyntaxKind.NullKeyword:
      return write('null');
    case SyntaxKind.TrueKeyword:
      return write('true');
    case SyntaxKind.FalseKeyword:
      return write('false');
    case SyntaxKind.NumericLiteral:
    case SyntaxKind.StringLiteral:
    case SyntaxKind.RegularExpressionLiteral:
    case SyntaxKind.NoSubstitutionTemplateLiteral:
    case SyntaxKind.TemplateHead:
    case SyntaxKind.TemplateMiddle:
    case SyntaxKind.TemplateTail:
      return emitLiteral(<LiteralExpression>node);
    case SyntaxKind.TemplateExpression:
      return emitTemplateExpression(<TemplateExpression>node);
    case SyntaxKind.TemplateSpan:
      return emitTemplateSpan(<TemplateSpan>node);
    case SyntaxKind.JsxElement:
    case SyntaxKind.JsxSelfClosingElement:
      return emitJsxElement(<JsxElement | JsxSelfClosingElement>node);
    case SyntaxKind.JsxText:
      return emitJsxText(<JsxText>node);
    case SyntaxKind.JsxExpression:
      return emitJsxExpression(<JsxExpression>node);
    case SyntaxKind.QualifiedName:
      return emitQualifiedName(<QualifiedName>node);
    case SyntaxKind.ObjectBindingPattern:
      return emitObjectBindingPattern(<BindingPattern>node);
    case SyntaxKind.ArrayBindingPattern:
      return emitArrayBindingPattern(<BindingPattern>node);
    case SyntaxKind.BindingElement:
      return emitBindingElement(<BindingElement>node);
    case SyntaxKind.ArrayLiteralExpression:
      return emitArrayLiteral(<ArrayLiteralExpression>node);
    case SyntaxKind.ObjectLiteralExpression:
      return emitObjectLiteral(<ObjectLiteralExpression>node);
    case SyntaxKind.PropertyAssignment:
      return emitPropertyAssignment(<PropertyDeclaration>node);
    case SyntaxKind.ShorthandPropertyAssignment:
      return emitShorthandPropertyAssignment(<ShorthandPropertyAssignment>node);
    case SyntaxKind.ComputedPropertyName:
      return emitComputedPropertyName(<ComputedPropertyName>node);
    case SyntaxKind.PropertyAccessExpression:
      return emitPropertyAccess(<PropertyAccessExpression>node);
    case SyntaxKind.ElementAccessExpression:
      return emitIndexedAccess(<ElementAccessExpression>node);
    case SyntaxKind.CallExpression:
      return emitCallExpression(<CallExpression>node);
    case SyntaxKind.NewExpression:
      return emitNewExpression(<NewExpression>node);
    case SyntaxKind.TaggedTemplateExpression:
      return emitTaggedTemplateExpression(<TaggedTemplateExpression>node);
    case SyntaxKind.TypeAssertionExpression:
      return emit((<TypeAssertion>node).expression);
    case SyntaxKind.AsExpression:
      return emit((<AsExpression>node).expression);
    case SyntaxKind.ParenthesizedExpression:
      return emitParenExpression(<ParenthesizedExpression>node);
    case SyntaxKind.FunctionDeclaration:
    case SyntaxKind.FunctionExpression:
```
`````

</details>

### chunk 7 / 9　`text`　3522 字符

- id：`emitter-v1-007-c14eb81d9ca0`
- scope（标题路径）：`发射器::发射器函数`
- heading：``emitJavaScriptWorker``（level 3）
- group：`grp-004-emitter.md`
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
heading: `emitJavaScriptWorker`
heading_level: 3
scope: 发射器::发射器函数
```ts
    case SyntaxKind.TaggedTemplateExpression:
      return emitTaggedTemplateExpression(<TaggedTemplateExpression>node);
    case SyntaxKind.TypeAssertionExpression:
      return emit((<TypeAssertion>node).expression);
    case SyntaxKind.AsExpression:
      return emit((<AsExpression>node).expression);
    case SyntaxKind.ParenthesizedExpression:
      return emitParenExpression(<ParenthesizedExpression>node);
    case SyntaxKind.FunctionDeclaration:
    case SyntaxKind.FunctionExpression:
    case SyntaxKind.ArrowFunction:
      return emitFunctionDeclaration(<FunctionLikeDeclaration>node);
    case SyntaxKind.DeleteExpression:
      return emitDeleteExpression(<DeleteExpression>node);
    case SyntaxKind.TypeOfExpression:
      return emitTypeOfExpression(<TypeOfExpression>node);
    case SyntaxKind.VoidExpression:
      return emitVoidExpression(<VoidExpression>node);
    case SyntaxKind.AwaitExpression:
      return emitAwaitExpression(<AwaitExpression>node);
    case SyntaxKind.PrefixUnaryExpression:
      return emitPrefixUnaryExpression(<PrefixUnaryExpression>node);
    case SyntaxKind.PostfixUnaryExpression:
      return emitPostfixUnaryExpression(<PostfixUnaryExpression>node);
    case SyntaxKind.BinaryExpression:
      return emitBinaryExpression(<BinaryExpression>node);
    case SyntaxKind.ConditionalExpression:
      return emitConditionalExpression(<ConditionalExpression>node);
    case SyntaxKind.SpreadElementExpression:
      return emitSpreadElementExpression(<SpreadElementExpression>node);
    case SyntaxKind.YieldExpression:
      return emitYieldExpression(<YieldExpression>node);
    case SyntaxKind.OmittedExpression:
      return;
    case SyntaxKind.Block:
    case SyntaxKind.ModuleBlock:
      return emitBlock(<Block>node);
    case SyntaxKind.VariableStatement:
      return emitVariableStatement(<VariableStatement>node);
    case SyntaxKind.EmptyStatement:
      return write(';');
    case SyntaxKind.ExpressionStatement:
      return emitExpressionStatement(<ExpressionStatement>node);
    case SyntaxKind.IfStatement:
      return emitIfStatement(<IfStatement>node);
    case SyntaxKind.DoStatement:
      return emitDoStatement(<DoStatement>node);
    case SyntaxKind.WhileStatement:
      return emitWhileStatement(<WhileStatement>node);
    case SyntaxKind.ForStatement:
      return emitForStatement(<ForStatement>node);
    case SyntaxKind.ForOfStatement:
    case SyntaxKind.ForInStatement:
      return emitForInOrForOfStatement(<ForInStatement>node);
    case SyntaxKind.ContinueStatement:
    case SyntaxKind.BreakStatement:
      return emitBreakOrContinueStatement(<BreakOrContinueStatement>node);
    case SyntaxKind.ReturnStatement:
      return emitReturnStatement(<ReturnStatement>node);
    case SyntaxKind.WithStatement:
      return emitWithStatement(<WithStatement>node);
    case SyntaxKind.SwitchStatement:
      return emitSwitchStatement(<SwitchStatement>node);
    case SyntaxKind.CaseClause:
    case SyntaxKind.DefaultClause:
      return emitCaseOrDefaultClause(<CaseOrDefaultClause>node);
    case SyntaxKind.LabeledStatement:
      return emitLabelledStatement(<LabeledStatement>node);
    case SyntaxKind.ThrowStatement:
      return emitThrowStatement(<ThrowStatement>node);
    case SyntaxKind.TryStatement:
      return emitTryStatement(<TryStatement>node);
    case SyntaxKind.CatchClause:
      return emitCatchClause(<CatchClause>node);
    case SyntaxKind.DebuggerStatement:
      return emitDebuggerStatement(node);
```
`````

</details>

### chunk 8 / 9　`text`　3038 字符

- id：`emitter-v1-008-42ade355673a`
- scope（标题路径）：`发射器::发射器函数`
- heading：``emitJavaScriptWorker``（level 3）
- group：`grp-004-emitter.md`
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
heading: `emitJavaScriptWorker`
heading_level: 3
scope: 发射器::发射器函数
```ts
    case SyntaxKind.DefaultClause:
      return emitCaseOrDefaultClause(<CaseOrDefaultClause>node);
    case SyntaxKind.LabeledStatement:
      return emitLabelledStatement(<LabeledStatement>node);
    case SyntaxKind.ThrowStatement:
      return emitThrowStatement(<ThrowStatement>node);
    case SyntaxKind.TryStatement:
      return emitTryStatement(<TryStatement>node);
    case SyntaxKind.CatchClause:
      return emitCatchClause(<CatchClause>node);
    case SyntaxKind.DebuggerStatement:
      return emitDebuggerStatement(node);
    case SyntaxKind.VariableDeclaration:
      return emitVariableDeclaration(<VariableDeclaration>node);
    case SyntaxKind.ClassExpression:
      return emitClassExpression(<ClassExpression>node);
    case SyntaxKind.ClassDeclaration:
      return emitClassDeclaration(<ClassDeclaration>node);
    case SyntaxKind.InterfaceDeclaration:
      return emitInterfaceDeclaration(<InterfaceDeclaration>node);
    case SyntaxKind.EnumDeclaration:
      return emitEnumDeclaration(<EnumDeclaration>node);
    case SyntaxKind.EnumMember:
      return emitEnumMember(<EnumMember>node);
    case SyntaxKind.ModuleDeclaration:
      return emitModuleDeclaration(<ModuleDeclaration>node);
    case SyntaxKind.ImportDeclaration:
      return emitImportDeclaration(<ImportDeclaration>node);
    case SyntaxKind.ImportEqualsDeclaration:
      return emitImportEqualsDeclaration(<ImportEqualsDeclaration>node);
    case SyntaxKind.ExportDeclaration:
      return emitExportDeclaration(<ExportDeclaration>node);
    case SyntaxKind.ExportAssignment:
      return emitExportAssignment(<ExportAssignment>node);
    case SyntaxKind.SourceFile:
      return emitSourceFileNode(<SourceFile>node);
  }
}
```

通过简单地调用相应的 `emitXXX` 函数来完成递归，例如 `emitFunctionDeclaration`

```ts
function emitFunctionDeclaration(node: FunctionLikeDeclaration) {
  if (nodeIsMissing(node.body)) {
    return emitOnlyPinnedOrTripleSlashComments(node);
  }

  if (node.kind !== SyntaxKind.MethodDeclaration && node.kind !== SyntaxKind.MethodSignature) {
    // 会把注释当做方法声明的一部分去发射。
    emitLeadingComments(node);
  }

  // 目标为 es6 之前时，使用 function 关键字来发射类函数（functions-like）声明，包括箭头函数
  // 目标为 es6 时，可以发射原生的 ES6 箭头函数，并使用宽箭头代替 function 关键字.
  if (!shouldEmitAsArrowFunction(node)) {
    if (isES6ExportedDeclaration(node)) {
      write('export ');
      if (node.flags & NodeFlags.Default) {
        write('default ');
      }
    }

    write('function');
    if (languageVersion >= ScriptTarget.ES6 && node.asteriskToken) {
      write('*');
    }
    write(' ');
  }

  if (shouldEmitFunctionName(node)) {
    emitDeclarationName(node);
  }

  emitSignatureAndBody(node);
  if (
    languageVersion < ScriptTarget.ES6 &&
    node.kind === SyntaxKind.FunctionDeclaration &&
    node.parent === currentSourceFile &&
    node.name
  ) {
    emitExportMemberAssignments((<FunctionDeclaration>node).name);
  }
  if (node.kind !== SyntaxKind.MethodDeclaration && node.kind !== SyntaxKind.MethodSignature) {
    emitTrailingComments(node);
  }
}
```

`````

</details>

### chunk 9 / 9　`text`　2319 字符

- id：`emitter-v1-009-98659ba42498`
- scope（标题路径）：`发射器`
- heading：`发射器源映射（SourceMaps）`（level 2）
- group：（无）
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
heading: 发射器源映射（SourceMaps）
heading_level: 2
scope: 发射器
## 发射器源映射（SourceMaps）

如前所述 `emitter.ts` 中的大部分代码是函数 `emitJavaScript`（我们之前展示过该函数的初始化例程）。
它主要是设置一批本地变量并交给 `emitSourceFile` 处理。下面我们再看一遍这个函数，这次我们重点关注 `SourceMap` 的部分：

```ts
function emitJavaScript(jsFilePath: string, root?: SourceFile) {

    // 无关代码 ........... 已移除
    let writeComment = writeCommentRange;

    /** 将发射的输出写到磁盘上 */
    let writeEmittedFiles = writeJavaScriptFile;

    /** 发射一个节点 */
    let emit = emitNodeWithoutSourceMap;

    /** 节点发射前调用 */
    let emitStart = function (node: Node) { };

    /** 节点发射完成后调用 */
    let emitEnd = function (node: Node) { };

    /** 从 startPos 位置开始，为指定的 token 发射文本。默认写入的文本由 tokenKind 提供，
      * 但是如果提供了可选的 emitFn 回调，将使用该回调来代替默认方式发射文本。
      * @param tokenKind 要搜索并发射的 token 的类别
      * @param startPos 源码中搜索 token 的起始位置
      * @param emitFn 如果给出，会被调用来进行文本的发射。*/
    let emitToken = emitTokenText;

    /** 该函数因为节点，会在发射的代码中于函数或类中启用词法作用域前调用
      * @param scopeDeclaration 启动词法作用域的节点
      * @param scopeName 可选的作用域的名称，而不是从节点声明中推导
      */
    let scopeEmitStart = function(scopeDeclaration: Node, scopeName?: string) { };

    /** 出了作用域后调用 */
    let scopeEmitEnd = function() { };

    /** 会被编码的 Sourcemap 数据 */
    let sourceMapData: SourceMapData;

    if (compilerOptions.sourceMap || compilerOptions.inlineSourceMap) {
        initializeEmitterWithSourceMaps();
    }

    if (root) {
        // 不要直接调用 emit，那样不会设置 currentSourceFile
        emitSourceFile(root);
    }
    else {
        forEach(host.getSourceFiles(), sourceFile => {
            if (!isExternalModuleOrDeclarationFile(sourceFile)) {
                emitSourceFile(sourceFile);
            }
        });
    }

    writeLine();
    writeEmittedFiles(writer.getText(), /*writeByteOrderMark*/ compilerOptions.emitBOM);
    return;
```

重要的函数调用： `initializeEmitterWithSourceMaps`，该函数是 `emitJavaScript` 的本地函数，它覆盖了部分已定义的本地函数。
覆盖的函数可以在 `initalizeEmitterWithSourceMap` 的底部找到：

```ts
// `initializeEmitterWithSourceMaps` 函数的最后部分

writeEmittedFiles = writeJavaScriptAndSourceMapFile;
emit = emitNodeWithSourceMap;
emitStart = recordEmitNodeStartSpan;
emitEnd = recordEmitNodeEndSpan;
emitToken = writeTextWithSpanRecord;
scopeEmitStart = recordScopeNameOfNode;
scopeEmitEnd = recordScopeNameEnd;
writeComment = writeCommentRangeWithMap;
```

就是说大部分的发射器代码不关心 `SourceMap`，它们以相同的方式使用这些（带或不带 SourceMap 的）本地函数。

`````

</details>

## 4. truthy.md

- 说明：含 0 个 outline / 1 个表格块 —— 确认多窗归并与表格原子性
- 格式：`md`　文档标题：`Truthy`
- sections：2　chunks：3

### chunk 1 / 3　`text`　182 字符

- id：`truthy-v1-001-2d67f8343d30`
- scope（标题路径）：（无）
- heading：`Truthy`（level 1）
- group：（无）
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
heading: Truthy
heading_level: 1
# Truthy

JavaScript 有一个 `truthy` 概念，即在某些场景下会被推断为 `true`，例如除 `0` 以外的任何数字：

```ts
if (123) {
  // 将会被推断出 `true`
  console.log('Any number other than 0 is truthy');
}
```

你可以用下表来做参考：

`````

</details>

### chunk 2 / 3　`table`　300 字符

- id：`truthy-v1-002-fdb76ad7d7fb`
- scope（标题路径）：（无）
- heading：`Truthy`（level 1）
- group：（无）
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
heading: Truthy
heading_level: 1
| **Variable Type** | **When it is falsy** | **When it is truthy** |
| --- | --- | --- |
| boolean | false | true |
| string | ' ' (empty string) | any other string |
| number | 0 NaN | any other number |
| null | always | never |
| Any other Object including empty ones like {},[] | never | always |
`````

</details>

### chunk 3 / 3　`text`　317 字符

- id：`truthy-v1-003-22d073d9166b`
- scope（标题路径）：`Truthy`
- heading：`明确的`（level 2）
- group：（无）
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
heading: 明确的
heading_level: 2
scope: Truthy
## 明确的

通过操作符 `!!`，你可以很容易的将某些值转化为布尔类型的值，例如：`!!foo`，它使用了两次 `!`，第一个 `!` 用来将其（在这里是 `foo`）转换为布尔值，但是这一操作取得的是其取反后的值，第二个取反时，能得到真正的布尔值。

这在很多地方都可以看到：

```ts
// Direct variables
const hasName = !!name;

// As members of objects
const someObj = {
  hasName: !!name
};

// ReactJS
{
  !!someName && <div>{someName}</div>;
}
```

`````

</details>

## 5. 报告.docx

- 说明：无标题结构文档（heading 节点为 0） —— 验证无标题时按段落聚合的兜底，以及表格结构化
- 格式：`docx`　文档标题：`报告.docx`
- sections：1　chunks：14

### chunk 1 / 14　`outline`　16 字符

- id：`---v1-001-026b5f95545b`
- scope（标题路径）：（无）
- heading：（无）
- group：`grp-000---.docx`
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
document section
`````

</details>

### chunk 2 / 14　`text`　223 字符

- id：`---v1-002-12d151a6311c`
- scope（标题路径）：（无）
- heading：（无）
- group：`grp-000---.docx`
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
地球物理实习报告

地球物理学2303 李恒

0110230306

实习时间

2026年7月5日到2026年7月24日

实习地点

湖南岳阳市岳阳县黄秀农耕文化园

具体安排

课程：磁法，常规电法，探地雷达，高密度电法，地震，瞬变电磁

6月29号开始陆续进行早课，分别讲述各个方法的内容

7月5号正式出发前往岳阳市岳阳县

7月18日结束课程内容，开始处理数据，整理分析资料

7月22日课程答辩

7月24日回校

异常体分布图

`````

</details>

### chunk 3 / 14　`table`　1546 字符

- id：`---v1-003-3fbf28e04b06`
- scope（标题路径）：（无）
- heading：（无）
- group：（无）
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
| 探 测 编 号 | 目标体 |  | 直径/m | 长/m | 埋深/m | 覆土情况 | 探区范围 | 工区编号 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 混凝土球 | 两平行混凝土球(浅埋) | 1.0 | / | 2.5 | 建筑石块和松散石土&土壤均匀、密实 | 1.2m×5m | 1910 |
| 2 | 两平行混凝土球(深埋) | 1.0 | / | 3.8 | 均质土壤(待核实) | 1.2m×5m |  |  |
| 3 | 混凝土球 (单一深埋) | 1.0 | / | 4.0 | 均质土壤(待核实) | 1.2m×4m | 11 |  |
| 4 | 混凝土管 | 混凝土管(大管径，浅埋) | 1.8 | 4 | 1.2 | 均质土壤(待核实) | 5m×8m | 2 |
| 5 | 混凝土管(大管径，深埋) | 1.8 | 4 | 2.5 | 均质土壤(待核实) | 5m×8m | 5 |  |
| 6 | 混凝土管(小管径，深埋) | 1.0 | 4 | 2.7 | 均质土壤(待核实) | 4m×8m | 14 |  |
| 7 | PE 管 | PE 管(浅埋) | 0.7 | 3 | 1.4 | 均质土壤，赋存植物根系 | 2m×5m | 4 |
| 8 | PE 管(深埋) | 0.7 | 3 | 2.4 | 均质土壤(待核实) | 2m×5m | 17 |  |
| 9 | 轮胎 | 轮胎(小管径，较浅埋) | 0.6 | 3 | 1.0 | 均质土壤(待核实) | 2m×5m | 13 |
| 10 | 轮胎(小管径，浅埋) | 0.6 | 3 | 1.4 | 下层覆盖 1m 土壤，上层覆盖建筑垃圾 | 2m×5m | 3 |  |
| 11 | 轮胎(小管径，浅埋) | 0.6 | 3 | 1.5 | 均质土壤(待核实) | 2m×5m | 12 |  |
| 12 | 轮胎(大管径，深埋) | 1 | 4 | 2.9 | 均质土壤(待核实) | 2m×5m | 6 |  |
| 13 | 铁管 | 铁管(深埋) | 0.7 | 3 | 2.5 | 均质土壤(待核实) | 2m×5m | 16 |
| 14 | 铁管(浅埋) | 0.7 | 3 | 1.4 | 均质土壤(待核实) | 2m×5m | 18 |  |
| 15 | 混凝土管 | 混凝土管(上下两层，间隔 1m) | 1.0 | 4 | 1.2 | 上层 | 4m×8m | 15 |
| 0.8 | 4 | 3.2 | 下层 |  |  |  |  |  |
| 16 | 混凝土管(左右平行，间隔 1.5m) | 0.8 | 4 | 2.2 | 左侧 | 4m×8m | 19 |  |
| 0.8 | 4 | 2.2 | 右侧 |  |  |  |  |  |
| 17 | 水池 | 小水池(砖砌) | 长 3m，宽 1.5m，高2m |  |  | 埋深不明 | 5m×8m | 7 |
| 18 | 大水池(砖砌) | 长 3m，宽 2m，高 1.5m |  |  | 埋深不明 | 5m×8m | 8 |  |
| 19 | 有缺陷的桩 |  | 桩径 0.5m桩长 5.5m |  |  | 3.4m 处填充 0.3m 厚的泡沫，塑料管间距 3.5m | 5m×8m | 20 |
| 20 | 铁板 | 竖直铁板 | / | / | / | / | / | 21 |
| 21 | 倾斜铁板 | / | / | / | / | / | 22 |  |
`````

</details>

### chunk 4 / 14　`text`　1354 字符

- id：`---v1-004-09ebb622288e`
- scope（标题路径）：（无）
- heading：（无）
- group：`grp-000---.docx`
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
磁法勘探

老师： 郭安栋，胡艳芳

实习要求

通过本次实习，能熟练地运用课堂所学磁法勘探知识及基本理论，开展磁法勘探以解决实际工程问题。

1、通过实践加深对磁法勘探理论的认识和理解。

2、结合地质资料和现场踏勘情况，初步掌握如何开展磁法勘探的野外工程设计。

3，能独立开展野外磁法勘探工作，熟练磁法勘探野外工作基本过程。

4，初步掌握磁法数据处理。

5，能对磁法勘探数据开展简单的定性和定量解释。

6，结合地质等资料开展初级的磁法勘探地质推断，以解决实际工程问题。

原理

磁法勘探

磁法勘探是以岩（矿）石间的磁性差异为基础，通过观测和分析地磁场的变化特征，查明研究对象地质特征和性质的一种地球物理方法。

解释

地球有两个磁极，磁北极和磁南极；地磁场与一个均匀磁化的球体或位于地球中心的一个磁偶极子的磁场很类似。磁轴与地理的轴不重合，交角为11.5°。

地磁场是一个弱磁场（平均强度约为50000nT），且是基本稳定的磁场。

地磁场是地球内部电流环产生的磁场，可近似为磁偶极子产生的磁场。地磁场强度：是表示磁场强弱的物理量，地球周围某一点处单位正磁荷所受到的磁力大小，也就是我们测量的总磁感应强度大小，这是一个标量，单位是nT(纳特斯拉)

地磁七要素

对应的地磁场强度大小计算如下图，图中的D是磁偏角(Declination)，I是磁倾角(Inclination)，根据海拔和经纬度可计算得该测量地区的D约为-4.3度，I约为45度

磁感应强度大小的计算

地球磁场由以下部分组成，我们实验中需要求出异常场，什么是异常场呢？在地磁学研究中，基本磁场为正常场，也称背景场。地壳内的岩石矿物及地质体在基本磁场磁化作用下产生的磁场，称为地壳磁场，又称为异常场或磁异常，所以求出测区测点对应的磁异常可以大致判断该点的地下情况。

磁异常Ta 是一个矢量场，在实际工作中直接测量Ta 的大小和方向是比较困难的，因此通常测量Ta 的分量。所以你能看到我们在磁异常等值线图处理中有化极和垂直求导的部分。

怎么大致判断我们这里的地磁场强度大小？全球范围的地磁图一般是基本磁场的分布图称为国际地磁参考场，由这个可得该地的地磁场强度大概是49000nT。地磁场总强度等值线与纬度线近似平行，在磁赤道附近强度约为30000~40000nT；随着纬度的升高，强度逐渐增大，到两极约为60000~70000nT。地磁场垂直分量等值线与纬度线近似平行，在磁赤道附近强度为0；随着纬度的升高，强度逐渐增大，到两极约为±60000~70000nT，南半球为负，北半球为正。地磁场水平分量等值线与纬度线近似平行，在磁赤道附近强度约为30000~40000nT；随着纬度的升高，强度逐渐减小，到两极为0。地磁场磁倾角等值线与纬度线近似平行，零倾线在地理赤道附近，称为磁赤道，它不是一条直线，磁赤道向北倾角为正，向南为负。

我们要处理的是短期变化因素，如日变场，地磁日变周期为24小时，各要素逐日不停地变化，其中振幅易变相位稳定，依赖于地方时，地磁日变在较大范围内基本相同，日变幅度可达几十nT，在磁法勘探中应予以校正。

实验

本次实习使用的仪器为重庆顶峰地质勘探仪器有限公司生产的MZC-2质子磁力仪

`````

</details>

### chunk 5 / 14　`table`　343 字符

- id：`---v1-005-94cc7087b813`
- scope（标题路径）：（无）
- heading：（无）
- group：（无）
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
| 主机重量 | 1.9kg |
| --- | --- |
| 主机体积 | 200×115×230mm |
| 探头重量 | 0.8kg |
| 探头体积 | 155mm长×75mm直径 |
| 采集界面 | android系统操作界面 |
| 通讯方式 | 蓝牙通讯 |
| 通讯距离 | 蓝牙通讯10米，数据传输1KM，公网传输距离不限； |
| 测量范围 | 标配20,000nT～120,000nT，可定制10000nT-150000nT； |
| 灵敏度 | 0.05nT（精细模式） |
| 分辨率 | ±0.01nT |
| 测量精度 | ±0.2nT（精细模式）；±0.5nT（正常模式） |
| 测量速度 | ≤3秒/读数（精细模式）；≤2秒/读数（正常模式） |
`````

</details>

### chunk 6 / 14　`text`　1728 字符

- id：`---v1-006-b33f789a6066`
- scope（标题路径）：（无）
- heading：（无）
- group：`grp-000---.docx`
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
探头 主机 采集软件

带正电且具有自旋的核会产生磁场，该自旋磁场与外加磁场相互作用，将会产生进动，进动的频率与自旋核角速度及外加磁场的关系可用拉莫尔方程表示。

质子磁力仪的样品是含有大量质子的液体，如水、煤油、酒精等，这些质子是一种带有正电荷的粒子，没有外界磁场作用时，其本身在不停地自旋，且无规则。若垂直于地磁场 T 的方向，加一强人工磁场 Ho，则样品中的质子磁矩将按 Ho 方向排列起来，此过程称为极化。切断磁场 Ho ，则地磁场对质子有p×T 力矩作用，试图将质子拉回到地磁场方向，由于质子自旋，质子磁矩p将绕着地磁场T 的方向作旋进运动，其旋进频率 f 与地磁场 T 有关系：T=23.4874f（单位：伽马），当测定出频率 f 后，即可计算出总磁场强度 T 的数值。

测线布置

6条测线，每条线7个测点。点距5m，线距5m。4号线上有YC20,YC18两个异常，所以

4号线上多加了8个点，也就是在0-5m，20-25m间多加了8个点，点距1m。

实验过程

我们携带4台仪器前往测区，在途中，我们选择一块平坦的地方对4台仪器进行对比测试，都选择基站模式，每隔15s测量一次。同一时间测量，测完189个点后，同时停止。计算每台仪器测量结果的标准差。

在测量过程中发现有一台仪器出现故障，计算另外3台仪器，选出标准差最小的数据，也就是稳定性最好，将对应的仪器作为日变站。

测区图

如上图所示，我们先布置好日变站，设置为基站模式，先启动测量。然后将10人分为两组，分别对123，456号线进行行走模式测量。测量完成后，导出数据

截取的日变站数据

一号线数据

数据处理

磁异常等值线图，如下。计算公式是测点地磁强度减去对应时刻日变地磁强度，没有处理高度改正，测点的高度基本一致。对应时刻的日变地磁强度是通过拉格朗日插值实现。通过网格化数据，绘制出等值线图象

磁异常等值线图

可以看到图中在4号线0-5m内并未体现出明显的正异常，在20-25m内有明显的正异常，在20-25m内是YC18，而在2号线10-20米有圆形的负异常，我们推断是铁管造成的，1号线在25-30米有负异常，推断是路牌造成的

位场处理之向上延拓，延拓后异常被压制，浅部高频干扰被平滑。延拓到 20m 时只剩大尺度区域异常

向上延拓

位场处理之化极，把斜磁化异常转换成垂直磁化异常。化极后正异常中心更接近磁性体正上方

化极

位场处理之垂直求导，锐化异常，零值线大致对应磁性体边界

垂直求导

高密度电法

老师：谢静

实习要求

1. 复习常规电法的原理，以及各种测量装置

2. 学会使用GD-10仪器使用

3. 处理数据使用RES2DINV软件，分析断面，剖面，滚动线，对数据进行格式转换，物理反演，绘制图象，分析数据和图象

原理

高密度电阻率法属于常规电阻率法，其工作原理与常规电阻率法完全相同，仍然以岩、矿石的电性差异为基础，通过观测和研究人工建立的地下稳定电场的分布规律来解决水文、环境和工程地质问题。

原理参考常规电法，我们测量了偶极偶极装置，温纳装置，施伦贝谢尔装置

实验

点位分布

温纳装置

特点：测量断面为倒梯形，

描述：测量时，AM=MIN=NB为一个电极间距，A、B、M、N逐点同时向右移动，得到第一条剖面线：接着AM、MB、NB增大一个电极间距，A、B、M、N逐点同时向右移动动，得到另一条剖面线：这样不断扫描测量下去，得到倒梯形断面。

偶极偶极装置

特点：测量断面为倒梯形，

描述：测量时，AB=BM=MIN为一个电极间距，A、B、M、门逐点同时向右移动，得到第一条剖面线：接看AB、BM、MN增大一个电极间距，A、B、M、N逐点同时向右移动得到另一条剖面线：这样不断描测量下去，得到倒梯形断面

施伦贝谢尔装置

特点：测量断面为倒梯形，

描述：测量时，AM=MN=NB为一个电极间距，A、B、M、N逐点同时向石移动，得到第一条剖面线：接着AM、NB增大一个电极间距，MN始终为一个电极间距，A、B、M、N逐点同时同右移动，得到另一条剖面线：这样不断扫描测量下去，得到倒梯形断面

`````

</details>

### chunk 7 / 14　`table`　252 字符

- id：`---v1-007-7724d52d021a`
- scope（标题路径）：（无）
- heading：（无）
- group：（无）
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
| 温纳装置（Wenner） | 水平探测分辨率较高，对电性变化反应灵敏。 |
| --- | --- |
| 施伦贝谢装置（Schlumberger） | 对地质体的水平分辨率很高，适合水平方向的探测。 |
| 偶极-偶极装置（Dipole-Dipole） | 水平探测分辨率较高，具有较好的敏感性，但信号强度较弱。 |
| 温纳-施伦贝尔组合装置 | 在测深方面具有优势，适合深部基岩的探测。 |
| 微分装置（Differential） | 可以作为探测检测对比装置，有助于提高数据的解释能力。 |
`````

</details>

### chunk 8 / 14　`text`　646 字符

- id：`---v1-008-65ba97b04e60`
- scope（标题路径）：（无）
- heading：（无）
- group：`grp-000---.docx`
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
仪器

仪器主机显示页面

布置

点距越小对目标体的探测精度相对越高，但是如果电极数不变，随着点距的减小，排列长度也相应减小，从而也减小了探测深度，影响了对埋深较大的异常体的探测能力。所以电极的排列长度和点距的大小直接影响着高密度电法对地下目标物的勘探能力，也影响我们对地下结构的数据采集和图象判断，我们此次测量使用的是60m，点距1m。

仪器页面

对测量的数据进行坏点处理，突变点和负值点进行删除

使用RES2DINV处理：

侧线1-温纳装置

放大第三个图象，也就是二维反演图象

实际上在这条测线上有4个异常体，14m处YC01,22m处YC02，36m处YC03,40m处YC04

侧线1-施伦贝谢尔装置

侧线1-偶极偶极装置

侧线2-温纳装置

侧线2-偶极偶极装置

探地雷达

老师：王珣

实习要求

1）了解地质雷达剖面法测量原理。

2）学会地质雷达剖面法测量参数设置方法。

3）学会使用 GSSI-SIR-4000 型地质雷达进行剖面法数据采集。

4）通过实验加深对地质雷达剖面法数据采集的理解。

原理

探地雷达GPR 采用电磁波探测技术，频率一般在5-3000MHz，用于对地下结构，埋藏物以及人造结构成像。 地下不同物体或介质的差异，会对电磁波进行反射，使用者根据反射图像判断地下异常体。

介质（材料）的三个因子决定电磁波在的传播特性：介电常数，磁导率，电导率。地下物质的传播特性差异使得探地雷达这种地球物理方法出现

探地雷达的优缺点：

`````

</details>

### chunk 9 / 14　`table`　615 字符

- id：`---v1-009-62bc0d21fc6e`
- scope（标题路径）：（无）
- heading：（无）
- group：（无）
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
| 无损性：由于探地雷达是利用高频电磁波来探测地下目标和结构的，因而其探测 具有非破坏性，不会对介质产生任何损伤，可以安全地应用在城市和正在建设中的施工现场 |
| --- |
| 宽频带：无载波脉冲探地雷达由于发射接收基带脉冲、非调制信号，具有极 宽的频带，能利用信号处理技术，提高探测能力和分辨能力。 |
| 高分辨率：探地雷达工作频率可达5000MHz，分辨率可达到厘米数量级，因而可 准确确定目标体的尺寸、空间位置和物理特征。例如在公路路面探测中， 车载探地雷达以40km/h的速度进行探测时，距离采样间隔能够达到精度。可见，探地雷达的高分辨率，是探地雷达优于其它地球物理方法的最重要的标志。 |
| 探测效率高：探地雷达仪器轻便，不需要复杂的震源和接收装置，从数据采集到处理成像一体化，操作简单，采样迅速，工作人员少，因而探测效率高。此外，采样和接收时间短，因而可以高效率地进行探测。 |
| 抗干扰能力强 ：探地雷达的天线通常是封装于只对地面开口的金属壳内的，它只能接收地面直达波和来自地下的回波信号，其它外界电磁干扰很难进入系统，因此，它可以在各种环境下正常工作 |
| 使用灵活方便、结果直观 抗干扰能力强 探测效率高：GPR整机重量和体积都较小，技术集成度高，操作简单，携带方便，使用灵活。探地雷达采用剖面法进行探测，结果直观反映地下介质的变化规律。即使不进行复杂的数据处理，一般工作人员也能进行资料的解释。 |
`````

</details>

### chunk 10 / 14　`text`　9 字符

- id：`---v1-010-5587e92c1a30`
- scope（标题路径）：（无）
- heading：（无）
- group：`grp-000---.docx`
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
优点

衍射图象

`````

</details>

### chunk 11 / 14　`table`　311 字符

- id：`---v1-011-db6631cf1ff0`
- scope（标题路径）：（无）
- heading：（无）
- group：（无）
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
| 探地雷达采用高频电磁波进行探测，在高导介质中传播具有较大的衰减，限制雷达波的穿透能力。 |
| --- |
| 对于电磁脉冲，不同频率成分的衰减程度不同，高频成分衰减较严重，而低频成分衰减较少，探测中会降低探测的分辨率，这是探地雷达的一个主要局限性。 |
| GPR波的强度在它离开天线时最强，然后逐渐减弱。由于这种衰减，来自深目标的探地雷达回波可能无法探测到。 |
| 水的介电常数比较大(相对介电常为81，一般岩石为6左右)，探地雷达探测的响应水具有较大的影响。为探地雷达探测带来了困难，因为地表的气候条件变化较快，地面的干湿将严重影响探测的结果，也影响探地雷达探测资料的重复性，对资料的评价和结果解释带来困难 |
`````

</details>

### chunk 12 / 14　`text`　1703 字符

- id：`---v1-012-050ec94a60b2`
- scope（标题路径）：（无）
- heading：（无）
- group：`grp-000---.docx`
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
缺点

地质雷达是一种地球物理高频宽带电磁探测方法，其基本原理是通过位于地表的发射天线 T 向地下地质结构（电磁波速度 v）辐射宽频带高频脉冲电磁波， 当高频宽带电磁波遇到不同电性介质分界面或目标体时会发生反射、绕射和散射现象，上述高频电磁波返回至地表并被放置于地表的接收天线 R 接收与记录，如图 1-3 所示。高频电磁波在地下介质结构中传播时，受介质的介电参数、空间形态等特征的综合影响， 其强度、路径和波形会发生相应的变化， 并携带地下介质结构信息。因此， 可以根据地质雷达剖面中高频电磁波的振幅、相位、频率、走时等参数， 获取地下介质分界面或目标体的形态、位置、电性等信息，从而实现地下目标体的精确探测与定位。

假设 x 表示收发天线间距，z 表示目标体的深度，v 表示地下介质的电磁波传播速度，由图 1-3 可知，高频电磁波从发射到接收的旅行时间，即双程走时可表示为

t

当地下介质速度 v 已知时， 根据电磁波双程走时 t ，则可计算出地下目标体的深度z。

仪器

主要器材： SIR-4000 型地质雷达主机 1 台，地质雷达天线 5 根（中心频率分别为 100 MHz ，200 MHz ，400 MHz ，900 MHz），电缆线若干、测距轮 1 个、拉杆 1 个、锂电池 1个、米尺 1 把。

SIR-4000 型地质雷达（Ground Penetrating Radar, GPR）是一款由美国地球物理测量公司（GSSI）研制生产的一款轻便、便携式、地面透视雷达仪器如图 1-1 和图 1-2 所示，其基于 Windows8 的主机界面时尚、友好和个性化；界面提供了 10.4 英寸 LED 阳光型屏幕，便于用户在强光下工作， 且屏幕颜色可选。主机既可连接模拟天线又能连接数字天线，还能够智能识别和设置智能天线；全新的旋钮设计可使仪器操作更加简便、提高工作效率。 SIR-4000 型地质雷达仪器已被广泛应用于隧道工程检测，路面及路基的无损检测，地下管线及空洞探测，堤坝、桥梁、混凝土病害的无损检测，冰层与冻土探测，矿产、地质、水文勘察， 考古探测等工程检测问题。

图 1-1 SIR-4000 型地质雷达雷达主机           图 1-2 SIR-4000 型地质雷达天线（中心频率为 100MHz）

实验

剖面法（Common offset method）是目前地质雷达数据采集应用最为广泛的测量方式，具有操作简单、采集效率高，适用于连续、快速和大范围探测的优点，其采集的地质雷达剖面能够较为准确地反映测线下方各反射界面的起伏形态和目标体位置。

剖面法是一种发射天线（T）和接收天线（R）以固定间距沿测线方向进行等距离同步移动的一种地质雷达测量方式，如图 2-1 所示。数据采集过程中，收发天线间距固定不变，沿测线方向进行等距离同步移动，剖面法测量结果通常采用时间域地质雷达剖面表示，

坐标记录天线在地表的位置，纵坐标为反射波双程走时，其结果能较为准确反映测线下方地下各反射界面形态。

测量模式是指驱动地质雷达收发天线进行数据采集的方式，主要有：距离模式，时间模式，点测模式。距离模式一般采用测量轮或人工设置标志点来确定距离进行测量，通常应用于地形比较平坦或障碍物很少的情况。 时间模式一般通过时间改变来驱动数据采集，通常应用于地形比较平坦或障碍物很少的情况。点测模式一般通过人为控制主机或天线来进行数据采集， 以测点为单位进行移动和测量，一般在地形比较复杂或障碍物较多的情况下开展。

本次实验采用距离模式进行数据采集。

注意事项

1）剖面法测量时， 测点位置是天线顶部左右两侧的黑色横线位置。

2）测量过程中如发现测量参数设置有误， 可终止采集并调整和更改测量参数。

3）距离模式测量时，测量轮安装在天线移动方向的反方向。

测量结果

测线1 小树林

测线2 凉亭边

测线3 凉亭边

常规电法

老师：佟铁钢

实习要求

原理

当向地下供入电流或切断电流的瞬间，在测量电极之间总能观测到随时间变化的电位差，称为激电效应

实验

`````

</details>

### chunk 13 / 14　`table`　12 字符

- id：`---v1-013-6713515b1dfc`
- scope（标题路径）：（无）
- heading：（无）
- group：（无）
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
|  |
| --- |
`````

</details>

### chunk 14 / 14　`text`　78 字符

- id：`---v1-014-28718f8d9820`
- scope（标题路径）：（无）
- heading：（无）
- group：`grp-000---.docx`
- 代码 fence 配平：✅

<details><summary>送去 embedding 的完整文本</summary>

`````text
瞬变电磁

老师：童孝忠

实习要求

原理

当向地下供入电流或切断电流的瞬间，在测量电极之间总能观测到随时间变化的电位差，称为激电效应

实验

地震

`````

</details>

## 6. resume.pdf

- 说明：PDF 文档 —— 验证 PDF 路径与页码溯源
- 格式：`pdf`　文档标题：`resume.pdf`
- sections：1　chunks：1

### chunk 1 / 1　`text`　2032 字符

- id：`resume-v1-001-91981b57a2b4`
- scope（标题路径）：（无）
- heading：（无）
- group：（无）
- 代码 fence 配平：✅
- 页码：[1]

<details><summary>送去 embedding 的完整文本</summary>

`````text
李恒

求职意向：AI Agent 全栈开发⼯程师

|

⼀周内到岗

年 龄

21 岁

性 别

男

⼯作年限

应届⽣

电 话

13551458597

邮 箱

0110230306@csu.edu.cn

教育背景

2023-09

〜

⾄今

中南⼤学

物理学

(本科)

- 获得 25 年湖南省级奖学⾦，完成「⾮结构化⽹格的三维重⼒异常正演」

- 针对校内伪随机信号⽣成软件开发，完成 偏微分⽅程数据计算多种算法 的优化，拿到本院两位博⼠⽣导师的本科⽣奖学⾦

技能特⻓

- 熟悉 AI Agent 全栈开发，具有两个企业项⽬实战开发经验，熟悉 Agent 相关概念，如：上下⽂管理、Context Window、 Human-inthe-loop、Runtime、Temperature 和 Transformer 等

- 熟悉 NodeJS、前端、Python 等开发⽅向，熟悉 LangChain、LangGraph 等 Agent 框架⽣态，理解 Agent 与 LLM 在 任务规划、⼯程 调⽤、执⾏流程上的差别

- 具备⼀定的算法能⼒，可以把算法逻辑应⽤到项⽬开发实战中，并以此完成校内多个软件算法重构，得到校内多位博导的⾼度认可，并 获得对应博导本科⽣奖学⾦

项⽬经历

AI 编程 Agent ⼯作流升级

Python、MCP、Agent Runtime、ReAct、Human-in-the-loop

- 设计可替换 Agent Provider，将模型决策统⼀约束为 Action、Replan 和 Final 三类结构化结果，使真实模型与预设执⾏轨迹能够复⽤ 同⼀套 Agent Runtime。

- 基于 ReAct 实现模型与⼯具的多轮执⾏闭环，将代码读取、代码搜索、受控修改、⽂件删除、测试、类型检查和 Diff 查询封装为 Tool，并将⼯具结果校验后保存为 Observation，驱动模型决定下⼀步操作

- 引⼊ Plan-and-Execute，将⾃然语⾔需求转换为结构化 Plan State，维护步骤状态、依赖关系和 Completion Criteria；当失败测试推翻 初始判断时执⾏增量 Replanning，保留已完成步骤并⽣成 Plan v2

- 实现 Agent Runtime，统⼀管理 Agent Run State、计划、模型决策、⼯具调⽤、验证结果和停⽌原因，通过最⼤迭代、⼯具调⽤、执 ⾏时间、⽂件变更数量及重复 Action 检测，避免 Agent ⽆限循环或持续消耗资源。

- 为每次 Agent Run 创建独⽴代码⼯作区，通过路径边界、⽂件⽩名单和受控命令限制模型权限，禁⽌修改测试⽂件、越过⼯作区访问 ⽂件或执⾏任意 Shell 命令

- 建⽴代码任务验收链路，综合测试结果、TypeScript 类型检查、最终 Diff 和 Completion Criteria 判断任务是否完成，避免仅根据模型 ⽣成的最终回答结束 Agent Run

- 增加 Human-in-the-Loop 确认环节，Runtime 在执⾏前暂停任务并保存待审批 Action，涉及到敏感代码操作场景时，通过弹窗确认的 形式完成⼈⼯交互，避免出现系统性错误

Agent 知识库问答平台

NestJS、Milvus、智谱、Rerank、RAG、BM25、Vue、Vite

- 通过 SSE 对接 Agent 服务，实现成⽂本流式渲染、加载、中断 等控制，基于 LangChain 实现意图识别、⼯具调⽤、结果汇总 等功 能，并沉淀出可复⽤⽅案

- 设计并实现 RAG ⽂档⼊库链路，⽀持 Markdown ⽂档解析、清洗、分块、Chunk ID ⽣成和 Metadata 管理，为后续检索、来源引⽤和 版本更新提供基础数据

- 基于 GLM Embedding ⽣成⽂本向量，并使⽤ Milvus 存储 Chunk、向量和业务 Metadata，实现向量持久化、TopK 检索、Metadata Filter 和⽂档更新能⼒

- 实现向量检索与 BM25 关键词检索的混合召回，通过 RRF 融合两路检索结果，并接⼊ Rerank 模型对候选 Chunk 进⾏精排，提⾼复杂 问题下的召回率和相关性

- 设置 Agent 权限分离系统，针对不同权限部⻔分别设置 Agent 回答权限，配合 LLM 和 Mlivus 完成召回前识别能⼒

- 实现基于重复⽂档检测和版本切换机制，⽀持⽂档更新功能，可达到更新后新版本⽣效、旧版本保留但不参与正常检索的能⼒

- 实现 RAG 效果评估脚本，使⽤ Recall@K、MRR 和 Faithfulness 分析召回、排序和答案忠实度问题，为后续检索参数、分块策略 和 Rerank 调优提供依据

`````

</details>

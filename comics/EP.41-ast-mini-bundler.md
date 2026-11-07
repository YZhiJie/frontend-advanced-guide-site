# EP.41 AST 里藏了啥

> 对应正文：[第四部分 · 框架深入理解](../27-mini-framework.md)

## 剧情回顾

- **第 1 格**：标签君看打包报告——tree-shaking 抖掉了 `add`（没被 import），但 `dead`（export default 里被 call 的函数）还在。为啥 default export 里的函数体代码都被标成 reachable？
- **第 2 格**：码叔点破——tree-shaking 不是"删没被 import 的 export"，而是 AST 遍历"标记 reachable 引用 → 删除未标记节点"。reachability 从入口（main.js import 的东西）出发，递归遍历所有 Identifier 引用。`export default function() { return dead() }` 里这个默认导出被 import 了，所以函数体 reachable，函数体里 call 了 `dead()`，于是 `dead` 也 reachable——环环相扣抖不掉。
- **第 3 格**：像素酱用 acorn parse 手写 mini-bundler——walk AST、mark reachability、generate 输出。实测：`add/sub/mul` 三个 export，main.js 只 import 了 add，打包后 sub 和 mul 真没了。420B → 132B，-69%。
- **第 4 格**：码叔结案——四个 tree-shaking 死角：eval/new Function 里的代码 AST 碰不到；CJS 的 `require(variable)` 动态路径做不到静态分析；需要配合 `sideEffects: false` / `/* #__PURE__ */` 注释才能激进抖；export default 里所有引用跟着 default 走。

## 知识点拆解

### 第 1 格 · tree-shaking 到底在摇谁

tree-shaking（最初由 Rollup 2015 年推广）的本质是 **DCE（Dead Code Elimination）的模块级实现**。它不是"没被 import 的 export 都删掉"，而是：

1. 从入口文件出发，收集所有 import 声明（静态）；
2. 递归 import 的模块，收集它的 export 中被引用的部分；
3. 为每个 export 建立**内部引用图**——函数体里 call 了谁、引用了谁，都连边；
4. 从被外部引用的 export 出发，深度优先遍历所有引用，标记 reachable；
5. 删除所有未标记 reachable 的 AST 节点。

所以 `export function sub() {}` 即使没被 import，如果它被本模块另一个 export 引用了，一样会被打进包里。

### 第 2 格 · AST walker 长啥样

```js
const acorn = require('acorn');
const fs = require('fs');

function parse(file) {
  const code = fs.readFileSync(file, 'utf8');
  return acorn.parse(code, { sourceType: 'module' });
}

// AST walker：递归访问每个节点
function walk(node, visitors) {
  if (!node || typeof node !== 'object') return;
  if (visitors[node.type]) visitors[node.type](node);
  for (const key in node) {
    walk(node[key], visitors);
  }
}

// Reachability marking
const reachable = new Set();
function mark(node) {
  if (!node || reachable.has(node)) return;
  reachable.add(node);
  // 继续 mark 引用的 Identifier
  walk(node, {
    Identifier(n) { /* 在 scope 里找到 n.name 对应的声明，mark 它 */ },
    CallExpression(n) { mark(n.callee); },
  });
}
```

`mark(rootExport)` 然后递归，一轮下来所有会被"用到"的 AST 节点都进了 reachable set。

### 第 3 格 · ESM vs CJS 的根本差异

ESM 是 **静态可分析的**：
- `import x from './a.js'` 编译期就能解析路径；
- `import { foo, bar } from './a.js'` 能精确知道 import 了哪个标识符；
- `export const x = 1` 编译期能建立符号表。

CJS 是 **动态的**：
- `require('./' + name + '.js')` 路径运行时才拼出来；
- `module.exports = { ...foo }` 导出对象可以运行时改；
- `require` 可以出现在条件分支里。

所以 tree-shaking 只有 ESM 才能做彻底。Vite 强推 ESM 不是赶时髦——是它让构建工具能精确做静态分析。

### 第 4 格 · sideEffects 和 pure 注释

有些代码看起来没被 import，但执行了会有副作用（比如 `import './polyfill.js'` 改了全局原型），tree-shaking 不能随便摇：

```json
// package.json
{
  "sideEffects": ["**/*.css", "**/polyfill.js"]
}
// 或 "sideEffects": false  —— 整个包都无副作用
```

`/* #__PURE__ */` 告诉 bundler "这个函数调用没有副作用，如果返回值没被用到就可以整个删掉"：

```js
/* #__PURE__ */ React.createElement('div', null, 'hello');
// 如果这行没被赋值、没被 export，就可以摇掉
```

## 坑点清单

> 🔗 正文对照：[《27.7 本章避坑清单》](../27-mini-framework#_27-7-本章避坑清单)

1. **eval / new Function 是 tree-shaking 黑洞**：`eval('function dead() {}')` 里的代码在运行时才解析，AST walker 根本碰不到。打包器只能假设它可能用到任何东西——永远不会被摇掉。生产环境代码里应彻底避免 eval。
2. **CJS require 的动态路径**：`const mod = require('./' + dir + '.js')` 打包器无法静态解析路径，只能把可能的候选全打进去，或者干脆不摇这个 require。
3. **副作用声明没配对**：很多 NPM 包没正确声明 sideEffects——要么漏写（摇掉了 polyfill 崩溃），要么乱写 `"sideEffects": false`（明明有全局副作用）。Vite/Rollup 在这方面踩过无数坑。
4. **export default 整体 reachable**：`export default function() { dead() }`——整个 default 是一个 AST 节点。只要有人 import default，整个函数体就 reachable，里面 call 的 dead 也跟着 reachable。要让 dead 被摇掉，得把它改成 named export 且 default 函数体里不 call 它。

## 自测 3 题

**1. 为什么 tree-shaking 只对 ESM 有效？CJS 的 require 能不能做？**

<details>
<summary>参考答案</summary>

ESM 静态、CJS 动态，根本差异有三：

1. **路径可解析性**：ESM 的 `import x from './a.js'` 路径在源码里写死，编译期就能 resolve；CJS 的 `require('./' + name)` 运行时才拼。
2. **导入精确性**：ESM 的 `import { foo }` 精确到符号；CJS 的 `const m = require('./a')` 拿到整个 module.exports 对象，再从对象上读属性——静态分析不知道这个属性是在哪个 export 里赋值的。
3. **执行副作用不可控**：CJS require 会立即执行模块顶层代码，打包器不敢随便删——怕删掉的代码恰好是初始化代码。ESM 顶层代码也执行，但 export 声明本身不会产生副作用。

结论：CJS 想 tree-shaking 只能靠 webpack 的 `/* #__PURE__ */` + 模块级标记做非常有限的 DCE，做不到真正的模块级 tree-shaking。
</details>

**2. 这段代码，tree-shaking 能摇掉哪些？为什么？**

```js
// util.js
export function pureFn() { return 42 }
export function sideEffect() { console.log('init') }
export const obj = { foo: 1, bar: 2 }
export default function () { return pureFn() }

// main.js
import util from './util.js'
console.log('hi')
```

<details>
<summary>参考答案</summary>

main.js 只 import 了 default export，所以 reachable 从 default function 出发：

- `pureFn`：被 default function 体 call 了 → reachable，保留；
- `sideEffect`：没有任何地方引用 → **可以摇掉**（只要 util.js 的 package.json 没声明 sideEffects 包含它）；
- `obj`：没人引用 → **可以摇掉**；
- default function：被 import → reachable，保留。

关键点：`sideEffect` 虽然函数体执行 `console.log` 有副作用，但如果没人调用它，这副作用根本不会发生——摇掉它是安全的。只有 **模块顶层的执行代码**（比如 `import './polyfill.js'` 里的顶层语句）才算不可摇的副作用。
</details>

**3. `sideEffects: false` 和 `/* #__PURE__ */` 注释分别在哪一层起作用？**

<details>
<summary>参考答案</summary>

两个是不同层级的机制：

| 机制 | 层级 | 作用 |
|---|---|---|
| `package.json` 的 `"sideEffects"` | **模块/包级别** | 声明"这个包里的模块是否会产生顶层副作用"。`false` = 全部无副作用，`["**/*.css"]` = 只有 CSS 文件有副作用。打包器据此决定能否整模块摇掉。 |
| `/* #__PURE__ */` | **表达式级别** | 标注在单个函数调用前，告诉打包器"这个调用没有副作用，如果返回值没被用就可以删掉"。 |

两者配合使用：声明了 `sideEffects: false` 的包内，`/* #__PURE__ */ foo()` 这种调用如果返回值没被使用就会被 DCE 删掉。没有 `sideEffects: false`，打包器不敢假设顶层语句可摇，`/* #__PURE__ */` 只能在已经被 import 的模块内起作用。
</details>

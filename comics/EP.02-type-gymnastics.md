# EP.02 TypeScript 类型体操

> 对应正文：[02-typescript.md](../02-typescript.md)（类型收窄 / 泛型与条件类型）· 示例：`examples/02-01-narrowing.ts`、`examples/02-02-generics.ts`、`examples/02-04-conditional-infer.ts`

## 剧情回顾

- **第 1 格**：标签君被 any 埋雷——`user.nmae.toFixed(2)` 拼错字段编译不报错，上线才白屏。
- **第 2 格**：码叔给出收窄三板斧：`typeof`、`in`、判别联合，联合类型越查越窄。
- **第 3 格**：像素酱实证条件类型与 `infer`：`Unwrap<string[]>` 如何抽出 `string`。
- **第 4 格**：码叔结案——体操有度：优先工具类型，any 换 unknown。

## 知识点拆解

### 第 1 格 · any 黑洞

- `any` 会关闭该值的类型检查：取属性、传参、赋值全放行，错误被**推迟到运行时**；
- `@ts-nocheck`、双重 `as` 断言是同一性质的问题——把检查权交回给人眼；
- 安全替代是 `unknown`：允许接收任何值，但**使用前必须收窄**。

### 第 2 格 · 收窄三板斧

1. `typeof`：按运行时类型收窄原始值（`'string' | 'number'`）；
2. `in`：判断字段是否存在，区分不同形态；
3. 判别联合（discriminated union）：每种形态携带一个字面量 `kind`，`if` / `switch` 判断后 TS 控制流自动收窄，访问不存在的字段编译期直接报错。

### 第 3 格 · 条件类型与 infer

```ts
type Unwrap<T> = T extends Array<infer U> ? U : T;
type A = Unwrap<string[]>; // string
type B = Unwrap<number>;   // number
```

- 条件类型是**类型层面的三元表达式**，对联合类型还具有分布式；
- `infer` 只能出现在 `extends` 子句里，声明一个"待推断"的占位符，让编译器反向抓出内层类型；
- 这是类型体操的基础件：`ReturnType`、`Awaited`、`Parameters` 等工具类型都由它实现。

### 第 4 格 · 体操有度

- 递归条件类型没有终止条件会拖慢编译甚至爆栈，业务代码**优先使用内置工具类型**；
- 正确姿势是渐进收紧：`any → unknown → 收窄到具体类型`，而不是一步到位堆炫技类型。

## 坑点清单

> 🔗 正文对照：[《2.10 本章避坑清单》](../02-typescript#_2-10-本章避坑清单)

1. `any` 具有传染性：一个 any 经过几次赋值就污染整条调用链；
2. `as` 硬断言掩盖真实类型错误，等于把检查权交给运气；
3. 递归类型缺少终止分支，导致编译卡死、编辑器卡顿。

## 自测 3 题（含答案）

1. `any` 与 `unknown` 的区别？——**any 完全跳过检查可直接使用；unknown 接收任意值但使用前必须收窄**。
2. 判别联合为什么能自动收窄？——**每种形态携带不同的字面量 kind，TS 控制流分析根据判断结果缩小类型范围**。
3. `infer` 能用在哪里？——**只能在条件类型的 extends 子句中，声明待推断的占位类型**。

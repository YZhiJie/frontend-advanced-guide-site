# EP.36 生成器高阶模式

> 对应正文：[01-javascript-advanced.md](../01-javascript-advanced.md) 1.14 节 · 示例：`examples/01-38-generator-advanced.ts`

## 剧情回顾

- **第 1 格**：像素酱发现 `[...inner()]` 与 `for...of` 都只有 `yield` 出来的值，内层 `return '结算'` 凭空消失——它只会成为 `yield*` 的求值结果。
- **第 2 格**：码叔摊开一条双向通道：`next()` 启动、`next(x)` 数据回流、`it.throw(e)` 暂停点注入错误、`yield*` 控制权下沉并回传 return 值。
- **第 3 格**：标签君实证两大模式：红绿灯状态机（状态序列即产出）与生成器版洋葱模型（`yield* next()` 下沉再回流，A-前 → B-前 → B-后 → A-后）。
- **第 4 格**：码叔结案：生成器是可暂停的函数，驱动权在消费者手里——一次性迭代器、首条 next 传参无效、break 沿委托链收尾。

## 知识点拆解

### 第 1 格 · yield* 的返回值：内层生成器的 return 值

`for...of`、展开、`Array.from` 都只消费 `yield` 出来的值，`done: true` 时携带的 `return` 值被丢弃。想拿到它只有两条路：`const r = yield* inner()`（委托方接收），或手动 `it.next()` 判断 `done` 后读 `result.value`。

**关键认知**：`yield*` 不只是"替内层吐值"，它是一条完整的控制权委托——内层生成器的 `next/throw/return` 全部转发，结束后把 return 值作为整个 `yield*` 表达式的求值结果交回外层。

### 第 2 格 · 一条双向通道

| 操作 | 语义 | 备注 |
| ---- | ---- | ---- |
| `it.next()` | 启动，跑到第一个 yield | 首条传参无效（没有 yield 在等） |
| `it.next(x)` | x 成为上一条 yield 表达式的值 | 消费者拉动生产节奏 = 拉模式背压 |
| `it.throw(e)` | 在暂停的 yield 处抛出 e | 内部无 catch 则穿透，但 finally 先执行 |
| `yield* g` | 控制权下沉到 g | g 结束后回传 return 值 |
| `break` | 触发 `return()` | 沿委托链逐层收尾，各层 finally 照常执行 |

### 第 3 格 · 状态机与洋葱模型

```js
// 红绿灯：转移表收敛在数组里，状态序列即产出
function* trafficLight(cycles) {
    const states = ['红', '绿', '黄'];
    for (let c = 0; c < cycles; c++) yield* states;
}

// 洋葱模型（Koa 1 + co 的历史形态）：yield* next() 下沉
function* A(ctx, next) { ctx.logs.push('A-前'); yield* next(); ctx.logs.push('A-后'); }
```

`yield* next()` 把控制权交给内层中间件，内层全部完成后控制权自然回流，当前层继续写后置逻辑——递归委托天然形成先进后出的包裹结构，`compose` 只是把 `dispatch(ctx, i + 1)` 串成链。

### 第 4 格 · 高频易错点

1. **return 值丢失**：`yield* inner()` 的返回值必须显式接住，`[...outer()]` 永远不含 return 值；
2. **首条 next 传参无效**：生成器启动时还没有 yield 在等待，`it.next(99)` 的 99 直接被丢弃；
3. **一次性迭代器**：生成器对象耗尽即终结，重放需重新调用生成器函数创建新实例；
4. **break 会沿委托链收尾**：`for...of` 中 break 触发 `return()`，委托链上每层生成器的 finally 都会执行——这是"暂停点局部清理"的机制基础。

## 坑点清单

> 🔗 正文对照：[《1.19 本章避坑清单》](../01-javascript-advanced#_1-19-本章避坑清单)

1. **for...of/展开拿不到 return 值**：结算值、统计结果这类 return 信息必须用 `yield*` 或手动 next 链路读取；
2. **首条 next() 传参无效**：双向通道从第二个 next 才真正打开，首参被静默丢弃；
3. **生成器对象不可重放**：缓存了一个已耗尽的生成器再迭代将一无所获，重放要重新调用生成函数；
4. **break/throw 都走收尾**：break 触发 `return()`，throw 在暂停点抛出——两者都会先执行当前暂停层的 finally，再沿委托链向外传播；
5. **异步版别手写驱动器**：同步洋葱模型聚焦控制权结构；异步场景直接用 co / 现代async/await，驱动器交给成熟方案（见 01-31）。

## 自测 3 题（含答案）

1. **`function* inner(){ yield 1; return 2 }`，`[...inner()]` 与 `const it = inner(); it.next(); it.next(); it.next()` 的结果各是什么？**——`[...inner()]` 得 `[1]`（return 值被丢弃）；手动 next 三次依次得 `{value:1,done:false}`、`{value:2,done:true}`、`{value:undefined,done:true}`——return 值只在 `done:true` 那次的 `value` 上出现一次，之后再 next 只返回 `undefined`。
2. **为什么 `it.next(99)` 作为第一次调用时 99 不会出现在任何地方？**——`next(x)` 的语义是"把 x 作为上一条暂停的 yield 表达式的求值结果"。第一次调用时生成器还没执行到任何 yield，没有"上一条 yield"在等待，所以传参被丢弃；要传初始值应通过生成器函数的入参。
3. **`for (const n of walk(tree)) { if (hit) break }` 中断后，为什么未访问的分支"零成本"？**——break 触发遍历器的 `return()`，它沿 `yield*` 委托链逐层向下传递，每层生成器在当前暂停点直接收尾（finally 照常执行）后标记 done；尚未执行的 `walk(child)` 递归分支根本没有被调用，未搜索子树不产生任何遍历开销。

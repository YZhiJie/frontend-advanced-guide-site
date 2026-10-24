# case 05：手写极简响应式状态容器

用不到 200 行 TypeScript 手写一个极简状态容器：`setState` 不可变更新（对象浅合并 + 函数式 updater）、`subscribe` 订阅与取消、`select` 记忆化选择器、`batch` 合并通知，以及包裹 `setState` 的中间件机制，对标 Zustand 的设计思想。

与 `examples/` 中的单文件片段相比，这里是一个带 `package.json`、`tsconfig.json`、`src/`、`test/` 的可运行小工程，可以直接 `npm test` 跑回归。

## 目录结构

```
05-state-store-lab/
├── package.json
├── tsconfig.json
├── src/
│   └── store.ts        # createStore + shallowEqual + logger 中间件
├── test/
│   └── store.test.ts   # node:test 回归用例（13 个）
└── README.md
```

## 运行

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # tsx --test test/*.test.ts（13 个用例）
```

## 关键设计

- **不可变更新**：`setState` 用 `{ ...state, ...patch }` 生成新对象，patch 可以是对象或 `(state) => patch` 函数；原状态引用永不被改写。
- **浅比较去重**：新状态与旧状态浅比较相等时直接返回，既不换引用也不通知订阅者，避免无效渲染（`Object.is` 逐键比较，规避 `NaN` 误判）。
- **订阅保序通知**：订阅者存在 `Set` 中天然保序，通知前先快照再遍历，回调内部增删订阅不影响本次派发；订阅返回的取消函数即 `Set.delete`。
- **select 记忆化**：以「状态快照引用」为缓存键，同一快照重复调用不重复执行 selector；再叠加可注入的 `equalityFn`，让派生对象在值等价时沿用旧引用、保持下游引用稳定。
- **中间件增强 dispatch**：`Middleware = (api) => (next) => (patch) => ...`，数组顺序即「外层 → 内层」；`logger` 在 `setState` 前后各取一次状态，且不阻断原本的 `setState`。
- **batch 合并通知**：用 `batchDepth` 计数，内层只做脏标记，最外层结束才统一 flush；批处理中 `getState()` 已是最新值，不会读到中间态。

## 对应章节

- [5.1 状态管理设计思想](../05-state-management.md#_5-1-状态管理设计思想)
- [5.3 Zustand 轻量方案](../05-state-management.md#_5-3-zustand-轻量方案)

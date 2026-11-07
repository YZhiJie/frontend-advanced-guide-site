# case 04：手写前端框架小工程

用 TypeScript + Node 原生模块手写一个完整的前端框架闭环：**虚拟 DOM (h/diff) → Proxy 响应式 (reactive/effect) → 优先级调度器 (high/normal/low/idle) → Fiber 协调 (beginWork/completeWork + 时间片)**。

四个模块各自独立，但串在一起就是一个极简版 React 核心。与 `examples/` 里的单文件片段不同，这里是一个可运行、可测试的小工程。

## 目录结构

```
04-mini-framework-lab/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── vdom.ts           # h() + isSameVNodeType + 同层 diff + keyed list LCS + collectDOMCommands
│   ├── reactivity.ts     # reactive(Proxy) + effect + Dep + batch + 数组方法特判
│   ├── scheduler.ts      # 四优先级队列 + 去重 id + 同步 high / queueMicrotask normal / setTimeout low / idle
│   └── fiber.ts          # Fiber 节点 + beginWork / completeWork + 栈式 renderLoopImpl 时间片
└── test/
    ├── vdom.test.ts      # 15 个用例：h 构造 / isSameVNodeType / diff / keyed list / collectDOMCommands
    ├── reactivity.test.ts# 12 个用例：reactive / effect / 嵌套 / batch / 数组 push / cleanup
    ├── scheduler.test.ts # 8 个用例：优先级顺序 / 去重 / 错误隔离 / runRecords
    └── fiber.test.ts     # 14 个用例：Fiber 创建 / render sync / flags / buildLog / renderAsync
```

## 运行

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm test        # tsx --test test/*.test.ts（49 个用例全过）
```

## 关键设计

### vdom.ts

- **h 工厂**：自动过滤 null/boolean、拍平数组、把 key 从 props 拆到顶层
- **同层 diff**：`isSameVNodeType` 先比 type + key，再决定 CREATE / REPLACE / 原地更新
- **keyed list LCS**：先用 Map 按 key 索引旧节点，再用最长递增子序列找稳定节点，剩余节点标移动或删除
- **纯函数 PatchResult**：不依赖 DOM 环境，返回 rootOp + propOps + childrenOps 三层结构；`collectDOMCommands` 再把它展平成可执行命令列表（方便在 jsdom / 浏览器环境中真实渲染）

### reactivity.ts

- **Proxy 四钩子**：`get` 用 `proxyToRaw` 找原始 target，`has/ownKeys` 也建立依赖；嵌套对象自动递归 reactive
- **数组方法特判**：`push/splice` 等内部会先写数字索引再写 length，若直接 `Reflect.get(t, "length")` 会读到已被改写的值导致不触发 length 的 trigger；代码里对数组 length key 提前读 oldValue
- **effect 双向引用**：effect.deps 存它依赖的 Dep，Dep.effects 反向存依赖它的 effect；每次 run 前先 cleanup（清空旧 deps 并通知 Dep 移除）
- **batch 计数**：`batchDepth > 0` 时 trigger 只把 effect 放进 pendingEffects Set，最外层 return 时统一 flush

### scheduler.ts

- **四优先级**：high 同步 flush（调用方保证最高优先级）；normal 用 queueMicrotask 合并；low 用 setTimeout 0；idle 模拟 requestIdleCallback（setTimeout 16ms 作为一帧，内部还有 5ms 预算）
- **id 去重**：相同 id 覆盖旧任务，新任务进队时先从对应队列移除旧的
- **错误隔离**：`runQueue` 里 try/catch，单个任务抛错不影响后续任务

### fiber.ts

- **Fiber 节点**：tag 区分 HostRoot / HostComponent / HostText；用 `flags` bitmask 标记 Placement / Update / Deletion / TextUpdate；`subtreeFlags` 归并子树副作用
- **beginWork 分发**：HostRoot 调 `updateHostRoot`（单次 reconcileChildFibers）；HostComponent 调 `updateHostComponent`（取 `pendingProps.children` 里的 VNode 数组 → `reconcileChildrenArray` keyed diff）；HostText 返回 null
- **completeWork 归并**：沿 child.sibling 链把子 flags 归到父 subtreeFlags
- **时间片 renderLoopImpl**：用显式栈（begin → complete 成对 push）模拟 DFS，每次 `step()` 有 frameBudgetMs 预算，预算用完保留栈内容、setTimeout(16ms) 下一帧续

## 对应章节

- [4.1 React 架构与 Fiber 原理](../04-frameworks.md#_4-1-react-架构与-fiber-原理)：Fiber 协调与时间片调度
- [4.4 Vue 响应式系统原理](../04-frameworks.md#_4-4-vue-响应式系统原理)：Proxy 响应式 + effect 依赖收集

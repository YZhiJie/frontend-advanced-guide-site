# EP.04 React Fiber 与 Vue 响应式

> 对应正文：[04-frameworks.md](../04-frameworks.md)（React Fiber / Vue 响应式原理 / 渲染优化）· 示例：`examples/04-01-use-state-mechanism.ts`、`examples/04-02-mini-reactivity.ts`

## 剧情回顾

- **第 1 格**：标签君的一万行列表一输入就卡死——同步渲染把主线程占满。
- **第 2 格**：码叔揭秘 Fiber：渲染拆成可中断的小任务链表，current/wip 双缓冲。
- **第 3 格**：像素酱实证 Vue3 响应式：Proxy 拦截 get/set，自动收集与触发依赖。
- **第 4 格**：码叔结案——memo/useMemo 与 computed 各显神通，小心 Hooks 闭包旧值。

## 知识点拆解

### 第 1 格 · 同步渲染的困境

- 一次 `setState` 触发整棵子树重新 reconcile + 渲染，大列表就是长任务；
- 长任务堵死主线程，输入、点击、动画全部掉帧；
- 优化方向：把"必须一次做完"拆成"可以分批做完"。

### 第 2 格 · Fiber 调度模型

- Fiber 把组件树拆成链表节点，渲染阶段**可中断、可恢复、可按优先级插队**；
- `current`（屏幕上的树）与 `wip`（内存中的树）**双缓冲**，算完再切换；
- **commit 阶段同步不可中断**——DOM 一旦开始改就必须改完，否则用户看到撕裂。

### 第 3 格 · Vue3 响应式原理

```ts
const state = reactive({ n: 1 });
effect(() => console.log(state.n)); // 1
state.n = 2; // 自动重跑，输出 2
```

- `Proxy` 的 `get` 拦截**依赖收集**（谁在读本字段）；
- `set` 拦截**触发更新**（通知所有读过它的 effect）；
- 对比 React"拉"模式（状态变了重跑渲染函数），Vue 是"推"模式（数据知道谁用了自己）。

### 第 4 格 · 各取所长与坑

- React：`memo`、`useMemo`、`useCallback` 挡住无效重渲染；
- Vue：`computed` 缓存 + 细粒度追踪，改哪个字段只有用到它的组件更新；
- 共同目标：**只更新真正变化的部分**。

## 坑点清单

> 🔗 正文对照：[《4.10 本章避坑清单》](../04-frameworks#_4-10-本章避坑清单)

1. Hooks 闭包捕获旧值：定时器 / 事件回调里读到的是注册那一刻的 state；
2. 滥用 `useMemo`/`useCallback` 本身也有比较开销，纯组件未必更快；
3. Vue 里解构 `reactive` 对象会丢失响应式，要用 `toRefs`。

## 自测 3 题（含答案）

1. Fiber 渲染阶段和提交阶段的区别？——**渲染阶段可中断可插队；提交阶段同步不可中断**。
2. Vue3 依赖收集发生在什么时候？——**Proxy 的 get 拦截中，读取字段时把当前 effect 记为依赖**。
3. Hooks 闭包旧值怎么修？——**用 ref 持有最新值，或把变量加进 useEffect 依赖数组**。

# EP.05 状态管理思想

> 对应正文：[05-state-management.md](../05-state-management.md)（props 钻井 / 单向数据流 / 服务端状态）· 示例：`examples/05-01-mini-redux.ts`

## 剧情回顾

- **第 1 格**：标签君改个主题色，props 要穿七层——"props 钻井"之痛。
- **第 2 格**：码叔揭秘 Redux：dispatch → 纯 reducer → 新 state → 订阅更新，单向流动。
- **第 3 格**：像素酱实证 Zustand/Pinia 的选择器订阅：无关字段更新不再惊动整树。
- **第 4 格**：码叔结案——状态分家：服务端状态交给 TanStack Query，store 只放 UI 状态。

## 知识点拆解

### 第 1 格 · props 钻井

- 数据要跨多层传递，中间层既不使用也不关心，却必须透传；
- 改一个字段要动 N 个文件，层级越深成本越高；
- 本质问题：**状态离使用者太远**。

### 第 2 格 · 单向数据流（Redux 思想）

1. 视图 `dispatch(action)` 描述"发生了什么"；
2. reducer 是**纯函数** `(state, action) => newState`，绝不原地修改；
3. store 保存新 state 并通知订阅者；
4. 修改路径唯一 → 可预测、可回放、可时间旅行调试。

### 第 3 格 · 选择器订阅

```ts
const user = useStore((s) => s.user);
```

- Zustand / Redux 的 `useSelector` 只比较选择器结果，结果不变不渲染；
- Pinia 的 state 天然是响应式对象，字段级依赖自动追踪；
- 对比"整棵 store 变了整树重渲染"，切片订阅是性能分水岭。

### 第 4 格 · 状态分家

- **服务端状态**（接口数据）：交给 TanStack Query / SWR——缓存、失效、重取、去重开箱即用；
- **跨页面 UI 状态**（登录态、主题、购物车）：全局 store；
- **局部状态**（表单草稿、开关）：`useState` / `ref` 就地管理。

## 坑点清单

> 🔗 正文对照：[《5.9 本章避坑清单》](../05-state-management#_5-9-本章避坑清单)

1. 把服务端接口数据复制进全局 store，之后要手工维护"何时重新拉取"——失效逻辑必漏；
2. reducer 里做副作用（发请求、写 localStorage），破坏可预测性；
3. 选择器每次返回新对象引用（如 `map`/`filter` 结果），导致订阅永远"变了"。

## 自测 3 题（含答案）

1. Redux 单向数据流的完整链路？——**dispatch → 纯 reducer 生成新 state → store 通知订阅者 → 视图更新**。
2. 选择器订阅解决什么问题？——**只订阅用到的状态切片，无关更新不触发重渲染**。
3. 为什么服务端状态不该进全局 store？——**它有自己的缓存/失效/重取生命周期，用 TanStack Query 管理更可靠，手工同步必漏**。

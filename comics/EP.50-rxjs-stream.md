# EP.50 响应式的流思维

> 对应正文：[第二十九部分 · RxJS 响应式编程](../29-rxjs.md)

## 剧情回顾

- **第 1 格**：标签君困惑——前端请求层用 async/await 写了三个请求，每个都带一个 cancel 标志（AbortController），还要叠加失败重试和结果缓存，代码从上往下串成链条，改一个环节牵一片。能不能把"请求"也当成一种可组合的数据流？
- **第 2 格**：码叔点破 Promise vs Observable 根本差异——Promise 是"已经发生的单次结果"，Observable 是"尚未到来的值的集合"。前者 resolve/reject 一次性，后者可以多次 next、可取消、可错误、可完成。`switchMap`/`concatMap`/`mergeMap`/`exhaustMap` 四种拍平操作符就是四种不同的"旧请求怎么处理"的策略。
- **第 3 格**：像素酱把搜索框 input 事件改成 Observable 管道——debounceTime 300ms 防抖动，switchMap 把每次输入映射到搜索请求（旧请求自动取消），catchError 把错误消化成空结果。两行代码搞定竞态、防抖、错误处理三件事。
- **第 4 格**：码叔结案——RxJS 四个最容易踩的坑：把冷流当热流用（每个订阅各跑一份生产过程）、忘记 takeUntil 取消（组件销毁后订阅还在）、retry 不封顶（指数退避最终还是要 maxAttempts）、误用 mergeMap 导致并发风暴。

## 知识点拆解

### 第 1 格 · Observable vs Promise 心智对比

| 维度 | Promise | Observable |
| --- | --- | --- |
| 值数量 | 1 | 0..∞ |
| 惰性 | 构造即执行 | subscribe 才执行 |
| 可取消 | × | Subscription.unsubscribe() |
| 错误 | 链式 catch（一次） | pipe 内 catchError（每次流） |
| 组合 | Promise.all/race/first | pipe 内任意组合符 |

### 第 2 格 · 四种高阶映射操作符选型表

| 场景 | 操作符 | 语义 |
| --- | --- | --- |
| 搜索联想 / 自动保存 | `switchMap` | 新事件 → 取消上一个内层流 |
| 下单 / 顺序上传 | `concatMap` | 排队串行，前一个完成再发下一个 |
| 批量并发请求 | `mergeMap` | 并发执行，不保证顺序 |
| 提交按钮防重复 | `exhaustMap` | 内层未完成时忽略新事件 |

### 第 3 格 · 搜索联想一行搞定

```ts
const search$ = fromEvent(input, "input").pipe(
    debounceTime(300),
    map((e) => e.target.value.trim()),
    filter((kw) => kw.length > 0),
    switchMap((kw) => api.search(kw).pipe(catchError(() => of([])))),
    takeUntil(destroy$),
);
```

`takeUntil(destroy$)` 组件销毁时自动收口整个订阅链。

### 第 4 格 · 四个最坑

1. **冷流被多次订阅**：每个订阅各跑一份 fetch——要么用 `shareReplay({ refCount: true })` 复用，要么确保只订阅一次。
2. **忘记 takeUntil**：组件 unmount 后订阅还在，既内存泄漏又可能 set 一个已销毁组件的状态。
3. **retry 无封顶**：指数退避理论上可以无限重连，必须加 `retry({ count: 3, delay })`。
4. **mergeMap 并发风暴**：1000 个事件 1000 个并发请求——用 `mergeMap(fn, 3)` 控并发。

## 坑点清单

> 🔗 正文对照：[《29.7 本章避坑清单》](../29-rxjs#_29-7-本章避坑清单)

1. **冷流被多次订阅 = 多次请求**：`defer(() => fetch(x))` 每次 subscribe 都会触发一次 fetch。想要多订阅共享结果，用 `shareReplay({ refCount: true })`，但要注意上游什么时候开始、什么时候结束。
2. **忘记 takeUntil 取消**：最经典的"组件卸载后还 set 状态"泄漏。规则：每订阅一个外部事件源，都要在管道尾加 `takeUntil(destroy$)`。
3. **retry 不封顶**：指数退避 `retryWhen(errors => errors.pipe(delay(1000)))` 没有重试次数限制，服务端挂了客户端会无限重连。必须加 `retry({ count: 3, delay })` 或手动计数。
4. **mergeMap 无并发上限 = 请求风暴**：`mergeMap(fn)` 默认并发无穷，100 个事件 = 100 个同时发出的请求。第三个参数 `concurrency` 必须设。

## 自测 3 题

**1. switchMap、concatMap、mergeMap、exhaustMap 分别在什么场景用？请各举一个前端真实案例。**

<details>
<summary>参考答案</summary>

| 操作符 | 语义 | 案例 |
| --- | --- | --- |
| `switchMap` | 新事件到来时取消上一个内层流 | 搜索框输入联想：每敲一个字符取消上次请求，只关心最新结果 |
| `concatMap` | 排队串行，前一个内层完成再发下一个 | 下单按钮点击：用户狂点三次也得一个个排着发，不能并发 |
| `mergeMap` | 并发执行，不保证顺序 | 批量上传：同时发 3 个文件请求（配合 concurrency 限流） |
| `exhaustMap` | 内层未完成时忽略新事件 | 登录按钮：一次点击还没返回时，后续点击全部忽略 |

四个操作符本质都是"把源事件映射成内层流然后拍平"，区别只在"旧的怎么处理"。

</details>

**2. 什么是冷流、什么是热流？为什么每个订阅都重新执行 fetch 会让人困惑？**

<details>
<summary>参考答案</summary>

冷流 = **生产过程独立于订阅者**：每个订阅者都会触发一次完整的生产过程。`defer(() => fetch())` 就是冷流——subscribe A 触发一次 fetch，subscribe B 又触发一次 fetch，两个订阅者拿到的是两份独立的结果。

热流 = **生产过程独立运行、订阅者只是"接入"**：`fromEvent(button, 'click')` 就是热流——点击事件天然发生，订阅者只接入后续事件，不会让历史事件重放。

困惑点：Observable 默认是冷的。你以为 `search$ = api.search(kw)` 是"同一个请求"，但如果 `search$` 被订阅两次，fetch 就会被调用两次。解法：用 `shareReplay({ refCount: true })` 把冷流转成热流，让多个订阅者共享同一次生产结果。

</details>

**3. 下面这个管道有什么问题？如何修复？**

```ts
interval(500).pipe(
    switchMap(() => fetch('/api/data')),
).subscribe(handle)
```

<details>
<summary>参考答案</summary>

三个问题：

1. **没有错误处理**：fetch 失败会把整个管道炸掉（Observable 进 error 后停止），不会重试也不会优雅降级。修复：`catchError(() => of(null))` 把错误消化成一个安全值。
2. **没有取消机制**：这个 interval 会一直跑下去，没有任何 takeUntil/takeWhile/时间限制。修复：加 `takeUntil(destroy$)` 或 `take(10)`。
3. **fetch 本身是 Promise，不支持取消**：上游 switchMap 能取消 Observable 管道，但已经发出的 fetch 请求不会被中止。修复：fetch 外面包一层 deferred Observable，配合 AbortController 实现真正的取消。

完整修复：

```ts
const data$ = interval(500).pipe(
    switchMap(() => defer(() => {
        const ctrl = new AbortController();
        const p = fetch('/api/data', { signal: ctrl.signal })
            .then((r) => r.json())
            .catch((err) => { if (err.name !== 'AbortError') throw err; });
        return new Observable((sub) => {
            p.then((v) => { sub.next(v); sub.complete(); })
             .catch((e) => sub.error(e));
            return () => ctrl.abort();  // Observable 取消时真的取消 fetch
        });
    })),
    catchError(() => of(null)),
    takeUntil(destroy$),
);
```

</details>

# 第二十九册 RxJS 自测题答案（全 20 题）

> 配套正文：[29-rxjs.md](../29-rxjs.md)（第二十九部分：RxJS 响应式编程——从入门到精通）。
> 本册答案与正文 `<details>` 折叠答案一致，抽出成册便于自测后集中对答案、打印与团队培训使用。
> 实战案例的可运行验证见同目录 `29-01` ~ `29-04` 四个示例（TestScheduler 虚拟时钟硬断言）：
>
> ```bash
> npx tsx 29-01-auto-save.ts      # 草稿自动保存：防抖只存最新、失败不死、卸载收口
> npx tsx 29-02-ws-reconnect.ts   # WebSocket 心跳与自动重连：退避、share、停表
> npx tsx 29-03-batch-upload.ts   # 批量聚合上传：双阈值、空窗过滤、并发上限、整批重试
> npx tsx 29-04-drag-frames.ts    # 拖拽动画：帧主时钟、抬起即停、钳制与除零兜底
> ```

---

## 29.1 心智模型与学习路线（第 1~3 题）

**1.【基础】Observable 与 Promise 的核心差异有哪些？**

Promise 只产出一个值且创建即执行、无法取消；Observable 可产出 0~N 个值、订阅时才执行、可通过 `unsubscribe` 取消，并拥有丰富的组合操作符。因此「一次请求」用 Promise 足够，「持续事件 + 组合 + 取消」才值得上 Observable。

**2.【进阶】冷流与热流的本质区别是什么？Subject 属于哪一种？**

冷流的生产过程由每个订阅者独立触发，因此两次订阅会得到两份互不相干的值；热流的生产过程独立于订阅者，订阅只是接入正在发生的事件，晚订阅者拿不到历史。Subject 是热流且天然多播，所有订阅者共享同一条通道。

**3.【挑战】请用 Observable、Subscription、Subject 的心智模型解释「订阅里再订阅」为什么容易泄漏。**

外层 `subscribe` 创建了一条独立的订阅链，内层 `subscribe` 又创建了另一条，两者之间没有资源关联；取消外层订阅不会自动取消内层，内层若来自 DOM 事件或无限定时器就会一直存活。正确做法是用 `switchMap` / `mergeMap` 把内层流提升为管道的一部分，让一次 `unsubscribe` 沿链路传播到底。

---

## 29.2 入门（第 4~6 题）

**4.【基础】`of`、`from`、`defer` 三个创建操作符分别适合什么输入？**

`of` 接收若干现成参数并逐个发射；`from` 接收数组、类数组、迭代器、Promise 等可转换来源；`defer` 接收一个工厂函数，在每次订阅时才调用工厂并订阅其返回的 Observable，适合需要「每次订阅都重新执行」的场景。

**5.【进阶】`forkJoin` 与 `combineLatest` 的行为差异是什么？各举一个典型场景。**

`forkJoin` 等所有输入流都完成，只发射一次「各自最后一个值」；任一输入报错则整体报错，空数组会立即完成。`combineLatest` 等每个输入至少发射一次，之后任一输入更新都会组合最新值发射，永不主动等待完成。前者适合并行首屏加载，后者适合多字段联动与实时组合。

**6.【挑战】为什么 `from(fetch(url))` 在两次订阅时不会发两次请求？如何改成每次订阅都重新请求？**

`fetch(url)` 在调用时就已经执行并返回 Promise，`from` 只是把这个已存在的 Promise 转成 Observable，多个订阅者观察的是同一个 Promise，因此只发一次请求。改成 `defer(() => from(fetch(url)))` 后，每次订阅都会调用工厂、重新执行 `fetch`，从而得到真正冷的行为。

---

## 29.3 进阶（第 7~9 题）

**7.【基础】`switchMap`、`concatMap`、`mergeMap`、`exhaustMap` 的核心区别是什么？**

四者都是把内层流压平：`switchMap` 只保留最新内层流，新值到来就取消旧的；`concatMap` 严格串行排队；`mergeMap` 并行执行所有内层流；`exhaustMap` 在当前内层流未完成时丢弃新值。区别可归纳为「并发数、是否取消、是否保序」三个维度。

**8.【进阶】搜索联想、按序保存、批量并行上传、防重复提交分别应该选哪个操作符？**

搜索联想用 `switchMap`，只保留最后一次输入的结果；按序保存用 `concatMap`，保证请求按操作顺序串行落库；批量并行上传用 `mergeMap` 并设置 `concurrent` 上限；防重复提交用 `exhaustMap`，请求未完成时忽略新的点击。

**9.【挑战】用 `switchMap` 提交订单可能造成什么业务问题？如何修正？**

用户在请求未完成时再次点击，`switchMap` 会取消前一次订阅，但 HTTP 请求可能已经在服务端执行，于是出现「前端以为取消了、后端却创建了两笔订单」。修正方式是写操作改用 `concatMap` 串行处理，或在 UI 层用 `exhaustMap` 防重复触发，同时给请求带上幂等键。

---

## 29.4 精通（第 10~12 题）

**10.【基础】`catchError`、`retry`、`finalize` 各自负责什么？**

`catchError` 捕获上游错误并返回一条替代流，让链路继续；`retry` 在错误到达下游前重新订阅上游，可配置次数与延迟；`finalize` 在流终止时执行清理，无论终止原因是完成、错误还是取消。三者通常按「retry → catchError → finalize」的顺序组合。

**11.【进阶】`shareReplay({ bufferSize: 1, refCount: true })` 在最后一个订阅者取消后会发生什么？**

`refCount: true` 时引用计数归零会断开与源流的连接，缓存也随之失效；下一次订阅会重新执行源 Observable。这能避免长驻缓存泄漏，但意味着「组件全部卸载后再回来」会重新发请求。若需要跨路由长期缓存，应显式设计缓存生命周期，而不是把 `refCount` 改成 `false` 了事。

**12.【挑战】从源码结构角度解释：为什么 `unsubscribe` 能取消整条操作符链？自定义操作符要注意什么？**

`Observable.subscribe` 会创建 `Subscriber`，每个操作符返回的新 Observable 在订阅时会把下游 `Subscriber` 与上游 `Subscriber` 通过 `operate` 连接起来，形成一条订阅链；每个 `Subscriber` 都持有 teardown 集合。末端 `unsubscribe` 会先执行自身 teardown，再逐级调用上游的 `unsubscribe`，因此定时器、事件监听与内层流都会被清理。自定义操作符必须把 `next` / `error` / `complete` 正确转发给下游，并在 teardown 中释放自己创建的资源，否则取消会在这一环断掉。

---

## 29.5 实战（第 13~15 题）

**13.【基础】React 中为什么必须在 `useEffect` 的清理函数里取消订阅？**

组件卸载或依赖变化时，`useEffect` 会重新执行，旧订阅若不取消就会继续持有 DOM 引用、定时器和闭包，造成内存泄漏与「已卸载组件仍在 setState」。把 `subscription.unsubscribe()` 放进返回的清理函数，可以保证订阅与视图生命周期一一对应。

**14.【进阶】一个 SPA 页面越用越卡，怀疑是 RxJS 泄漏，你会如何定位？**

先检查所有无限流（`interval`、`fromEvent`、WebSocket、`Subject`）是否有 `takeUntil` 或 `unsubscribe`；再用 DevTools 的 Performance/Memory 面板观察监听器与定时器数量是否随路由切换增长；最后在关键流上加 `finalize` 日志，确认组件卸载时是否真的触发清理。常见根因是「订阅里再订阅」与「共享服务里创建的 Subject 从不 complete」。

**15.【挑战】设计一个 WebSocket 消息流：断线要指数退避重连，重连后只保留最新一条连接，页面卸载要全部清理。你会怎么组合操作符？**

用 `defer` 包住「创建 WebSocket 并返回消息 Observable」，失败时用 `retry({ delay: (_, n) => timer(2 ** n * 500) })` 做指数退避；外层用 `switchMap` 保证重连时旧连接被取消；用 `takeUntil(destroy$)` 绑定页面生命周期，`finalize` 里关闭 socket。若需要心跳，可在连接内部用 `interval` 发送 ping，并同样挂到 `takeUntil` 上。

> 可运行验证：`npx tsx 29-02-ws-reconnect.ts` 用 marble 脚本模拟「断线 → 退避 → 重连 → 卸载」全过程，逐帧断言消息时间线、心跳 ping 计数与建连次数。

---

## 29.6 综合自测题（第 16~20 题）

**16.【基础】两个组件各自订阅同一个 `defer(() => from(fetch(...)))`，会发几次请求？如何只发一次？**

会发两次：`defer` 是冷流，每个订阅都会重新执行工厂并调用 `fetch`。若希望共享一次请求，在管道末尾加 `shareReplay({ bufferSize: 1, refCount: true })`，让两个组件共享同一次执行结果；同时要接受「最后一个订阅取消后缓存失效」的语义。

**17.【进阶】提交表单按钮用 `switchMap` 为什么可能产生重复订单？`exhaustMap` 和 `concatMap` 分别如何解决？**

`switchMap` 会取消上一次订阅，但已发出的 HTTP 请求未必能在服务端取消，于是用户连点两次就可能创建两笔订单。`exhaustMap` 在请求未完成时直接丢弃新的点击，从入口防重复；`concatMap` 则把第二次点击排队，等第一次完成后再发，二者都避免了并发提交，但业务语义不同。

**18.【挑战】写出一个带指数退避与随机抖动的重试管道（最多 4 次），并说明抖动的作用。**

```typescript
import { timer, throwError, type Observable } from 'rxjs';
import { retry } from 'rxjs/operators';

function withBackoff<T>(source: Observable<T>, maxRetries = 4): Observable<T> {
    return source.pipe(
        retry({
            count: maxRetries,
            delay: (error, attempt) => {
                if (attempt > maxRetries) return throwError(() => error);
                const base = 2 ** attempt * 200;
                const jitter = Math.random() * 100;
                return timer(base + jitter);
            },
        }),
    );
}
```

抖动让大量客户端不会在同一毫秒一起重试，避免「服务刚恢复又被重试风暴打挂」。`delay` 回调既是等待策略也是最后一次短路点，配合 `catchError` 才能把最终错误交给业务降级。

**19.【挑战】设计 marble 测试验证「连续输入时只保留最后一次请求结果」，写出关键断言思路。**

用 `TestScheduler` 构造一条 `cold` 输入流，在虚拟时间上连续发出多个值；用 `switchMap` 映射成不同延迟的 `cold` 内层流，让早期的内层流晚于后续内层流完成；断言最终输出只包含最后一个输入对应的结果，且早期内层流的订阅已被取消。整个过程不出现真实等待，帧数完全可控，失败时 marble 图能直接指出时间点。

> 可运行验证：`npx tsx 29-01-auto-save.ts` 的场景 A 正是该思路的完整落地——连续输入 A/B，断言只有 B 触发保存且只调用一次。

**20.【进阶】`catchError` 放在 `retry` 之前和之后，行为有什么区别？**

放在 `retry` 之前：错误先被 `catchError` 转成替代流，`retry` 看不到错误，不会重试。放在 `retry` 之后：`retry` 先获得重试机会，次数耗尽后才把最终错误交给 `catchError` 降级。因此「先重试、后兜底」的顺序才是正确的，把 `catchError` 写在前面会静默吞掉重试。

---

## 附：四个实战案例的硬断言验证点

| 示例 | 对应正文案例 | 验证的硬性质 |
| --- | --- | --- |
| `29-01-auto-save.ts` | 草稿自动保存 | 防抖只存最新草稿；失败转 `failed` 状态值流不终结；destroy 后输入不再触发保存 |
| `29-02-ws-reconnect.ts` | WebSocket 心跳与自动重连 | 退避公式 15s 封顶；断线按退避重连且消息逐帧对齐；心跳随断线/卸载停表；share 让两个订阅者每代只建一条连接 |
| `29-03-batch-upload.ts` | 批量聚合上传 | 超时/攒满双阈值 flush；空窗口零请求；事件洪峰下在飞请求不超并发上限；失败批重试 2 次后单独丢弃、流不终结 |
| `29-04-drag-frames.ts` | 拖拽动画 | 输出只落在帧滴答上（move 高频不触发）；抬起即停；重按由 switchMap 重建；坐标钳制 [0,1] 与宽度为 0 防 NaN |

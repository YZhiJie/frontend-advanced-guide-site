# EP.59 错误捕获四张网

> 对应正文：[第四十六部分 · 前端错误捕获处理方案](../46-error-handling.md)

## 剧情回顾

- **第 1 格**：标签君的页面线上报错漏了一屏。他明明给代码套了 `try/catch`，但 `setTimeout` 回调里的 `throw` 和 `fetch` 的 reject 都没被抓到——回调执行时，外层 `try` 早已出栈，根本不在同一个调用栈。
- **第 2 格**：码叔点破关键——前端错误不走同一条通道。同步同栈的错误归 `try/catch`，JS 运行时与资源 404 归 `error` 事件（必须捕获阶段），没人接的 Promise 拒绝归 `unhandledrejection`，框架渲染期错误归 ErrorBoundary / `errorHandler`。唯一的特例：Promise executor 里的同步 `throw` 会被自动转成 rejection。
- **第 3 格**：像素酱实证多任务编排的坑——`Promise.all` 一个挂了整体立刻失败，但其余请求还在天上飞，60ms 后慢的那个照样跑完。想真正取消得配 `AbortController`；要完整账单用 `allSettled`；多步骤流程失败要逆序补偿。
- **第 4 格**：码叔结案——捕获只是上半场，错误还要归一化成 `AppError`、按 fatal/error/warning/info 分级、同指纹聚合计数，再批量上报。坑点警告：sourcemap 只传监控平台，部署到公网等于源码白送。

## 知识点拆解

### 第 1 格 · try/catch 为什么罩不住异步

```text
try {
  setTimeout(() => { throw e }, 0)   // 回调在另一个宏任务执行
  fetch('/api')                      // 拒绝走 Promise 通道
} catch { /* 永远接不到 */ }
```

`try/catch` 的本质是捕获**同一事件循环回合、同一调用栈**里同步抛出的异常。`setTimeout` 回调执行时外层 `try` 已经出栈，`fetch` 的拒绝则压根不是「抛出」而是 Promise 的状态迁移——两者都不在这条通道上。

| 写进 try 里的代码 | 实际去向 |
| ---- | ---- |
| 同步 `throw` / `JSON.parse` 失败 | ✅ try/catch 接住 |
| `setTimeout` / 事件回调里的 throw | ❌ 冒到全局 `error` 事件 |
| Promise reject | ❌ 走 `.catch` / `unhandledrejection` |

可运行实证见 [46-01-sync-capture.ts](../examples/46-01-sync-capture.ts)——示例自建了一个微型事件队列，模拟「回调在另一个回合执行」，断言外层 try/catch 永远抓不到。

### 第 2 格 · 四类错误四张网

```text
try/catch           → 同步同栈
error (捕获阶段)     → JS 运行时 + 资源 404
unhandledrejection  → 没人接的 Promise 拒绝
ErrorBoundary       → 框架渲染期/生命周期
```

三条硬规则：

1. **资源错误不冒泡**——`<img>` / `<script>` 404 必须在捕获阶段监听（`addEventListener('error', cb, true)`），冒泡阶段一条都收不到；
2. **Promise executor 是唯一特例**——构造函数同步执行 executor 时自带 try/catch，同步 `throw` 自动转成 rejection；
3. **框架边界只管渲染期**——React ErrorBoundary 抓不到事件处理器、异步代码、SSR 与边界自身的错误，这四类仍要靠前两张网。

全局三件套骨架与「跨域脚本只有 `Script error.`」的解法（`crossorigin="anonymous"` + CDN 配 CORS 头）见正文 [46.1](../46-error-handling.md#_46-1-错误分类与捕获全景)，冒泡与 rethrow 规则见 [46-02-async-capture.ts](../examples/46-02-async-capture.ts)。

### 第 3 格 · all 短路 ≠ 取消

```text
all([快失败 10ms, 慢成功 50ms])
→ 10ms 整体失败（短路）
→ 60ms 后:慢成功照样跑完了
```

`Promise.all` 的短路只是**整体 Promise 提前落定**，没有任何取消语义——在途请求照样打满服务端。四种编排各管一件事：

| API | 错误语义 | 适用 |
| ---- | ---- | ---- |
| `all` | 第一个失败即整体失败，其余照跑 | 缺一不可的首屏聚合（配 AbortController 取消在途） |
| `allSettled` | 永不短路，全部落定分开记账 | 仪表盘多卡片，部分失败也展示 |
| `race` | 第一个落定无论成败 | 超时控制 |
| `any` | 第一个成功，全败抛 AggregateError | 多 CDN 择优容灾 |

多步骤流程（下单 → 扣库存 → 支付）失败时要**逆序补偿**：回补库存 → 撤销订单，且补偿动作必须幂等、补偿失败要告警。完整实证见 [46-03-multi-task-errors.ts](../examples/46-03-multi-task-errors.ts)，正文展开见 [46.4](../46-error-handling.md#_46-4-多个异步任务的错误编排-短路、汇总与补偿)。

### 第 4 格 · 从捕获到治理

```text
各通道 → normalizeError → 分级 → 指纹聚合 → 批量上报
fatal  → 立即上报 + 阻断
error  → 批量队列
info   → 只留本地
```

管线四步的要点：

- **归一化**：所有来源先进 `normalizeError()` 变成统一的 `AppError`（name / message / level / fingerprint / cause），下游只认一种结构；
- **指纹聚合**：`name + message + 堆栈第一帧` 做指纹，同一故障聚成一条计数——一次发布事故不该刷出十万条告警；
- **批量上报**：队列攒批 + 页面隐藏时 `sendBeacon` 兜底，别让监控本身成为性能问题；
- **sourcemap**：构建产 hidden sourcemap，CI 上传监控平台后从产物删除——公网可下载等于开源整个工程。

可运行的最小管线见 [46-04-error-pipeline.ts](../examples/46-04-error-pipeline.ts)（同一故障连发 5 次聚合成 `count=5`），正文展开见 [46.6](../46-error-handling.md#_46-6-工程化落地-归一化、分级与上报管线)，完整监控体系（Web Vitals、行为回溯）见 [11.2](../11-patterns-architecture.md#_11-2-前端监控与错误上报)。

## 坑点清单

> 🔗 正文对照：[《46.8 本章避坑清单》](../46-error-handling#_46-8-本章避坑清单)

1. **用 try/catch 包 setTimeout 回调**：回调在另一个调用栈执行，错误静默漏到全局。回调内部自包，或全局 `error` 事件兜底。
2. **资源错误监听忘开捕获阶段**：资源错误不冒泡，冒泡阶段一条都收不到。`addEventListener('error', cb, true)` 第三个参数不能省。
3. **只挂 error 不挂 unhandledrejection**：Promise 失败完全无感知。两个全局监听必须成对挂在应用入口最前面。
4. **以为 Promise.all 短路会取消在途请求**：整体失败≠任务停止，失败请求照样打满服务端，还会各触发一次 unhandledrejection。取消要配 AbortController。
5. **每层都 catch 又 rethrow**：同一错误重复上报刷屏。只在一个层级兜底，中间层透传或带语义 rethrow。
6. **sourcemap 部署到公网**：源码与内部接口路径白送。hidden sourcemap + CI 上传监控平台后删除产物。
7. **上报前不脱敏**：token、手机号进日志平台就是合规事故。beforeSend 统一走白名单脱敏。

## 自测 3 题

**1. 为什么 Promise executor 里的同步 throw 能被 `.catch` 接到，而 setTimeout 回调里的 throw 不能？**

<details>
<summary>参考答案</summary>

Promise 构造函数在**同步执行** executor 时自己包了一层 try/catch，把同步抛出的错误转成该 Promise 的 rejection——所以进得了 Promise 的 `.catch` 通道。setTimeout 回调则在另一个宏任务里以全新调用栈执行，外层 try 早已出栈，没有任何人替它兜底，只能冒泡到全局 `error` 事件。一个是「构造器主动转译」，一个是「调用栈彻底断开」。
</details>

**2. `Promise.all` 里一个任务失败后，为什么监控平台上可能出现多条 unhandledrejection？怎么避免？**

<details>
<summary>参考答案</summary>

`all` 短路后整体 Promise 已落定，但其余任务仍在后台执行。如果这些任务后续也失败且没有自己的 `.catch`，它们的拒绝就没有任何处理器，会各自触发一次 `unhandledrejection`。避免方法：给任务数组先统一挂一层就地记账的 `.catch`（转成占位结果），或用 AbortController 在首个失败时取消在途任务，或改用 `allSettled`。
</details>

**3. 错误指纹聚合为什么不能只用 message 做指纹？**

<details>
<summary>参考答案</summary>

两个方向都会出问题：message 太粗时（如 `Cannot read properties of undefined`），几十个不相关的 bug 被聚成一个 issue，无法定位；message 带动态内容时（含用户 id、时间戳），同一故障被拆成几千条，告警刷屏。实用做法是 `name + 清洗后的 message + 堆栈第一帧`：帧位置区分不同故障，清洗模板抑制动态字段。
</details>

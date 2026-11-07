# case 06：手写请求层实验室

把「TTL 缓存、并发去重、指数退避重试、超时与取消、竞态最新胜出」五件事组装成一个可注入 fetcher 的请求层：`createClient` 对外只暴露 `request / invalidate / clear`，底层取数与时钟、随机、等待全部可注入，测试离线且确定。

与 `06-network.md` 里的代码片段（单文件讲解）的区别：这里是一个带 `package.json`、`tsconfig.json`、`src/`、`test/` 的可运行小工程，可以直接 `npm test` 跑回归。

## 目录结构

```
06-request-layer-lab/
├── package.json
├── tsconfig.json
├── src/
│   ├── backoff.ts         # fullJitterDelay + withRetry（指数退避与抖动）
│   └── request.ts         # createClient：缓存 / 去重 / 重试 / 超时 / 竞态
├── test/
│   └── request.test.ts    # node:test 回归用例（注入假 fetcher 与 sleep）
└── README.md
```

## 运行

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # tsx --test test/*.test.ts（共 9 个用例）
```

## 关键设计

- **可注入 fetcher**：`Fetcher<T>` 由使用方提供，测试注入假实现，全程离线、不发真实网络请求。
- **缓存命中优先于去重**：`request` 先查 TTL 缓存，再查 in-flight；过期边界用 `expiresAt > now()` 判定，`now === expiresAt` 视为过期。时钟 `now` 可注入，TTL 用例不依赖真实时间。
- **并发去重共享同一 Promise**：同 key 的并发请求返回同一个 in-flight Promise，完成后移出 in-flight；清理时只删「仍属于自己的那一条」，避免误删被顶替后的新条目。
- **full-jitter 退避**：`cap = min(maxDelay, baseDelay * 2^attempt)`，`delay = random() * cap`，把同时失败的重试打散；`random` 与 `sleep` 均可注入，测试用 `random: () => 1` 得到确定延迟 `[100, 200]`。
- **超时即取消**：每次尝试新建 `AbortController`，调用方 signal 与内部超时 signal 用 `AbortSignal.any` 合并后交给 fetcher；超时既 reject `RequestTimeoutError` 又 abort 下游。调用方 abort 时不重试。
- **竞态最新胜出**：每个 key 维护「代际版本号」，`force` 请求会自增占位；请求返回时只有代际仍等于自己才允许写缓存，旧请求的迟到结果绝不覆盖新结果。

## 对应章节

- [6.2 缓存策略详解](../06-network.md#_6-2-缓存策略详解)
- [6.4 请求层封装实战](../06-network.md#_6-4-请求层封装实战)
- [6.5 竞态处理与请求取消](../06-network.md#_6-5-竞态处理与请求取消)

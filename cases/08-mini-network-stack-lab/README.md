# case 08：迷你网络栈实验室

用 TypeScript + Node 原生模块（http、https、URL、crypto、stream）手写一个完整网络栈闭环——HTTP 报文解析、fetch 实现、EventSource / SSE 客户端，以及 HTTP 缓存策略。四个模块环环相扣：fetch 用 http.createConnection 发真实请求，回来的响应能被 http-parser 解析（反向场景测试）、被 cache.ts 装饰、被 sse.ts 消费成事件流。

与 `06-network.md` 里的代码片段（单文件讲解）的区别：这里是一个带 `package.json`、`tsconfig.json`、`src/`、`test/` 的可运行小工程，44 个回归用例全部离线可跑。

## 目录结构

```
08-mini-network-stack-lab/
├── package.json
├── tsconfig.json
├── src/
│   ├── http-parser.ts   # parse(buf) / parseAll / serialize：Buffer ↔ HTTP 结构化报文
│   ├── fetch.ts         # fetch(url, init) → HttpResponse；重定向、AbortController、timeout
│   ├── sse.ts           # EventSource：SSE 四种前缀解析 + 指数退避重连
│   └── cache.ts         # MemoryCache（LRU）+ cacheFetch：Cache-Control / ETag / Last-Modified
├── test/
│   ├── http-parser.test.ts  # 14 用例（simple / chunked / pipelining / trailer）
│   ├── fetch.test.ts        # 10 用例（get / post / redirect / abort / timeout / headers）
│   ├── sse.test.ts          # 8 用例（data / event / id / retry / 注释 / 可注入 fetch）
│   └── cache.test.ts        # 12 用例（max-age / no-store / 304 / ETag-LM 条件请求 / LRU 淘汰）
└── README.md
```

## 运行

```bash
pnpm install
pnpm typecheck    # tsc --noEmit
pnpm test         # tsx --test test/*.test.ts（共 44 个用例）
```

## 核心设计

- **http-parser：管饱 Buffer 里一个字符一个字符地抠报文**。先用 `indexOfDoubleCRLF` 找 header/body 分界，`parseHeaderLines` 按 CRLF 分行再按 `:` 切 key-value、同名 key 用逗号合并（符合 RFC 7230）。body 提取分两条路径：有 `Transfer-Encoding: chunked` 就跑 `parseChunkedBody`（支持 size 行带扩展参数、支持 trailer），否则看 `Content-Length`。管道化支持靠 `nextOffset` 指针——每次返回下一条报文起始偏移，调用方切片后继续喂同一个 parse。
- **fetch：Node 原生 http.request 的薄封装**。关键是把 Node 里回调驱动的 API Promise 化（用 `new Promise((resolve, reject) => http.request(...))`），然后套三件事：重定向跟随（最多 5 次，303 强制 GET + 丢 body、301/302 POST 也转 GET）、AbortController 取消（先 `combineWithTimeout` 把用户 signal 和 timeout signal 合并，再挂 onAbort 监听 req.destroy）、timeout 到点自动 abort。
- **sse：不继承 EventTarget，自己实现 on/off/dispatch**。核心是 `parseAndDispatch(text)`——统一换行符后按空行分 block，每个 block 按 `data:` / `event:` / `id:` / `retry:` 四种前缀解析成事件对象，空 data block 跳过。重连用指数退避，`retry:` 字段覆盖 `initialRetry`。fetch 可注入，测试里换成 fake fetcher 全程离线。
- **cache：LRU + HTTP 语义**。`MemoryCache` 用 Map 保序实现 LRU——get 后删了再插尾部、set 时淘汰头部。`cacheFetch` 装饰 fetch 后按 Cache-Control 决定策略：`max-age` 内直接返回、过期但有 `etag` / `last-modified` 就发条件请求（加 `if-none-match` / `if-modified-since`）、服务端回 304 则刷新过期时间不重新下载、回 2xx 则覆盖缓存。`no-store` 写入即丢、`no-cache` 强制发条件请求。时钟可注入，测试里固定值保证过期判断确定。

## 对应章节

- [6.2 缓存策略详解](../06-network.md#_6-2-缓存策略详解)
- [6.3 HTTP 报文结构](../06-network.md#_6-3-http-报文结构)
- [6.4 请求层封装实战](../06-network.md#_6-4-请求层封装实战)
- [6.7 SSE 与 HTTP Streaming](../06-network.md#_6-7-sse-与-http-streaming)

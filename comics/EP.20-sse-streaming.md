# EP.20 SSE 流式传输

> 对应正文：[21-frontend-ai-interview.md](../21-frontend-ai-interview.md)（21.1 SSE 流技术：AI 流式响应的地基）· 示例：`examples/14-01-sse-parser.ts`、`examples/06-03-sse.ts`、`examples/14-02-stream-chat.tsx`

## 剧情回顾

- **第 1 格**：标签君上线 AI 问答，用户盯着转圈十秒，整段答案才"砰"地出现，差评如潮。
- **第 2 格**：码叔揭秘 SSE——一个不关的 HTTP 长响应，`Content-Type: text/event-stream`，`data:` 行 + **空行分帧**，服务端持续推、浏览器逐帧收。
- **第 3 格**：像素酱实证两种接法：GET 简单通知用原生 `EventSource`（自带重连 + Last-Event-ID）；LLM 要 POST 和鉴权头，用 `fetch` + ReadableStream 手写解析。
- **第 4 格**：码叔结案——chunk 必须缓冲切帧、代理缓冲会把流变便秘、AbortController 给停止键。

## 知识点拆解

### 第 1 格 · 整包等待为什么难熬

- 大模型是一个 token 一个 token 生成的，非流式接口却要等全部生成完才返回；
- 用户承受 TTFT（首字延迟）+ 总时长的**双重等待**，中间零反馈；
- 流式把"思考过程"变成可见内容，感知速度远快于实际速度。

### 第 2 格 · SSE 协议四件套

```http
Content-Type: text/event-stream

retry: 3000
id: 101
data: {"delta":"你好"}

data: [DONE]
```

- `data:` 数据行（可多行，分发时用 `\n` 拼接）；`event:` 类型；`id:` 断点编号；`retry:` 重连间隔；冒号开头是心跳注释；
- **空行（`\n\n`）= 一帧结束**，浏览器只在此时分发事件；
- 本质是"一个 HTTP 请求 + 一条持续增长的响应体"，服务端 → 客户端**单向**。

### 第 3 格 · EventSource 与 fetch 两条路

| | EventSource | fetch + ReadableStream |
| ---- | ---- | ---- |
| 方法 | 只能 GET | 任意（LLM 用 POST） |
| 请求头 | 不能自定义 | Authorization 随便带 |
| 重连 | 内置 + Last-Event-ID 续传 | 自己实现 |
| 适用 | 通知、行情 | **AI 流式对话** |

- 网络 chunk 边界 ≠ 协议帧边界：`TextDecoder.decode(v, { stream: true })` 防半个汉字乱码，字符串缓冲按 `\n\n` 切帧、残帧留下次；
- 代码芯片里的两级缓冲是本话最重要的考点。

### 第 4 格 · 生产环境三个坑

- **代理缓冲**：Nginx 默认 `proxy_buffering on` + gzip 会攒批转发，流变整段蹦；要 `proxy_buffering off` 或响应头 `X-Accel-Buffering: no`；
- **中止**：`controller.abort()` 关闭连接实现"停止生成"，服务端探测到断连应取消模型调用省钱；
- **续传**：`id:` + `Last-Event-ID`，服务端从断点补发，客户端幂等去重。

## 坑点清单

> 🔗 正文对照：[《21.7.3 常见误区总清单》](../21-frontend-ai-interview#_21-7-3-常见误区总清单)

1. 收到 chunk 就渲染：半个 JSON 解析失败、半个汉字乱码——必须两级缓冲按空行切帧；
2. 上线后"假流式"：90% 是 Nginx/CDN/压缩中间件在缓冲，用 `curl -N` 逐段排查；
3. EventSource 硬塞 POST 场景：方向错了，应换 fetch 读流；
4. 不处理 AbortError：用户主动停止被当成错误弹提示、还自动重连。

## 自测 3 题（含答案）

1. **SSE 一帧如何界定？为什么需要缓冲区？**——空行（双换行）结束一帧；TCP chunk 会把一帧切成多段，必须拼到完整帧再解析；字节层还要 `TextDecoder` 的 `stream:true` 防多字节截断。
2. **LLM 流式接口为什么用 fetch 而不是 EventSource？**——EventSource 只支持 GET、不能自定义鉴权头、不能携带大请求体；fetch 可 POST、带 Authorization、用 AbortController 中止，且响应体同样按 SSE 格式解析。
3. **AI 回答一卡一卡整段出现，怎么排查？**——分层定位：`curl -N` 直连服务端口 → 应用压缩/缓冲中间件 → Nginx proxy_buffering/gzip → CDN → 客户端是否按帧消费；辅以 TTFT/首帧时间监控。

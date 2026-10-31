# EP.14 AI 流式 UI

> 对应正文：[14-frontend-ai.md](../14-frontend-ai.md)（14.2 流式输出与打字机 UI 实战 / 14.3 Tool Calling 的前端呈现）· 示例：`examples/14-01-sse-parser.ts`、`examples/14-02-stream-chat.tsx`

## 剧情回顾

- **第 1 格**：标签君的 AI 问答转圈十秒才一次性出整段，等待感拉满。
- **第 2 格**：码叔揭秘 SSE——模型边生成边推，`data:` 行 + 空行分帧，`[DONE]` 收尾。
- **第 3 格**：像素酱实证跨块缓冲：一帧会被 TCP 切开，TextDecoder stream 模式 + 残帧缓冲防乱码。
- **第 4 格**：码叔结案——打字机 UI 要给停止键（AbortController），自动滚动先做贴底检测。

## 知识点拆解

### 第 1 格 · 整包等待的体验问题

- LLM 生成是 token 流式产出的，但普通 JSON 接口要等全部生成完才返回；
- 首字延迟（TTFT）+ 总时长叠加，用户面对的是长时间无反馈；
- 流式让「思考过程」可见，感知速度远快于实际速度。

### 第 2 格 · SSE 协议

```http
Content-Type: text/event-stream

data: 你好

data: ，世界

data: [DONE]
```

- 一条消息由若干 `data:` 行组成，**两个换行（空行）表示一帧结束**；
- 浏览器原生 `EventSource` 支持 SSE，但 LLM 场景多需 POST + 自定义头，故用 `fetch` + ReadableStream 手动解析；
- SSE 是**服务端 → 客户端单向**通道，比 WebSocket 轻。

### 第 3 格 · 跨 chunk 缓冲与打字机

```ts
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = '';
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true }); // stream: true 半个汉字不乱码
  const frames = buf.split('\n\n');
  buf = frames.pop();          // 最后一段可能是残帧，留到下次
  frames.forEach(handleFrame); // 每解析一帧就增量渲染
}
```

- 网络 chunk 边界与协议帧边界**毫无关系**，绝不能假设一次 read 是一条消息；
- `TextDecoder` 的 `stream: true` 保证多字节字符跨块时不产生乱码；
- 打字机 UI：增量追加文本 + 闪烁光标，配合 rAF 批量刷新避免每 token 一次渲染。

### 第 4 格 · 停止生成、贴底与工具卡

- **AbortController**：用户点停止 → `controller.abort()`，请求与读取循环立即终止；
- **贴底检测**：用户上滑查看历史时不应被自动滚动拽走——只有「距底 &lt; 阈值」才跟随；
- Tool Calling：模型要调工具时，前端先渲染「工具调用卡」（如"正在搜索…"），工具结果回来再续写正文。

## 坑点清单

> 🔗 正文对照：[《14.7 本章避坑清单》](../14-frontend-ai#_14-7-本章避坑清单)

1. 收到 chunk 就直接渲染：帧被 TCP 切开导致半个 JSON、半个汉字乱码，必须缓冲按 `\n\n` 切帧；
2. 没有 AbortController：用户无法停止生成长文，重复提问还会堆并发请求；
3. 无脑 scrollIntoView：用户一上滑就被强制拉回底部，先判断是否贴底再自动滚动。

## 自测 3 题（含答案）

1. SSE 一帧怎么界定？为什么要缓冲区？——**空行（双换行）结束一帧；网络 chunk 会把一帧切成多段，必须拼到完整帧再解析**。
2. TextDecoder 为什么要传 `{ stream: true }`？——**多字节 UTF-8 字符可能横跨两个 chunk，stream 模式保留残字节避免乱码**。
3. 流式聊天怎么做"停止生成"？——**用 AbortController 在点击时 abort fetch，并终止 reader 读取循环**。

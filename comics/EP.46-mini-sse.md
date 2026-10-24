# EP.46 SSE 那三种冒号

> 对应正文：[第二十六部分 · 手写网络栈](../26-mini-network-stack.md#_26-3-mini-event-source-sse-手写实现)

## 剧情回顾

- **第 1 格**：标签君读 SSE 流犯了经典错——Buffer 按 `\n` 切就 dispatch，结果服务器的一条 `data: hello\ndata: world\n\n` 被切成三个残片；加上断线重连没带 `Last-Event-ID` 头，服务器不知道从哪条继续发，事件丢得干干净净。
- **第 2 格**：码叔画协议——SSE 就四种前缀：`data:`（事件负载，可多行，多行要 join）、`event:`（事件名，默认 message）、`id:`（事件 id，要持久化）、`retry:`（重连毫秒数，别忽略）。**事件之间用空行 `\n\n` 分隔**，这才是真正的 dispatch 边界。
- **第 3 格**：像素酱实证——用 ReadableStream 逐块读，`Buffer.concat` 累进 buf，然后 while 循环 `buf.indexOf('\n\n')` 找完整事件块；每块 parse 四种冒号，多行 data 用 `\n` join 后再 dispatch；断线重连时自动带上 localStorage 里存的 last-event-id。
- **第 4 格**：码叔结案——别忽略 retry（服务器给的重连节奏是有道理的）、注释行（`: hello`）要静默吞、ReadableStream 中断要 catch。

## 知识点拆解

### 第 1 格 · SSE 基础

Server-Sent Events 协议极简，浏览器 `EventSource` 已经帮你实现了大部分——但手写才懂它为什么好：

- 连接：`GET` + `Accept: text/event-stream`；
- 服务器响应头：`Content-Type: text/event-stream` + 保持长连接；
- 客户端：`EventSource(url)`，自动重连、自动带 Last-Event-ID。

### 第 2 格 · 四种前缀 + 空行分隔

```
event: price-update\n       ← 可选事件名
id: 42\n                    ← 可选事件 id
data: {\n                   ← 多行 data
data:   "symbol": "BTC",\n
data:   "price": 100\n
data: }\n
retry: 3000\n               ← 可选重连间隔
\n                          ← 空行 = dispatch 信号
```

规则：
- `data:` 可以多行，累积后用 `\n` join（**注意是单个 `\n`，不是什么都不加**）；
- `event:` 和 `id:` 每个事件最多一行，后面的覆盖前面的；
- `retry:` 覆盖默认重连时间；
- 单独一行 `:` 是注释，静默忽略（服务器发心跳用）。

### 第 3 格 · mini EventSource 核心循环

```js
let buf = Buffer.alloc(0);
for await (const chunk of response.body) {
  buf = Buffer.concat([buf, chunk]);
  while (true) {
    const i = buf.indexOf('\n\n');
    if (i === -1) break;                   // 没凑齐一个事件
    parseAndDispatch(buf.slice(0, i));
    buf = buf.slice(i + 2);                // 吞掉空行
  }
}
```

parseAndDispatch 内部对每个事件块按 `\n` 切行，每行按第一个 `:` 分前缀，处理四种类型；多行 data 用 `lines.filter(l => l.startsWith('data:')).map(l => l.slice(5)).join('\n')`。

### 第 4 格 · 断线重连 + Last-Event-ID

```js
const storedId = localStorage.getItem('last-event-id');
const headers = storedId ? { 'Last-Event-ID': storedId } : {};

// 收到 id: 42 时：
localStorage.setItem('last-event-id', '42');
```

服务器据此只发 id ≥ 42 的事件，客户端丢事件的概率就降为零。这也是 SSE 比 WebSocket 更适合"历史敏感"场景的原因——协议本身有幂等。

## 坑点清单

> 🔗 正文对照：[《26.7 本章避坑清单》](../26-mini-network-stack#_26-7-本章避坑清单)

1. **retry 别忽略**：服务器给的 retry 是有目的的（限流、过载保护），别硬写死成 3s；
2. **多行 data 要用 `\n` join**：直接拼接会丢掉原来的换行，服务器如果发了 JSON 对象就 parse 失败；
3. **ReadableStream 中断要 catch**：for-await-of 被 abort 或网络断开时会抛 TypeError/CancelError，必须在 try/catch 里处理，然后触发重连；
4. **注释行要静默吞掉**：单独一行 `: heart-beat` 是服务器发的保活，别当事件 dispatch 出去；
5. **`data:` 前缀后面的空格**：规范里是可选的——`data: hello` 和 `data:hello` 都合法，别硬编码必须有空格。

## 自测 3 题（含答案）

1. **为什么 SSE 的事件分隔符是 `\n\n`（空行）而不是单个 `\n`？这种设计解决了什么问题？**——因为 `data:` 行本身就可以包含多个换行（服务器可以发多行 data 事件，parse 时用 `\n` join），如果事件边界也是 `\n`，就无法区分"这一行是 data 的一部分"还是"这一行是事件的结束"。双换行把事件粒度抬到"事件块"层级，data 内部允许自由换行，只要事件块之间有空行就行。
<details><summary>参考答案</summary>
- 多行文场景：服务器发一段 JSON object，自然带多个换行，用单换行就切烂；
- 与 HTTP parser 用 `\r\n\r\n` 分隔 header/body 是同一个设计思路——区块之间用更"重"的分隔符；
- 反过来，事件块内部的每行才用轻量的 `\n`，两种粒度不冲突。
</details>

2. **手写 EventSource 时，怎么正确处理断线重连？关键的三件事是什么？**——(a) 保存 last-event-id 到 localStorage，重连请求带 `Last-Event-ID` 头，让服务器续发；(b) 遵守服务器给的 `retry:` 值作为重连间隔，别写死；(c) 用指数退避 + 随机抖动避免雪崩（多个客户端同时重连打爆服务器）。另外还要注意：重连时如果上一个连接还没完全关干净，要等 close 事件后再发起新连接。
<details><summary>参考答案</summary>
```js
let retry = 1000;
async function connect() {
  const headers = {};
  const lastId = localStorage.getItem('last-event-id');
  if (lastId) headers['Last-Event-ID'] = lastId;
  try {
    const res = await fetch(url, { headers });
    for await (const chunk of res.body) {
      // parse and dispatch...
    }
  } catch (err) {
    // 读流中断，正常重连
  }
  const jitter = Math.random() * 0.5 + 0.5;   // 0.5~1 倍抖动
  setTimeout(connect, retry * jitter);
}
```
三个关键：持久化 id、读取 retry、抖动。
</details>

3. **一段 SSE 事件：`data: {\n  "msg": "hi"\n}\n\n`，parse 出来的 data 字段应该是什么？为什么不能直接 `data.slice(5)` 后拼接多行？**——正确结果是 `'{\n  "msg": "hi"\n}'`（三行用 `\n` join）。如果直接拼接三行会得到 `'{  "msg": "hi"}'`（中间无换行），JSON.parse 会失败或解析成错误结构。规范明确要求：多个 `data:` 行合并时用单个 `\n` 连接（最后一行不额外追加 `\n`）。
<details><summary>参考答案</summary>
```js
const dataLines = [];
for (const line of eventBlock.split('\n')) {
  if (line.startsWith('data:')) {
    dataLines.push(line.slice(5).replace(/^ /, ''));  // 去掉可选前导空格
  }
}
const data = dataLines.join('\n');   // 正确
// const wrong = dataLines.join('');  // 错误
```
注意 `data:` 后面的单个空格是可选的，所以 `line.slice(5).replace(/^ /, '')` 兼容有/无空格两种写法。
</details>

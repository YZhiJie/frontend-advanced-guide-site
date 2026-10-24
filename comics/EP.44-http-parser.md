# EP.44 HTTP 报文那七行字

> 对应正文：[第二十六部分 · 手写网络栈](../26-mini-network-stack.md#_26-1-mini-http-parser-http-报文怎么读)

## 剧情回顾

- **第 1 格**：标签君抓包看 HTTP 报文——一行 request line、N 行 headers、一行空行、最后才是 body。Buffer 在网络层是分段收的，肉眼看 "那七行字" 很美，但代码里就是一堆可能被切烂的字节。
- **第 2 格**：码叔点破——HTTP 报文的真正分隔符是 `\r\n\r\n`。`buf.indexOf('\r\n\r\n')` 一刀切，Header 和 Body 就此分家；再对 Header 那半截按 `\r\n` 切每一行，就是 request line + 若干 `Key: Value` 对。
- **第 3 格**：像素君实证——`createServer` 收到真实 Buffer 喂给手写 parser，method/path/version/headers/body 全对。关键是先等 Header 全部收齐（`indexOf !== -1`），再用 Content-Length 或 chunked 规则拼完 Body。
- **第 4 格**：码叔结案——别以为 indexOf 一把梭就完了。TCP 粘包、pipelining（多个请求拼一块）、chunked CRLF、Content-Length 边界……网络层永远是状态机，等不到分隔符就缓存着。

## 知识点拆解

### 第 1 格 · HTTP 报文结构

HTTP 报文格式是 ASN.1 之后最"正"的网络协议格式：

```
GET /api/user HTTP/1.1\r\n        ← request line
Host: example.com\r\n             ← headers
User-Agent: curl/8.0\r\n
\r\n                              ← 空行 = 硬分隔
{ "ok": true }                    ← body
```

响应同理，把第一行换成 `HTTP/1.1 200 OK\r\n`。`\r\n` 是历史包袱（电传打字机两个动作），但至今仍得严格遵守——不能用 `\n` 代替。

### 第 2 格 · 核心那一刀

```js
const idx = buf.indexOf('\r\n\r\n');
const headerBuf = buf.slice(0, idx);
const bodyBuf = buf.slice(idx + 4);
```

这是所有 HTTP parser 的根基。Header 这半截再按 `\r\n` split：第一行拆成 method/path/version，后续每行用第一个 `:` 切成 key/value。注意 header value 可能跨换行（折叠 header），但现代 HTTP 基本不玩了。

### 第 3 格 · TCP 粘包怎么办

`chunk` 可能只是半个 header，也可能带着下一个请求。所以不能对每个 chunk 直接 parse——必须有累加器：

```js
let buffer = Buffer.alloc(0);
socket.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const idx = buffer.indexOf('\r\n\r\n');
    if (idx === -1) break;                // 还没收齐
    const parsed = parseHeader(buffer.slice(0, idx));
    buffer = buffer.slice(idx + 4);
    // 等 body 收齐后再 dispatch
  }
});
```

这就是状态机的雏形——事件驱动网络层都是这个套路。

### 第 4 格 · Body 的三种长度规则

| 规则 | 来源 | 解法 |
| ---- | ---- | ---- |
| Content-Length | Header | 精确等够 N 字节 |
| Transfer-Encoding: chunked | Header | 直到 `\r\n0\r\n\r\n` |
| 无 Content-Length & 非 chunked | HTTP/1.0 或 response 无 body | 读到连接关闭 |

这三条是真实世界里最容易搞漏的分支。

## 坑点清单

> 🔗 正文对照：[《26.7 本章避坑清单》](../26-mini-network-stack#_26-7-本章避坑清单)

1. **chunked CRLF 陷阱**：chunked 编码每一段后面都有 `\r\n`，如果直接 split 会把 chunk 长度行当成 header；正确做法是按 chunk-size 行 + chunk-data + `\r\n` 三段循环解析。
2. **pipelining 粘包**：HTTP/1.1 允许一个 TCP 连接上连续发多个请求，响应也可能拼在一个 Buffer 里。parser 必须是循环驱动的，不能假设一个 chunk 只含一个报文。
3. **`\r\n` 边界别用 split**：split 会把 header 当普通文本切烂。对 Buffer 用 `indexOf('\r\n')` + `slice` 才是 Buffer 友好的写法。
4. **Content-Length 溢出**：有的恶意服务器会给巨大的 Content-Length；手写 parser 必须设最大 header/body 限制，不然就是 DoS 入口。

## 自测 3 题（含答案）

1. **为什么 HTTP 报文分隔符是 `\r\n\r\n`，不是单个 `\r\n`？**——Header 区和 Body 区之间必须有一个"不可再分"的硬边界。`\r\n` 本身是 Header 行的分隔符，如果用它切 Header 和 Body，那 Body 里出现的任何 `\r\n` 都会被误判。连续两个 `\r\n` 才是 Header 区的结束标记。

<details><summary>参考答案</summary>
- 结构正确性：单 `\r\n` 是 header 行间分隔符，区分不出 header 结束还是 header 换行；
- Body 里可能含 `\r\n`（JSON/HTML/表单数据都可能），如果只靠一个分隔符会切烂；
- 协议实现上，任何 parser 都需要一个"此处分隔两区块"的锚点，双 CRLF 就是这个锚点。
</details>

2. **TCP 粘包场景下，一个 chunk 可能包含"半个 Header + 完整 Body + 下一个 Header 的一半"，你的 parser 应该怎么设计？**——必须是累加器 + 循环驱动：chunk 先 concat 进 buffer，然后 while 循环每次 `indexOf('\r\n\r\n')`，找到就切一刀、parse、dispatch，继续循环直到找不到为止才退出等下一个 chunk。Body 部分同理——Header 里拿到 Content-Length/Transfer-Encoding 后，用同样的 while 循环累计直到 Body 收齐再 dispatch 完整请求。

<details><summary>参考答案</summary>
```js
let buf = Buffer.alloc(0);
socket.on('data', c => {
  buf = Buffer.concat([buf, c]);
  while (true) {
    const hi = buf.indexOf('\r\n\r\n');
    if (hi === -1) return;                          // header 还没凑齐
    const header = buf.slice(0, hi);
    const cl = parseContentLength(header);
    const bi = hi + 4 + cl;
    if (cl == null || buf.length < bi) return;       // body 还没凑齐
    dispatch({ header, body: buf.slice(hi+4, bi) });
    buf = buf.slice(bi);
  }
});
```
</details>

3. **chunked 编码的 Body 怎么解析？核心循环是什么？**——chunked 格式是 `size\r\ndata\r\n` 循环，直到 `size=0` 结束。解析器循环：先读一行 `size`（十六进制字符串，parseInt(hex, 16)），再读 `size` 字节 data，再吞掉一个 `\r\n`。size=0 时循环结束（注意后面还有 trailer 区，多数 parser 忽略）。

<details><summary>参考答案</summary>
- size 行：十六进制，可能有扩展参数 `;ext=val` 需截断 `;` 前的部分；
- 必须用累加器逐个 chunk 切，不能对整个 bodyBuffer 一次 split；
- 最坑的地方是 size 后面的 `\r\n`——读完 size 字节后必须确认跟着 `\r\n` 才能继续下一轮；
- 0 结束后还有 trailer headers（可选），然后是最后的 `\r\n`。
</details>

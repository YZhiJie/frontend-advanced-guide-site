# EP.45 fetch 背后那个 URL 对象

> 对应正文：[第二十六部分 · 手写网络栈](../26-mini-network-stack.md)

## 剧情回顾

- **第 1 格**：标签君想手写 fetch——一遇 301 从 http 跳到 https 就爆 `Protocol "https:" not supported`，一调 AbortController.abort() 就 `TypeError: The operation was aborted`。错误信息像没说一样。
- **第 2 格**：码叔揭开——URL 字符串 vs URL 对象是关键差。字符串传进 net.request，它就按你给的协议走；redirect 后必须用 `new URL(location, base)` 重新构造，协议会自动从 http 升到 https。abort 不是同步杀进程——要 `signal.addEventListener('abort', ...)` 监听事件。
- **第 3 格**：像素酱实证 mini-fetch 三条主线——30x 时 follow 且换 URL 对象重入；signal 监听 destroy；超时 setTimeout + 记状态。跑下来 redirect 自动跟随、abort 立即断、超时也能正确 reject。
- **第 4 格**：码叔结案——fetch 底层就是 URL 解析器 + request 状态机。协议只能升级不能降级、abort 后必须先记 aborted 再 destroy、超时后别忘了 clearTimeout。

## 知识点拆解

### 第 1 格

浏览器 fetch 是 Node 18+ 才内置的 polyfill 化产物。核心四件事：

1. URL 解析：WHATWG 标准 URL 类，不是旧 url.parse；
2. 重定向链：最多 follow 到 maxRedirects，协议只能 http→https；
3. AbortController 信号：abort 是事件触发，不是同步；
4. 响应体是 ReadableStream，逐块 await。

### 第 2 格

Location 头可能是相对路径，必须用 base URL 拼：

```js
const base = new URL(url);
const next = new URL(locationHeader, base);
```

然后按 `next.protocol` 决定用 http.request 还是 https.request。

### 第 3 格

AbortController 正确姿势：

```js
if (signal?.aborted) {
  return reject(new DOMException('Aborted', 'AbortError'));
}
signal?.addEventListener('abort', () => req.destroy(), { once: true });
```

坑点：signal 已经 aborted 再调 request，会立即抛 TypeError。

### 第 4 格

超时实现：

```js
let timer;
const timeoutPromise = new Promise((_, reject) => {
  timer = setTimeout(() => reject(new Error('Timeout')), 8000);
});
Promise.race([fetchPromise, timeoutPromise]).finally(() => clearTimeout(timer));
```

关键：不管哪条先赢都要清 timer。

## 坑点清单

> 🔗 正文对照：[《26.7 本章避坑清单》](../26-mini-network-stack#_26-7-本章避坑清单)

1. redirect 协议只能升级不能降级：http→https 自动 follow，https→http 直接拒。
2. abort 后状态要先记下来：`aborted = true; req.destroy()`。
3. 超时后要 clearTimeout：race 的输家不能留悬挂定时器。
4. location 头可能是相对路径：必须传 base。
5. Node 17+ 有 `AbortSignal.timeout(ms)`，省得自己写 setTimeout。

## 自测 3 题

**1. 手写 fetch 遇到 http→https 重定向时不能直接把原 URL 字符串传给 https.request，为什么？**

因为 http 和 https 是两个不同的 Node 模块（http.request vs https.request），握手协议、证书链、端口默认值都不一样。更重要的是 Location 头可能是相对路径（如 /redirect-target），必须用 `new URL(location, base)` 重新生成一个新的 URL 对象，让它自动处理协议升级 + 路径归一化。

<details>
<summary>参考答案</summary>

```js
const url = 'http://old.example.com/redirect';
const location = '/redirect-target';
const base = new URL(url);
const next = new URL(location, base);
next.protocol = 'https:';
const lib = next.protocol === 'https:' ? https : http;
const req = lib.request(next, ...);
```

</details>

**2. AbortController.abort() 之后，如果在 abort 之后才调 fetch，会发生什么？怎么避免？**

会立即抛 `TypeError: Aborted`，因为 fetch 内部会先检查 `signal.aborted`，为 true 就直接 reject。避免方式：在发起 fetch 前先判断。

<details>
<summary>参考答案</summary>

```js
function fetchWithSignal(url, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException('Aborted', 'AbortError'));
    }
    const req = https.request(new URL(url), res => { ... });
    signal?.addEventListener('abort', () => req.destroy(), { once: true });
    req.on('error', reject);
    req.end();
  });
}
```
</details>

3. **超时 race 的输家需要被清理吗？**

需要。两种实现：(a) race + clearTimeout：fetch 赢了清 timer，timer 赢了 abort fetch；(b) 直接用 `AbortSignal.timeout(ms)`，超时就是 abort 事件。

<details>
<summary>参考答案</summary>

```js
// 方案 A：手动 race，能区分 TimeoutError
async function fetchTimeout(url, ms) {
  let timer;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new TimeoutError()), ms);
  });
  try {
    return await Promise.race([fetch(url), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
// 方案 B：AbortSignal.timeout（最简）
const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
```

</details>

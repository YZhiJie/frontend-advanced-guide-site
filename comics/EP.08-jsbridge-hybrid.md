# EP.08 JSBridge 与跨端

> 对应正文：[08-cross-platform.md](../08-cross-platform.md)（8.5 Hybrid 与 JSBridge 原理）· 示例：`examples/08-01-jsbridge.ts`

## 剧情回顾

- **第 1 格**：标签君的 H5 页面在 WebView 里想调原生扫码，却发现 JS 引擎里根本没有这些 API。
- **第 2 格**：码叔揭秘 JS→原生的两条通道：scheme 拦截（老办法）与原生注入对象（主流）。
- **第 3 格**：像素酱实证回调机制——给每次调用发 id 存注册表，原生完成后按 id 回到对应的 Promise。
- **第 4 格**：码叔结案——最大的坑是注入时机：bridge 必须赶在业务 JS 就绪之前注入完成。

## 知识点拆解

### 第 1 格 · 为什么需要桥

- H5 运行在 WebView 沙箱，只有标准 Web API，没有摄像头/相册/支付等原生能力；
- 原生壳（Android/iOS）握有全部系统能力，但看不懂 JS；
- JSBridge 就是两端之间的"外交协议"：约定方法名、参数、回调格式。

### 第 2 格 · JS → 原生的两条通道

```js
// 通道①：scheme 拦截（老办法）
location.href = 'jsbridge://scan?id=1';
// 原生拦截 URL 协议，解析参数后执行

// 通道②：注入对象（主流）
window.NativeBridge.scan(params);
// Android: addJavascriptInterface
// iOS WKWebView: WKScriptMessageHandler
```

- scheme 拦截兼容性好但有 URL 长度限制、时序问题；注入对象是现在的标准做法；
- 本质相同：把「方法名 + 参数」序列化后交给原生层。

### 第 3 格 · 原生 → JS 与回调注册表

```ts
const cbs = new Map();
function call(method, data) {
  const seq = ++id;
  cbs.set(seq, { resolve, reject });
  sendToNative(seq, method, data);
}
// 原生完成 → evaluateJavascript 回调对应 id
```

- 调用是异步的、可能乱序返回，靠 **id 注册表**把结果配对回正确的 Promise；
- 配合**超时兜底**：超时未回调就 reject 并清理，防止调用永久挂起。

### 第 4 格 · 注入时机

- 业务 JS 可能在 bridge 注入完成前就执行（页面有缓存时尤其明显）；
- Android 在 `onPageStarted` 前注入，iOS 用 `WKUserScript` 在文档创建时注入；
- JS 侧做保护：bridge 未就绪时先入队，ready 后重放（类似"重放 join"）。

## 坑点清单

> 🔗 正文对照：[《移动端经典坑点专题（JD 适配）》](../08-cross-platform#移动端经典坑点专题-jd-适配)

1. bridge 注入时机晚于业务 JS 调用：`window.NativeBridge is undefined`，必须 ready 队列兜底；
2. 回调不注册 id 直接"最后一个覆盖"：并发调用时结果张冠李戴；
3. 原生只回调成功不回调失败：调用方没有超时兜底就永久挂起，loading 转到天荒地老。

## 自测 3 题（含答案）

1. JS 调原生的两条通道是什么？——**scheme 拦截（location.href 触发协议被原生拦截）与注入对象（addJavascriptInterface / WKScriptMessageHandler）**。
2. 回调为什么需要 id 注册表？——**调用异步且可能乱序返回，id 把结果配对回正确的 Promise，配合超时防挂起**。
3. bridge 未注入完成时 JS 调用怎么办？——**调用先入队，监听 bridge ready 后重放队列**。

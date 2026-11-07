# EP.18 Worker 家族与跨 Tab

> 对应正文：[18-worker-messaging.md](../18-worker-messaging.md)（Worker 家族 / Service Worker 缓存与更新 / 跨 Tab 通信选型）· 示例：`examples/18-01-cross-tab/`、`examples/18-04-service-worker/`

## 剧情回顾

- **第 1 格**：标签君在主线程算十万行数据，三秒长任务冻结了所有点击与动画。
- **第 2 格**：码叔揭秘 Dedicated Worker：独立线程计算，postMessage 回传，UI 全程不卡。
- **第 3 格**：像素酱实证四兄弟分工，以及跨 Tab 通信的两条路（BroadcastChannel / SharedWorker）。
- **第 4 格**：码叔结案——Service Worker 新版本要 skipWaiting + 通知 reload 才会生效。

## 知识点拆解

### 第 1 格 · 主线程为什么不能算重活

- 浏览器主线程同时负责 JS 执行、样式布局、绘制合成、事件响应；
- 一个超过 50ms 的任务就会让交互出现可感知延迟，三秒即"页面已无响应"；
- 原则：**主线程只做与 UI 直接相关的事，计算卸载到 Worker**。

### 第 2 格 · Dedicated Worker

```js
const w = new Worker('calc.worker.js');
w.postMessage(rows);                 // 结构化克隆：拷贝一份传过去
w.onmessage = (e) => render(e.data);
```

- Worker 运行在独立线程，有独立事件循环；
- **没有 `window`/`document`/DOM**，能做计算、fetch、IndexedDB、定时器；
- postMessage 默认**结构化克隆**（深拷贝，有开销）；大块二进制用 Transferable（转移所有权，零拷贝）或 SharedArrayBuffer。

### 第 3 格 · Worker 四兄弟与跨 Tab

- **Dedicated Worker**：一个页面专属，卸载计算（排序、解析、编解码）；
- **SharedWorker**：同源多个页面共享同一个工人，可作为跨 Tab 的状态中枢（端口连接，首个连接负责"选主"）；
- **Service Worker**：页面外的网络代理，拦截 fetch 做离线缓存、后台同步、推送；
- **Worklet**：渲染管线/音频的底层钩子（PaintWorklet、AudioWorklet）；
- 跨 Tab 只广播事件 → `BroadcastChannel` 最轻；要共享一份状态/长连接 → SharedWorker。

### 第 4 格 · Service Worker 更新机制

- 浏览器检测到 sw.js 字节变化 → 安装新 Worker，但**旧 Worker 仍控制着所有页面**，新的进入 waiting；
- `self.skipWaiting()` 让新 SW 安装后立即激活，配合 `clients.claim()` 接管；
- 前端监听 `controllerchange` 提示用户刷新（或自动 reload），否则用户仍跑旧缓存；
- 缓存策略要带版本号（如 `cache-v3`），activate 阶段清理旧缓存。

## 坑点清单

> 🔗 正文对照：[《模块十：坑点速查、调试与自测》](../18-worker-messaging#模块十-坑点速查、调试与自测)

1. 在 Worker 里写 DOM 操作报 ReferenceError：Worker 无 DOM，只能算完把结果 postMessage 回去；
2. 频繁 postMessage 巨大对象：结构化克隆成本高，用 Transferable 转移或切片增量发送；
3. 发布新 SW 后用户死活不更新：waiting 状态没处理——skipWaiting + controllerchange 提示 reload。

## 自测 3 题（含答案）

1. 为什么 Worker 里不能操作 DOM？——**Worker 是无 DOM 的独立线程环境，只有计算/fetch/IndexedDB 等能力，UI 变更必须回传主线程执行**。
2. BroadcastChannel 和 SharedWorker 怎么选？——**只需跨 Tab 广播事件选 BroadcastChannel（轻量）；需要共享状态或共享一条长连接选 SharedWorker**。
3. 新 Service Worker 为什么不立刻生效？怎么处理？——**旧 SW 仍控制页面，新的在 waiting；调用 skipWaiting + clients.claim，并监听 controllerchange 提示刷新**。

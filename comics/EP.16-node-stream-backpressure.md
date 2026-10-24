# EP.16 Node 流与背压

> 对应正文：[16-node-server.md](../16-node-server.md)（16.1 Node 运行时要点 / 16.2 Stream 与背压 / 16.3 BFF 层实战）· 示例：`examples/16-01-node-event-loop.ts`、`examples/16-03-stream-pipeline.ts`

## 剧情回顾

- **第 1 格**：标签君用 readFile 读 2GB 日志，文件全量进内存，服务直接 OOM。
- **第 2 格**：码叔揭秘事件循环：libuv 扛 IO，CPU 密集任务会堵死整个循环。
- **第 3 格**：像素酱实证流与背压：pipeline 分块流动，写不动就反压上游，内存恒定。
- **第 4 格**：码叔结案——Node 的甜区是 IO 密集的 BFF 聚合层，重活交给 Worker。

## 知识点拆解

### 第 1 格 · 全量读取的代价

```ts
readFile('big.log', (e, data) => process(data)); // ❌ 2GB 文件 = 2GB 常驻内存
```

- 并发十个请求就是十倍内存峰值，容器直接被 OOM Killer 回收；
- 正确直觉：**数据应该"流过"程序，而不是"躺进"内存**。

### 第 2 格 · 事件循环与 libuv

- Node 单线程：JS 执行只有一个线程，IO（网络/文件/定时器）交给 libuv 线程池与系统多路复用；
- 主阶段：timers → pending callbacks → poll（IO 回调）→ check（`setImmediate`）→ close；
- 微任务（Promise/MutationObserver 语义的 nextTick）在每个阶段切换间清空；
- **CPU 密集代码（加密、大循环、图像编解码）独占主线程**，期间所有请求排队——用 `worker_threads` 卸载。

### 第 3 格 · Stream 与背压

```ts
import { pipeline } from 'node:stream/promises';
await pipeline(
  createReadStream('big.log'),  // 读：磁盘很快
  createGzip(),                  // 变换
  res                           // 写：客户端很慢
);
```

- 写端处理不过来时 `write()` 返回 `false`，读端自动暂停（背压/backpressure）；
- 缓冲排空后触发 `drain`，读端恢复——**速率由最慢的一端决定，内存恒定为几块 chunk**；
- 务必用 `pipeline` 而非裸 `pipe`：前者错误自动传播、自动销毁所有流，避免句柄泄漏。

### 第 4 格 · BFF 聚合层

- BFF（Backend For Frontend）：Node 在边缘给前端做**并行聚合、字段裁剪、协议转换**；
- 典型场景：一个页面要调 5 个后端接口，BFF 用 `Promise.all` 并行取回并裁成页面形状；
- 这是纯 IO 等待，正中 Node 单线程高并发的甜区。

## 坑点清单

> 🔗 正文对照：[《16.7 本章避坑清单》](../16-node-server#_16-7-本章避坑清单)

1. `readFileSync`/全量 readFile 处理大文件：内存随文件大小线性增长，必 OOM；
2. 在请求处理里跑 CPU 密集计算：整个事件循环被堵，健康检查都超时——挪到 worker_threads；
3. 手动 `data` 事件拼接却不处理背压：读快写慢时缓冲区无限增长，内存照样爆。

## 自测 3 题（含答案）

1. Node 为什么适合 IO 密集但怕 CPU 密集？——**IO 由 libuv 异步处理，单线程可承载大量并发等待；CPU 密集会独占主线程，所有请求排队**。
2. 什么是背压？流怎么处理它？——**写端消费不过来通知读端暂停（write 返回 false），缓冲排空 drain 后恢复，使内存恒定**。
3. pipeline 相比裸 pipe 好在哪？——**错误自动向上游传播、自动销毁所有流并关闭句柄，避免资源泄漏**。

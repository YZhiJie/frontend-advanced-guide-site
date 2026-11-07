# EP.73 看不见的体验监控网

> 对应正文：[99-web-performance-monitoring.md](../99-web-performance-monitoring.md)（99.1 Vitals / 99.2 错误捕获 / 99.3 APM 上报 / 99.4 指纹聚合）· 示例：`examples/99-01-web-performance-monitoring.ts`

## 剧情回顾

- **第 1 格**：线上白屏，用户投诉才知道——没有错误监控。
- **第 2 格**：码叔揭秘错误捕获——onerror/unhandledrejection/资源错误三种方式。
- **第 3 格**：像素酱实证 APM 上报（采样+批量）与错误指纹聚合去重。
- **第 4 格**：码叔结案——健康评分与告警规则。

## 知识点拆解

### 第 1 格 · 没有监控的盲飞

- 线上错误开发感知不到；
- 必须建立错误和性能监控才能闭环优化。

### 第 2 格 · 错误捕获

- JS 运行时：`window.onerror`；
- Promise 拒绝：`unhandledrejection`；
- 资源加载：捕获阶段 `error` 事件；
- React 渲染错误：Error Boundary。

### 第 3 格 · APM 上报与指纹

- 采样：错误全量、Vitals 采样；
- 批量：攒 N 条合并发；
- 指纹：message+stack 哈希，相同错误只更新计数。

### 第 4 格 · 健康评分与告警

- 健康分 = Vitals(75%) + 错误率(25%)；
- 告警：错误率环比突增、LCP 超阈值，加抑制防风暴。

## 坑点清单

> 🔗 正文对照：[《99.7 本章避坑清单》](../99-web-performance-monitoring#_99-7-本章避坑清单)

1. 上报风暴 → 采样+批量+限流；
2. 数据丢失 → sendBeacon 或 fetch keepalive；
3. stack 看不懂 → 上传 sourcemap。

## 自测 3 题（含答案）

1. 前端三类错误分别怎么捕获？——**JS 错误用 window.onerror，Promise 用 unhandledrejection，资源错误用捕获阶段 error 事件**。
2. APM 上报为什么要采样和批量？——**防止上报风暴，降低服务器压力，采样减少数据量，批量减少请求数**。
3. 错误指纹有什么用？——**把相同错误归并去重，避免同一错误存成千上万条**。

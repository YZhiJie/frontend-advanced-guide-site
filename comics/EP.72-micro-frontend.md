# EP.72 巨石应用的拆分术

> 对应正文：[98-micro-frontend.md](../98-micro-frontend.md)（98.1 生命周期 / 98.2 JS 沙箱 / 98.3 样式隔离 / 98.4 方案选型）· 示例：`examples/98-01-micro-frontend.ts`

## 剧情回顾

- **第 1 格**：子应用样式互相污染——.btn 全局生效。
- **第 2 格**：码叔揭秘 JS 沙箱（Proxy）+ 样式隔离（scoped/shadow DOM）。
- **第 3 格**：像素酱实证三种方案选型——qiankun/MF/wujie。
- **第 4 格**：码叔结案——生命周期与事件总线通信。

## 知识点拆解

### 第 1 格 · 样式污染

- 子应用 CSS 没有作用域，全局类名互相覆盖；
- 必须做样式隔离。

### 第 2 格 · JS 沙箱与样式隔离

- JS 沙箱：Proxy 代理 window，写入进私有副本不污染主应用；
- 样式隔离：scoped（前缀）、shadow DOM、CSS Modules。

### 第 3 格 · 方案选型

- qiankun：多技术栈、存量应用多；
- Module Federation：同技术栈、新应用；
- wujie：老旧应用、需强隔离。

### 第 4 格 · 生命周期与通信

- 生命周期：bootstrap→mount→unmount；
- 通信：全局事件总线，事件名加应用前缀。

## 坑点清单

> 🔗 正文对照：[《98.7 本章避坑清单》](../98-micro-frontend#_98-7-本章避坑清单)

1. 子应用挂 window 变量 → 用沙箱私有域；
2. 样式冲突 → CSS Modules 或 strictStyleIsolation；
3. 定时器没清 → unmount 里清所有监听。

## 自测 3 题（含答案）

1. JS 沙箱 Proxy 方案怎么隔离全局变量？——**写入进私有 fakeWindow，读取先查私有再回退真实 window**。
2. qiankun 和 wujie 的核心区别？——**qiankun 用 Proxy 沙箱+HTML Entry，wujie 用 iframe 实现强隔离**。
3. 子应用之间怎么通信？——**全局事件总线发布订阅，事件名加应用前缀**。

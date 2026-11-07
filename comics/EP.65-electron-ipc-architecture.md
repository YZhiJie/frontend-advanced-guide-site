# EP.65 Electron 三层防线

> 对应正文：[91-electron-ipc-architecture.md](../91-electron-ipc-architecture.md)（91.1 三层架构 / 91.2 IPC 通道 / 91.3 事件推送）· 示例：`examples/91-01-electron-ipc-architecture.ts`

## 剧情回顾

- **第 1 格**：渲染进程直接 require('fs')，XSS 即可操作系统——nodeIntegration 的灾难。
- **第 2 格**：码叔揭秘三层架构——main 掌权、preload 桥接、renderer 只用授权 API。
- **第 3 格**：像素酱实证 IPC 通道白名单与参数校验。
- **第 4 格**：码叔结案——主进程用 send 主动推送事件给渲染进程。

## 知识点拆解

### 第 1 格 · nodeIntegration 的风险

- 渲染进程开启 nodeIntegration 后能直接调 Node API；
- 一旦有 XSS 漏洞，黑客可操作系统（删文件、读密钥）；
- 现代 Electron 默认 `contextIsolation: true`，禁止直连。

### 第 2 格 · 三层架构

```
渲染进程(Chromium) ↔ preload(contextBridge) ↔ 主进程(Node)
```

- **主进程**：Node.js 环境，拥有系统能力（文件、网络、托盘）；
- **preload**：桥接层，用 `contextBridge.exposeInMainWorld` 暴露受控 API；
- **渲染进程**：纯网页环境，只能调 preload 暴露的方法。

### 第 3 格 · IPC 权限校验

- 通道名白名单：只注册允许的通道；
- 参数校验：类型、范围（如禁止写 /sys 目录）；
- 最小权限：只暴露必要能力，不暴露整个 fs 模块。

### 第 4 格 · 主→渲染事件推送

- `webContents.send(channel, data)`：主进程主动推送；
- `ipcRenderer.on(channel, cb)`：渲染进程监听；
- 与 `invoke`（渲染→主请求-响应）配合使用。

## 坑点清单

> 🔗 正文对照：[《91.7 本章避坑清单》](../91-electron-ipc-architecture#_91-7-本章避坑清单)

1. 开 nodeIntegration → XSS 等于系统沦陷；
2. preload 暴露整个 fs → 权限过大，应封装最小 API；
3. IPC 不校验参数 → 路径穿越漏洞。

## 自测 3 题（含答案）

1. Electron 三层架构分别是什么？——**主进程(Node) / preload(桥接) / 渲染进程(Chromium)**。
2. 为什么渲染进程不能直连 Node？——**防止 XSS 漏洞被利用获取系统权限，必须通过 preload 暴露受控 API**。
3. 主进程如何主动推送消息给渲染进程？——**`webContents.send(channel, data)`**。

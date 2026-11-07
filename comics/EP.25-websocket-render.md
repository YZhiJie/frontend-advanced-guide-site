# EP.25 WebSocket 实时渲染

> 对应正文：[21-frontend-ai-interview.md](../21-frontend-ai-interview.md)（21.6 WebSocket 与实时渲染）· 示例：`examples/06-04-websocket-manager.ts`、`examples/18-01-cross-tab/`

## 剧情回顾

- **第 1 格**：AI 客服要加"坐席实时协同 + 语音打断"，SSE 只会服务端推、浏览器没法同时双向说话，标签君卡住。
- **第 2 格**：码叔揭秘 WebSocket——HTTP 握手 `Upgrade` 换 101 后变全双工长连接，帧有 text/binary/ping/pong/close，收发自由。
- **第 3 格**：像素酱实证连接保命三件套：应用层 ping + 看门狗识破半开死链、全抖动指数退避防重连风暴、resume + seq 断点补发。
- **第 4 格**：码叔结案——token 别放 URL query 换一次性票据、高频消息 rAF 合批渲染、bufferedAmount 背压保护。

## 知识点拆解

### 第 1 格 · 什么时候必须上 WebSocket

- SSE：服务端 → 客户端单向文本，适合 token 流，简单穿透好；
- WebSocket：全双工、二进制，适合语音上行、Agent 中途追加指令、多人协同、IM、白板；
- 折中：SSE 走 token 流 + REST 发控制指令（停止/反馈），别为少量双向需求硬上 WS；
- 协同新形态：多人观看同一个 Agent 回答时，服务端对一次模型调用做房间 fan-out，不重复调模型。

### 第 2 格 · 握手与帧

```http
GET /ws HTTP/1.1
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: <16 随机字节 base64>
---
HTTP/1.1 101 Switching Protocols
Sec-WebSocket-Accept: base64(SHA1(Key + RFC6455 GUID))
```

- Accept 只用于证明"对方懂 WebSocket"，**不是加密、不是鉴权**；
- 帧：text(0x1)/binary(0x2)/close(0x8)/ping(0x9)/pong(0xA)，FIN 支持分片，permessage-deflate 压缩；
- 浏览器无法主动发协议 ping，心跳用业务消息 `{"type":"ping"}`。

### 第 3 格 · 连接管理三件套

1. **心跳 + 看门狗**：每 25s 发 ping，8s 没收到 pong 主动 close 走重连——TCP keepalive 默认两小时，进程假死它发现不了；
2. **全抖动指数退避**：`min(30s, 1s×2ⁿ) × (0.5~1.5 随机)`，防止断网恢复时全体客户端同时打爆网关；
3. **断点续传**：重连后发 `resume(lastSeq)`，服务端补发缺口；未连接期间的消息排队，恢复后重放；收到消息按 seq 去重。

- 框架坑：React StrictMode 双挂载会开两条连接——用模块级单例 manager + 引用计数；
- 移动端：`visibilitychange` 回前台主动探活，页面被挂起时看门狗会失真。

### 第 4 格 · 鉴权、渲染与背压

- 鉴权三方案：REST 换**一次性短期 ticket**（推荐，5~30s 单次有效）、Cookie、Sec-WebSocket-Protocol 带头；别把长期 token 放 URL（进日志/历史）；
- 校验 Origin 防跨站 WS 劫持（CSWSH），全程 wss，单帧大小 + 频率 + 并发连接三限流；
- 高频消息：入队列 → rAF 每帧取最新值合批/coalesce → ref 直写或 canvas，绕过响应式；大列表窗口化；
- 背压：发送前看 `bufferedAmount`，超阈值降级（降频/丢非关键帧）；
- 协同冲突：OT（中央服务器变换，Google Docs 路线）vs CRDT（Yjs/Automerge，可交换合并）。

## 坑点清单

> 🔗 正文对照：[《21.7.3 常见误区总清单》](../21-frontend-ai-interview#_21-7-3-常见误区总清单)

1. 无心跳：半开死链（WiFi 掉线、NAT 超时）双方都不知道，消息石沉大海；
2. 重连固定间隔：断网恢复瞬间重连风暴打挂网关；
3. 重连后消息丢/重：没有 seq 与 resume 补发、没有幂等去重；
4. token 放 ws URL：日志泄露；
5. 每秒几十条消息直接 setState：帧帧重渲染，必须 rAF coalesce + 窗口化。

## 自测 3 题（含答案）

1. **描述 WebSocket 握手与 SSE 的本质区别。**——WS 用 HTTP 头 Upgrade 换 101 后成为全双工二进制协议；SSE 自始至终是一个单向 HTTP 长响应。Sec-WebSocket-Accept 只是协议认知证明，不管安全。
2. **如何实现可靠的断线重连？**——应用心跳 + 看门狗检测半开 → 全抖动指数退避（封顶 30s）→ resume(lastSeq) 补发缺口 + 排队消息重放 + 按 seq 去重；onerror 统一收敛到 onclose 处理避免竞态。
3. **AI 客服要加实时协同怎么设计？**——WebSocket 房间（会话即房间），模型流服务端 fan-out 给全体观看者；presence 走可丢帧信令；坐席接管走角色状态机并停模型流；成员资格加入与每条消息双校验；消息持久化与实时通道分离。

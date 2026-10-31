# EP.23 MCP 协议

> 对应正文：[21-frontend-ai-interview.md](../21-frontend-ai-interview.md)（21.4 MCP：模型上下文协议）· 关联：`examples/14-03-tool-ui.tsx`（工具调用卡 UI）

## 剧情回顾

- **第 1 格**：标签君要接 GitHub、数据库、订单系统三套工具，每接一个 AI 应用就要重写一遍适配，N×M 的泥潭。
- **第 2 格**：码叔亮出 MCP——**Model Context Protocol（模型上下文协议）**，给 AI 接外部能力的"USB-C"；三角色 Host / Client / Server，消息走 JSON-RPC 2.0。
- **第 3 格**：像素酱实证握手时序：`initialize` 协商能力 → `notifications/initialized` → `tools/list`（每个工具带 JSON Schema）→ `tools/call`，远程传输走 Streamable HTTP。
- **第 4 格**：码叔结案——MCP ≠ Function Calling；错误有三层；可重试才重试，全抖动退避 + 熔断；危险调用必须用户授权。

## 知识点拆解

### 第 1 格 · N×M 适配爆炸

- 没有统一协议时，N 个 AI 应用 × M 个工具 = N×M 套私有对接；
- 工具发现、鉴权、流式进度、错误码各搞各的；
- MCP 把它变成 N+M：任何 Host 都能即插即用任何 Server。

### 第 2 格 · 三角色与 JSON-RPC

| 角色 | 职责 |
| ---- | ---- |
| Host | 用户的 AI 应用（Claude Desktop/IDE/客服工作台），管权限与 UI |
| Client | Host 内与每个 Server 维持的 1:1 协议连接 |
| Server | 暴露 tools / resources / prompts 的本地或远程服务 |

```json
{ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": { "name": "query_order", "arguments": { "orderId": "A1024" } } }
```

- 请求带 `id` 且必须有响应；通知（notification）无 `id`；
- 传输两种：**stdio**（本地子进程，每行一条）与 **Streamable HTTP**（远程单端点，可升级 SSE 流式，2025 规范取代旧的 HTTP+SSE 双端点）。

### 第 3 格 · 生命周期与工具契约

- `initialize` 交换协议版本与 capabilities → 客户端发 initialized 通知 → 才能 list/call；
- 工具入参是 **JSON Schema**：调用前先本地校验（模型可能幻觉出非法参数），用户授权后再发 Server；
- 清单缓存 + `tools/list_changed` 通知增量更新；
- 流式工具调用通过 SSE 下发进度，前端渲染"检索中…"步骤卡。

### 第 4 格 · 与 Function Calling 的边界（最高频考点）

- **Function Calling 是"模型的嘴"**：模型输出结构化调用意图，是一次推理能力；
- **MCP 是"应用的手"**：应用与工具服务器之间怎么连、怎么发现、怎么协商、怎么传结果；
- 一条链路：模型 function-call → Host 校验授权 → 经 MCP `tools/call` 执行 → 结果回灌模型续写；
- 三层失败：传输故障 / JSON-RPC 标准错误码（-32602 参数非法等）/ 协议成功但 `isError:true` 业务失败，再加用户拒绝授权——处理策略各不相同。

## 坑点清单

> 🔗 正文对照：[《21.7.3 常见误区总清单》](../21-frontend-ai-interview#_21-7-3-常见误区总清单)

1. 名字说错：MCP 是 Model **Context** Protocol，不是 Control；
2. 把 MCP 与 Function Calling 混为一谈——前者是连接协议，后者是模型能力，互补；
3. 对 -32602/-32601 这类确定性错误做重试：永远不会成功，应立即失败；
4. 盲目信任社区 Server：要沙箱化、最小权限、审计其资源访问；
5. 写操作不做二次确认：模型意图不等于用户授权。

## 自测 3 题（含答案）

1. **MCP 解决什么问题？三角色分别是什么？**——统一 AI 应用接入外部工具/资源/提示词的协议，把 N×M 变 N+M；Host（AI 应用，管权限）、Client（与 Server 1:1 的连接）、Server（暴露 tools/resources/prompts）。
2. **MCP 握手流程？**——initialize 协商协议版本与能力 → notifications/initialized → tools/list 发现工具 → tools/call 调用；stdio 与 Streamable HTTP 两种传输，后者支持流式进度。
3. **工具调用失败有哪几类？如何处理？**——传输/5xx/-32603 可按全抖动指数退避重试并配熔断；-32602/-32601 参数或方法错误立即失败并回喂模型修正；`isError:true` 属业务失败按业务提示；权限拒绝走明确 UI 不静默重试。

// 文件: examples/39-02-reliable-delivery.ts
// ============ 可靠投递：ACK / 超时重发 / 幂等去重 ============
// 网络不可靠是 IM 的一切设计前提。可靠投递三件套：
// 1) ACK：客户端发出后起计时器，服务端确认（回填 serverId）才停；
// 2) 超时重发：超时未 ACK 就重发，clientId 不变——服务端据此幂等去重，
//    避免"重发导致对方收到两条"；
// 3) 接收端去重：按 clientId（或 serverId）判重，重复投递直接丢弃。
// 本示例用确定性伪网络（丢包表）模拟，可重复运行验证。

export interface Wire {
  /** 按调用次序预先决定是否丢包（true = 丢弃） */
  drops: boolean[];
  /** 内部游标：已消耗的丢包决策数 */
  i: number;
}

export function makeWire(drops: boolean[]): Wire {
  return { drops, i: 0 };
}

/** 服务端：收消息 → 幂等去重 → 回 ACK */
export class Server {
  /** clientId → serverId：幂等表，重发同 clientId 不会产生第二条 */
  private seen = new Map<string, { serverId: string; seq: number }>();
  private seqCounter = 100;
  readonly deliveredLog: string[] = [];

  receive(
    clientId: string,
    content: string,
    wire: Wire,
  ): { serverId: string; seq: number } | null {
    if (wire.drops[wire.i++] === true) return null; // 上行丢包：服务端根本没收到
    const existing = this.seen.get(clientId);
    if (existing) return existing; // 幂等：同 clientId 返回同一确认

    const serverId = `srv-${++this.seqCounter}`;
    const seq = this.seqCounter;
    this.seen.set(clientId, { serverId, seq });
    this.deliveredLog.push(content); // 投递给接收端（简化：直接入投递日志）
    return { serverId, seq };
  }
}

export interface SendAttempt {
  attempt: number;
  acked: boolean;
}

/**
 * 客户端发送（带重发）：最多 maxAttempts 次，每次超时判定 = 本次 wire 是否丢包。
 * 返回发送轨迹；最终未 ACK 则 failed。
 */
export function sendWithRetry(
  server: Server,
  clientId: string,
  content: string,
  wire: Wire,
  maxAttempts = 3,
): { status: "sent" | "failed"; attempts: SendAttempt[]; serverId?: string } {
  const attempts: SendAttempt[] = [];
  for (let i = 1; i <= maxAttempts; i++) {
    const ack = server.receive(clientId, content, wire);
    const ok = ack !== null;
    attempts.push({ attempt: i, acked: ok });
    if (ok) return { status: "sent", attempts, serverId: ack!.serverId };
  }
  return { status: "failed", attempts };
}

/** 接收端去重：按 clientId 判重（投递也可能重复） */
export class Receiver {
  private seen = new Set<string>();
  readonly inbox: string[] = [];

  deliver(clientId: string, content: string): "accepted" | "dedup" {
    if (this.seen.has(clientId)) return "dedup";
    this.seen.add(clientId);
    this.inbox.push(content);
    return "accepted";
  }
}

// ---------------- 验证 ----------------

console.log("=== 场景 1：第一次就成功 ===");
const wire1 = makeWire([false]);
const server1 = new Server();
const r1 = sendWithRetry(server1, "c-1", "在吗", wire1);
console.log(r1);

console.log("\n=== 场景 2：丢两次，第三次成功（重发同 clientId） ===");
const wire2 = makeWire([true, true, false]);
const server2 = new Server();
const r2 = sendWithRetry(server2, "c-2", "这条会丢两次", wire2);
console.log("结果:", r2.status, "尝试次数:", r2.attempts.length);
console.log("服务端投递日志（只投递一次，幂等生效）:", server2.deliveredLog);

console.log("\n=== 场景 3：三次全丢 → failed（界面出红色感叹号） ===");
const wire3 = makeWire([true, true, true]);
const server3 = new Server();
const r3 = sendWithRetry(server3, "c-3", "彻底失败", wire3);
console.log(
  "结果:",
  r3.status,
  "服务端是否收到:",
  server3.deliveredLog.length === 0,
);

console.log("\n=== 接收端去重：重复投递只收一条 ===");
const rx = new Receiver();
console.log(rx.deliver("c-9", "早安"));
console.log(rx.deliver("c-9", "早安"));
console.log("收件箱:", rx.inbox);

console.log("\n=== 生产提示 ===");
console.log(`
// 指数退避重发：1s → 2s → 4s（封顶 30s），连接恢复时优先重发 failed 队列
// 服务端幂等键：clientId 全局唯一（uuid v4），存储层唯一索引兜底`);

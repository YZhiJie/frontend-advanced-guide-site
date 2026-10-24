// 文件: examples/51-02-chat-pipeline.ts
// ============ 聊天消息管线:幂等去重 + 用户限流 + 重复合并 ============
// 设计要点:
// 1) 直播消息可能因重连补发/多端同步而重复,必须按消息 id 幂等去重;
// 2) 单用户刷屏会淹没直播间,要按「时间窗 + 条数」限流;
// 3) 连续相同的「666」不必逐条上屏,合并成计数更省渲染资源。

interface ChatMessage {
  id: string;
  userId: string;
  text: string;
  ts: number;
}

type Result =
  | { status: "ok"; display: string; merged: boolean }
  | { status: "duplicate" }
  | { status: "rate-limited"; retryAfter: number };

class ChatPipeline {
  private seen = new Set<string>();
  private windows = new Map<string, number[]>();
  private lastByUser = new Map<
    string,
    { text: string; count: number; at: number }
  >();

  constructor(
    private windowMs = 2000,
    private maxPerWindow = 3,
    private mergeWindowMs = 4000,
  ) {}

  accept(msg: ChatMessage): Result {
    // 1) 幂等:同一 id 只处理一次
    if (this.seen.has(msg.id)) return { status: "duplicate" };

    // 2) 限流:滑动窗口,拒绝时告诉调用方多久后可重试
    const bucket = (this.windows.get(msg.userId) ?? []).filter(
      (t) => msg.ts - t < this.windowMs,
    );
    if (bucket.length >= this.maxPerWindow) {
      const retryAfter = this.windowMs - (msg.ts - bucket[0]);
      this.windows.set(msg.userId, bucket);
      return { status: "rate-limited", retryAfter };
    }
    bucket.push(msg.ts);
    this.windows.set(msg.userId, bucket);
    this.seen.add(msg.id);

    // 3) 合并:同一用户、相同文本、在合并窗口内,累计计数
    const last = this.lastByUser.get(msg.userId);
    if (
      last &&
      last.text === msg.text &&
      msg.ts - last.at < this.mergeWindowMs
    ) {
      last.count++;
      last.at = msg.ts;
      return {
        status: "ok",
        display: `${msg.text} ×${last.count}`,
        merged: true,
      };
    }
    this.lastByUser.set(msg.userId, { text: msg.text, count: 1, at: msg.ts });
    return { status: "ok", display: msg.text, merged: false };
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

// ---------------- 场景 1:重连补发去重 ----------------
const pipe = new ChatPipeline();
const m1 = { id: "m1", userId: "u1", text: "主播好", ts: 0 };
const r1 = pipe.accept(m1);
const r2 = pipe.accept({ ...m1 });
console.log("首次:", r1, "重发:", r2);
assert(
  r1.status === "ok" && r2.status === "duplicate",
  "同一 id 只应被接受一次",
);

// ---------------- 场景 2:单用户限流 ----------------
const spam = new ChatPipeline(2000, 3);
const results = [0, 100, 200, 300].map((ts) =>
  spam.accept({ id: `s${ts}`, userId: "u2", text: `刷屏${ts}`, ts }),
);
console.log(
  "限流结果:",
  results.map((r) => r.status),
);
assert(
  results.slice(0, 3).every((r) => r.status === "ok"),
  "窗口内前 3 条应放行",
);
const limited = results[3];
assert(limited.status === "rate-limited", "第 4 条应被限流");
if (limited.status === "rate-limited") {
  console.log(`第 4 条被限流,${limited.retryAfter}ms 后可重试`);
  assert(limited.retryAfter === 1700, "retryAfter 应等于窗口剩余时间");
}

// 时间窗滑过后恢复
const after = spam.accept({
  id: "s2500",
  userId: "u2",
  text: "恢复",
  ts: 2500,
});
assert(after.status === "ok", "窗口滑过后应恢复放行");

// ---------------- 场景 3:重复文本合并 ----------------
const merge = new ChatPipeline();
const displays: string[] = [];
for (let i = 0; i < 3; i++) {
  const r = merge.accept({
    id: `k${i}`,
    userId: "u3",
    text: "666",
    ts: i * 500,
  });
  if (r.status === "ok") displays.push(r.display);
}
console.log("合并结果:", displays);
assert(
  displays[0] === "666" && displays[2] === "666 ×3",
  "连续相同文本应合并计数",
);

// 超过合并窗口后重新开始
const reset = merge.accept({ id: "k3", userId: "u3", text: "666", ts: 9000 });
assert(
  reset.status === "ok" && reset.display === "666",
  "合并窗口外应重新计数",
);

// ---------------- 场景 4:不同用户互不影响 ----------------
const multi = new ChatPipeline(2000, 1);
const a = multi.accept({ id: "a1", userId: "ua", text: "A", ts: 0 });
const b = multi.accept({ id: "b1", userId: "ub", text: "B", ts: 0 });
assert(
  a.status === "ok" && b.status === "ok",
  "限流按用户隔离,不应误伤其他用户",
);

console.log("\n消息管线通过:幂等、限流、合并、用户隔离均有确定行为。");

// 标记为模块,避免与其它示例的顶层变量重名
export {};

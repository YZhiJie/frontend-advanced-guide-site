// 文件: examples/46-04-error-pipeline.ts
// ============ 错误治理管线:归一化 → 分级 → 指纹聚合 → 批量上报 ============
// 设计要点:
// 1) 全应用只认一种错误结构(AppError),各种来源(接口/框架/全局兜底)先归一化再进管线;
// 2) 分级决定动作:fatal 阻断+即时上报,error 上报,warning 进队列,info 只记本地;
// 3) 指纹聚合:同一错误(message+顶层堆栈帧)只算一个 issue,避免一次故障刷出十万条;
// 4) 上报队列批量合并 + 页面隐藏时 flush,别把监控本身打成性能问题。

/** 硬断言:不满足即非零退出,让 CI 门禁能真的拦截 */
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

// ---------------- 1. 归一化:全应用统一的错误结构 ----------------

type ErrorLevel = "fatal" | "error" | "warning" | "info";

interface AppError {
  name: string;
  message: string;
  level: ErrorLevel;
  fingerprint: string;
  context?: Record<string, unknown>;
  cause?: unknown;
}

// ---------------- 2. 分级:级别决定处置动作 ----------------

class BusinessError extends Error {
  readonly level: ErrorLevel;
  constructor(message: string, level: ErrorLevel = "warning") {
    super(message);
    this.name = "BusinessError";
    this.level = level;
  }
}

function levelOf(input: unknown): ErrorLevel {
  if (input instanceof BusinessError) return input.level;
  if (input instanceof TypeError) return "error"; // 空指针类,代码 bug
  return "error";
}

/** 把任意来源的 unknown 归一化为 AppError */
function normalizeError(
  input: unknown,
  context?: Record<string, unknown>,
): AppError {
  // 已经是 AppError 的直接透传
  if (isAppError(input)) return input;
  const err = input instanceof Error ? input : new Error(String(input));
  return {
    name: err.name || "Error",
    message: err.message,
    level: levelOf(input),
    fingerprint: fingerprintOf(err),
    context,
    cause: err,
  };
}

function isAppError(x: unknown): x is AppError {
  return (
    typeof x === "object" && x !== null && "fingerprint" in x && "level" in x
  );
}

/** 指纹:name + message + 堆栈第一帧——同一故障聚成同一 issue */
function fingerprintOf(err: Error): string {
  const topFrame = (err.stack?.split("\n")[1] ?? "").trim();
  return `${err.name}:${err.message}@${topFrame}`.slice(0, 200);
}

// ---------------- 3. 上报队列:批量合并 + 聚合去重 + 兜底 flush ----------------

class ReportQueue {
  private buffer: AppError[] = [];
  private seen = new Map<string, number>(); // 指纹 → 聚合次数
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private readonly flush: (
      batch: Array<AppError & { count: number }>,
    ) => void,
    private readonly maxSize = 10,
    private readonly intervalMs = 3000,
  ) {}

  push(input: unknown, context?: Record<string, unknown>) {
    const err = normalizeError(input, context);

    // info 只留本地日志,不进上报通道
    if (err.level === "info") {
      console.info("  [本地]", err.message);
      return;
    }
    // 聚合:同一指纹只保留一条,计数累加
    const count = (this.seen.get(err.fingerprint) ?? 0) + 1;
    this.seen.set(err.fingerprint, count);
    const idx = this.buffer.findIndex((x) => x.fingerprint === err.fingerprint);
    if (idx >= 0) this.buffer.splice(idx, 1);
    this.buffer.push(err);

    // fatal 不等批量,立即 flush
    if (err.level === "fatal" || this.buffer.length >= this.maxSize) {
      this.drain();
      return;
    }
    this.timer ??= setTimeout(() => this.drain(), this.intervalMs);
  }

  /** 页面隐藏/卸载时调用(浏览器里挂 visibilitychange + sendBeacon) */
  drain() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.buffer.length) return;
    const batch = this.buffer
      .splice(0)
      .map((e) => ({ ...e, count: this.seen.get(e.fingerprint) ?? 1 }));
    this.seen.clear();
    this.flush(batch);
  }
}

// ---------------- 4. 演示:故障风暴被聚合成一条 ----------------

const sent: Array<Array<AppError & { count: number }>> = [];
const queue = new ReportQueue((batch) => {
  sent.push(batch);
  console.log(
    `  → 上报一批 ${batch.length} 条:`,
    batch.map((b) => `${b.name}×${b.count}[${b.level}]`).join(", "),
  );
});

// 同一故障连续触发 5 次(例如轮询接口持续 500)
for (let i = 0; i < 5; i++) {
  const e = new Error("订单接口 500");
  e.stack = "Error: 订单接口 500\n    at fetchOrders (app.ts:42:11)";
  queue.push(e);
}
// 一条业务警告 + 一条致命错误
queue.push(new BusinessError("库存不足", "warning"));
queue.push(new TypeError("Cannot read properties of undefined (reading 'id')"));
queue.push(
  normalizeError(new Error("白屏:根组件渲染失败"), { route: "/order" }),
);

// 手动补一条 fatal 演示即时通道
const fatal = normalizeError(new Error("支付 SDK 加载失败"));
fatal.level = "fatal";
queue.push(fatal);

queue.drain(); // 页面隐藏时兜底 flush

assert(
  sent.flat().some((b) => b.count === 5),
  "同一指纹必须聚合成 count=5",
);
console.log("\n全部断言通过:错误治理管线已跑通");

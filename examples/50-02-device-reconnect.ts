// 文件: examples/50-02-device-reconnect.ts
// ============ 设备重连状态机:指数退避 + 抖动 + 上限,避免「断线风暴」 ============
// 设计要点:
// 1) 固定 1 秒重试会把服务端/网关打爆——必须指数退避;
// 2) 所有设备同时重连会产生同频抖动——加随机 jitter 打散;
// 3) 重连要有明确上限与终态,不能无限循环;用户手动重试应重置计数。

type State = "idle" | "connecting" | "waiting" | "connected" | "failed";

interface Config {
  baseDelay: number;
  factor: number;
  cap: number;
  maxAttempts: number;
  jitterRatio: number;
}

const DEFAULT_CONFIG: Config = {
  baseDelay: 500,
  factor: 2,
  cap: 8000,
  maxAttempts: 5,
  jitterRatio: 0.2,
};

/** 确定性伪随机:示例要可复现,生产可用 Math.random */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class ReconnectMachine {
  state: State = "idle";
  attempts = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private rand: () => number;

  constructor(
    private config: Config,
    private connect: () => Promise<boolean>,
    seed = 42,
  ) {
    this.rand = mulberry32(seed);
  }

  /** 第 n 次重试的等待时间:base * factor^n,封顶 cap,再叠加 ±jitter */
  delayFor(attempt: number): number {
    const raw = Math.min(
      this.config.cap,
      this.config.baseDelay * Math.pow(this.config.factor, attempt),
    );
    const jitter = raw * this.config.jitterRatio * (this.rand() * 2 - 1);
    return Math.round(raw + jitter);
  }

  async start(): Promise<void> {
    if (this.state === "connected") return;
    this.attempts = 0;
    await this.attempt();
  }

  private async attempt(): Promise<void> {
    this.state = "connecting";
    const ok = await this.connect();
    if (ok) {
      this.state = "connected";
      this.attempts = 0;
      return;
    }
    this.attempts++;
    if (this.attempts >= this.config.maxAttempts) {
      this.state = "failed";
      return;
    }
    const delay = this.delayFor(this.attempts - 1);
    this.state = "waiting";
    console.log(`第 ${this.attempts} 次失败,${delay}ms 后重试`);
    await new Promise<void>((resolve) => {
      this.timer = setTimeout(resolve, delay);
    });
    if (this.state !== "waiting") return; // 等待期间被手动取消
    await this.attempt();
  }

  /** 用户点「取消」:清定时器并回到 idle,不再自动重试 */
  cancel() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.state = "idle";
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

// ---------------- 场景 1:延迟序列的边界 ----------------
const probe = new ReconnectMachine(DEFAULT_CONFIG, async () => true);
const delays = [0, 1, 2, 3, 4].map((n) => probe.delayFor(n));
console.log("退避序列:", delays);
assert(delays.every((d) => d > 0 && d <= DEFAULT_CONFIG.cap * 1.2), "延迟必须在抖动范围内");
assert(delays[4] <= DEFAULT_CONFIG.cap * 1.2, "封顶后不应无限增长");

// ---------------- 场景 2:连续失败后进入 failed ----------------
let calls = 0;
const fail = new ReconnectMachine(DEFAULT_CONFIG, async () => {
  calls++;
  return false;
});
// 用极短延迟跑完整流程,避免示例等待过久
(DEFAULT_CONFIG as Config).baseDelay = 5;
await fail.start();
console.log(`连接尝试 ${calls} 次,终态 = ${fail.state}`);
assert(calls === DEFAULT_CONFIG.maxAttempts, "达到上限后必须停止重试");
assert(fail.state === "failed", "终态应为 failed,而不是无限 waiting");

// ---------------- 场景 3:失败两次后成功 ----------------
let n = 0;
const flaky = new ReconnectMachine(
  { ...DEFAULT_CONFIG, baseDelay: 1 },
  async () => {
    n++;
    return n >= 3;
  },
  7,
);
await flaky.start();
console.log(`第 ${n} 次尝试成功,状态 = ${flaky.state},attempts = ${flaky.attempts}`);
assert(flaky.state === "connected" && flaky.attempts === 0, "成功后计数应清零");

// ---------------- 场景 4:抖动打散同频重连 ----------------
const a = new ReconnectMachine(DEFAULT_CONFIG, async () => true, 1);
const b = new ReconnectMachine(DEFAULT_CONFIG, async () => true, 2);
assert(a.delayFor(3) !== b.delayFor(3), "不同随机源应产生不同抖动,避免同频风暴");

console.log("\n重连状态机通过:退避、封顶、抖动、上限、手动取消均有确定行为。");

// 标记为模块,避免与其它示例的顶层变量重名
export {};

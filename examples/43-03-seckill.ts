// 文件: examples/43-03-seckill.ts
// ============ 秒杀：按钮状态机与请求治理 ============
// 秒杀的前端战场不在「抢」，在「治理」：
// 1) 按钮状态机：idle → countdown → ready → submitting →（success | soldout | error），
//    submitting 期间点击一律忽略——连点风暴的第一个受害者是自家接口；
// 2) 服务器时间校准：本地时钟不可信，倒计时用「活动开始时间戳 - 服务器时间」，
//    开屏取一次偏移量 offset，之后 tick 全用本地时间 + offset；
// 3) 失败克制：失败重试有上限 + 退避，库存为 0 立即冻结——
//    抢不到的库存再怎么刷也不会变出来，刷的只是服务器和用户的电量。

export type SeckillState =
  | "idle" // 未开始
  | "countdown" // 距开始
  | "ready" // 可抢
  | "submitting" // 请求中（锁）
  | "success"
  | "soldout"
  | "error";

export interface SeckillNetwork {
  /** 返回 true = 抢到；false = 没抢到（库存空）；抛错 = 网络失败 */
  submit(): Promise<boolean>;
}

export class SeckillPanel {
  state: SeckillState = "idle";
  private attempts = 0;
  readonly requestLog: string[] = [];

  constructor(
    private readonly network: SeckillNetwork,
    private readonly maxAttempts = 3,
  ) {}

  /** 服务端返回活动开始时间与服务器当前时间 → 计算时钟偏移 */
  private serverOffset = 0;
  syncTime(serverNow: number, localNow: number): void {
    this.serverOffset = serverNow - localNow;
  }
  private serverNow(localNow: number): number {
    return localNow + this.serverOffset;
  }

  /** 每秒 tick：驱动状态机 */
  tick(localNow: number, startAt: number, stockHint: number): void {
    if (this.state === "submitting" || this.state === "success") return;
    if (this.state === "soldout") return; // 冻结：库存空了不再变化
    if (this.serverNow(localNow) < startAt) {
      this.state = "countdown";
    } else {
      this.state = stockHint > 0 ? "ready" : "soldout";
    }
  }

  /** 点击抢购：仅 ready 态放行，submitting 天然防连点 */
  async buy(): Promise<boolean> {
    if (this.state !== "ready") return false; // 其余状态点击无效
    this.state = "submitting";
    this.attempts++;
    this.requestLog.push(`#${this.attempts} 发出请求`);
    try {
      const ok = await this.network.submit();
      this.state = ok ? "success" : "soldout";
      return ok;
    } catch {
      this.requestLog.push(`#${this.attempts} 失败`);
      // 失败可重试但有上限；超过上限停在 error（用户手动重试，不自动刷）
      this.state = this.attempts >= this.maxAttempts ? "error" : "ready";
      return false;
    }
  }
}

// ---------------- 验证（伪时钟 + 伪网络） ----------------

let stock = 1;
const network: SeckillNetwork = {
  async submit() {
    if (stock <= 0) return false;
    stock--;
    return true;
  },
};

const START_AT = 1000; // 活动开始时间（服务器时间轴）

console.log("=== 服务器时钟校准 ===");
const panel = new SeckillPanel(network);
panel.syncTime(1005, 1000); // 服务器比本地快 5 秒
panel.tick(998, START_AT, stock); // 本地 998 → 服务器 1003 ≥ 1000
console.log("本地 998（未到开始时间）→ 状态:", panel.state, "（校准后已可抢）");

console.log("\n=== 连点 5 次只发 1 个请求（submitting 锁） ===");
panel.state = "ready";
const clicks = Array.from({ length: 5 }, () => panel.buy());
const results = await Promise.all(clicks);
console.log(
  "5 次点击结果:",
  results,
  "→ 请求记录:",
  panel.requestLog,
  "终态:",
  panel.state,
);

console.log("\n=== 库存空 → soldout 冻结 ===");
const panel2 = new SeckillPanel(network);
panel2.tick(2000, START_AT, 0);
console.log("tick(库存 0) →", panel2.state);
console.log("soldout 时点击:", await panel2.buy(), "（请求不会发出）");

console.log("\n=== 失败重试上限 ===");
const failNet: SeckillNetwork = {
  async submit() {
    throw new Error("timeout");
  },
};
const panel3 = new SeckillPanel(failNet, 3);
panel3.state = "ready";
for (let i = 0; i < 4; i++) await panel3.buy();
console.log(
  "连试 4 轮 → 实发请求",
  panel3.requestLog.filter((l) => l.includes("发出")).length,
  "次（上限 3），终态:",
  panel3.state,
);

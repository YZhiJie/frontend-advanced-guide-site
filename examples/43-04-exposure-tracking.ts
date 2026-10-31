// 文件: examples/43-04-exposure-tracking.ts
// ============ 曝光埋点：可见性判定与批量上报 ============
// 埋点的可信度取决于「曝光怎么算」和「丢了怎么办」：
// 1) 曝光标准：面积 ≥ 50% 且持续停留 ≥ 500ms 才算——滑过就算曝光，数据全是噪声；
// 2) 会话内去重：同一 target 只报一次（Set 记录），重复曝光不重复计费；
// 3) 批量上报：凑批（满 10 条）或定时（5s）发送，减少请求数；
// 4) 失败回队：发送失败的事件放回队列头部，下次优先重发；
// 5) 页面卸载兜底：visibilitychange → hidden 时用 sendBeacon 强制发出（不阻塞卸载）。

export interface ExposureEvent {
  targetId: string;
  dwellMs: number;
  at: number;
}

/** 可见性判定：ratio ≥ 0.5 且停留 ≥ 500ms 才算有效曝光 */
export function isQualifiedExposure(ratio: number, dwellMs: number): boolean {
  return ratio >= 0.5 && dwellMs >= 500;
}

export interface ReportNetwork {
  send(batch: readonly ExposureEvent[]): Promise<void>;
}

export class ExposureTracker {
  private queue: ExposureEvent[] = [];
  private readonly reported = new Set<string>(); // 会话内去重
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly network: ReportNetwork,
    private readonly batchSize = 10,
    private readonly flushIntervalMs = 5000,
  ) {}

  /** IntersectionObserver 回调进入：达标才入队，重复 id 丢弃 */
  track(targetId: string, ratio: number, dwellMs: number, at: number): void {
    if (!isQualifiedExposure(ratio, dwellMs)) return;
    if (this.reported.has(targetId)) return;
    this.reported.add(targetId);
    this.queue.push({ targetId, dwellMs, at });
    if (this.queue.length >= this.batchSize) void this.flush();
    else this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.flushIntervalMs);
  }

  /** 批量上报：失败的事件放回队列头部，下次优先 */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    try {
      await this.network.send(batch);
    } catch {
      this.queue.unshift(...batch); // 回队头：下次先发老的
    }
  }

  /** 页面卸载兜底：同步尽力发出（真实环境用 navigator.sendBeacon） */
  flushOnHide(): void {
    void this.flush();
  }

  get pending(): number {
    return this.queue.length;
  }
}

// ---------------- 验证（伪网络可控失败） ----------------

let failNext = 0; // 接下来 N 次发送失败
const sent: ExposureEvent[][] = [];
const network: ReportNetwork = {
  async send(batch) {
    if (failNext > 0) {
      failNext--;
      throw new Error("network down");
    }
    sent.push([...batch]);
  },
};

const tracker = new ExposureTracker(network, 3, 5000);

console.log("=== 曝光判定与去重 ===");
tracker.track("banner", 0.3, 2000, 1); // 面积不足 → 丢弃
tracker.track("banner", 0.6, 200, 2); // 停留不足 → 丢弃
tracker.track("banner", 0.6, 2000, 3); // 达标 → 入队
tracker.track("banner", 0.9, 5000, 4); // 重复 → 去重
console.log("队列长度（批量 3 未满、定时未到）:", tracker.pending);

console.log("\n=== 凑批触发：第 2、3 条达标 → 满 3 条立即发送 ===");
tracker.track("sku-card", 0.8, 800, 5);
tracker.track("coupon", 1.0, 600, 6);
await new Promise((r) => setTimeout(r, 10)); // 让异步 flush 落地
console.log(
  "已发送批次:",
  sent.length,
  "首批:",
  sent[0]?.map((e) => e.targetId),
);

console.log("\n=== 失败回队重试 ===");
failNext = 1;
tracker.track("item-a", 1, 1000, 7);
tracker.track("item-b", 1, 1000, 8);
tracker.track("item-c", 1, 1000, 9); // 满 3 触发 flush → 网络失败 → 回队
await new Promise((r) => setTimeout(r, 10));
console.log("失败后积压:", tracker.pending, "（事件已回到队头）");
tracker.track("item-d", 1, 1000, 10); // 积压已 ≥ 批量 → 立即重发 [a,b,c,d]
await new Promise((r) => setTimeout(r, 10));
console.log(
  "重发后批次:",
  sent.length,
  "该批:",
  sent[1]?.map((e) => e.targetId),
);

console.log("\n=== 页面卸载兜底：不足一批也强制发出 ===");
tracker.track("item-e", 1, 1000, 11);
tracker.track("footer", 1, 1000, 12);
tracker.flushOnHide();
await new Promise((r) => setTimeout(r, 10));
console.log(
  "最终批次:",
  sent.length,
  "末批:",
  sent[2]?.map((e) => e.targetId),
  "积压:",
  tracker.pending,
);

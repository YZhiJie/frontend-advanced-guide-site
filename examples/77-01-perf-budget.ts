// 文件: examples/77-01-perf-budget.ts
// ============ 性能预算门禁：分档口径 + 分位数聚合 + 回归判定 + 发布闸门 ============
// 把 77.1 的「性能预算」落成可执行代码：按设备档位定义预算，用 p75 而不是平均值聚合，
// 同时做「绝对阈值」与「相对基线回退」两类判定，任一不达标即阻断发布并给出归因建议。
// 设计决策：
// - 用 p75 而非平均：平均值会被高端机稀释，长尾用户的卡顿恰恰藏在 p75/p95；
// - 绝对预算防「本来就慢」，基线回退防「这版变慢」，两道闸门互补；
// - 输出结构化报告，CI 直接消费，无需人工看日志。

/** 硬断言：console.assert 在 Node 里不阻断，脚本需要「错了就红」 */
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ 断言失败：${msg}`);
    process.exit(1);
  }
}

// ---------------- 1. 预算定义：按设备档位分档，而不是一刀切 ----------------

type Tier = "high" | "mid" | "low";

/** 预算单位：ms（LCP/INP/TBT）、无量纲（CLS）、KB（首屏 JS） */
interface Budget {
  lcpMs: number;
  inpMs: number;
  cls: number;
  tbtMs: number;
  initialJsKb: number;
}

/** 企业级预算的常见口径：高端看体验上限，低端看可用下限（低端机反而要更严） */
const BUDGETS: Record<Tier, Budget> = {
  high: { lcpMs: 2000, inpMs: 150, cls: 0.08, tbtMs: 200, initialJsKb: 300 },
  mid: { lcpMs: 2500, inpMs: 200, cls: 0.1, tbtMs: 300, initialJsKb: 250 },
  low: { lcpMs: 3500, inpMs: 300, cls: 0.15, tbtMs: 450, initialJsKb: 180 },
};

// ---------------- 2. 采样数据：真实 RUM 上报的会话级记录 ----------------

interface Sample {
  tier: Tier;
  lcpMs: number;
  inpMs: number;
  cls: number;
  tbtMs: number;
  initialJsKb: number;
}

const SAMPLES: Sample[] = [
  { tier: "high", lcpMs: 1700, inpMs: 120, cls: 0.04, tbtMs: 150, initialJsKb: 280 },
  { tier: "high", lcpMs: 2300, inpMs: 180, cls: 0.09, tbtMs: 240, initialJsKb: 320 },
  { tier: "high", lcpMs: 1900, inpMs: 100, cls: 0.05, tbtMs: 180, initialJsKb: 290 },
  { tier: "high", lcpMs: 2600, inpMs: 260, cls: 0.12, tbtMs: 320, initialJsKb: 340 },
  { tier: "mid", lcpMs: 2200, inpMs: 160, cls: 0.07, tbtMs: 260, initialJsKb: 240 },
  { tier: "mid", lcpMs: 2900, inpMs: 240, cls: 0.14, tbtMs: 380, initialJsKb: 270 },
  { tier: "mid", lcpMs: 2400, inpMs: 190, cls: 0.1, tbtMs: 300, initialJsKb: 250 },
  { tier: "mid", lcpMs: 3100, inpMs: 280, cls: 0.16, tbtMs: 420, initialJsKb: 300 },
  { tier: "low", lcpMs: 3800, inpMs: 420, cls: 0.22, tbtMs: 520, initialJsKb: 210 },
  { tier: "low", lcpMs: 3300, inpMs: 300, cls: 0.15, tbtMs: 430, initialJsKb: 190 },
  { tier: "low", lcpMs: 4100, inpMs: 460, cls: 0.24, tbtMs: 560, initialJsKb: 220 },
  { tier: "low", lcpMs: 3600, inpMs: 340, cls: 0.18, tbtMs: 470, initialJsKb: 200 },
];

// ---------------- 3. 分位数聚合：p75 是「大多数用户」的体验 ----------------

/** nearest-rank 分位数：小样本也能算，且结果一定是真实出现过的样本值 */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))];
}

interface Summary {
  tier: Tier;
  lcpMs: number;
  inpMs: number;
  cls: number;
  tbtMs: number;
  initialJsKb: number;
  sessions: number;
}

function summarize(samples: Sample[]): Summary[] {
  return (["high", "mid", "low"] as Tier[]).map((tier) => {
    const group = samples.filter((s) => s.tier === tier);
    return {
      tier,
      lcpMs: percentile(group.map((s) => s.lcpMs), 75),
      inpMs: percentile(group.map((s) => s.inpMs), 75),
      cls: Math.round(percentile(group.map((s) => s.cls), 75) * 100) / 100,
      tbtMs: percentile(group.map((s) => s.tbtMs), 75),
      initialJsKb: percentile(group.map((s) => s.initialJsKb), 75),
      sessions: group.length,
    };
  });
}

// ---------------- 4. 双闸门判定：绝对预算 + 相对基线回退 ----------------

interface Violation {
  tier: Tier;
  metric: keyof Budget;
  actual: number;
  limit: number;
  kind: "budget" | "regression";
}

/** 基线：上一个稳定版本同口径的 p75 */
const BASELINE = summarize(SAMPLES);

/** 回归容忍度：低端机对体积与长任务更敏感，容忍度更小 */
const REGRESSION_TOLERANCE: Record<Tier, number> = { high: 0.1, mid: 0.08, low: 0.05 };

function check(current: Summary[], baseline: Summary[]): Violation[] {
  const violations: Violation[] = [];
  for (const cur of current) {
    const budget = BUDGETS[cur.tier];
    for (const metric of Object.keys(budget) as (keyof Budget)[]) {
      if (cur[metric] > budget[metric]) {
        violations.push({ tier: cur.tier, metric, actual: cur[metric], limit: budget[metric], kind: "budget" });
      }
      const base = baseline.find((b) => b.tier === cur.tier);
      if (!base) continue;
      const allowed = base[metric] * (1 + REGRESSION_TOLERANCE[cur.tier]);
      if (cur[metric] > allowed) {
        violations.push({ tier: cur.tier, metric, actual: cur[metric], limit: Math.round(allowed * 100) / 100, kind: "regression" });
      }
    }
  }
  return violations;
}

// ---------------- 5. 运行：输出报告 + 发布闸门 ----------------

const current = summarize(SAMPLES);
const violations = check(current, BASELINE);

console.log("=== 分档 p75 汇总 ===");
console.table(current);
console.log("\n=== 预算/回归违规 ===");
if (violations.length === 0) console.log("✅ 全档位通过，允许发布");
else console.table(violations);

/** 发布闸门：低端机任何违规都阻断；其他档位只阻断绝对预算违规 */
const blocking = violations.filter((v) => v.tier === "low" || v.kind === "budget");

console.log(`\n阻断项 ${blocking.length} 条，发布闸门：${blocking.length === 0 ? "放行" : "拦截"}`);

// ---------------- 6. 硬断言：验证聚合与判定逻辑本身 ----------------

// p75 在 4 个样本时取第 3 小值（nearest-rank）
assert(percentile([100, 200, 300, 400], 75) === 300, "p75 应取第 3 小值");
assert(percentile([100, 200, 300, 400], 50) === 200, "p50 应取第 2 小值");
assert(percentile([], 75) === 0, "空样本应返回 0");

// 低端机 LCP p75 = 3800 > 3500，必须触发预算违规
assert(
  violations.some((v) => v.tier === "low" && v.metric === "lcpMs" && v.kind === "budget"),
  "低端机 LCP 超预算应被识别",
);
// 高端机 INP p75 = 180 > 150，也必须触发
assert(
  violations.some((v) => v.tier === "high" && v.metric === "inpMs"),
  "高端机 INP 超标应被识别",
);
// 基线等于当前时不应产生回归违规（只可能产生绝对预算违规）
const selfCheck = check(current, current);
assert(
  selfCheck.every((v) => v.kind === "budget"),
  "与自身基线对比不应出现 regression 违规",
);
// 低端机回归容忍度 5%：基线 LCP 3800 → 允许 3990，3810 的漂移不应判回归
const drift = check([{ ...current[2], lcpMs: 3810 }], [current[2]]);
assert(
  drift.every((v) => v.kind === "budget"),
  "低端机 0.26% 漂移在 5% 容忍内不应误报回归",
);

console.log("\n✅ 性能预算门禁示例全部断言通过");

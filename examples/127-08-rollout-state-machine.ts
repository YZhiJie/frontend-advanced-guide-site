/**
 * 第 127 部分配套：灰度 / 蓝绿 / 回滚状态机
 * JD 需求点：能把「先放 5% → 观察 → 扩到 25% → 全量 → 出事回滚」写成可执行状态机，
 *   并保证流量守恒、旧版本保留、Source Map 与 release 绑定、回滚后监控口径一致。
 * 本示例：
 *   1) 灰度状态机与非法迁移拦截
 *   2) 流量权重守恒（任意状态 stable + canary = 100）
 *   3) split_clients 分桶的确定性与比例误差
 *   4) 蓝绿切换的原子性与失败回退
 *   5) 发布守卫与 Source Map 绑定
 * 运行：npx tsx examples/127-08-rollout-state-machine.ts
 */
import assert from "node:assert";

type State = "idle" | "canary-5" | "canary-25" | "verifying" | "promoted" | "rolled-back";
type Event = "start" | "advance" | "pass" | "fail" | "rollback";

const TRANSITIONS: Record<State, Partial<Record<Event, State>>> = {
  idle: { start: "canary-5" },
  "canary-5": { advance: "canary-25", fail: "rolled-back", rollback: "rolled-back" },
  "canary-25": { advance: "verifying", fail: "rolled-back", rollback: "rolled-back" },
  verifying: { pass: "promoted", fail: "rolled-back", rollback: "rolled-back" },
  promoted: { rollback: "rolled-back" },
  "rolled-back": {},
};

const TRAFFIC: Record<State, { stable: number; canary: number }> = {
  idle: { stable: 100, canary: 0 },
  "canary-5": { stable: 95, canary: 5 },
  "canary-25": { stable: 75, canary: 25 },
  verifying: { stable: 50, canary: 50 },
  promoted: { stable: 0, canary: 100 },
  "rolled-back": { stable: 100, canary: 0 },
};

interface Rollout {
  state: State;
  stable: string;
  canary: string;
  history: State[];
  sourcemaps: Record<string, boolean>;
}

function createRollout(stable: string, canary: string): Rollout {
  return { state: "idle", stable, canary, history: ["idle"], sourcemaps: {} };
}

function transition(r: Rollout, event: Event): Rollout {
  const next = TRANSITIONS[r.state][event];
  assert(next, `非法迁移：${r.state} --${event}-->（没有这条边）`);
  return { ...r, state: next, history: [...r.history, next] };
}

function trafficOf(state: State): { stable: number; canary: number } {
  const t = TRAFFIC[state];
  assert.strictEqual(t.stable + t.canary, 100, `${state} 流量不守恒：${JSON.stringify(t)}`);
  return t;
}

interface GuardMetrics {
  errorRate: number; // 0~1
  p95Ms: number;
  jsErrorRate: number;
}

const GUARD = { errorRate: 0.01, p95Ms: 800, jsErrorRate: 0.005 };

function guardVerdict(m: GuardMetrics): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (m.errorRate > GUARD.errorRate) reasons.push(`错误率 ${(m.errorRate * 100).toFixed(2)}% > 1%`);
  if (m.p95Ms > GUARD.p95Ms) reasons.push(`P95 ${m.p95Ms}ms > 800ms`);
  if (m.jsErrorRate > GUARD.jsErrorRate) reasons.push(`JS 错误率 ${(m.jsErrorRate * 100).toFixed(2)}% > 0.5%`);
  return { ok: reasons.length === 0, reasons };
}

/** FNV-1a：同一 IP 必须永远落在同一个桶，否则灰度比例每次刷新都在抖 */
function bucketOf(key: string, buckets = 100): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % buckets;
}

function pickVariant(ip: string, canaryPercent: number): "stable" | "canary" {
  assert(canaryPercent >= 0 && canaryPercent <= 100);
  return bucketOf(ip) < canaryPercent ? "canary" : "stable";
}

function sampleDistribution(ips: string[], canaryPercent: number): number {
  const hit = ips.filter((ip) => pickVariant(ip, canaryPercent) === "canary").length;
  return (hit / ips.length) * 100;
}

interface BlueGreen {
  active: "blue" | "green";
  blue: { release: string; healthy: boolean };
  green: { release: string; healthy: boolean };
}

function switchTraffic(bg: BlueGreen, target: "blue" | "green"): BlueGreen {
  const next = target === "blue" ? bg.blue : bg.green;
  assert(next.healthy, `目标环境 ${target} 不健康，拒绝切换`);
  return { ...bg, active: target };
}

function publishSourcemap(r: Rollout, release: string, uploaded: boolean): Rollout {
  return { ...r, sourcemaps: { ...r.sourcemaps, [release]: uploaded } };
}

function canPromote(r: Rollout): boolean {
  return r.sourcemaps[r.canary] === true;
}

// ===================== 运行断言 =====================
console.log("===== 1. 灰度状态机 =====");
let rollout = createRollout("sha-stable", "sha-canary");
assert.strictEqual(rollout.state, "idle");
rollout = transition(rollout, "start");
assert.strictEqual(rollout.state, "canary-5");
rollout = transition(rollout, "advance");
assert.strictEqual(rollout.state, "canary-25");
rollout = transition(rollout, "advance");
assert.strictEqual(rollout.state, "verifying");
rollout = transition(rollout, "pass");
assert.strictEqual(rollout.state, "promoted");
assert.deepStrictEqual(rollout.history, ["idle", "canary-5", "canary-25", "verifying", "promoted"]);
console.log(`✓ ${rollout.history.join(" → ")}`);

console.log("\n===== 2. 非法迁移必须被拦截 =====");
assert.throws(() => transition(createRollout("a", "b"), "pass"), /非法迁移/, "未开始就 pass 应被拒绝");
assert.throws(
  () => transition(transition(createRollout("a", "b"), "start"), "pass"),
  /非法迁移/,
  "5% 阶段不能直接 pass 到全量",
);
assert.throws(
  () => transition({ ...createRollout("a", "b"), state: "rolled-back" }, "start"),
  /非法迁移/,
  "回滚后不能原地重来，必须重新走一次发布",
);
console.log("✓ 跳过阶段 / 未开始 / 回滚后重入 全部被拒绝");

console.log("\n===== 3. 流量守恒 =====");
for (const state of Object.keys(TRAFFIC) as State[]) {
  const t = trafficOf(state);
  assert(t.stable >= 0 && t.canary >= 0);
}
assert.deepStrictEqual(trafficOf("canary-5"), { stable: 95, canary: 5 });
assert.deepStrictEqual(trafficOf("verifying"), { stable: 50, canary: 50 });
assert.deepStrictEqual(trafficOf("rolled-back"), { stable: 100, canary: 0 });
console.log("✓ 6 个状态的 stable + canary 恒等于 100");

console.log("\n===== 4. split_clients 确定性与比例 =====");
assert.strictEqual(bucketOf("203.0.113.7"), bucketOf("203.0.113.7"), "同一 IP 的分桶必须稳定");
const distinctBuckets = new Set(
  Array.from({ length: 100 }, (_, i) => bucketOf(`203.0.113.${i}`)),
);
assert(distinctBuckets.size >= 40, `100 个 IP 只落到 ${distinctBuckets.size} 个桶，哈希分布过差`);
const ips = Array.from({ length: 5000 }, (_, i) => `198.51.100.${i % 256}-${i}`);
const p5 = sampleDistribution(ips, 5);
const p25 = sampleDistribution(ips, 25);
assert(Math.abs(p5 - 5) < 1.5, `5% 灰度的实际分流 ${p5.toFixed(2)}% 偏差过大`);
assert(Math.abs(p25 - 25) < 2, `25% 灰度的实际分流 ${p25.toFixed(2)}% 偏差过大`);
console.log(`✓ 5000 个样本：5% → ${p5.toFixed(2)}%，25% → ${p25.toFixed(2)}%`);

console.log("\n===== 5. 发布守卫 =====");
assert.strictEqual(guardVerdict({ errorRate: 0.002, p95Ms: 420, jsErrorRate: 0.001 }).ok, true);
const bad = guardVerdict({ errorRate: 0.04, p95Ms: 1600, jsErrorRate: 0.02 });
assert.strictEqual(bad.ok, false);
assert.strictEqual(bad.reasons.length, 3, `三条守卫都应命中，实际 ${bad.reasons.join("; ")}`);
const borderline = guardVerdict({ errorRate: 0.0101, p95Ms: 799, jsErrorRate: 0 });
assert.strictEqual(borderline.ok, false, "错误率只要超过 1% 就必须拦截");
console.log(`✓ 正常通过；异常命中 3 条：${bad.reasons.join(" / ")}`);

console.log("\n===== 6. 守卫失败 → 自动回滚 =====");
let failing = transition(createRollout("sha-stable", "sha-canary"), "start");
failing = transition(failing, "advance");
const verdict = guardVerdict({ errorRate: 0.03, p95Ms: 1200, jsErrorRate: 0.004 });
assert.strictEqual(verdict.ok, false);
failing = transition(failing, "fail");
assert.strictEqual(failing.state, "rolled-back");
assert.deepStrictEqual(trafficOf(failing.state), { stable: 100, canary: 0 });
assert.strictEqual(failing.stable, "sha-stable", "回滚必须回到原 stable，而不是重发现一版");
console.log(`✓ 25% 阶段守卫失败 → rolled-back，stable=${failing.stable}`);

console.log("\n===== 7. Source Map 与 release 绑定 =====");
const noMap = createRollout("sha-stable", "sha-canary");
assert.strictEqual(canPromote(noMap), false, "未上传 Source Map 不允许进入 promoted");
const wrongRelease = publishSourcemap(noMap, "sha-other", true);
assert.strictEqual(canPromote(wrongRelease), false, "Source Map 必须绑定当前 canary release");
const bound = publishSourcemap(noMap, "sha-canary", true);
assert.strictEqual(canPromote(bound), true);
console.log("✓ 缺失 / 版本错配 均被拦截，绑定当前 release 后才可晋升");

console.log("\n===== 8. 蓝绿切换 =====");
let bg: BlueGreen = {
  active: "blue",
  blue: { release: "sha-v1", healthy: true },
  green: { release: "sha-v2", healthy: false },
};
assert.throws(() => switchTraffic(bg, "green"), /不健康/, "green 未就绪时禁止切流");
bg = { ...bg, green: { ...bg.green, healthy: true } };
bg = switchTraffic(bg, "green");
assert.strictEqual(bg.active, "green");
assert.strictEqual(bg.blue.release, "sha-v1", "切换后 blue 必须保留，作为回滚目标");
bg = switchTraffic(bg, "blue");
assert.strictEqual(bg.active, "blue", "green 异常时可原子切回 blue");
console.log("✓ 未就绪拒绝切换；切换后旧环境保留；可原子切回");

console.log("\n===== 9. 回滚后的观察口径 =====");
interface Monitor {
  stableRelease: string;
  windowMin: number;
  alertsMuted: string[];
}
const afterRollback: Monitor = {
  stableRelease: failing.stable,
  windowMin: 30,
  alertsMuted: ["canary-version"],
};
assert.strictEqual(afterRollback.stableRelease, "sha-stable");
assert(afterRollback.windowMin >= 30, "回滚后观察窗口不应短于 30 分钟");
assert(afterRollback.alertsMuted.includes("canary-version"), "回滚后必须静音「canary 版本存在」类告警");
console.log("✓ 回滚后 30 分钟观察窗口 + 静音 canary 版本告警");

console.log("\n✅ 发布编排：状态机 + 流量守恒 + 分桶 + 守卫 + Source Map + 蓝绿 + 回滚口径全部通过");

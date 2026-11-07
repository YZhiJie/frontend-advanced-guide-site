// 文件: examples/43-05-ab-experiment.ts
// ============ A/B 实验：稳定分桶与流量灰度 ============
// A/B 实验前端要保证的三件事：
// 1) 稳定性：同一用户（+实验 key）永远分到同一组——哈希决定，与请求次数无关；
// 2) 正交性：不同实验用不同盐（key 拼进哈希输入），实验之间互不干扰；
// 3) 灰度放量：traffic ∈ (0,1]，只放行哈希值落在前 traffic 比例的用户——
//    放量从 10% 提到 20% 时，原 10% 用户的分组不变（分桶是前缀，扩量只新增）。
// 教学 hash 用 djb2（够演示均匀性）；生产用 murmurhash/xxhash + 服务端下发分桶。

/** djb2 字符串哈希 + fmix 雪崩收尾：稳定、无依赖、低位已打散。
 *  若没有收尾混淆，djb2 的最低位只由各字符奇偶性的异或累积决定——
 *  两个实验（不同盐）的 bucket 奇偶可能完全同步，导致分组 100% 相关（正交性破灭）。 */
export function hashStr(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0; // 32 位溢出折叠
  }
  h ^= h >>> 15; // 雪崩收尾（murmur3 fmix 风格）：高位信息混入低位
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return h >>> 0; // 转无符号
}

export interface ExperimentConfig {
  key: string; // 实验标识，同时充当哈希盐
  variants: readonly string[]; // 如 ["control", "treatment"]
  /** 灰度比例 (0,1]：只放行哈希落在前 traffic 的用户 */
  traffic: number;
}

export interface Assignment {
  inExperiment: boolean; // 未命中灰度 → 走默认逻辑
  variant: string | null;
  bucket: number; // 调试用：0..999
}

/** 分桶 + 分组：hash(userId + "#" + key) 决定桶，桶内按 variants 均分 */
export function assign(userId: string, cfg: ExperimentConfig): Assignment {
  const bucket = hashStr(`${userId}#${cfg.key}`) % 1000;
  if (bucket >= Math.round(cfg.traffic * 1000)) {
    return { inExperiment: false, variant: null, bucket };
  }
  const idx = bucket % cfg.variants.length;
  return { inExperiment: true, variant: cfg.variants[idx], bucket };
}

/** 命中上报：进实验必须带实验曝光事件（分析侧靠它对齐分组） */
export function reportExposure(
  userId: string,
  cfg: ExperimentConfig,
  sink: (line: string) => void,
): void {
  const a = assign(userId, cfg);
  if (a.inExperiment)
    sink(
      `exp_exposure user=${userId} key=${cfg.key} variant=${a.variant} bucket=${a.bucket}`,
    );
}

// ---------------- 验证 ----------------

const cfg: ExperimentConfig = {
  key: "checkout-btn-2026",
  variants: ["control", "treatment"],
  traffic: 0.5,
};

console.log("=== 稳定性：同一用户重复请求分组不变 ===");
for (const u of ["u-001", "u-002", "u-003"]) {
  const a1 = assign(u, cfg);
  const a2 = assign(u, cfg);
  console.log(
    `${u}: ${a1.variant}（bucket ${a1.bucket}）重复请求一致: ${a1.variant === a2.variant}`,
  );
}

console.log("\n=== 均匀性：1000 个伪用户的分组分布 ===");
const counts: Record<string, number> = { control: 0, treatment: 0, outside: 0 };
for (let i = 0; i < 1000; i++) {
  const a = assign(`user-${i}`, cfg);
  if (a.inExperiment) counts[a.variant!]++;
  else counts.outside++;
}
console.log(counts, "（目标各 ~250）");

console.log("\n=== 灰度扩量：10% → 20% 时原用户分组不变 ===");
const small: ExperimentConfig = { ...cfg, traffic: 0.1 };
const large: ExperimentConfig = { ...cfg, traffic: 0.2 };
let consistent = true;
let movedIn = 0;
for (let i = 0; i < 1000; i++) {
  const u = `user-${i}`;
  const a1 = assign(u, small);
  const a2 = assign(u, large);
  if (a1.inExperiment && a1.variant !== a2.variant) consistent = false;
  if (!a1.inExperiment && a2.inExperiment) movedIn++;
}
console.log("原 10% 用户分组全部不变:", consistent, "；扩量新增用户:", movedIn);

console.log("\n=== 正交性：不同实验（盐不同）分组独立 ===");
const expB: ExperimentConfig = {
  key: "recommend-rank-2026",
  variants: ["v1", "v2"],
  traffic: 1,
};
const cross = {
  v1_control: 0,
  v1_treatment: 0,
  v2_control: 0,
  v2_treatment: 0,
};
for (let i = 0; i < 1000; i++) {
  const u = `user-${i}`;
  const a = assign(u, cfg); // traffic 0.5
  if (!a.inExperiment) continue;
  const b = assign(u, expB);
  cross[`${b.variant}_${a.variant}` as keyof typeof cross]++;
}
console.log(cross, "（四格应大致均衡 → 两实验独立）");

console.log("\n=== 命中上报 ===");
reportExposure("u-001", cfg, (line) => console.log("  上报:", line));

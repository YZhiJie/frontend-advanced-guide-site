// 文件: examples/71-01-wasm-decision.ts

/**
 * WASM 适用性评估器（JS 侧模拟，无需 Rust 工具链）
 *
 * 思路：上不上 WASM 不是信仰问题，是算术问题——
 *   WASM 净收益 = JS 基线耗时 - (WASM 计算耗时 + 边界穿越开销 + 数据搬运开销)
 * 模型只求数量级正确，用于「要不要做」的决策，不用于「快多少」的承诺：
 *   - 单次 JS↔WASM 边界穿越：约 0.7µs（现代引擎已优化，但仍非零，高频调用会累积）
 *   - 数据进出线性内存：约 0.8µs / KB（写入一次 + 读回一次各算一遍）
 *   - 数值计算 WASM 相对 JS 的典型提速：2~8 倍（本模型取 4 倍中性估计）
 */

/** 任务画像：描述一个待评估的计算任务 */
interface TaskProfile {
  name: string;
  /** 单次调用的计算量（百万次浮点运算） */
  megaOpsPerCall: number;
  /** 调用频率（次/秒）——决定边界开销是否累积成灾 */
  callsPerSecond: number;
  /** 每次调用需要搬进/搬出线性内存的数据量（KB） */
  payloadKB: number;
  /** 每次调用的边界穿越次数（进 + 出 = 2，拆分调用会变多） */
  crossingsPerCall: number;
}

/** 评估结论 */
interface Verdict {
  /** JS 基线耗时（毫秒/次） */
  jsMs: number;
  /** WASM 总耗时（毫秒/次）= 计算 + 边界 + 搬运 */
  wasmMs: number;
  /** 边界成本占 WASM 总耗时的比例 */
  boundaryRatio: number;
  /** 净收益百分比（正数 = WASM 更快） */
  netGainPct: number;
  recommendation: "强烈推荐" | "推荐" | "观望" | "不推荐";
  reason: string;
}

/** 模型常量（数量级估计，可按团队实测校准） */
const MODEL = {
  /** JS 数值吞吐：约 200 Mops/s（JIT 预热后的中性估计） */
  jsMopsPerMs: 0.2,
  /** WASM 相对 JS 的提速倍数 */
  wasmSpeedup: 4,
  /** 单次边界穿越开销（微秒） */
  crossingUs: 0.7,
  /** 数据拷贝开销（微秒/KB，含写入与读回） */
  copyUsPerKB: 0.8,
};

function evaluate(task: TaskProfile): Verdict {
  // JS 基线：纯计算时间
  const jsMs = task.megaOpsPerCall / MODEL.jsMopsPerMs;
  // WASM 侧：计算时间按提速倍数缩减
  const wasmComputeMs = jsMs / MODEL.wasmSpeedup;
  // 边界成本 = 穿越次数开销 + 数据搬运开销（微秒 → 毫秒）
  const boundaryMs =
    (task.crossingsPerCall * MODEL.crossingUs +
      task.payloadKB * MODEL.copyUsPerKB * 2) / 1000;
  const wasmMs = wasmComputeMs + boundaryMs;

  const boundaryRatio = wasmMs > 0 ? boundaryMs / wasmMs : 1;
  const netGainPct = jsMs > 0 ? ((jsMs - wasmMs) / jsMs) * 100 : 0;

  // 决策规则（工程口径，不是定理）：
  let recommendation: Verdict["recommendation"];
  let reason: string;
  if (jsMs < 0.5) {
    recommendation = "不推荐";
    reason = "任务本身亚毫秒级，优化收益看不见，边界开销反而可能让它变慢";
  } else if (boundaryRatio > 0.4) {
    recommendation = "不推荐";
    reason = `边界成本占比 ${(boundaryRatio * 100).toFixed(0)}% 过高，调用太碎或数据太碎，先合并调用再谈 WASM`;
  } else if (netGainPct >= 50) {
    recommendation = "强烈推荐";
    reason = `净收益 ${netGainPct.toFixed(0)}%，计算密集且边界开销可摊薄`;
  } else if (netGainPct >= 25) {
    recommendation = "推荐";
    reason = `净收益 ${netGainPct.toFixed(0)}%，值得做，但先 benchmark 验证再全量`;
  } else {
    recommendation = "观望";
    reason = `净收益仅 ${netGainPct.toFixed(0)}%，不如先优化算法或移入 Worker`;
  }
  return { jsMs, wasmMs, boundaryRatio, netGainPct, recommendation, reason };
}

/** ============ 三个对照场景演示 ============ */
export function runDecisionDemo() {
  const scenarios: TaskProfile[] = [
    {
      // 场景 A：图像高斯模糊——200 万像素 × 9 次卷积 ≈ 36 Mops，每秒 30 帧
      name: "A. 实时图像滤镜（200 万像素卷积，30fps）",
      megaOpsPerCall: 36,
      callsPerSecond: 30,
      payloadKB: 8000, // 8MB RGBA 缓冲
      crossingsPerCall: 2, // 整帧进、整帧出
    },
    {
      // 场景 B：表单校验——每次按键几十次运算，调用极频繁但计算极轻
      name: "B. 表单实时校验（每次按键一次调用）",
      megaOpsPerCall: 0.0001,
      callsPerSecond: 20,
      payloadKB: 1,
      crossingsPerCall: 2,
    },
    {
      // 场景 C：500MB 大文件 SHA-256——分块喂入，64 次穿越摊薄到每块 8MB
      name: "C. 大文件哈希（500MB，分 64 块流式喂入）",
      megaOpsPerCall: 2600, // SHA-256 约 13 cycles/byte × 500MB 折算
      callsPerSecond: 0.02,
      payloadKB: 512000,
      crossingsPerCall: 128, // 64 块 × 进出 2 次
    },
  ];

  for (const s of scenarios) {
    const v = evaluate(s);
    console.log(`\n${s.name}`);
    console.log(
      `  JS 基线 ${v.jsMs.toFixed(2)}ms/次 → WASM 预估 ${v.wasmMs.toFixed(2)}ms/次` +
        `（边界占比 ${(v.boundaryRatio * 100).toFixed(1)}%，净收益 ${v.netGainPct.toFixed(0)}%）`,
    );
    console.log(`  结论：${v.recommendation} —— ${v.reason}`);
  }

  // ---- 断言：三个场景的结论必须符合直觉 ----
  const [a, b, c] = scenarios.map(evaluate);
  console.assert(
    a.recommendation === "强烈推荐" || a.recommendation === "推荐",
    "图像滤镜应推荐 WASM",
  );
  console.assert(b.recommendation === "不推荐", "表单校验不应上 WASM");
  console.assert(
    c.recommendation !== "不推荐",
    "大文件哈希边界成本可被分块摊薄，不应被否掉",
  );
  console.assert(
    b.boundaryRatio > a.boundaryRatio,
    "高频小任务的边界占比应显著高于整帧任务",
  );

  console.log("\n✅ WASM 适用性评估器演示通过");
}

runDecisionDemo();

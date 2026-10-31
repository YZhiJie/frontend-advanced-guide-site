// 文件: examples/71-03-benchmark-protocol.ts

/**
 * 基准方法学演示：怎么测 JS vs WASM 才不自欺欺人
 *
 * 四个最常见的测量陷阱：
 *   1. 不预热——JIT 还没编译热路径，前几十次迭代慢得离谱，全混进样本里
 *   2. 取均值——一次 GC 停顿或系统调度就能拉出 10 倍离群值，均值被污染
 *   3. 没有对照组——只报「WASM 耗时 12ms」没有意义，相对 JS 基线的加速比才有
 *   4. 微基准失真——测的是脱离上下文的玩具循环，不是真实数据规模与调用模式
 *
 * 本示例的「WASM 实现」是模拟的：用 1/4 的迭代次数模拟 4 倍提速，
 * 再叠加固定边界开销，用来演示「加速比被边界成本侵蚀」的效果。
 */

interface BenchReport {
  name: string;
  /** 原始样本数（含预热） */
  totalRuns: number;
  /** 被丢弃的预热样本数 */
  warmupRuns: number;
  /** IQR 剔除的异常样本数 */
  outliersDropped: number;
  medianMs: number;
  meanMs: number;
  p95Ms: number;
}

/** 受测工作负载：对 Float64Array 做 sqrt 累加，计算密集且可复现 */
function makeWorkload(data: Float64Array, iterations: number) {
  return () => {
    let acc = 0;
    for (let k = 0; k < iterations; k++) {
      for (let i = 0; i < data.length; i++) {
        acc += Math.sqrt(data[i]);
      }
    }
    return acc;
  };
}

/**
 * 标准测量协议：预热 → 采样 → 剔除异常值 → 报中位数
 */
function benchmark(
  name: string,
  fn: () => unknown,
  warmupRuns = 20,
  sampleRuns = 80,
): BenchReport {
  // 第一步：预热——让 JIT 完成优化编译，这部分样本直接丢弃
  for (let i = 0; i < warmupRuns; i++) fn();

  // 第二步：逐次采样，每次单独计时（不要把 N 次放一次计时里取平均，会失去分布信息）
  const samples: number[] = [];
  for (let i = 0; i < sampleRuns; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }

  // 第三步：IQR 剔除异常值——GC 停顿、系统调度造成的尖刺不参与结论
  const sorted = [...samples].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const upperFence = q3 + 1.5 * iqr;
  const kept = samples.filter((s) => s <= upperFence);

  // 第四步：报中位数与 P95，均值仅作参照（对离群值敏感）
  const keptSorted = [...kept].sort((a, b) => a - b);
  const median = keptSorted[Math.floor(keptSorted.length / 2)];
  const mean = kept.reduce((a, b) => a + b, 0) / kept.length;
  const p95 = keptSorted[Math.floor(keptSorted.length * 0.95)];

  return {
    name,
    totalRuns: warmupRuns + sampleRuns,
    warmupRuns,
    outliersDropped: samples.length - kept.length,
    medianMs: median,
    meanMs: mean,
    p95Ms: p95,
  };
}

function printReport(r: BenchReport) {
  console.log(
    `  ${r.name}：中位数 ${r.medianMs.toFixed(2)}ms | 均值 ${r.meanMs.toFixed(2)}ms | ` +
      `P95 ${r.p95Ms.toFixed(2)}ms（剔除异常 ${r.outliersDropped} 个，预热 ${r.warmupRuns} 次已丢弃）`,
  );
}

/** ============ 对照实验演示 ============ */
export function runBenchmarkDemo() {
  const data = new Float64Array(4096).map((_, i) => (i % 97) + 1);

  // JS 基线：完整迭代（约 650 万次 sqrt，单次调用数毫秒——足够掩盖计时器噪声）
  const jsImpl = makeWorkload(data, 1600);
  // 模拟 WASM：1/4 迭代模拟 4 倍计算提速 + 每次调用 0.3ms 边界开销（数据搬运）
  const wasmBoundaryMs = 0.3;
  const wasmMockInner = makeWorkload(data, 400);
  const wasmMock = () => {
    const r = wasmMockInner();
    // 模拟固定的边界穿越开销（真实场景是拷贝数据进线性内存的时间）
    const t0 = performance.now();
    while (performance.now() - t0 < wasmBoundaryMs) {
      /* 空转模拟边界开销 */
    }
    return r;
  };

  console.log("对照组报告（同协议、同机器、同数据规模）：");
  const jsReport = benchmark("JS 基线  ", jsImpl);
  const wasmReport = benchmark("模拟 WASM", wasmMock);
  printReport(jsReport);
  printReport(wasmReport);

  const speedup = jsReport.medianMs / wasmReport.medianMs;
  console.log(`\n加速比（中位数口径）：${speedup.toFixed(2)}x`);
  console.log(
    `边界开销占 WASM 侧耗时：${((wasmBoundaryMs / wasmReport.medianMs) * 100).toFixed(0)}%` +
      "——计算量越小，这个比例越大，WASM 越不值",
  );

  // ---- 断言：协议本身要守住 ----
  console.assert(
    wasmReport.medianMs < jsReport.medianMs,
    "模拟 WASM 应快于 JS 基线",
  );
  console.assert(
    speedup < 4,
    "叠加边界开销后加速比应小于纯计算的 4 倍——边界成本会侵蚀收益",
  );
  console.assert(
    jsReport.warmupRuns === 20 && wasmReport.warmupRuns === 20,
    "预热样本必须被丢弃",
  );

  // 陷阱演示：不预热 + 只测首轮会得到什么
  const naive = makeWorkload(data, 1600);
  const t0 = performance.now();
  naive(); // 第一次调用包含 JIT 预热成本
  const naiveFirstMs = performance.now() - t0;
  console.log(
    `\n陷阱演示：未预热的首轮耗时 ${naiveFirstMs.toFixed(2)}ms，` +
      `与预热后中位数 ${jsReport.medianMs.toFixed(2)}ms 可能相差数倍——这就是不预热的数据`,
  );

  console.log("\n✅ 基准方法学演示通过");
}

runBenchmarkDemo();

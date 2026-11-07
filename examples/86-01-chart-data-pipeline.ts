// 文件: examples/86-01-chart-data-pipeline.ts
// ============ Recharts 数据管线：时间序列对齐 + 缺失值填充 + 系列聚合 ============
// 对应 JD 技术栈 Recharts。Recharts 是声明式 SVG 图表，数据管线是关键：
// 把后端返回的不规则数据转成 Recharts 需要的「按 x 轴对齐的数组」。
// 纯 TS 演示时间序列对齐、缺失值填充、系列聚合。

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ 断言失败：${msg}`);
    process.exit(1);
  }
}

// ---------------- 1. 时间序列对齐 ----------------

export interface RawPoint {
  date: string; // ISO 日期
  value: number;
}

/**
 * 把多个系列的原始数据对齐到同一个日期轴。
 * 后端可能返回：系列 A 有 1/1、1/3 的数据，系列 B 有 1/2、1/3 的数据。
 * Recharts 需要统一的 x 轴，所以要合并所有日期，缺失的填 null。
 */
export function alignTimeSeries(series: Record<string, RawPoint[]>): Array<Record<string, number | null>> {
  // 收集所有日期并排序
  const allDates = Array.from(
    new Set(Object.values(series).flatMap((s) => s.map((p) => p.date))),
  ).sort();

  // 每个系列建一个 date → value 的 map 方便查找
  const maps = Object.entries(series).map(([name, points]) => {
    const m = new Map<string, number>();
    points.forEach((p) => m.set(p.date, p.value));
    return { name, map: m };
  });

  return allDates.map((date) => {
    const row: Record<string, number | null> = { date };
    for (const { name, map } of maps) {
      row[name] = map.get(date) ?? null;
    }
    return row;
  });
}

// ---------------- 2. 缺失值填充策略 ----------------

export type FillStrategy = "null" | "zero" | "previous" | "linear";

/**
 * 对对齐后的数据做缺失值填充。
 * - null:     保留 null（Recharts 会断开连线）
 * - zero:     填 0
 * - previous: 用上一个非空值
 * - linear:   线性插值
 */
export function fillMissing(
  data: Array<Record<string, number | null>>,
  seriesNames: string[],
  strategy: FillStrategy,
): Array<Record<string, number | null>> {
  if (strategy === "null") return data;

  return data.map((row, i) => {
    const filled: Record<string, number | null> = { ...row };
    for (const name of seriesNames) {
      if (filled[name] !== null) continue;
      switch (strategy) {
        case "zero":
          filled[name] = 0;
          break;
        case "previous": {
          // 往前找最近的非空值
          for (let j = i - 1; j >= 0; j--) {
            if (data[j][name] !== null) { filled[name] = data[j][name]; break; }
          }
          break;
        }
        case "linear": {
          // 找前后最近的非空值做线性插值
          let prev: { idx: number; val: number } | null = null;
          let next: { idx: number; val: number } | null = null;
          for (let j = i - 1; j >= 0; j--) {
            if (data[j][name] !== null) { prev = { idx: j, val: data[j][name] as number }; break; }
          }
          for (let j = i + 1; j < data.length; j++) {
            if (data[j][name] !== null) { next = { idx: j, val: data[j][name] as number }; break; }
          }
          if (prev && next) {
            const ratio = (i - prev.idx) / (next.idx - prev.idx);
            filled[name] = Math.round(prev.val + (next.val - prev.val) * ratio);
          } else if (prev) {
            filled[name] = prev.val;
          } else if (next) {
            filled[name] = next.val;
          } else {
            filled[name] = 0;
          }
          break;
        }
      }
    }
    return filled;
  });
}

// ---------------- 3. 系列聚合（按日/周/月） ----------------

/**
 * 按时间粒度聚合：把日数据聚合成周/月。
 * Recharts 的 X 轴如果点太密会挤在一起，需要聚合。
 */
export function aggregateByPeriod(
  points: RawPoint[],
  period: "day" | "week" | "month",
): RawPoint[] {
  const bucketKey = (date: string): string => {
    const d = new Date(date);
    if (period === "day") return date;
    if (period === "month") return date.slice(0, 7); // YYYY-MM
    // week：ISO 周，简化为按 7 天分组
    const start = new Date(d.getFullYear(), 0, 1);
    const weekNum = Math.ceil(((d.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7);
    return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
  };

  const buckets = new Map<string, number[]>();
  for (const p of points) {
    const key = bucketKey(p.date);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(p.value);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => ({
      date,
      value: vals.reduce((s, v) => s + v, 0), // 求和聚合
    }));
}

// ---------------- 演示与断言 ----------------

function main(): void {
  console.log("===== 1. 时间序列对齐 =====");
  const series = {
    revenue: [
      { date: "2024-01-01", value: 100 },
      { date: "2024-01-03", value: 300 },
    ],
    cost: [
      { date: "2024-01-02", value: 50 },
      { date: "2024-01-03", value: 150 },
    ],
  };
  const aligned = alignTimeSeries(series);
  assert(aligned.length === 3, `对齐后应有 3 天，实际 ${aligned.length}`);
  assert(aligned[0].revenue === 100 && aligned[0].cost === null, "1/1 有 revenue 无 cost");
  assert(aligned[1].revenue === null && aligned[1].cost === 50, "1/2 有 cost 无 revenue");
  assert(aligned[2].revenue === 300 && aligned[2].cost === 150, "1/3 两者都有");
  console.log("✓ 两个系列对齐到 3 天，缺失值填 null");

  console.log("\n===== 2. 缺失值填充策略 =====");
  const names = ["revenue", "cost"];
  const zeroFilled = fillMissing(aligned, names, "zero");
  assert(zeroFilled[0].cost === 0, "zero 策略填 0");

  const prevFilled = fillMissing(aligned, names, "previous");
  // 1/2 的 revenue 用 1/1 的 100
  assert(prevFilled[1].revenue === 100, `previous 策略：1/2 revenue 应继承 1/1 的 100，实际 ${prevFilled[1].revenue}`);

  const linearFilled = fillMissing(aligned, names, "linear");
  // 1/2 的 revenue 在 100(1/1) 和 300(1/3) 中间 → 200
  assert(linearFilled[1].revenue === 200, `linear 插值：1/2 revenue 应为 200，实际 ${linearFilled[1].revenue}`);
  console.log("✓ zero=0, previous=继承前值, linear=线性插值(100→200→300)");

  console.log("\n===== 3. 按月聚合 =====");
  const daily: RawPoint[] = [
    { date: "2024-01-01", value: 10 },
    { date: "2024-01-15", value: 20 },
    { date: "2024-02-01", value: 30 },
    { date: "2024-02-20", value: 40 },
  ];
  const monthly = aggregateByPeriod(daily, "month");
  assert(monthly.length === 2, "按月聚合应有 2 条");
  assert(monthly[0].date === "2024-01" && monthly[0].value === 30, "1 月求和 30");
  assert(monthly[1].date === "2024-02" && monthly[1].value === 70, "2 月求和 70");
  console.log(`✓ 按月聚合：${monthly.map((m) => `${m.date}=${m.value}`).join(", ")}`);

  console.log("\n✅ 时间序列对齐 + 缺失值填充 + 周期聚合全部通过");
}

main();

/**
 * 第 97 部分 · IoT 时序数据可视化
 * JD 需求点：智慧能源/数字孪生 JD 要求"IoT 传感器数据实时接入、时序数据可视化、
 *   告警阈值、设备监控大屏"；数据有高频（秒级）、量大（百万点）、需降采样的特点。
 * 本示例在 Node 环境模拟：
 *   1) 时序数据模型（timestamp + metric + tags + value）与写入
 *   2) 降采样：平均值聚合（1s→1min）与 LTTB 算法（保留形状的下采样）
 *   3) 滚动窗口告警（连续 N 点超阈值触发，防抖）
 *   4) 实时数据缓冲与定时 flush（合并高频推送，减少渲染）
 *   5) 多设备数据对齐（不同时间戳对齐到同一时间网格）
 * 运行：npx tsx examples/97-01-iot-time-series.ts
 */
import assert from "node:assert";

// ---------- 1. 时序数据模型 ----------
interface DataPoint {
  timestamp: number; // ms
  value: number;
}

interface TimeSeries {
  metric: string;
  tags: Record<string, string>; // 设备 ID、位置等维度
  points: DataPoint[];
}

function createSeries(metric: string, tags: Record<string, string>): TimeSeries {
  return { metric, tags, points: [] };
}

function appendPoint(series: TimeSeries, timestamp: number, value: number): void {
  series.points.push({ timestamp, value });
}

// ---------- 2. 降采样：平均值聚合 ----------
// 把高频点按固定窗口（如 60s）聚合成一个点（avg）
function avgAggregate(points: DataPoint[], windowMs: number): DataPoint[] {
  if (points.length === 0) return [];
  const buckets = new Map<number, { sum: number; count: number }>();
  for (const p of points) {
    const bucket = Math.floor(p.timestamp / windowMs) * windowMs;
    const b = buckets.get(bucket) ?? { sum: 0, count: 0 };
    b.sum += p.value;
    b.count++;
    buckets.set(bucket, b);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, b]) => ({ timestamp: ts, value: b.sum / b.count }));
}

// ---------- 3. 降采样：LTTB（ Largest Triangle Three Buckets ）----------
// 保留折线形状的下采样算法，比平均值更能保留峰值/谷值
function lttbDownsample(points: DataPoint[], threshold: number): DataPoint[] {
  const n = points.length;
  if (n <= threshold || threshold < 3) return points.slice();

  const sampled: DataPoint[] = [points[0]];
  const bucketSize = (n - 2) / (threshold - 2);
  let a = 0; // 上一个选中点的索引

  for (let i = 0; i < threshold - 2; i++) {
    // 计算下一个桶的平均点（作为三角形第三个点的近似）
    const nextStart = Math.floor((i + 1) * bucketSize) + 1;
    const nextEnd = Math.floor((i + 2) * bucketSize) + 1;
    let avgX = 0, avgY = 0;
    for (let j = nextStart; j < Math.min(nextEnd, n); j++) {
      avgX += points[j].timestamp;
      avgY += points[j].value;
    }
    const avgRange = Math.min(nextEnd, n) - nextStart || 1;
    avgX /= avgRange;
    avgY /= avgRange;

    // 当前桶范围
    const curStart = Math.floor(i * bucketSize) + 1;
    const curEnd = Math.floor((i + 1) * bucketSize) + 1;

    // 选当前桶里与 a、平均点构成面积最大的点
    let maxArea = -1;
    let nextA = curStart;
    const ax = points[a].timestamp, ay = points[a].value;
    for (let j = curStart; j < curEnd && j < n; j++) {
      const area = Math.abs(
        (ax - avgX) * (points[j].value - ay) - (ax - points[j].timestamp) * (avgY - ay)
      ) / 2;
      if (area > maxArea) {
        maxArea = area;
        nextA = j;
      }
    }
    sampled.push(points[nextA]);
    a = nextA;
  }
  sampled.push(points[n - 1]); // 最后一个点必选
  return sampled;
}

// ---------- 4. 滚动窗口告警 ----------
// 连续 N 个点超过阈值才触发，防抖（避免单点毛刺误报）
interface AlertRule {
  metric: string;
  threshold: number;
  consecutivePoints: number;
  direction: "above" | "below";
}

function checkAlert(points: DataPoint[], rule: AlertRule): boolean {
  let count = 0;
  for (const p of points) {
    const breached = rule.direction === "above" ? p.value > rule.threshold : p.value < rule.threshold;
    count = breached ? count + 1 : 0;
    if (count >= rule.consecutivePoints) return true;
  }
  return false;
}

// ---------- 5. 实时缓冲 + flush ----------
// 高频推送先缓冲，定时合并 flush，减少渲染次数
class RealtimeBuffer {
  private buffer: DataPoint[] = [];
  private lastFlush = 0;
  constructor(private intervalMs: number, private onFlush: (points: DataPoint[]) => void) {}
  push(ts: number, value: number) {
    this.buffer.push({ timestamp: ts, value });
    const now = ts;
    if (now - this.lastFlush >= this.intervalMs) {
      this.flush(now);
    }
  }
  flush(now: number) {
    if (this.buffer.length === 0) return;
    this.onFlush(this.buffer);
    this.buffer = [];
    this.lastFlush = now;
  }
}

// ---------- 6. 多设备时间对齐 ----------
// 不同设备上报时间不同，对齐到固定时间网格（如每 10s 一个点）
function alignToGrid(series: DataPoint[], gridMs: number, start: number, end: number): DataPoint[] {
  const result: DataPoint[] = [];
  for (let t = start; t <= end; t += gridMs) {
    // 找时间最近的点（线性插值或最近邻）
    let nearest = series[0];
    let minDiff = Infinity;
    for (const p of series) {
      const diff = Math.abs(p.timestamp - t);
      if (diff < minDiff) { minDiff = diff; nearest = p; }
    }
    result.push({ timestamp: t, value: nearest?.value ?? 0 });
  }
  return result;
}

// ===================== 运行断言 =====================
console.log("===== 1. 时序数据写入 =====");
const temp = createSeries("temperature", { device: "sensor-001", location: "机房A" });
for (let i = 0; i < 100; i++) appendPoint(temp, i * 1000, 20 + Math.sin(i / 10) * 5 + Math.random());
assert(temp.points.length === 100, "应写入 100 个点");
console.log(`✓ 写入：${temp.points.length} 个温度点`);

console.log("\n===== 2. 平均值聚合降采样 =====");
const agg = avgAggregate(temp.points, 10000); // 10s 窗口
assert(agg.length === 10, `100 个 1s 点按 10s 聚合应为 10 个，实际 ${agg.length}`);
console.log(`✓ 平均聚合：100 → ${agg.length} 个点`);

console.log("\n===== 3. LTTB 形状保持降采样 =====");
const lttb = lttbDownsample(temp.points, 20);
assert(lttb.length === 20, `LTTB 应下采样到 20 个点，实际 ${lttb.length}`);
assert(lttb[0].timestamp === temp.points[0].timestamp, "首尾点应保留");
assert(lttb[lttb.length - 1].timestamp === temp.points[99].timestamp, "最后一点应保留");
console.log(`✓ LTTB：100 → ${lttb.length} 个点（首尾保留）`);

console.log("\n===== 4. 滚动窗口告警 =====");
const alertPoints = [10, 11, 12, 35, 36, 37, 38, 10].map((v, i) => ({ timestamp: i * 1000, value: v }));
const rule: AlertRule = { metric: "temperature", threshold: 30, consecutivePoints: 3, direction: "above" };
assert(checkAlert(alertPoints, rule) === true, "连续 4 点超 30 应触发告警");

const glitch = [10, 35, 10, 35, 10].map((v, i) => ({ timestamp: i * 1000, value: v }));
assert(checkAlert(glitch, rule) === false, "单点毛刺不应触发");
console.log("✓ 告警：连续 3 点超阈值触发，单点毛刺不触发");

console.log("\n===== 5. 实时缓冲 flush =====");
let flushed: DataPoint[] = [];
const buf = new RealtimeBuffer(3000, (pts) => { flushed = pts; });
buf.push(0, 1); buf.push(1000, 2); buf.push(2000, 3);
assert(flushed.length === 0, "未到 3s 不应 flush");
buf.push(4000, 4); // 距离上次 flush 超过 3s
assert(flushed.length === 4, `应 flush 4 个点，实际 ${flushed.length}`);
console.log(`✓ 缓冲：${flushed.length} 个点合并 flush`);

console.log("\n===== 6. 多设备时间对齐 =====");
const dev1 = [{ timestamp: 0, value: 10 }, { timestamp: 15000, value: 12 }, { timestamp: 30000, value: 15 }];
const aligned = alignToGrid(dev1, 10000, 0, 30000);
assert(aligned.length === 4, `0~30s 按 10s 网格应为 4 个点，实际 ${aligned.length}`);
assert(aligned[0].timestamp === 0 && aligned[1].timestamp === 10000, "网格点应为 0/10000/20000/30000");
console.log(`✓ 对齐：${aligned.length} 个网格点`);

console.log("\n✅ 时序模型 + 平均聚合 + LTTB 降采样 + 滚动告警 + 实时缓冲 + 时间对齐全部通过");

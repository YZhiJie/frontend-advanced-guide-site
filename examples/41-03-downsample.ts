// 文件: examples/41-03-downsample.ts
// ============ 大数据量优化：LTTB 降采样 ============
// 传感器/日志类数据动辄十万点，直接画 SVG 必卡（DOM 上限），Canvas 画了也看不清。
// 降采样的关键不是「均匀抽样」——会恰好丢掉峰值（大屏上最该被看见的异常）。
// LTTB（Largest-Triangle-Three-Buckets）按「视觉重要性」保留点：
// 分桶后每桶选「与前一个保留点、桶平均点构成三角形面积最大」的点——峰值天然被保留。

export interface Point {
    x: number;
    y: number;
}

/** 三角形面积（叉积） */
function triangleArea(a: Point, b: Point, c: Point): number {
    return Math.abs(((a.x - c.x) * (b.y - a.y) - (a.x - b.x) * (a.y - c.y)) / 2);
}

/** LTTB 降采样：threshold 为目标点数 */
export function lttb(data: readonly Point[], threshold: number): Point[] {
    const n = data.length;
    if (threshold >= n || threshold < 3) return [...data];

    const sampled: Point[] = [data[0]!];
    const every = (n - 2) / (threshold - 2); // 每桶平均点数
    let a = data[0]!;

    for (let i = 0; i < threshold - 2; i++) {
        // 当前桶与下一桶的范围
        const bucketStart = Math.floor((i + 1) * every) + 1;
        const bucketEnd = Math.min(Math.floor((i + 2) * every) + 1, n);
        const nextStart = Math.min(Math.floor((i + 2) * every) + 1, n);
        const nextEnd = Math.min(Math.floor((i + 3) * every) + 1, n);

        // 下一桶平均点（决定三角形的第三个顶点）
        let avgX = 0;
        let avgY = 0;
        const nextLen = Math.max(1, nextEnd - nextStart);
        for (let j = nextStart; j < nextEnd; j++) {
            avgX += data[j]!.x;
            avgY += data[j]!.y;
        }
        const avg: Point = { x: avgX / nextLen, y: avgY / nextLen };

        // 在当前桶中选与 a、avg 构成面积最大的点
        let maxArea = -1;
        let maxIdx = bucketStart;
        for (let j = bucketStart; j < bucketEnd; j++) {
            const area = triangleArea(a, data[j]!, avg);
            if (area > maxArea) {
                maxArea = area;
                maxIdx = j;
            }
        }
        a = data[maxIdx]!;
        sampled.push(a);
    }
    sampled.push(data[n - 1]!); // 首尾必保留
    return sampled;
}

/** 均匀抽样（对照：会丢峰值） */
export function uniformSample(data: readonly Point[], threshold: number): Point[] {
    if (threshold >= data.length) return [...data];
    const step = data.length / threshold;
    const out: Point[] = [];
    for (let i = 0; i < threshold; i++) out.push(data[Math.floor(i * step)]!);
    return out;
}

// ---------------- 验证 ----------------

// 构造 10 万点信号：基线 50 + 正弦 + 一个孤立的尖峰（y=990，宽度 3 个点）
const N = 100_000;
const raw: Point[] = Array.from({ length: N }, (_, i) => ({
    x: i,
    y: 50 + 20 * Math.sin(i / 500) + (i >= 50000 && i < 50003 ? 940 : 0),
}));

console.log("=== 数据规模 ===");
console.log("原始点数:", N, "尖峰位置: x=50000~50002 (y≈990)");

const TARGET = 500;
const lttbResult = lttb(raw, TARGET);
const uniformResult = uniformSample(raw, TARGET);

console.log("\n=== 降采样到", TARGET, "点 ===");
console.log("LTTB 保留点数:", lttbResult.length);
console.log("均匀抽样点数:", uniformResult.length);

console.log("\n=== 峰值保留对比（核心差异） ===");
const lttbMax = Math.max(...lttbResult.map((p) => p.y));
const uniformMax = Math.max(...uniformResult.map((p) => p.y));
console.log("LTTB 最大值:", lttbMax.toFixed(0), lttbMax > 900 ? "→ 尖峰被保留 ✓" : "→ 尖峰丢失 ✗");
console.log("均匀抽样最大值:", uniformMax.toFixed(0), uniformMax > 900 ? "→ 尖峰被保留 ✓" : "→ 尖峰丢失 ✗（3/200 概率恰好命中）");

console.log("\n=== 前端工程衔接 ===");
console.log(`
// 10 万点 SVG：10 万个 <circle> → DOM 爆炸，页面假死
// 10 万点 Canvas：能画但缩放平移要全量重绘
// LTTB 降到 500 点：SVG/Canvas 都轻松，峰值信息不丢 —— 「先降采样再渲染」`);

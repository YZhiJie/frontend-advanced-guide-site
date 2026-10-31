// 文件: examples/41-02-scales.ts
// ============ 比例尺：数据域到像素域的映射 ============
// 所有图表库的底层核心都是比例尺（D3 的 d3.scaleLinear 等）：
// 把数据值域（domain）线性映射到像素值域（range）。
// 三种常用比例尺：
// - linear：连续数值 → 像素（柱高、折线 y 坐标）；
// - ordinal：离散类别 → 位置/颜色（分类轴）；
// - colorRamp：数值 → 颜色插值（热力图、地图填色）。
// 轴刻度是比例尺的直接产物：nice ticks（取整刻度）。

export interface LinearScale {
    (value: number): number;
    invert(pixel: number): number;       // 反向：像素 → 数据（鼠标交互必用）
    domain(): [number, number];
    range(): [number, number];
}

/** 线性比例尺：domain [d0,d1] → range [r0,r1] */
export function scaleLinear(domain: [number, number], range: [number, number]): LinearScale {
    const [d0, d1] = domain;
    const [r0, r1] = range;
    const span = d1 - d0 || 1; // 防 domain 零宽除零
    const scale = ((value: number) => r0 + ((value - d0) / span) * (r1 - r0)) as LinearScale;
    scale.invert = (pixel: number) => d0 + ((pixel - r0) / (r1 - r0 || 1)) * span;
    scale.domain = () => [d0, d1];
    scale.range = () => [r0, r1];
    return scale;
}

/** 序数比例尺：类别 → 均分位置（柱状图 x 轴） */
export function scaleBand(categories: readonly string[], range: [number, number]): { (cat: string): number | undefined; bandwidth: number; step: number } {
    const step = (range[1] - range[0]) / categories.length;
    const map = new Map(categories.map((c, i) => [c, range[0] + i * step]));
    const scale = ((cat: string) => map.get(cat)) as ReturnType<typeof scaleBand>;
    scale.bandwidth = step * 0.7;   // 留 30% 间隙
    scale.step = step;
    return scale;
}

/** 色带：数值在 [0,1] 之间插值两个 RGB 颜色（热力图） */
export function scaleColor(low: [number, number, number], high: [number, number, number]): (t: number) => string {
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    return (t) => {
        const k = clamp(t);
        const rgb = low.map((l, i) => Math.round(l + (high[i]! - l) * k));
        return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    };
}

/** nice 刻度：把数据范围扩展到「整」刻度边界（0/25/50/75/100 而非 3/27/51） */
export function niceTicks(min: number, max: number, count = 5): number[] {
    const span = max - min;
    const step = Math.pow(10, Math.floor(Math.log10(span / count)));
    const err = (span / count) / step;
    const mult = err >= 7.5 ? 10 : err >= 3 ? 5 : err >= 1.5 ? 2 : 1;
    const niceStep = step * mult;
    const niceMin = Math.floor(min / niceStep) * niceStep;
    const niceMax = Math.ceil(max / niceStep) * niceStep;
    const ticks: number[] = [];
    for (let v = niceMin; v <= niceMax + niceStep / 2; v += niceStep) ticks.push(Number(v.toFixed(10)));
    return ticks;
}

// ---------------- 验证 ----------------

console.log("=== 线性比例尺：销售额 0~500(万) → 图表高 0~400(px) ===");
const y = scaleLinear([0, 500], [400, 0]); // y 轴向下，range 反转
console.log("350 万 →", y(350).toFixed(1), "px");
console.log("500 万 →", y(500), "px（顶）");
console.log("像素 100 反推 →", y.invert(100), "万（鼠标悬停提示用）");

console.log("\n=== 序数比例尺：四个季度均分 800px ===");
const x = scaleBand(["Q1", "Q2", "Q3", "Q4"], [0, 800]);
console.log("Q2 起点:", x("Q2"), "px，柱宽:", x.bandwidth.toFixed(1), "px");

console.log("\n=== 色带：0~1 → 绿到红（热力图） ===");
const heat = scaleColor([52, 211, 153], [239, 68, 68]);
console.log("0.0 →", heat(0));
console.log("0.5 →", heat(0.5));
console.log("1.0 →", heat(1));
console.log("越界 1.5 →", heat(1.5), "（clamp 到红）");

console.log("\n=== nice 刻度 ===");
console.log("数据 [12, 87] →", niceTicks(12, 87));
console.log("数据 [0, 1024] →", niceTicks(0, 1024));

// 文件: examples/41-04-render-budget.ts
// ============ 渲染选型：SVG vs Canvas 的决策模型 ============
// 大屏图表选型的两条主线：
// - SVG：DOM 节点即图形，事件/动画/无障碍免费，但节点上限 ~1 万（多了 DOM 管理成本爆炸）；
// - Canvas：像素级绘制，十万点无压力，但交互要自己做命中检测，动画要自己管帧。
// 工程折中是「分层」：Canvas 画数据主体（大面积），SVG/DOM 叠交互层（tooltip、选框）。
// 本示例实现一个决策函数：输入数据规模与交互需求，输出选型建议。

export interface ChartRequirement {
    elementCount: number;       // 图形元素数（点/柱/节点）
    hasHoverInteraction: boolean;
    hasAnimation: boolean;
    fpsTarget: 30 | 60;
    needsExportSVG: boolean;    // 需要矢量导出/打印
}

export type Choice = "svg" | "canvas" | "layered" | "webgl";

export interface Decision {
    choice: Choice;
    reasons: string[];
}

/** 渲染选型决策 */
export function decideRenderer(req: ChartRequirement): Decision {
    const reasons: string[] = [];
    let score = 0; // > 0 偏 Canvas

    if (req.elementCount > 10_000) {
        score += 3;
        reasons.push(`${req.elementCount} 个元素超过 SVG 舒适区（~1 万）`);
    } else if (req.elementCount > 2000) {
        score += 1;
        reasons.push(`${req.elementCount} 个元素偏多，SVG 勉强可用`);
    } else {
        score -= 1;
        reasons.push(`${req.elementCount} 个元素在 SVG 舒适区`);
    }

    if (req.hasHoverInteraction && req.elementCount <= 5000) {
        score -= 2;
        reasons.push("悬停交互 + 元素不多 → SVG 事件系统免实现");
    } else if (req.hasHoverInteraction) {
        reasons.push("悬停交互元素过多 → Canvas 需自实现命中检测，或走分层（Canvas 画 + SVG 热区层）");
    }

    if (req.hasAnimation && req.fpsTarget === 60 && req.elementCount > 3000) {
        score += 2;
        reasons.push("60fps 动画 + 大量元素 → SVG 每帧改 DOM 会抖，Canvas 重绘更稳");
    }

    if (req.needsExportSVG) {
        score -= 3;
        reasons.push("需要矢量导出 → 强制 SVG");
    }

    if (req.elementCount > 200_000) {
        reasons.push("元素超 20 万 → WebGL（ECharts GL / deck.gl）");
        return { choice: "webgl", reasons };
    }

    if (req.hasHoverInteraction && req.elementCount > 10_000) {
        return { choice: "layered", reasons };
    }
    return { choice: score > 0 ? "canvas" : "svg", reasons };
}

/** 渲染耗时估算模型（教学近似）：DOM 变更成本 >> 像素绘制成本 */
export function estimateFrameCost(req: ChartRequirement, updatedElements: number): { svgMs: number; canvasMs: number } {
    // 经验常数：SVG 单元素更新 ~0.01ms（layout 参与），Canvas 全量重绘 ~ 元素数 × 0.0005ms
    const svgMs = updatedElements * 0.01;
    const canvasMs = req.elementCount * 0.0005 + 0.5;
    return { svgMs: Number(svgMs.toFixed(2)), canvasMs: Number(canvasMs.toFixed(2)) };
}

/** 帧预算检查：16.7ms 内能否跑满 60fps */
export function meetsFps(costMs: number, fpsTarget: 30 | 60): boolean {
    const budget = 1000 / fpsTarget;
    return costMs < budget * 0.7; // 留 30% 给业务逻辑
}

// ---------------- 验证 ----------------

const cases: ChartRequirement[] = [
    { elementCount: 500, hasHoverInteraction: true, hasAnimation: true, fpsTarget: 60, needsExportSVG: false },
    { elementCount: 8000, hasHoverInteraction: true, hasAnimation: true, fpsTarget: 60, needsExportSVG: false },
    { elementCount: 50_000, hasHoverInteraction: true, hasAnimation: false, fpsTarget: 30, needsExportSVG: false },
    { elementCount: 300_000, hasHoverInteraction: false, hasAnimation: false, fpsTarget: 30, needsExportSVG: false },
    { elementCount: 2000, hasHoverInteraction: true, hasAnimation: false, fpsTarget: 30, needsExportSVG: true },
];

for (const c of cases) {
    const d = decideRenderer(c);
    console.log(`\n=== ${c.elementCount} 元素 · hover=${c.hasHoverInteraction} · 动画=${c.hasAnimation} · 导出SVG=${c.needsExportSVG} ===`);
    console.log("选型:", d.choice);
    for (const r of d.reasons) console.log("  -", r);
}

console.log("\n=== 帧成本估算（60fps 预算 16.7ms） ===");
const req: ChartRequirement = { elementCount: 8000, hasHoverInteraction: false, hasAnimation: true, fpsTarget: 60, needsExportSVG: false };
const cost = estimateFrameCost(req, 8000);
console.log("每帧更新 8000 个元素 → SVG:", cost.svgMs, "ms / Canvas:", cost.canvasMs, "ms");
console.log("SVG 达标:", meetsFps(cost.svgMs, 60), "Canvas 达标:", meetsFps(cost.canvasMs, 60));

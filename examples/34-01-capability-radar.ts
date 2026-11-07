// 架构师能力自评雷达：五维加权汇总 → 定位当前阶段 → 给出最短板的提升抓手。
// 权重与维度可按团队实际调整，但「先看最短板、再看总分」的读法不要变。

interface Dimension {
    name: string;
    weight: number; // 对架构师胜任度的贡献权重，总和为 1
    score: number;  // 自评 1~5：1=没碰过 3=能独立完成 5=能带人并沉淀方法
    hint: string;   // 低于 3 分时的提升抓手
}

const dimensions: Dimension[] = [
    { name: "技术深度", weight: 0.2, score: 3, hint: "吃透一条线（渲染/网络/编译器任选），能讲到机制层" },
    { name: "技术广度", weight: 0.15, score: 2, hint: "把全书地图按专项篇补齐，每册至少跑通一个示例" },
    { name: "工程赋能", weight: 0.25, score: 2, hint: "从一个 lint 规则或 CI 门禁做起，把团队规范变成机器检查" },
    { name: "决策判断", weight: 0.2, score: 1, hint: "下次选型用 34.2 的 trade-off 矩阵 + ADR 走完整流程" },
    { name: "影响力", weight: 0.2, score: 2, hint: "每季度产出一份 RFC 或复盘文档，先在小组内评审" },
];

const total = dimensions.reduce((s, d) => s + d.weight * d.score, 0);

console.log("=== 五维自评 ===");
for (const d of dimensions) {
    const bar = "█".repeat(d.score) + "░".repeat(5 - d.score);
    console.log(`${d.name.padEnd(4, "　")} ${bar} ${d.score}/5 × 权重${d.weight}`);
}
console.log(`加权总分：${total.toFixed(2)} / 5`);

const phase =
    total < 2.5 ? "资深工程师核心期：先把深度与广度补到 3 分"
    : total < 3.5 ? "架构过渡期：把赋能与决策提到 3 分以上"
    : "架构师胜任区：把优势维度沉淀成团队可复用的方法";

console.log(`阶段定位：${phase}`);

const weakest = [...dimensions].sort((a, b) => a.score - b.score)[0];
console.log(`当前最短板：${weakest.name} → ${weakest.hint}`);

// ADR（架构决策记录）：把「为什么当初这么定」变成可检索的资产。
// 重要不是工具，是五个字段一个都不能少；被取代时改状态而不是删除，保留演进史。

interface AdrOption {
    name: string;
    pros: string[];
    cons: string[];
}

interface Adr {
    id: string;
    title: string;
    status: "proposed" | "accepted" | "deprecated" | "superseded";
    supersededBy?: string;
    context: string;
    options: AdrOption[];
    decision: string;
    consequences: string;
}

const adr1: Adr = {
    id: "ADR-0001",
    title: "请求层选型：引入 TanStack Query 替代自研封装",
    status: "superseded",
    supersededBy: "ADR-0003",
    context: "自研请求层缓存与竞态逻辑 bug 率高（近两季度 6 个 P2 事故中 3 个源于此），维护投入约占一人季度工时的 40%。",
    options: [
        { name: "继续自研", pros: ["零依赖", "团队 100% 熟悉"], cons: ["缓存失效逻辑复杂度持续增长", "无社区测试覆盖"] },
        { name: "TanStack Query", pros: ["缓存/竞态/重试开箱即用", "类型推导完整"], cons: ["新概念学习成本", "包体积 +13KB gzip"] },
        { name: "SWR", pros: ["体积更小"], cons: ["mutation 与乐观更新能力弱", "团队无经验"] },
    ],
    decision: "引入 TanStack Query，自研层仅保留鉴权注入与埋点，通过封装层隔离。",
    consequences: "接受 13KB 体积与两周学习曲线；换取请求类 P2 事故清零目标；组件层代码不改（封装层兜底）。",
};

function render(adr: Adr): string {
    const lines = [
        `# ${adr.id}：${adr.title}`,
        `- 状态：${adr.status}${adr.supersededBy ? `（被 ${adr.supersededBy} 取代）` : ""}`,
        `## 背景`,
        adr.context,
        `## 候选与取舍`,
        ...adr.options.map(
            (o) => `- **${o.name}**：优点 ${o.pros.join("、")}；代价 ${o.cons.join("、")}`,
        ),
        `## 结论`,
        adr.decision,
        `## 后果`,
        adr.consequences,
    ];
    return lines.join("\n");
}

console.log(render(adr1));
console.log("\n// ADR-0002 落地半年后性能预算收紧 → ADR-0003 评估按需加载方案并取代本决策");

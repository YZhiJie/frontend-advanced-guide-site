// 文件: examples/48-01-cross-platform-decision.ts
// ============ 跨端方案加权选型器:把「感觉 Flutter 更好」变成可复核的分数 ============
// 设计要点:
// 1) 选型不是选框架,是选「约束下的最优解」——先定权重,再打分,最后做敏感性检查;
// 2) 权重必须来自业务:硬件对接、包体积、团队栈、上线节奏,不同项目结论会完全不同;
// 3) 敏感性检查比总分更重要:如果某个维度动 1 分就翻转结论,说明决策并不稳固。

type OptionId = "flutter" | "react-native" | "uni-app" | "h5";

interface Criterion {
  id: string;
  weight: number;
  /** true 表示分数越高越差（如包体积增量） */
  reverse?: boolean;
}

const CRITERIA: Criterion[] = [
  { id: "渲染性能", weight: 0.25 },
  { id: "双端一致性", weight: 0.2 },
  { id: "原生/硬件能力", weight: 0.2 },
  { id: "生态与招聘", weight: 0.15 },
  { id: "团队迁移成本", weight: 0.1 },
  { id: "包体积", weight: 0.1, reverse: true },
];

const OPTIONS: Record<OptionId, { name: string; scores: Record<string, number> }> = {
  flutter: {
    name: "Flutter",
    scores: {
      渲染性能: 5,
      双端一致性: 5,
      原生硬件能力: 4,
      生态与招聘: 3,
      团队迁移成本: 2,
      包体积: 4,
    },
  },
  "react-native": {
    name: "React Native",
    scores: {
      渲染性能: 4,
      双端一致性: 3,
      原生硬件能力: 5,
      生态与招聘: 5,
      团队迁移成本: 4,
      包体积: 3,
    },
  },
  "uni-app": {
    name: "uni-app",
    scores: {
      渲染性能: 2,
      双端一致性: 3,
      原生硬件能力: 2,
      生态与招聘: 4,
      团队迁移成本: 5,
      包体积: 2,
    },
  },
  h5: {
    name: "H5 / PWA",
    scores: {
      渲染性能: 2,
      双端一致性: 4,
      原生硬件能力: 1,
      生态与招聘: 5,
      团队迁移成本: 5,
      包体积: 1,
    },
  },
};

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

/** 反向维度用 6 - score 归一,保证「分高=更优」的统一口径 */
function normalizedScore(c: Criterion, raw: number): number {
  return c.reverse ? 6 - raw : raw;
}

function weightedScore(id: OptionId): number {
  const opt = OPTIONS[id];
  return CRITERIA.reduce(
    (sum, c) => sum + (normalizedScore(c, opt.scores[c.id]) / 5) * c.weight,
    0,
  );
}

const ranking = (Object.keys(OPTIONS) as OptionId[])
  .map((id) => ({ id, name: OPTIONS[id].name, score: weightedScore(id) }))
  .sort((a, b) => b.score - a.score);

console.log("=== 跨端方案加权得分（满分 1.000）===");
for (const item of ranking) {
  console.log(`${item.name.padEnd(12)} ${item.score.toFixed(3)}`);
}

// 场景约束:高性能双端 + 需要蓝牙/串口等原生能力 + 团队没有原生积累
assert(ranking[0].id === "flutter", "既定权重下第一顺位应为 Flutter");

// ---------------- 敏感性检查 ----------------
// 把「团队迁移成本」权重从 0.10 提到 0.30,其余等比压缩,看结论是否翻转
const sensitivity: Criterion[] = CRITERIA.map((c) =>
  c.id === "团队迁移成本"
    ? { ...c, weight: 0.3 }
    : { ...c, weight: c.weight * (0.7 / 0.9) },
);
const sensitivityTop = (Object.keys(OPTIONS) as OptionId[])
  .map((id) => ({
    id,
    score: sensitivity.reduce(
      (sum, c) => sum + (normalizedScore(c, OPTIONS[id].scores[c.id]) / 5) * c.weight,
      0,
    ),
  }))
  .sort((a, b) => b.score - a.score)[0].id;

console.log(`\n敏感性检查:团队成本权重升至 0.30 后第一顺位 = ${OPTIONS[sensitivityTop].name}`);
if (sensitivityTop !== ranking[0].id) {
  console.log("⚠️ 结论对权重敏感,应先把「团队迁移成本」估算做实,再拍板");
}

// ---------------- 单维度领先面 ----------------
console.log("\n=== 各维度领先者 ===");
for (const c of CRITERIA) {
  const winner = (Object.keys(OPTIONS) as OptionId[]).sort(
    (a, b) =>
      normalizedScore(c, OPTIONS[b].scores[c.id]) -
      normalizedScore(c, OPTIONS[a].scores[c.id]),
  )[0];
  console.log(`${c.id.padEnd(10)} → ${OPTIONS[winner].name}`);
}

// 标记为模块,避免与其它示例的顶层变量重名
export {};

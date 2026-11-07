// 技术选型的加权 trade-off 矩阵：把「我觉得 A 好」变成「按当前约束算出来 A 高 0.6 分」。
// 分数必须来自实测或调研数据，权重必须来自当下项目的真实约束——矩阵只组织思考，不代替思考。

interface Option {
  name: string;
  scores: Record<string, number>; // 各维度得分 1~5，注释即证据
}

interface Criterion {
  name: string;
  weight: number;
}

// 维度与权重来自「当下」的约束：中后台、团队 6 人、已有 Pinia 经验、无 SSR 需求
const criteria: Criterion[] = [
  { name: "团队熟悉度", weight: 0.3 },
  { name: "类型体验", weight: 0.25 },
  { name: "缓存与竞态能力", weight: 0.2 },
  { name: "包体积", weight: 0.1 },
  { name: "生态与维护", weight: 0.15 },
];

const options: Option[] = [
  {
    name: "TanStack Query",
    scores: {
      团队熟悉度: 2,
      类型体验: 5,
      缓存与竞态能力: 5,
      包体积: 4,
      生态与维护: 5,
    },
  },
  {
    name: "SWR",
    scores: {
      团队熟悉度: 3,
      类型体验: 4,
      缓存与竞态能力: 4,
      包体积: 5,
      生态与维护: 4,
    },
  },
  {
    name: "自研请求层",
    scores: {
      团队熟悉度: 5,
      类型体验: 3,
      缓存与竞态能力: 2,
      包体积: 5,
      生态与维护: 1,
    },
  },
];

const weighted = (o: Option) =>
  criteria.reduce((s, c) => s + c.weight * o.scores[c.name], 0);

console.log("=== 加权排序 ===");
const ranked = [...options].sort((a, b) => weighted(b) - weighted(a));
for (const o of ranked) {
  console.log(`${o.name.padEnd(14)} ${weighted(o).toFixed(2)}`);
}

// 敏感性检查：逐个维度把权重翻倍，看冠军是否易主——易主的维度就是最该被评审挑战的假设
console.log("\n=== 敏感性检查（该维度权重 ×2 后冠军是否反转）===");
const champion = ranked[0].name;
for (const c of criteria) {
  const alt = (o: Option) =>
    criteria.reduce(
      (s, x) => s + x.weight * (x.name === c.name ? 2 : 1) * o.scores[x.name],
      0,
    );
  const newBest = [...options].sort((a, b) => alt(b) - alt(a))[0].name;
  console.log(
    `${c.name}：${newBest === champion ? "不反转" : `反转 → ${newBest}`}`,
  );
}

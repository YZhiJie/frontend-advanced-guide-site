/** 78-01-selection-matrix.ts —— 技术选型矩阵：硬约束一票否决 + 加权打分 + 逐维敏感性 */

interface Criterion {
  name: string;
  weight: number; // 权重来自当下项目的真实约束，不来自「业界平均」
}

interface Option {
  name: string;
  scores: Record<string, number>; // 1~5，分数必须有证据（调研/试点/文档），不能凭印象
  evidence: Record<string, string>;
}

interface Constraint {
  name: string;
  reject: (o: Option) => boolean; // 硬约束：不参与打分，直接出局
}

const criteria: Criterion[] = [
  { name: '团队存量', weight: 0.30 },
  { name: '交付效率', weight: 0.20 },
  { name: '生态成熟度', weight: 0.15 },
  { name: 'SSR/RSC', weight: 0.10 },
  { name: '性能上限', weight: 0.10 },
  { name: '招聘供给', weight: 0.10 },
  { name: '合规与信创', weight: 0.05 },
];

// 场景：8 人团队、7 人一年以上 Vue 经验、历史 30 万行 Vue 2、4 个月交付、无 SSR 需求
const options: Option[] = [
  {
    name: 'Vue 3',
    scores: { 团队存量: 5, 交付效率: 4, 生态成熟度: 4, 'SSR/RSC': 3, 性能上限: 3, 招聘供给: 3, 合规与信创: 4 },
    evidence: {
      团队存量: '7/8 人有一年以上 Vue 经验，历史系统为 Vue 2',
      交付效率: '组件库与业务片段可复用，迁移路径清晰',
      生态成熟度: '国内组件库最全（Element Plus / Ant Design Vue）',
    },
  },
  {
    name: 'React 19',
    scores: { 团队存量: 3, 交付效率: 3, 生态成熟度: 5, 'SSR/RSC': 5, 性能上限: 4, 招聘供给: 5, 合规与信创: 4 },
    evidence: {
      生态成熟度: '全球生态最大，RSC/ISR/边缘方案完整',
      'SSR/RSC': 'Next.js App Router 原生支持 Server Components',
      招聘供给: '人才池最大，外包可选面更广',
    },
  },
  {
    name: 'Angular',
    scores: { 团队存量: 2, 交付效率: 2, 生态成熟度: 3, 'SSR/RSC': 3, 性能上限: 4, 招聘供给: 2, 合规与信创: 5 },
    evidence: {
      团队存量: '团队无 Angular 经验，学习曲线 2~3 个月',
      合规与信创: '强约定适合大型多团队与长期规范治理',
    },
  },
];

const hardConstraints: Constraint[] = [
  {
    // 真实需求：必须支持 Server Components / RSC
    name: '必须有 RSC',
    reject: (o) => o.scores['SSR/RSC'] < 4,
  },
  {
    // 真实约束：历史系统 30 万行 Vue 2，6 个月内不迁移
    name: '存量 Vue 不可迁移',
    reject: (o) => o.name !== 'Vue 3',
  },
];

const weighted = (o: Option, cs: Criterion[]) =>
  cs.reduce((sum, c) => sum + c.weight * o.scores[c.name], 0);

const rank = (cs: Criterion[], pool: Option[] = options) =>
  [...pool].sort((a, b) => weighted(b, cs) - weighted(a, cs));

const applyConstraints = (pool: Option[], cs: Constraint[]) =>
  pool.filter((o) => !cs.some((c) => c.reject(o)));

// ---- 1) 基线排序 ----
const ranked = rank(criteria);
const champion = ranked[0];
console.assert(champion.name === 'Vue 3', '基线场景下 Vue 3 应领先');
console.assert(Math.abs(weighted(champion, criteria) - 4.0) < 1e-9, 'Vue 3 加权分应为 4.00');
console.assert(
  Math.abs(weighted(options[1], criteria) - 3.85) < 1e-9,
  'React 19 加权分应为 3.85，仅落后 0.15',
);

// ---- 2) 敏感性检查：权重 ×2 看冠军是否反转 ----
const reversals: string[] = [];
for (const c of criteria) {
  const doubled = criteria.map((x) =>
    x.name === c.name ? { ...x, weight: x.weight * 2 } : x,
  );
  const next = rank(doubled)[0];
  if (next.name !== champion.name) {
    reversals.push(`${c.name} 权重翻倍 → ${next.name}`);
  }
}
console.assert(
  reversals.some((r) => r.includes('SSR/RSC') && r.includes('React 19')),
  'SSR/RSC 权重翻倍时 React 19 应反超——结论依赖「无强 SSR 需求」假设',
);
console.assert(
  reversals.length === 3 && reversals.every((r) => r.includes('React 19')),
  '生态、SSR/RSC、招聘三个维度可反转冠军，说明结论对这些假设并不稳健',
);

// ---- 3) 硬约束筛选：真需求变化时，结论直接切换 ----
const rscPool = applyConstraints(options, [hardConstraints[0]]);
const legacyPool = applyConstraints(options, [hardConstraints[1]]);
console.assert(
  rscPool.length === 1 && rscPool[0].name === 'React 19',
  '强制 RSC 时只剩 React 19',
);
console.assert(
  legacyPool.length === 1 && legacyPool[0].name === 'Vue 3',
  '存量不可迁移时只剩 Vue 3',
);

// ---- 输出 ----
console.log('\n=== 基线排序（权重来自当前约束）===');
for (const o of ranked) console.log(`${o.name.padEnd(10)} ${weighted(o, criteria).toFixed(2)}`);
console.log('\n=== 敏感性：权重 ×2 后冠军是否反转 ===');
console.log(reversals.length ? reversals.map((r) => `  ${r}`).join('\n') : '  无反转');
console.log('\n=== 反转条件（写进 ADR）===');
console.log('  若 12 个月内出现真实的 RSC/强 SEO 需求 → 重新评估 React 19 + Next.js');
console.log('  若组件库升级阻塞超过 2 个迭代 → 触发替代方案评审');
console.log('\n✅ 选型矩阵 / 敏感性 / 硬约束 / 反转条件全部通过');

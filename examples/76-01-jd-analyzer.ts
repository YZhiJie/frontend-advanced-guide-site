// 文件: examples/76-01-jd-analyzer.ts
// ============ JD 分析器：词典分词 + 频次 × 位置权重打分 + 能力权重表 + 缺口建议 ============
// 把 76.1 的 JD 拆解方法论跑成可执行代码：内置一份企业级移动办公前端 JD，
// 用「词典匹配」做关键词提取，按「出现频次 × 板块权重 × 条目位置衰减」加权计分，
// 输出降序排列的能力权重表，并把每个关键词映射到本指南 69~75 册，生成补课路线。

/** 硬断言：console.assert 在 Node 里只打印不退出，演示脚本需要「错了就红」 */
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ 断言失败：${msg}`);
    process.exit(1);
  }
}

// ---------------- 内置 JD 文本（标题 + 三板块，条目编号即位置权重的依据） ----------------

const JD_TEXT = `
高级前端工程师（企业级移动办公方向）

【岗位职责】
1. 负责企业级移动办公产品（IM、审批、日程、文档）的前端架构设计与核心模块开发，覆盖 Web、PC 桌面端与移动 H5 多端；
2. 主导 PC 桌面端的架构升级与性能优化，推动 Rust 在端能力层的落地；
3. 建设前端埋点体系，制定埋点规范，提升埋点覆盖率与数据准确率，支撑产品数据化决策；
4. 负责分层分级权限体系（组织层级、数据权限）的前端落地，保障企业级安全合规；
5. 参与多端共用架构设计，抽象端能力差异，提升跨端代码复用率与一致性体验。

【任职要求】
1. 计算机相关专业本科及以上学历，3 年以上前端开发经验，有协同办公或企业级 SaaS 经验者优先；
2. 熟练掌握 Vue 或 React 技术栈及生态，理解框架原理，具备复杂状态管理与组件设计能力；
3. 熟悉前端工程化与性能优化，有大型单页应用架构设计经验；
4. 有埋点 SDK 或数据上报体系的设计落地经验，熟悉神策、友盟等第三方埋点平台者优先；
5. 具备良好的沟通协作能力与 owner 意识，能与产品、设计、后端高效协同。

【加分项】
1. 有 Electron 或 Tauri 桌面端开发经验，了解 Rust 语言；
2. 有数据权限、RBAC、ABAC 等权限模型落地经验；
3. 有 WASM、跨端渲染、信创环境适配经验；
4. 有开源贡献或技术博客。
`;

// ---------------- 关键词词典（主词 + 同义词 + 人工定性 + 对应分册） ----------------

type Category = "硬性要求" | "加分项" | "软技能" | "领域知识";

interface KeywordDef {
  term: string; // 权重表中展示的主词
  aliases: string[]; // 同义词/别称，命中任意一个都计入主词
  category: Category; // 该词在 JD 中的定位（拆解表的人工结论，见 76.1）
  chapter: string; // 缺口建议：对应本指南分册
}

const DICTIONARY: KeywordDef[] = [
  { term: "埋点体系", aliases: ["埋点", "数据上报", "神策", "友盟"], category: "硬性要求", chapter: "第 69 册 · 前端埋点体系" },
  { term: "桌面端", aliases: ["桌面端", "Electron", "Tauri"], category: "硬性要求", chapter: "第 70 册 · 桌面端工程化" },
  { term: "Rust", aliases: ["Rust"], category: "加分项", chapter: "第 71 册 · Rust 与 WASM" },
  { term: "WASM", aliases: ["WASM"], category: "加分项", chapter: "第 71 册 · Rust 与 WASM" },
  { term: "数据权限", aliases: ["数据权限", "分层分级", "权限体系", "组织层级", "RBAC", "ABAC"], category: "硬性要求", chapter: "第 72 册 · 组织分层分级与数据权限" },
  { term: "多端架构", aliases: ["多端", "跨端"], category: "硬性要求", chapter: "第 73 册 · 多端共用架构" },
  { term: "信创适配", aliases: ["信创"], category: "加分项", chapter: "第 74 册 · 信创与国密合规" },
  { term: "协同办公", aliases: ["协同办公", "移动办公", "企业级"], category: "领域知识", chapter: "第 75 册 · 协同办公核心域" },
  { term: "框架原理", aliases: ["Vue", "React", "框架原理"], category: "硬性要求", chapter: "第 04 册 · 框架与原理" },
  { term: "性能优化", aliases: ["性能优化"], category: "硬性要求", chapter: "第 03 册 · 工程化与性能" },
  { term: "工程化", aliases: ["工程化"], category: "硬性要求", chapter: "第 03 册 · 工程化与性能" },
  { term: "沟通协作", aliases: ["沟通协作", "owner"], category: "软技能", chapter: "第 34 册 · 架构师成长路线（软素养）" },
  { term: "小程序", aliases: ["小程序"], category: "加分项", chapter: "（本 JD 未考察，无需投入）" },
];

// ---------------- 板块权重与位置衰减 ----------------

/** 板块权重：标题 > 岗位职责 > 任职要求 > 加分项——位置越靠前，越是「真需求」 */
const BLOCK_WEIGHT: Record<string, number> = {
  标题: 1.5,
  岗位职责: 1.2,
  任职要求: 1.0,
  加分项: 0.6,
};

/** 条目位置衰减：板块内第 1 条权重最高，之后每靠后一条递减 15% */
function positionDecay(entryIndex: number): number {
  return 1 / (1 + 0.15 * entryIndex);
}

/** 词典匹配计数：子串出现次数（「埋点体系」命中别名「埋点」属预期行为） */
function countOccurrences(line: string, alias: string): number {
  return line.split(alias).length - 1;
}

// ---------------- 打分主流程 ----------------

interface ScoreRow extends KeywordDef {
  score: number; // 加权总分
  hits: number; // 原始命中次数
}

function analyze(text: string): ScoreRow[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let block = "标题"; // 第一行默认是标题板块
  let entryIndex = 0;
  const scoreMap = new Map<string, number>();
  const countMap = new Map<string, number>();

  for (const line of lines) {
    const blockMatch = line.match(/^【(.+)】$/);
    if (blockMatch) {
      block = blockMatch[1];
      entryIndex = 0; // 换板块后条目序号归零
      continue;
    }
    const entryMatch = line.match(/^\d+[.、]/);
    if (entryMatch) entryIndex = Number(entryMatch[0].slice(0, -1)) - 1;
    const weight = (BLOCK_WEIGHT[block] ?? 0.8) * positionDecay(entryIndex);

    for (const kw of DICTIONARY) {
      const hits = kw.aliases.reduce((sum, a) => sum + countOccurrences(line, a), 0);
      if (hits === 0) continue;
      scoreMap.set(kw.term, (scoreMap.get(kw.term) ?? 0) + hits * weight);
      countMap.set(kw.term, (countMap.get(kw.term) ?? 0) + hits);
    }
  }

  return DICTIONARY.map((kw) => ({
    ...kw,
    score: Math.round((scoreMap.get(kw.term) ?? 0) * 100) / 100,
    hits: countMap.get(kw.term) ?? 0,
  })).sort((a, b) => b.score - a.score);
}

// ---------------- 演示与断言 ----------------

function main(): void {
  console.log("===== 1. 能力权重表（加权分 = 频次 × 板块权重 × 位置衰减） =====");
  const rows = analyze(JD_TEXT);
  rows.forEach((r, i) => {
    console.log(
      `${String(i + 1).padStart(2)}. ${r.term} ［${r.category}］ 加权分 ${r.score.toFixed(2)} 命中 ${r.hits} 次 → ${r.chapter}`,
    );
  });

  console.log("\n===== 2. 位置权重演示：同样的词，位置不同分值不同 =====");
  // 「埋点体系」在【岗位职责】第 3 条命中 3 次，实际贡献如下；若挪到【加分项】第 3 条则显著缩水
  const dutyScore = 3 * BLOCK_WEIGHT["岗位职责"] * positionDecay(2);
  const plusScore = 3 * BLOCK_WEIGHT["加分项"] * positionDecay(2);
  console.log(
    `「埋点」×3 次：岗位职责第 3 条得 ${dutyScore.toFixed(2)} 分，加分项第 3 条仅得 ${plusScore.toFixed(2)} 分——位置即诚意`,
  );
  assert(Math.abs(dutyScore / plusScore - 2) < 1e-9, "同位置下岗位职责权重应是加分项的 2 倍");

  console.log("\n===== 3. 缺口建议 =====");
  const hard = rows.filter((r) => r.category === "硬性要求" && r.score >= 2);
  console.log(`硬性要求中加权分 ≥ 2.0 的共 ${hard.length} 项，必须各准备一个 STAR 故事（见 76.3）：`);
  hard.forEach((r) => console.log(`  · ${r.term}（${r.score.toFixed(2)} 分）→ 补课：${r.chapter}`));
  const plus = rows.filter((r) => r.category === "加分项" && r.hits > 0);
  console.log(`加分项命中 ${plus.length} 项，是区分度来源，至少能讲清「是什么 + 为什么」：`);
  plus.forEach((r) => console.log(`  · ${r.term} → ${r.chapter}`));
  const missed = rows.filter((r) => r.hits === 0);
  missed.forEach((r) => console.log(`  · 「${r.term}」全文未命中：${r.chapter}`));

  // ---- 硬断言：结果可信的五条不变式 ----
  const top = rows[0];
  assert(top.term === "协同办公" && top.score > 8, "领域词总分应最高——业务匹配是隐性门槛");
  for (let i = 1; i < rows.length; i++) {
    assert(rows[i - 1].score >= rows[i].score, "权重表必须严格降序");
  }
  const tracking = rows.find((r) => r.term === "埋点体系")!;
  const rust = rows.find((r) => r.term === "Rust")!;
  assert(tracking.hits === 8, `「埋点体系」应命中 8 次，实际 ${tracking.hits}`);
  assert(rust.score < tracking.score, "加分项词不应压过岗位职责高频词");
  assert(rows.filter((r) => r.category === "硬性要求").every((r) => r.chapter.length > 0), "硬性要求必须全部有补课分册");
  const again = analyze(JD_TEXT);
  assert(JSON.stringify(again) === JSON.stringify(rows), "同一 JD 两次打分必须完全一致（确定性）");

  console.log("\n✅ 拆解完成：13 个跟踪词命中 12 个，硬性要求全部映射到分册（69~75 册 + 03/04/34 册）");
  console.log("下一步：加权分 ≥ 2.0 的关键词各准备一个 STAR 故事（见 76.3），90 秒自我介绍按权重从高到低排序");
}

main();

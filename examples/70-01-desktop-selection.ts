// 文件: examples/70-01-desktop-selection.ts —— 桌面端技术选型决策器：加权打分 + 理由生成

/** 六个评估维度：包体积 / 内存 / 生态复用 / 系统能力 / 团队栈匹配 / 跨端一致性 */
type Dimension = "bundle" | "memory" | "ecosystem" | "systemApi" | "teamFit" | "crossPlatform";

type Candidate = "electron" | "tauri" | "webview2" | "cef";

interface TeamProfile {
  teamStack: "react-ts" | "vue-ts" | "rust" | "csharp" | "cpp";
  bundleBudgetMB: number; // 安装包体积预算
  needDeepSystemApi: boolean; // 是否需要深度系统能力（驱动/串口/内核级）
  needCrossPlatform: boolean; // 是否需要 macOS + Windows + Linux 三端一致
  isIntranetOnly: boolean; // 政企内网封闭分发（无应用商店、无自动更新）
}

const DIMENSION_LABEL: Record<Dimension, string> = {
  bundle: "包体积",
  memory: "内存占用",
  ecosystem: "前端生态复用",
  systemApi: "系统能力深度",
  teamFit: "团队栈匹配",
  crossPlatform: "跨端一致性",
};

const CANDIDATE_LABEL: Record<Candidate, string> = {
  electron: "Electron",
  tauri: "Tauri",
  webview2: "WebView2",
  cef: "CEF",
};

/** 静态能力分（1~5，越高越好）：团队栈匹配维度除外，它由 teamStack 动态决定 */
const STATIC_SCORES: Record<Candidate, Record<Exclude<Dimension, "teamFit">, number>> = {
  electron: { bundle: 1, memory: 2, ecosystem: 5, systemApi: 4, crossPlatform: 5 },
  tauri: { bundle: 5, memory: 4, ecosystem: 4, systemApi: 5, crossPlatform: 3 },
  webview2: { bundle: 5, memory: 4, ecosystem: 4, systemApi: 3, crossPlatform: 1 },
  cef: { bundle: 2, memory: 2, ecosystem: 3, systemApi: 5, crossPlatform: 4 },
};

/** 团队栈匹配分：栈与候选方案的原生语言越接近分越高 */
function teamFitScore(candidate: Candidate, stack: TeamProfile["teamStack"]): number {
  const table: Record<Candidate, Record<TeamProfile["teamStack"], number>> = {
    electron: { "react-ts": 5, "vue-ts": 5, rust: 3, csharp: 2, cpp: 2 },
    tauri: { "react-ts": 3, "vue-ts": 3, rust: 5, csharp: 2, cpp: 3 },
    webview2: { "react-ts": 3, "vue-ts": 3, rust: 1, csharp: 5, cpp: 2 },
    cef: { "react-ts": 2, "vue-ts": 2, rust: 2, csharp: 3, cpp: 5 },
  };
  return table[candidate][stack];
}

/** 由团队画像推导各维度权重（1~3，越大越看重） */
function deriveWeights(p: TeamProfile): Record<Dimension, number> {
  return {
    bundle: p.bundleBudgetMB <= 30 ? 3 : p.bundleBudgetMB <= 100 ? 2 : 1,
    memory: p.isIntranetOnly ? 2 : 1, // 内网老机器多，内存敏感
    ecosystem: p.teamStack === "react-ts" || p.teamStack === "vue-ts" ? 3 : 1,
    systemApi: p.needDeepSystemApi ? 3 : 1,
    teamFit: 2, // 团队栈永远是重要约束：学习成本直接折算成排期
    crossPlatform: p.needCrossPlatform ? 3 : 1,
  };
}

interface ScoreRow {
  candidate: Candidate;
  total: number;
  detail: Record<Dimension, number>;
}

function evaluate(p: TeamProfile): ScoreRow[] {
  const weights = deriveWeights(p);
  const candidates: Candidate[] = ["electron", "tauri", "webview2", "cef"];
  const rows = candidates.map((candidate) => {
    const detail: Record<Dimension, number> = {
      ...STATIC_SCORES[candidate],
      teamFit: teamFitScore(candidate, p.teamStack),
    };
    // 硬约束：要求跨端但候选只能跑 Windows → 跨端一致性维度直接 0 分（已在静态分体现），
    // 且总分额外打折，避免「总分高但硬约束不满足」的假象
    let total = (Object.keys(weights) as Dimension[]).reduce(
      (sum, d) => sum + weights[d] * detail[d],
      0,
    );
    if (p.needCrossPlatform && candidate === "webview2") total = Math.round(total * 0.5);
    return { candidate, total, detail };
  });
  return rows.sort((a, b) => b.total - a.total);
}

/** 生成推荐理由：找出冠军领先亚军最多的两个维度 */
function explainWinner(rows: ScoreRow[]): string[] {
  const [winner, runnerUp] = rows;
  const dims = (Object.keys(DIMENSION_LABEL) as Dimension[])
    .map((d) => ({ d, gap: winner.detail[d] - runnerUp.detail[d] }))
    .filter((x) => x.gap > 0)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 2);
  return dims.map(
    (x) =>
      `${DIMENSION_LABEL[x.d]}（${CANDIDATE_LABEL[winner.candidate]} ${winner.detail[x.d]} 分 vs ${CANDIDATE_LABEL[runnerUp.candidate]} ${runnerUp.detail[x.d]} 分）`,
  );
}

function report(name: string, p: TeamProfile): Candidate {
  const rows = evaluate(p);
  console.log(`\n=== 场景 ${name} ===`);
  for (const r of rows) {
    console.log(`  ${CANDIDATE_LABEL[r.candidate].padEnd(9)} 加权总分 ${r.total}`);
  }
  const reasons = explainWinner(rows);
  console.log(
    `  → 推荐 ${CANDIDATE_LABEL[rows[0].candidate]}，关键优势：${reasons.join("；") || "总分领先"}`,
  );
  return rows[0].candidate;
}

/** ============ 三个典型团队画像的选型演示 ============ */
export function runSelectionDemo() {
  // 场景 A：前端团队 + 三端一致 + 体积不敏感 → 应选 Electron
  const a = report("A：React 团队 / 跨三端 / 办公套件 / 体积预算 200MB", {
    teamStack: "react-ts",
    bundleBudgetMB: 200,
    needDeepSystemApi: false,
    needCrossPlatform: true,
    isIntranetOnly: false,
  });
  console.assert(a === "electron", `场景 A 应推荐 electron，实际 ${a}`);

  // 场景 B：有 Rust 能力 + 体积预算 20MB + 跨端 → 应选 Tauri
  const b = report("B：Rust+TS 团队 / 跨端 / 轻量 IM 工具 / 体积预算 20MB", {
    teamStack: "rust",
    bundleBudgetMB: 20,
    needDeepSystemApi: true,
    needCrossPlatform: true,
    isIntranetOnly: false,
  });
  console.assert(b === "tauri", `场景 B 应推荐 tauri，实际 ${b}`);

  // 场景 C：C# 团队 + 政企内网 Windows 专用 + 体积敏感 → 应选 WebView2
  const c = report("C：C# 团队 / 仅 Windows / 政企内网 / 体积预算 15MB", {
    teamStack: "csharp",
    bundleBudgetMB: 15,
    needDeepSystemApi: false,
    needCrossPlatform: false,
    isIntranetOnly: true,
  });
  console.assert(c === "webview2", `场景 C 应推荐 webview2，实际 ${c}`);

  console.log("\n✅ 桌面端选型决策器三个场景全部命中预期");
}

runSelectionDemo();

/** 66-01-dependency-admission.ts —— 依赖准入评分器：下载量/维护活跃度/许可证/安装脚本/依赖深度 */

type License = "permissive" | "unknown" | "copyleft";

interface Candidate {
  name: string;
  weeklyDownloads: number;
  daysSinceLastPublish: number;
  maintainers: number;
  license: License;
  hasInstallScript: boolean;
  transitiveDeps: number;
  hasTypes: boolean;
  deprecated: boolean;
}

type Decision = "approve" | "review" | "reject";

interface Assessment {
  name: string;
  score: number; // 0-100,越高风险越大
  decision: Decision;
  reasons: string[];
}

/**
 * 风险评分：每项只回答「最坏会怎样」——
 * 下载量低 = 无人审计你的代码；长期不发布 = 维护者可能已离场；
 * 安装脚本 = npm install 就是一次任意代码执行；依赖深 = 漏洞通过传递依赖进来。
 * 权重可由团队调整，但判定顺序（硬门槛优先）不应改变。
 */
function assess(c: Candidate): Assessment {
  const reasons: string[] = [];
  let score = 0;

  // 1) 生态验证：下载量
  if (c.weeklyDownloads < 10_000) {
    score += 25;
    reasons.push(`周下载量 ${c.weeklyDownloads} < 1 万,缺少足够的使用者审计`);
  } else if (c.weeklyDownloads < 100_000) {
    score += 12;
    reasons.push(`周下载量 ${c.weeklyDownloads} < 10 万,生态验证有限`);
  } else if (c.weeklyDownloads < 1_000_000) {
    score += 5;
  }

  // 2) 维护活跃度：最后一次发布距今
  if (c.daysSinceLastPublish > 730) {
    score += 25;
    reasons.push(`超过 ${c.daysSinceLastPublish} 天未发布,维护者可能已离场`);
  } else if (c.daysSinceLastPublish > 365) {
    score += 15;
    reasons.push(`超过一年未发布(${c.daysSinceLastPublish} 天)`);
  } else if (c.daysSinceLastPublish > 180) {
    score += 8;
  }

  // 3) 维护者数量：单维护者 = 单点风险
  if (c.maintainers === 1) {
    score += 12;
    reasons.push("仅 1 位维护者,存在单点风险");
  } else if (c.maintainers === 2) {
    score += 5;
  }

  // 4) 许可证：copyleft 不一定是问题,但必须法务确认使用场景
  if (c.license === "unknown") {
    score += 10;
    reasons.push("许可证未知,无法确认商用授权");
  } else if (c.license === "copyleft") {
    score += 20;
    reasons.push("copyleft 许可证,需法务确认分发方式");
  }

  // 5) 安装脚本：npm install 阶段即可执行任意代码
  if (c.hasInstallScript) {
    score += 15;
    reasons.push("含 install/postinstall 脚本,安装即执行任意代码");
  }

  // 6) 依赖深度：传递依赖越多,漏洞暴露面越大
  if (c.transitiveDeps > 10) {
    score += 15;
    reasons.push(`传递依赖 ${c.transitiveDeps} 个,攻击面过大`);
  } else if (c.transitiveDeps > 3) {
    score += 8;
  }

  // 7) 类型与废弃状态
  if (!c.hasTypes) score += 5;
  if (c.deprecated) {
    score += 30;
    reasons.push("包已废弃,官方已声明不再维护");
  }

  score = Math.min(100, score);

  let decision: Decision = score <= 20 ? "approve" : score <= 45 ? "review" : "reject";

  // 硬门槛覆盖分数：安装脚本必须人工复核；废弃包直接拒绝；
  // copyleft 至少走法务评审——分数低不代表这几项可以放过。
  if (c.hasInstallScript && decision === "approve") {
    decision = "review";
    reasons.push("硬门槛:安装脚本必须人工复核");
  }
  if (c.license === "copyleft" && decision === "approve") {
    decision = "review";
    reasons.push("硬门槛:copyleft 需法务评审");
  }
  if (c.deprecated) {
    decision = "reject";
    reasons.push("硬门槛:废弃包不得进入新项目");
  }

  return { name: c.name, score, decision, reasons };
}

// ---- 断言 ----
const trusted = assess({
  name: "axios",
  weeklyDownloads: 50_000_000,
  daysSinceLastPublish: 30,
  maintainers: 5,
  license: "permissive",
  hasInstallScript: false,
  transitiveDeps: 2,
  hasTypes: true,
  deprecated: false,
});
console.assert(trusted.score === 0 && trusted.decision === "approve", "主流活跃库直接批准");

const borderline = assess({
  name: "small-utils",
  weeklyDownloads: 500_000,
  daysSinceLastPublish: 400,
  maintainers: 2,
  license: "permissive",
  hasInstallScript: false,
  transitiveDeps: 5,
  hasTypes: true,
  deprecated: false,
});
console.assert(borderline.score === 33 && borderline.decision === "review", "中风险走人工评审");
console.assert(
  borderline.reasons.some((r) => r.includes("一年未发布")),
  "评审理由包含维护活跃度",
);

const risky = assess({
  name: "mystery-pkg",
  weeklyDownloads: 5_000,
  daysSinceLastPublish: 900,
  maintainers: 1,
  license: "unknown",
  hasInstallScript: true,
  transitiveDeps: 30,
  hasTypes: false,
  deprecated: false,
});
console.assert(risky.score === 100 && risky.decision === "reject", "极低信任度包被拒绝");
console.assert(risky.reasons.length >= 5, "拒绝需给出完整理由链");

const installScript = assess({
  name: "native-addon",
  weeklyDownloads: 2_000_000,
  daysSinceLastPublish: 60,
  maintainers: 4,
  license: "permissive",
  hasInstallScript: true,
  transitiveDeps: 2,
  hasTypes: true,
  deprecated: false,
});
console.assert(
  installScript.score === 15 && installScript.decision === "review",
  "安装脚本硬门槛强制人工复核",
);

const deprecated = assess({
  name: "legacy-lib",
  weeklyDownloads: 3_000_000,
  daysSinceLastPublish: 200,
  maintainers: 3,
  license: "permissive",
  hasInstallScript: false,
  transitiveDeps: 2,
  hasTypes: true,
  deprecated: true,
});
console.assert(deprecated.score === 38 && deprecated.decision === "reject", "废弃包一票否决");

const copyleft = assess({
  name: "gpl-widget",
  weeklyDownloads: 800_000,
  daysSinceLastPublish: 100,
  maintainers: 3,
  license: "copyleft",
  hasInstallScript: false,
  transitiveDeps: 1,
  hasTypes: true,
  deprecated: false,
});
console.assert(copyleft.score === 25 && copyleft.decision === "review", "copyleft 需法务评审");

console.log("✅ 依赖准入评分 / 硬门槛覆盖 / 决策分级全部通过");

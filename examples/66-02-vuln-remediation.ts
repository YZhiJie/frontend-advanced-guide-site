/** 66-02-vuln-remediation.ts —— 高危漏洞定级与修复路径决策：有效严重度、SLA、处置动作 */

type Severity = "low" | "medium" | "high" | "critical";
type RuntimeEnv = "runtime" | "build" | "dev";
type Exploit = "active" | "poc" | "none";
type FixType = "patch" | "minor" | "major" | "none";
type Action = "upgrade" | "override" | "patch" | "replace" | "isolate" | "accept";

interface Finding {
  id: string;
  pkg: string;
  declared: Severity;
  env: RuntimeEnv; // 漏洞代码在运行时、构建期还是开发依赖中
  reachable: boolean; // 业务代码是否真的走到漏洞代码路径
  exposure: "public" | "internal" | "none"; // 服务暴露面
  exploit: Exploit; // 公开利用成熟度
  direct: boolean; // 直接依赖 or 传递依赖
  patchAvailable: boolean;
  fixType: FixType;
  canReplace: boolean; // 是否有可替代库
  businessCritical: boolean; // 所在业务是否核心链路
}

interface Plan {
  id: string;
  declared: Severity;
  effective: Severity;
  slaHours: number; // 修复 SLA（小时）
  mitigationHours: number | null; // 止血时限（仅 critical/high）
  deadline: string;
  action: Action;
  requiresApproval: boolean;
  steps: string[];
}

const ORDER: Severity[] = ["low", "medium", "high", "critical"];
const SLA: Record<Severity, number> = {
  critical: 72,
  high: 24 * 7,
  medium: 24 * 30,
  low: 24 * 90,
};
const MITIGATION: Record<Severity, number | null> = {
  critical: 24,
  high: 72,
  medium: null,
  low: null,
};

function shift(s: Severity, delta: number): Severity {
  const i = ORDER.indexOf(s);
  return ORDER[Math.max(0, Math.min(ORDER.length - 1, i + delta))];
}

/**
 * 有效严重度 ≠ 扫描器报告的 CVSS：
 * - 漏洞代码只在构建期/开发依赖里跑 → 降 2 级（不进入用户浏览器）；
 * - 运行时依赖但业务不可达 → 降 1 级（仍可能在深链路被触发，需留存证据）；
 * - 已有公开活跃利用 → 升 1 级（时效压力优先于理论分值）。
 */
function effectiveSeverity(f: Finding): Severity {
  let s = f.declared;
  if (f.env !== "runtime") s = shift(s, -2);
  else if (!f.reachable) s = shift(s, -1);
  if (f.exploit === "active") s = shift(s, 1);
  return s;
}

/** 修复路径：能升级就不打补丁，能打补丁就不替换，替换成本最高 */
function chooseAction(f: Finding, effective: Severity): Action {
  if (f.patchAvailable) return f.direct ? "upgrade" : "override";
  if (f.env !== "runtime" || !f.reachable) return "accept";
  if (f.canReplace) return "replace";
  return "isolate";
}

function buildSteps(f: Finding, action: Action, effective: Severity): string[] {
  const steps: string[] = [];
  if (effective === "critical" || effective === "high") {
    steps.push("先止血:功能开关/CSP/网关规则/回滚,阻断可达路径,再排修复窗口");
  }
  switch (action) {
    case "upgrade":
      steps.push(
        f.fixType === "major"
          ? "主版本升级:先读 changelog 破坏性变更,建分支跑全量回归,灰度发布"
          : "直接升级到已修复版本,锁定确切版本并提交 lockfile",
      );
      break;
    case "override":
      steps.push("在 pnpm.overrides 中强制传递依赖到已修复版本,检查是否产生重复实例");
      break;
    case "patch":
      steps.push("用 pnpm.patchedDependencies/patch-package 打最小补丁,记录上游 issue 跟踪");
      break;
    case "replace":
      steps.push("替换为维护活跃的替代库,写适配层隔离 API 差异");
      break;
    case "isolate":
      steps.push("隔离/下线受影响功能,评估业务损失并给出恢复条件");
      break;
    case "accept":
      steps.push("风险接受:记录不可达证据、豁免期限与审批人,到期强制复审");
      break;
  }
  steps.push("修复验证:audit/OSV 清零、全量测试、lockfile diff 审查、灰度观察");
  return steps;
}

function plan(f: Finding, createdAt: string): Plan {
  const effective = effectiveSeverity(f);
  const slaHours = SLA[effective];
  const action = chooseAction(f, effective);
  const requiresApproval =
    effective === "critical" ||
    action === "accept" ||
    action === "isolate" ||
    action === "replace" ||
    (action === "upgrade" && f.fixType === "major");
  const deadline = new Date(
    new Date(createdAt).getTime() + slaHours * 3_600_000,
  ).toISOString();
  return {
    id: f.id,
    declared: f.declared,
    effective,
    slaHours,
    mitigationHours: MITIGATION[effective],
    deadline,
    action,
    requiresApproval,
    steps: buildSteps(f, action, effective),
  };
}

const created = "2026-10-01T00:00:00.000Z";

// ---- 断言 ----
// 1) 核心链路、运行时可达、已有活跃利用的 Critical：不降级，72h 修复 + 24h 止血
const p1 = plan(
  {
    id: "GHSA-1",
    pkg: "axios",
    declared: "critical",
    env: "runtime",
    reachable: true,
    exposure: "public",
    exploit: "active",
    direct: true,
    patchAvailable: true,
    fixType: "patch",
    canReplace: true,
    businessCritical: true,
  },
  created,
);
console.assert(p1.effective === "critical" && p1.slaHours === 72, "Critical 运行时可达保持最高级");
console.assert(p1.mitigationHours === 24 && p1.action === "upgrade", "Critical 先止血再升级");
console.assert(p1.requiresApproval && p1.steps.length === 3, "Critical 需审批且步骤完整");
console.assert(p1.deadline === "2026-10-04T00:00:00.000Z", "72h 截止时间精确");

// 2) 仅构建期使用的 High 传递依赖、无补丁：降为 Low，走限时风险接受
const p2 = plan(
  {
    id: "GHSA-2",
    pkg: "build-tool",
    declared: "high",
    env: "build",
    reachable: true,
    exposure: "none",
    exploit: "none",
    direct: false,
    patchAvailable: false,
    fixType: "none",
    canReplace: true,
    businessCritical: false,
  },
  created,
);
console.assert(p2.effective === "low" && p2.slaHours === 24 * 90, "构建期依赖降两级");
console.assert(p2.action === "accept" && p2.requiresApproval, "无补丁且不可达→限时接受");

// 3) 运行时不可达的 Medium 传递依赖、有补丁：降为 Low，用 overrides 修复
const p3 = plan(
  {
    id: "GHSA-3",
    pkg: "transitive-lib",
    declared: "medium",
    env: "runtime",
    reachable: false,
    exposure: "internal",
    exploit: "none",
    direct: false,
    patchAvailable: true,
    fixType: "minor",
    canReplace: false,
    businessCritical: false,
  },
  created,
);
console.assert(p3.effective === "low" && p3.slaHours === 24 * 90, "不可达运行时依赖降一级");
console.assert(p3.action === "override" && !p3.requiresApproval, "传递依赖优先 overrides");

// 4) High 运行时可达、无补丁但有替代库：替换，High SLA 一周
const p4 = plan(
  {
    id: "GHSA-4",
    pkg: "abandoned-lib",
    declared: "high",
    env: "runtime",
    reachable: true,
    exposure: "public",
    exploit: "poc",
    direct: true,
    patchAvailable: false,
    fixType: "none",
    canReplace: true,
    businessCritical: true,
  },
  created,
);
console.assert(p4.effective === "high" && p4.slaHours === 24 * 7, "High 修复 SLA 七天");
console.assert(p4.action === "replace" && p4.requiresApproval, "无补丁优先替换库");

// 5) Low + 活跃利用：时效压力升级一级
const p5 = plan(
  {
    id: "GHSA-5",
    pkg: "low-lib",
    declared: "low",
    env: "runtime",
    reachable: true,
    exposure: "public",
    exploit: "active",
    direct: false,
    patchAvailable: true,
    fixType: "patch",
    canReplace: false,
    businessCritical: false,
  },
  created,
);
console.assert(p5.effective === "medium" && p5.slaHours === 24 * 30, "活跃利用升级一级");

// 6) 主版本升级：必须审批，避免破坏性变更直接上线
const p6 = plan(
  {
    id: "GHSA-6",
    pkg: "ui-kit",
    declared: "high",
    env: "runtime",
    reachable: true,
    exposure: "internal",
    exploit: "none",
    direct: true,
    patchAvailable: true,
    fixType: "major",
    canReplace: false,
    businessCritical: false,
  },
  created,
);
console.assert(p6.action === "upgrade" && p6.requiresApproval, "主版本升级需审批");

console.log("✅ 有效严重度 / SLA / 修复路径决策全部通过");

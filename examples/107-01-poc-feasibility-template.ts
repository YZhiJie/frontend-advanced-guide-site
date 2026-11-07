// 文件: examples/107-01-poc-feasibility-template.ts
// AI 项目 POC 可行性评估：输入调研结果 → 自动评分 → 输出 GO/NO-GO/GILDE

import assert from "node:assert";

interface Input {
  businessTimeSavedPct: number;
  businessErrorReductionPct: number;
  businessUserFeedbackScore: number;
  businessRoiMultiple: number;
  techAccuracy: number;
  techLatencyP95Ms: number;
  techSafetyPassRate: number;
  techDataQuality: number;
  costPerRequestCents: number;
  costDailyRequests: number;
  costBudgetMonthlyCny: number;
  teamAiEngineers: number;
  teamExistingStack: "python" | "node" | "mixed" | "none";
  teamTimelineWeeks: number;
}

interface Rating {
  overall: number; decision: "GO" | "NO-GO" | "GILDE";
  scores: Record<string, number>; blockers: string[]; warnings: string[];
}

function evaluate(i: Input): Rating {
  const blockers: string[] = [], warnings: string[] = [], scores: Record<string, number> = {};
  if (i.techSafetyPassRate < 1) blockers.push("安全拦截率必须 100%");
  if (i.techAccuracy < 0.5) blockers.push("离线准确率低于 50%");
  if (i.businessTimeSavedPct < 5) blockers.push("节省时间不足 5%");

  scores.business = Math.round(
    i.businessTimeSavedPct * 0.3 + i.businessErrorReductionPct * 0.2 +
    i.businessUserFeedbackScore * 10 + Math.min(i.businessRoiMultiple, 5) * 6
  );
  scores.tech = Math.round(
    i.techAccuracy * 60 + Math.max(0, (2000 - i.techLatencyP95Ms) / 2000) * 20 +
    i.techSafetyPassRate * 20
  );
  const monthlyCost = i.costPerRequestCents * i.costDailyRequests * 30 / 100;
  scores.cost = Math.max(0, Math.round(100 - (monthlyCost / i.costBudgetMonthlyCny) * 100));
  scores.team = Math.round(
    Math.min(i.teamAiEngineers, 3) * 20 + (i.teamExistingStack !== "none" ? 40 : 10) +
    Math.max(0, (12 - i.teamTimelineWeeks) / 12) * 40
  );
  const overall = Math.round(scores.business * 0.35 + scores.tech * 0.3 + scores.cost * 0.15 + scores.team * 0.2);

  if (i.techLatencyP95Ms > 3000) warnings.push("延迟超过 3s");
  if (i.techDataQuality < 0.6) warnings.push("数据质量不足 60%");

  const decision: Rating["decision"] = blockers.length ? "NO-GO" :
    overall >= 70 ? "GO" : overall >= 50 ? "GILDE" : "NO-GO";

  return { overall, decision, scores, blockers, warnings };
}

function run() {
  const go = evaluate({
    businessTimeSavedPct: 30, businessErrorReductionPct: 50,
    businessUserFeedbackScore: 4.5, businessRoiMultiple: 3,
    techAccuracy: 0.85, techLatencyP95Ms: 800, techSafetyPassRate: 1.0, techDataQuality: 0.8,
    costPerRequestCents: 0.05, costDailyRequests: 2000, costBudgetMonthlyCny: 5000,
    teamAiEngineers: 2, teamExistingStack: "python", teamTimelineWeeks: 6,
  });
  assert.equal(go.decision, "GO");
  console.log("[1/4] GO 场景 OK:", go.overall);

  const noGo = evaluate({
    businessTimeSavedPct: 5, businessErrorReductionPct: 10,
    businessUserFeedbackScore: 2, businessRoiMultiple: 1,
    techAccuracy: 0.3, techLatencyP95Ms: 4000, techSafetyPassRate: 0.95, techDataQuality: 0.3,
    costPerRequestCents: 0.5, costDailyRequests: 10000, costBudgetMonthlyCny: 500,
    teamAiEngineers: 0, teamExistingStack: "none", teamTimelineWeeks: 16,
  });
  assert.equal(noGo.decision, "NO-GO");
  assert.ok(noGo.blockers.length >= 2);
  console.log("[2/4] NO-GO 场景 OK, 拦截:", noGo.blockers.length);

  const gilde = evaluate({
    businessTimeSavedPct: 15, businessErrorReductionPct: 20,
    businessUserFeedbackScore: 3, businessRoiMultiple: 1.5,
    techAccuracy: 0.7, techLatencyP95Ms: 2500, techSafetyPassRate: 1.0, techDataQuality: 0.5,
    costPerRequestCents: 0.1, costDailyRequests: 500, costBudgetMonthlyCny: 3000,
    teamAiEngineers: 1, teamExistingStack: "node", teamTimelineWeeks: 8,
  });
  assert.ok(["GILDE", "GO"].includes(gilde.decision));
  console.log("[3/4] 灰区场景 OK:", gilde.decision);

  const unsafe = evaluate({
    businessTimeSavedPct: 40, businessErrorReductionPct: 60,
    businessUserFeedbackScore: 5, businessRoiMultiple: 5,
    techAccuracy: 0.9, techLatencyP95Ms: 500, techSafetyPassRate: 0.99, techDataQuality: 1.0,
    costPerRequestCents: 0.01, costDailyRequests: 100000, costBudgetMonthlyCny: 100000,
    teamAiEngineers: 3, teamExistingStack: "python", teamTimelineWeeks: 4,
  });
  assert.equal(unsafe.decision, "NO-GO");
  console.log("[4/4] 安全拦截 OK");

  console.log("✅ 107-01 POC 可行性评估 全部断言通过");
}
try { run(); } catch (e: any) { console.error(e.message); process.exit(1); }

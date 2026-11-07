/**
 * 第 127 部分配套：CI/CD 流水线规划与校验器
 * JD 需求点：能设计「并行矩阵 → 单次构建 → 制品传递 → 审批 → 部署 → 冒烟 → 失败回滚」
 *   的流水线，并说清每个阶段为什么存在、串行/并行带来的实际墙钟时间。
 * 本示例：
 *   1) DAG 校验（未知依赖、环、孤儿）
 *   2) 发布闸门（生产必须审批 + OIDC + 冒烟 + 回滚）
 *   3) 制品契约（谁产出 dist、谁消费 dist）
 *   4) 并行矩阵下的关键路径与墙钟时间
 *   5) GitHub Actions 与 GitLab CI 的阶段等价映射
 * 运行：npx tsx examples/127-07-ci-pipeline-planner.ts
 */
import assert from "node:assert";

type Stage = "verify" | "build" | "deploy-staging" | "smoke-staging" | "deploy-prod" | "smoke-prod" | "rollback";

interface Job {
  id: string;
  stage: Stage;
  needs: string[];
  durationSec: number;
  /** 矩阵并行份数：墙钟仍按单份算，但资源占用翻倍 */
  matrix?: number;
  cache?: boolean;
  environment?: "staging" | "production";
  /** 需要 OIDC/云凭证的作业 */
  cloud?: boolean;
  produces?: string[];
  consumes?: string[];
}

interface Pipeline {
  jobs: Job[];
  permissions: { idToken: boolean };
  rollbackDefined: boolean;
}

function validate(p: Pipeline): string[] {
  const errors: string[] = [];
  const ids = new Set(p.jobs.map((j) => j.id));
  if (ids.size !== p.jobs.length) errors.push("作业 id 重复");

  for (const j of p.jobs) {
    for (const n of j.needs) {
      if (!ids.has(n)) errors.push(`${j.id} 依赖不存在的作业 ${n}`);
    }
  }

  // 环检测
  const state = new Map<string, 0 | 1 | 2>();
  const byId = new Map(p.jobs.map((j) => [j.id, j]));
  const dfs = (id: string): boolean => {
    const s = state.get(id) ?? 0;
    if (s === 1) return true;
    if (s === 2) return false;
    state.set(id, 1);
    for (const n of byId.get(id)?.needs ?? []) if (dfs(n)) return true;
    state.set(id, 2);
    return false;
  };
  for (const j of p.jobs) if (dfs(j.id)) {
    errors.push(`依赖环：${j.id} 及其上游形成闭环`);
    break;
  }

  const prodDeploy = p.jobs.find((j) => j.stage === "deploy-prod");
  if (!prodDeploy) errors.push("缺少生产部署作业");
  else {
    if (prodDeploy.environment !== "production") errors.push("生产部署必须绑定 production environment（审批闸门）");
    if (!prodDeploy.needs.some((n) => byId.get(n)?.stage === "smoke-staging")) {
      errors.push("生产部署前必须先通过 staging 冒烟");
    }
  }
  if (!p.permissions.idToken) errors.push("缺少 id-token: write，OIDC 无法换取云凭证");
  if (!p.jobs.some((j) => j.id === "rollback" && j.stage === "rollback")) {
    errors.push("缺少回滚作业");
  }
  if (!p.rollbackDefined) errors.push("回滚路径未定义（没有可恢复的上一版本指针）");

  // 制品契约
  const producers = new Map<string, string[]>();
  for (const j of p.jobs) for (const a of j.produces ?? []) producers.set(a, [...(producers.get(a) ?? []), j.id]);
  for (const j of p.jobs) for (const a of j.consumes ?? []) {
    if (!producers.has(a)) errors.push(`${j.id} 消费制品 ${a}，但没有作业产出它`);
    else if (!j.needs.some((n) => producers.get(a)!.includes(n))) {
      errors.push(`${j.id} 消费 ${a} 但未依赖产出它的作业`);
    }
  }

  // 云凭证只应出现在部署阶段，避免 verify 阶段拿到发布权限
  for (const j of p.jobs) {
    if (j.cloud && j.stage === "verify") errors.push(`${j.id} 在 verify 阶段申请云凭证，权限过大`);
  }

  return errors;
}

function topoOrder(p: Pipeline): string[] {
  const byId = new Map(p.jobs.map((j) => [j.id, j]));
  const done = new Set<string>();
  const order: string[] = [];
  while (order.length < p.jobs.length) {
    const ready = p.jobs
      .filter((j) => !done.has(j.id) && j.needs.every((n) => done.has(n)))
      .map((j) => j.id)
      .sort();
    assert(ready.length > 0, "无法拓扑排序：存在环或未知依赖");
    for (const id of ready) {
      order.push(id);
      done.add(id);
    }
  }
  assert(order.length === p.jobs.length);
  return order;
}

/** 关键路径：每个作业最早结束时间 = max(上游结束) + 自身时长 */
function wallClock(p: Pipeline): { totalSec: number; path: string[] } {
  const byId = new Map(p.jobs.map((j) => [j.id, j]));
  const finish = new Map<string, number>();
  const prev = new Map<string, string | null>();
  for (const id of topoOrder(p)) {
    const j = byId.get(id)!;
    const start = Math.max(0, ...j.needs.map((n) => finish.get(n) ?? 0));
    finish.set(id, start + j.durationSec);
    prev.set(id, j.needs.length ? j.needs.reduce((a, b) => ((finish.get(a) ?? 0) >= (finish.get(b) ?? 0) ? a : b)) : null);
  }
  let end = "";
  let max = 0;
  for (const [id, t] of finish) if (t > max) { max = t; end = id; }
  const path: string[] = [];
  let cur: string | null = end;
  while (cur) { path.unshift(cur); cur = prev.get(cur) ?? null; }
  return { totalSec: max, path };
}

function stageDurations(p: Pipeline): Record<string, number> {
  const out: Record<string, number> = {};
  for (const j of p.jobs) out[j.stage] = (out[j.stage] ?? 0) + j.durationSec;
  return out;
}

const HAPPY: Pipeline = {
  permissions: { idToken: true },
  rollbackDefined: true,
  jobs: [
    { id: "verify", stage: "verify", needs: [], durationSec: 90, matrix: 2, cache: true },
    { id: "build", stage: "build", needs: ["verify"], durationSec: 120, cache: true, produces: ["dist"] },
    {
      id: "deploy-staging",
      stage: "deploy-staging",
      needs: ["build"],
      durationSec: 45,
      consumes: ["dist"],
      environment: "staging",
      cloud: true,
    },
    { id: "smoke-staging", stage: "smoke-staging", needs: ["deploy-staging"], durationSec: 30 },
    {
      id: "deploy-prod",
      stage: "deploy-prod",
      // 显式依赖 build：部署下载的是 build 的制品，审计时不能只看传递依赖
      needs: ["smoke-staging", "build"],
      durationSec: 60,
      consumes: ["dist"],
      environment: "production",
      cloud: true,
    },
    { id: "smoke-prod", stage: "smoke-prod", needs: ["deploy-prod"], durationSec: 30 },
    // 回滚只在失败分支触发；这里挂在 deploy-prod 之后，用于预留「最坏情况」的时间预算
    { id: "rollback", stage: "rollback", needs: ["deploy-prod"], durationSec: 20, cloud: true },
  ],
};

// ===================== 运行断言 =====================
console.log("===== 1. 理想流水线零错误 =====");
assert.deepStrictEqual(validate(HAPPY), [], `理想流水线不应有错误：${validate(HAPPY).join("; ")}`);
console.log(`✓ ${HAPPY.jobs.length} 个作业全部通过闸门校验`);

console.log("\n===== 2. 拓扑顺序与墙钟时间 =====");
const order = topoOrder(HAPPY);
assert.strictEqual(order[0], "verify");
assert(order.indexOf("build") < order.indexOf("deploy-staging"));
assert(order.indexOf("smoke-staging") < order.indexOf("deploy-prod"));
const wall = wallClock(HAPPY);
// 90 + 120 + 45 + 30 + 60 + 30 = 375；矩阵 2 份并行不改变墙钟，
// 回滚分支 90+120+45+30+60+20=365 短于冒烟分支，不构成关键路径
assert.strictEqual(wall.totalSec, 375, `关键路径应为 375s，实际 ${wall.totalSec}`);
assert.deepStrictEqual(wall.path, ["verify", "build", "deploy-staging", "smoke-staging", "deploy-prod", "smoke-prod"]);
console.log(`✓ 关键路径 ${wall.path.join(" → ")} = ${wall.totalSec}s`);
console.log(`✓ 各阶段累计时长：${JSON.stringify(stageDurations(HAPPY))}`);

console.log("\n===== 3. 逐项破坏，必须被拦截 =====");
const noSmoke: Pipeline = {
  ...HAPPY,
  jobs: HAPPY.jobs
    .filter((j) => j.id !== "smoke-staging")
    .map((j) => ({ ...j, needs: j.needs.filter((n) => n !== "smoke-staging") })),
};
assert(validate(noSmoke).some((e) => e.includes("staging 冒烟")), "绕过 staging 冒烟必须被拦截");

const noApproval: Pipeline = {
  ...HAPPY,
  jobs: HAPPY.jobs.map((j) => (j.id === "deploy-prod" ? { ...j, environment: undefined } : j)),
};
assert(validate(noApproval).some((e) => e.includes("production environment")), "生产部署缺审批必须被拦截");

const noOidc: Pipeline = { ...HAPPY, permissions: { idToken: false } };
assert(validate(noOidc).some((e) => e.includes("id-token")), "缺 OIDC 权限必须被拦截");

const cloudInVerify: Pipeline = {
  ...HAPPY,
  jobs: HAPPY.jobs.map((j) => (j.id === "verify" ? { ...j, cloud: true } : j)),
};
assert(validate(cloudInVerify).some((e) => e.includes("权限过大")), "verify 阶段申请云凭证必须被拦截");

const noArtifactProducer: Pipeline = {
  ...HAPPY,
  jobs: HAPPY.jobs.map((j) => (j.id === "build" ? { ...j, produces: [] } : j)),
};
assert(
  validate(noArtifactProducer).some((e) => e.includes("dist")),
  "制品没有生产者必须被拦截",
);

const cyclic: Pipeline = {
  ...HAPPY,
  jobs: HAPPY.jobs.map((j) =>
    j.id === "verify" ? { ...j, needs: ["rollback"] } : j,
  ),
};
assert(validate(cyclic).some((e) => e.includes("环")), "依赖环必须被拦截");

console.log("✓ 冒烟缺失 / 审批缺失 / OIDC 缺失 / 权限越界 / 制品断链 / 依赖环 全部命中");

console.log("\n===== 4. 并行矩阵不缩短关键路径，但会放大资源占用 =====");
const serial: Pipeline = {
  ...HAPPY,
  jobs: HAPPY.jobs.map((j) => (j.matrix && j.matrix > 1 ? { ...j, durationSec: j.durationSec * j.matrix } : j)),
};
assert(
  wallClock(serial).totalSec > wall.totalSec,
  "把矩阵误写成串行会拉长墙钟时间",
);
assert(
  wallClock(HAPPY).totalSec < wallClock(serial).totalSec,
  "并行矩阵应比串行更快",
);
console.log(`✓ 并行 ${wall.totalSec}s < 串行 ${wallClock(serial).totalSec}s`);

console.log("\n===== 5. GitHub Actions 与 GitLab CI 阶段等价 =====");
const githubJobs = HAPPY.jobs.map((j) => j.stage);
const gitlabStages = ["verify", "build", "deploy-staging", "smoke-staging", "deploy-prod", "smoke-prod", "rollback"];
assert.deepStrictEqual(
  [...new Set(githubJobs)],
  gitlabStages,
  "两个平台的阶段划分应一一对应，迁移时不改变发布语义",
);
assert.strictEqual(new Set(gitlabStages).size, gitlabStages.length, "GitLab stage 不能重名");
console.log(`✓ 7 个阶段在 GitHub Actions 与 GitLab CI 中语义一致`);

console.log("\n✅ CI/CD 规划：DAG + 闸门 + 制品 + 关键路径 + 跨平台等价全部通过");

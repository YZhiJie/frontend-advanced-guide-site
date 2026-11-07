// 文件: examples/47-04-leak-response.ts
// ============ 密钥泄漏应急响应:检测 → 撤销 → 轮换 → 清史 → 审计 ============
// 设计要点:
// 1) 发现密钥进了 git 历史,「删掉重新提交」毫无意义——历史里还在,必须当作「已泄漏」处置;
// 2) 应急顺序有讲究:先撤销/轮换(止血)再清史(整容),顺序反了等于裸奔期间没人管;
// 3) 轮换用「双密钥并行期」:新旧同时有效 → 全部调用方切到新 → 回收旧,避免硬切换造成线上中断;
// 4) 每一步带 owner 与验收标准,处置单可审计、可复盘。

/** 硬断言:不满足即非零退出,让 CI 门禁能真的拦截 */
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

// ---------------- 1. 泄漏定级:key 类型决定影响面与应急等级 ----------------

type KeyKind = "cloud-ak" | "payment" | "repo-token" | "user-jwt";

interface LeakEvent {
  kind: KeyKind;
  leakedAt: string; // 进入 git 历史的时间
  foundAt: string; // 扫描发现的时间
  exposureHours: number; // 暴露时长 = 影响面评估输入
}

const IMPACT: Record<KeyKind, { level: "P0" | "P1"; canDo: string }> = {
  "cloud-ak": { level: "P0", canDo: "调用云 API:拖库、开矿、删资源" },
  payment: { level: "P0", canDo: "发起交易/退款:直接资金损失" },
  "repo-token": { level: "P1", canDo: "读私有仓库、投毒代码" },
  "user-jwt": { level: "P1", canDo: "有效期内冒充用户" },
};

function classify(event: LeakEvent) {
  const { level, canDo } = IMPACT[event.kind];
  return { level, canDo, urgent: event.exposureHours > 0 }; // 已入史即视为已泄漏
}

// ---------------- 2. 处置单生成:四步硬顺序 + 每步可验收 ----------------

interface Action {
  step: string;
  owner: string;
  acceptance: string; // 验收标准:怎么算做完
}

function buildPlan(event: LeakEvent): Action[] {
  const info = classify(event);
  console.log(
    `✓ 1. 定级 ${info.level}:暴露 ${event.exposureHours}h,影响面——${info.canDo}`,
  );
  return [
    {
      step: "撤销/禁用旧密钥",
      owner: "密钥 Owner",
      acceptance: "用旧密钥调用返回 401/403",
    },
    {
      step: "签发新密钥并全量轮换",
      owner: "密钥 Owner + 各调用方",
      acceptance: "线上监控 0 条旧密钥调用记录",
    },
    {
      step: "清洗 git 历史(filter-repo/BFG)",
      owner: "仓库管理员",
      acceptance: "全分支 grep 不到密钥,协作者强制重克隆",
    },
    {
      step: "审计与复盘",
      owner: "安全 + 当事团队",
      acceptance: "调用日志无异常请求;复盘报告归档,流程补丁落地",
    },
  ];
}

const event: LeakEvent = {
  kind: "cloud-ak",
  leakedAt: "2026-10-20 14:00",
  foundAt: "2026-10-22 09:30",
  exposureHours: 43.5,
};
const plan = buildPlan(event);
plan.forEach((a, i) =>
  console.log(`  ${i + 1}. [${a.owner}] ${a.step} → 验收:${a.acceptance}`),
);

// 止血必须排在整容前面
assert(
  plan[0]!.step.includes("撤销") && plan[2]!.step.includes("清洗"),
  "顺序铁律:先撤销轮换止血,再清洗历史",
);
assert(
  plan.every((a) => a.owner && a.acceptance),
  "每步必须有 owner 与验收标准",
);

// ---------------- 3. 双密钥并行轮换:不停机切换状态机 ----------------

type RotationState = "old-only" | "dual-active" | "new-only" | "old-revoked";

const FLOW: Record<RotationState, RotationState> = {
  "old-only": "dual-active", // 签发新密钥,新旧并行
  "dual-active": "new-only", // 调用方全部切到新后,旧密钥转拒
  "new-only": "old-revoked", // 观察期无旧密钥调用后,彻底吊销
  "old-revoked": "old-revoked",
};
const nextState = (s: RotationState): RotationState => FLOW[s];

const trail: RotationState[] = ["old-only"];
while (trail[trail.length - 1] !== "old-revoked") {
  trail.push(nextState(trail[trail.length - 1]!));
}
console.log("✓ 2. 轮换状态机:", trail.join(" → "));
assert(
  trail.join(",") === "old-only,dual-active,new-only,old-revoked",
  "轮换必须经双密钥并行期,不允许硬切换",
);

// 并行期内新旧都可调,进入 new-only 后旧密钥必须被拒
const accept = (state: RotationState, key: "old" | "new") =>
  state === "dual-active" ||
  (state === "old-only" && key === "old") ||
  (state === "new-only" && key === "new");
assert(
  accept("dual-active", "old") && accept("dual-active", "new"),
  "并行期双通",
);
assert(
  !accept("new-only", "old") && accept("new-only", "new"),
  "切换后旧密钥即拒",
);
console.log("✓ 3. 并行期新旧双通,切换后旧密钥即拒——线上零中断");

console.log("\n全部断言通过:泄漏应急与轮换已跑通");

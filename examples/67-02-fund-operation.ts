/** 67-02-fund-operation.ts —— 大额资金操作状态机：审批分级、幂等执行与不可篡改审计轨迹 */

type FundState =
  | "draft"
  | "pending_review"
  | "approved"
  | "executing"
  | "success"
  | "failed"
  | "rejected"
  | "cancelled";

interface Operation {
  id: string;
  amountCents: number;
  applicantId: string;
  state: FundState;
  approvals: { approverId: string; role: "finance" | "compliance"; at: number }[];
  idempotencyKey?: string;
  attempts: number;
  result?: { ok: boolean; transactionId?: string; error?: string };
  trail: { at: number; from: FundState; to: FundState; actor: string; note: string }[];
}

class IllegalTransition extends Error {}

/**
 * 状态机只做三件事:守卫(能不能走)、记录(谁在何时改了什么)、可重放(幂等执行)。
 * 金额越大,需要的审批人越多——这是唯一必须前置硬编码的规则,
 * 其余风控(名单、限额)应在服务端二次校验,前端校验只是体验。
 */
const TRANSITIONS: Record<FundState, FundState[]> = {
  draft: ["pending_review", "cancelled"],
  pending_review: ["approved", "rejected", "cancelled"],
  approved: ["executing", "cancelled"],
  executing: ["success", "failed"],
  failed: ["pending_review", "cancelled"],
  success: [],
  rejected: [],
  cancelled: [],
};

function requiredApprovers(amountCents: number) {
  if (amountCents < 500_000_00) return 1; // < 50 万:一位财务
  if (amountCents < 5_000_000_00) return 2; // 50 万~500 万:两位(含财务)
  return 3; // >= 500 万:三位,且必须含合规岗
}

class FundManager {
  private ops = new Map<string, Operation>();
  private byIdempotencyKey = new Map<string, string>(); // key → opId

  create(id: string, amountCents: number, applicantId: string): Operation {
    if (amountCents <= 0) throw new Error("金额必须为正整数分");
    if (!Number.isInteger(amountCents)) throw new Error("金额必须是整数分,禁止浮点");
    const op: Operation = {
      id,
      amountCents,
      applicantId,
      state: "draft",
      approvals: [],
      attempts: 0,
      trail: [],
    };
    this.ops.set(id, op);
    return op;
  }

  private move(op: Operation, to: FundState, actor: string, note: string) {
    if (!TRANSITIONS[op.state].includes(to)) {
      throw new IllegalTransition(`${op.state} 不允许迁移到 ${to}`);
    }
    op.trail.push({ at: Date.now(), from: op.state, to, actor, note });
    op.state = to;
  }

  submit(id: string, applicantId: string) {
    const op = this.get(id);
    if (applicantId !== op.applicantId) throw new Error("只能由申请人提交");
    this.move(op, "pending_review", applicantId, "提交审批");
  }

  approve(id: string, approverId: string, role: "finance" | "compliance") {
    const op = this.get(id);
    if (approverId === op.applicantId) throw new Error("申请人不得自审自批");
    if (op.state !== "pending_review") throw new IllegalTransition("仅待审状态可审批");
    if (op.approvals.some((a) => a.approverId === approverId)) {
      throw new Error("同一审批人不得重复审批");
    }
    op.approvals.push({ approverId, role, at: Date.now() });

    const need = requiredApprovers(op.amountCents);
    const hasCompliance = op.approvals.some((a) => a.role === "compliance");
    const enough =
      op.approvals.length >= need && (need < 3 || hasCompliance);
    if (enough) this.move(op, "approved", approverId, `${need} 级审批完成`);
  }

  reject(id: string, approverId: string, reason: string) {
    const op = this.get(id);
    this.move(op, "rejected", approverId, `驳回:${reason}`);
  }

  /** 执行:同一幂等键重复调用返回首次结果,绝不重复扣款 */
  execute(id: string, idempotencyKey: string, gateway: (op: Operation) => { ok: boolean; transactionId?: string; error?: string }) {
    const existing = this.byIdempotencyKey.get(idempotencyKey);
    if (existing) {
      const prev = this.get(existing);
      return { replayed: true, state: prev.state, result: prev.result };
    }
    const op = this.get(id);
    if (op.state !== "approved") throw new IllegalTransition("仅审批通过可执行");
    this.byIdempotencyKey.set(idempotencyKey, id);
    op.idempotencyKey = idempotencyKey;
    op.attempts++;
    this.move(op, "executing", "system", `开始执行(第 ${op.attempts} 次)`);
    const result = gateway(op);
    op.result = result;
    this.move(op, result.ok ? "success" : "failed", "gateway", result.ok ? `流水号 ${result.transactionId}` : `失败:${result.error}`);
    return { replayed: false, state: op.state, result };
  }

  get(id: string) {
    const op = this.ops.get(id);
    if (!op) throw new Error(`操作单 ${id} 不存在`);
    return op;
  }
}

// ---- 断言 ----
const mgr = new FundManager();

const small = mgr.create("F-001", 300_000_00, "u-applicant");
mgr.submit("F-001", "u-applicant");
mgr.approve("F-001", "u-finance", "finance");
console.assert(mgr.get("F-001").state === "approved", "50 万以下一位财务即可通过");

const big = mgr.create("F-002", 6_000_000_00, "u-applicant");
mgr.submit("F-002", "u-applicant");
mgr.approve("F-002", "u-finance", "finance");
console.assert(mgr.get("F-002").state === "pending_review", "500 万以上一位审批不足");
mgr.approve("F-002", "u-manager", "finance");
console.assert(mgr.get("F-002").state === "pending_review", "缺合规岗仍不得通过");
mgr.approve("F-002", "u-compliance", "compliance");
console.assert(mgr.get("F-002").state === "approved", "三位含合规岗后通过");

let illegal = false;
try {
  mgr.approve("F-001", "u-applicant", "finance");
} catch (e) {
  illegal = e instanceof Error && e.message.includes("自审自批");
}
console.assert(illegal, "申请人自审自批必须被拒绝");

let duplicate = false;
try {
  mgr.approve("F-001", "u-finance", "finance");
} catch (e) {
  duplicate = e instanceof IllegalTransition;
}
console.assert(duplicate, "已通过的单据不可重复审批");

const pay = (op: Operation) => ({
  ok: true,
  transactionId: `T-${op.id}`,
});
const first = mgr.execute("F-001", "idem-key-a", pay);
const replay = mgr.execute("F-001", "idem-key-a", pay);
console.assert(first.replayed === false && mgr.get("F-001").state === "success", "首次执行成功");
console.assert(
  replay.replayed === true && replay.result?.transactionId === "T-F-001",
  "同一幂等键重放返回首次结果,不再扣款",
);
console.assert(mgr.get("F-001").attempts === 1, "重放不应增加执行次数");

mgr.execute("F-002", "idem-key-b", () => ({ ok: false, error: "银行通道超时" }));
console.assert(mgr.get("F-002").state === "failed", "网关失败应落到 failed");
mgr.get("F-002");
const failedTrail = mgr.get("F-002").trail;
console.assert(
  failedTrail.some((t) => t.to === "executing") &&
    failedTrail[failedTrail.length - 1].to === "failed",
  "审计轨迹完整记录执行与失败",
);
console.assert(mgr.get("F-002").trail.length === 4, "提交/审批通过/执行/失败共 4 条轨迹(未达成条件的审批不计轨迹)");

let blocked = false;
try {
  mgr.submit("F-002", "u-applicant");
} catch (e) {
  blocked = e instanceof IllegalTransition;
}
console.assert(!blocked, "失败后经 pending_review 允许重新提交(状态机允许 failed→pending_review)");

console.log("✅ 审批分级 / 自审拦截 / 幂等重放 / 审计轨迹全部通过");

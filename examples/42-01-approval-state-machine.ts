// 文件: examples/42-01-approval-state-machine.ts
// ============ 审批单状态机：状态、迁移守卫与审计轨迹 ============
// 审批单本质是一台状态机：状态有限、迁移有向、非法迁移一律拒绝。
// 三个工程要点：
// 1) 迁移表是唯一事实来源——所有流转必须过 canTransition，禁止直接改 state；
// 2) 每次 go() 落一条审计记录（谁、何时、从哪到哪、备注）——审批追溯全靠它；
// 3) 终态（approved/cancelled）迁移表为空数组，天然封死后续操作。

export type ApprovalState =
  | "draft" // 草稿
  | "pending" // 审批中
  | "approved" // 已通过（终态）
  | "rejected" // 已驳回（可重新提交）
  | "withdrawn" // 已撤回（可重新提交）
  | "cancelled"; // 已作废（终态）

export const TRANSITIONS: Readonly<
  Record<ApprovalState, readonly ApprovalState[]>
> = {
  draft: ["pending", "cancelled"],
  pending: ["approved", "rejected", "withdrawn", "cancelled"],
  approved: [], // 终态
  rejected: ["pending"], // 修改后重新提交
  withdrawn: ["pending"], // 再次提交
  cancelled: [], // 终态
};

export function canTransition(from: ApprovalState, to: ApprovalState): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface HistoryEntry {
  from: ApprovalState;
  to: ApprovalState;
  at: number; // 逻辑时钟（自增序号代替时间戳，保证顺序确定、可测试）
  by: string;
  comment?: string;
}

export class ApprovalDoc {
  state: ApprovalState = "draft";
  readonly history: HistoryEntry[] = [];
  private clock = 0;

  constructor(
    readonly id: string,
    readonly starterId: string, // 发起人——撤回操作的合法校验依据
  ) {}

  private go(to: ApprovalState, by: string, comment?: string): void {
    if (!canTransition(this.state, to))
      throw new Error(`非法迁移：${this.state} → ${to}（操作人 ${by}）`);
    this.history.push({ from: this.state, to, at: ++this.clock, by, comment });
    this.state = to;
  }

  submit(by: string): void {
    this.go("pending", by);
  }
  approve(by: string, comment?: string): void {
    this.go("approved", by, comment);
  }
  reject(by: string, comment: string): void {
    this.go("rejected", by, comment);
  }
  cancel(by: string): void {
    this.go("cancelled", by);
  }
  resubmit(by: string): void {
    this.go("pending", by);
  }
  withdraw(by: string): void {
    if (by !== this.starterId) throw new Error("只有发起人可以撤回");
    this.go("withdrawn", by);
  }
}

// ---------------- 验证 ----------------

const doc = new ApprovalDoc("AP-001", "e1001");

console.log("=== 正常生命周期（含驳回重提） ===");
doc.submit("e1001");
doc.reject("m001", "预算超了，调整后再提");
doc.resubmit("e1001");
doc.approve("m001", "同意");
console.log("终态:", doc.state);
for (const h of doc.history)
  console.log(
    `#${h.at} ${h.from} → ${h.to}（by ${h.by}${h.comment ? `：${h.comment}` : ""}）`,
  );

console.log("\n=== 非法迁移被拒绝 ===");
const doc2 = new ApprovalDoc("AP-002", "e1002");
try {
  doc2.approve("m001"); // 草稿直接审批
} catch (e) {
  console.log("捕获:", (e as Error).message);
}

console.log("\n=== 撤回：发起人校验 + 状态守卫 ===");
const doc3 = new ApprovalDoc("AP-003", "e1003");
doc3.submit("e1003");
try {
  doc3.withdraw("e9999"); // 非发起人
} catch (e) {
  console.log("捕获:", (e as Error).message);
}
doc3.withdraw("e1003");
doc3.resubmit("e1003");
console.log("撤回后重新提交:", doc3.state);

console.log("\n=== 终态封死 ===");
try {
  doc.approve("m002"); // 已 approved
} catch (e) {
  console.log("捕获:", (e as Error).message);
}

// 文件: examples/42-03-withdraw-return-addsign.ts
// ============ 撤回、驳回到指定节点与加签 ============
// 三个改变流程走向的高频操作：
// 1) 撤回 withdraw：发起人收回单子——仅当「当前节点还没有任何人处理」；
// 2) 驳回 returnTo：审批人把单子退回指定历史节点（常退回发起节点），从该节点重新走；
// 3) 加签 addSigner：往当前节点临时插入处理人——前加签（插在名单最前）/
//    后加签（追加到名单末尾）。会签语义下新签人也必须同意才能出节点。
// 教学引擎：线性流程（节点数组），节点内全员同意才进入下一节点（简化会签）。

export interface FlowNodeDef {
  id: string;
  name: string;
  assignees: readonly string[];
}

export type TaskState = "waiting" | "approved" | "rejected";

export interface Task {
  assignee: string;
  added?: boolean; // 加签插入的处理人
  state: TaskState;
}

export interface Step {
  nodeId: string;
  tasks: Task[];
  returned?: boolean; // 该节点是被驳回落点（重新处理中）
}

export type FlowStatus = "running" | "approved" | "rejected";

export class FlowRuntime {
  status: FlowStatus = "running";
  readonly steps: Step[] = [];
  readonly auditLog: string[] = [];
  current = -1;

  constructor(
    private readonly defs: readonly FlowNodeDef[],
    private readonly starterId: string,
  ) {}

  start(): void {
    this.enter(0);
  }

  private enter(i: number): void {
    this.current = i;
    const def = this.defs[i];
    this.steps.push({
      nodeId: def.id,
      tasks: def.assignees.map((a) => ({
        assignee: a,
        state: "waiting" as const,
      })),
    });
  }

  /** 撤回窗口：除发起步骤外，任何审批人都不曾有处理动作（钉钉式语义：首个审批人处理前可撤回） */
  withdraw(by: string): { ok: boolean; reason?: string } {
    if (by !== this.starterId) return { ok: false, reason: "只有发起人可撤回" };
    if (this.status !== "running")
      return { ok: false, reason: "流程已结束，无法撤回" };
    const acted = this.steps
      .slice(1) // 跳过发起步骤（发起人自己的提交不算「处理」）
      .some((s) => s.tasks.some((t) => t.state !== "waiting"));
    if (acted)
      return {
        ok: false,
        reason: "审批人已处理，不可撤回（可请审批人驳回）",
      };
    this.status = "rejected"; // 教学简化：撤回落 rejected（真实引擎一般回到草稿态）
    this.auditLog.push(`#${this.auditLog.length + 1} ${by} 撤回流程`);
    return { ok: true };
  }

  /** 处理任务：approve 需当前节点全员同意才流转；reject 直接否决流程 */
  act(assignee: string, action: "approve" | "reject", comment?: string): void {
    if (this.status !== "running") throw new Error("流程已结束");
    const step = this.steps[this.current];
    const task = step.tasks.find(
      (t) => t.assignee === assignee && t.state === "waiting",
    );
    if (!task) throw new Error(`${assignee} 无待处理任务`);

    if (action === "reject") {
      task.state = "rejected";
      this.status = "rejected";
      this.auditLog.push(
        `#${this.auditLog.length + 1} ${assignee} 在 ${step.nodeId} 否决${comment ? `：${comment}` : ""}`,
      );
      return;
    }
    task.state = "approved";
    this.auditLog.push(
      `#${this.auditLog.length + 1} ${assignee} 在 ${step.nodeId} 同意${comment ? `：${comment}` : ""}`,
    );
    if (step.tasks.every((t) => t.state === "approved")) {
      if (this.current + 1 < this.defs.length) this.enter(this.current + 1);
      else this.status = "approved";
    }
  }

  /** 驳回到指定历史步骤：丢弃其后的步骤，任务重置为 waiting 重新走 */
  returnTo(
    stepIndex: number,
    by: string,
    comment?: string,
  ): { ok: boolean; reason?: string } {
    if (this.status !== "running") return { ok: false, reason: "流程已结束" };
    if (stepIndex < 0 || stepIndex > this.current)
      return { ok: false, reason: "只能驳回到已走过的步骤" };
    this.steps.length = stepIndex + 1; // 截断后续步骤
    const step = this.steps[stepIndex];
    for (const t of step.tasks) t.state = "waiting";
    step.returned = true;
    this.current = stepIndex;
    this.auditLog.push(
      `#${this.auditLog.length + 1} ${by} 驳回到步骤 ${step.nodeId}${comment ? `：${comment}` : ""}`,
    );
    return { ok: true };
  }

  /** 加签：往当前节点插入处理人（节点需全员同意，新签人自然纳入） */
  addSigner(
    mode: "before" | "after",
    assignee: string,
    by: string,
  ): { ok: boolean; reason?: string } {
    if (this.status !== "running") return { ok: false, reason: "流程已结束" };
    const step = this.steps[this.current];
    if (step.tasks.some((t) => t.assignee === assignee))
      return { ok: false, reason: "该处理人已在当前节点名单中" };
    const task: Task = { assignee, state: "waiting", added: true };
    if (mode === "before") step.tasks.unshift(task);
    else step.tasks.push(task);
    this.auditLog.push(
      `#${this.auditLog.length + 1} ${by} ${mode === "before" ? "前加签" : "后加签"} ${assignee} 到 ${step.nodeId}`,
    );
    return { ok: true };
  }

  timeline(): string {
    return this.steps
      .map(
        (s, i) =>
          `${i === this.current ? "▶" : " "} ${s.nodeId}${s.returned ? "（驳回重走）" : ""}: ${s.tasks
            .map((t) => `${t.assignee}${t.added ? "*" : ""}(${t.state})`)
            .join(" + ")}`,
      )
      .join("\n");
  }
}

// ---------------- 验证 ----------------

const defs = [
  { id: "starter", name: "提交申请", assignees: ["e1001"] },
  { id: "manager", name: "经理审批", assignees: ["m001"] },
  { id: "director", name: "总监审批", assignees: ["d001"] },
];

console.log("=== 场景 1：后加签（经理节点插入财务） ===");
const f1 = new FlowRuntime(defs, "e1001");
f1.start();
f1.act("e1001", "approve");
console.log("加签财务:", f1.addSigner("after", "fin001", "m001"));
f1.act("m001", "approve", "业务没问题");
f1.act("fin001", "approve", "预算合规");
f1.act("d001", "approve");
console.log("最终状态:", f1.status);
console.log(f1.timeline());
console.log("审计轨迹:");
for (const line of f1.auditLog) console.log(" ", line);

console.log("\n=== 场景 2：撤回窗口（首个审批人处理前可撤） ===");
const f2 = new FlowRuntime(defs, "e1001");
f2.start();
f2.act("e1001", "approve"); // 流转到经理，经理尚未处理
console.log("经理未处理时撤回:", f2.withdraw("e1001"));
const f3 = new FlowRuntime(defs, "e1001");
f3.start();
f3.act("e1001", "approve");
f3.act("m001", "approve"); // 经理已处理 → 进入总监
console.log("经理已处理后撤回:", f3.withdraw("e1001"));

console.log("\n=== 场景 3：驳回到发起节点重走 ===");
const f4 = new FlowRuntime(defs, "e1001");
f4.start();
f4.act("e1001", "approve");
f4.act("m001", "approve");
console.log("总监驳回到发起节点:", f4.returnTo(0, "d001", "附件缺签名"));
console.log(f4.timeline());
f4.act("e1001", "approve", "补了签名");
f4.act("m001", "approve");
f4.act("d001", "approve");
console.log("重走后终态:", f4.status);

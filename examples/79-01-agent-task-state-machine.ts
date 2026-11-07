// 文件: examples/79-01-agent-task-state-machine.ts
// ============ Agent 任务状态机 + 多步骤进度 + 失败重试恢复 ============
// 对应 JD 「AI 工作流交互」：Thinking/Running 状态、多步骤任务执行、
// 实时进度、任务失败/重试/恢复、长任务异步执行。
// 状态机 + 步骤编排 + 重试退避，全部硬断言可直跑。

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ 断言失败：${msg}`);
    process.exit(1);
  }
}

// ---------------- 1. Agent 任务状态机 ----------------

/**
 * Agent 任务生命周期：draft → thinking → running → (awaiting_confirm | done | failed)
 * - thinking  模型正在拆解/规划（不可取消已发出的请求，但可 abort）
 * - running   正在执行工具调用/子步骤
 * - awaiting_confirm  有副作用的工具等待用户确认（JD 强调的「确认」环节）
 * - failed    终态之一，可 retry 回到 running（幂等键去重）
 * - done      终态，结果可被编辑/确认/保存（见第 80 册）
 */
export type AgentStatus =
  | "draft"
  | "thinking"
  | "running"
  | "awaiting_confirm"
  | "failed"
  | "cancelled"
  | "done";

export const TRANSITIONS: Readonly<Record<AgentStatus, readonly AgentStatus[]>> = {
  draft: ["thinking"],
  thinking: ["running", "failed", "cancelled"],
  running: ["awaiting_confirm", "failed", "cancelled", "done"],
  awaiting_confirm: ["running", "cancelled", "failed"],
  failed: ["running", "cancelled"],
  cancelled: [],
  done: [],
};

export function canTransition(from: AgentStatus, to: AgentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

// ---------------- 2. 多步骤任务与实时进度 ----------------

export interface Step {
  id: string;
  title: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  progress: number; // 0~100
  tool?: string; // 调用的工具名
  error?: string;
}

export interface AgentTask {
  id: string;
  status: AgentStatus;
  steps: Step[];
  retryCount: number;
  maxRetries: number;
}

/** 整体进度 = 已完成步骤权重之和，按步骤数平均；运行中步骤按其 progress 折算 */
export function overallProgress(task: AgentTask): number {
  if (task.steps.length === 0) return 0;
  const weight = 100 / task.steps.length;
  let total = 0;
  for (const s of task.steps) {
    if (s.status === "done" || s.status === "skipped") total += weight;
    else if (s.status === "running") total += (s.progress / 100) * weight;
  }
  return Math.round(total);
}

// ---------------- 3. 失败重试：指数退避 + 幂等键 ----------------

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** 可重试的错误类别：网络/限流/5xx；业务校验错误不重试 */
  retryable: (err: unknown) => boolean;
}

/** 指数退避（带上限），返回下一次重试等待毫秒数 */
export function nextBackoff(policy: RetryPolicy, attempt: number): number {
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
}

/** 幂等键：taskId + stepId + attempt，服务端据此去重重试请求 */
export function idempotencyKey(taskId: string, stepId: string, attempt: number): string {
  return `${taskId}:${stepId}:${attempt}`;
}

// ---------------- 4. 任务控制器：状态迁移守卫 + 步骤推进 ----------------

export class AgentTaskRunner {
  constructor(private task: AgentTask) {}

  get state(): AgentTask {
    return this.task;
  }

  transition(to: AgentStatus): void {
    if (!canTransition(this.task.status, to)) {
      throw new Error(`非法迁移: ${this.task.status} → ${to}`);
    }
    this.task.status = to;
  }

  /** 推进某个步骤的进度（0~100） */
  advanceStep(stepId: string, progress: number): void {
    const step = this.task.steps.find((s) => s.id === stepId);
    if (!step) throw new Error(`步骤不存在: ${stepId}`);
    step.status = "running";
    step.progress = Math.max(0, Math.min(100, progress));
  }

  completeStep(stepId: string): void {
    const step = this.task.steps.find((s) => s.id === stepId);
    if (!step) throw new Error(`步骤不存在: ${stepId}`);
    step.status = "done";
    step.progress = 100;
  }

  failStep(stepId: string, err: string, policy: RetryPolicy): "retry" | "giveup" {
    const step = this.task.steps.find((s) => s.id === stepId);
    if (!step) throw new Error(`步骤不存在: ${stepId}`);
    step.status = "failed";
    step.error = err;

    if (!policy.retryable(err) || this.task.retryCount >= policy.maxRetries) {
      return "giveup";
    }
    this.task.retryCount += 1;
    return "retry";
  }
}

// ---------------- 演示与断言 ----------------

function main(): void {
  console.log("===== 1. 状态机非法迁移被守卫拦截 =====");
  let threw = false;
  try {
    // done 是终态，不能回到 running
    canTransition("done", "running");
    // 直接构造一个 done 的任务再迁移
    const t = new AgentTaskRunner({
      id: "t1", status: "done", steps: [], retryCount: 0, maxRetries: 3,
    });
    t.transition("running");
  } catch {
    threw = true;
  }
  assert(threw, "终态 done 不允许迁移到 running");
  console.log("✓ 终态迁移被拒绝");

  console.log("\n===== 2. 多步骤实时进度计算 =====");
  const task: AgentTask = {
    id: "t2",
    status: "running",
    retryCount: 0,
    maxRetries: 3,
    steps: [
      { id: "s1", title: "解析需求", status: "done", progress: 100 },
      { id: "s2", title: "检索资料", status: "done", progress: 100 },
      { id: "s3", title: "生成方案", status: "running", progress: 50 },
      { id: "s4", title: "写入数据库", status: "pending", progress: 0 },
    ],
  };
  // 2 个完成 (50%) + 1 个 50% (12.5%) = 62.5 → 63
  assert(overallProgress(task) === 63, `整体进度应为 63，实际 ${overallProgress(task)}`);
  console.log(`✓ 4 步任务，2 完成 + 1 半完成 → 整体 ${overallProgress(task)}%`);

  console.log("\n===== 3. 失败重试：指数退避 + 幂等键 =====");
  const policy: RetryPolicy = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 8000,
    retryable: (e) => typeof e === "string" && (e.includes("timeout") || e.includes("503")),
  };
  // 退避：1000 → 2000 → 4000 → 8000（封顶）
  assert(nextBackoff(policy, 0) === 1000, "第 1 次重试等待 1000ms");
  assert(nextBackoff(policy, 1) === 2000, "第 2 次重试等待 2000ms");
  assert(nextBackoff(policy, 2) === 4000, "第 3 次重试等待 4000ms");
  assert(nextBackoff(policy, 5) === 8000, "超过上限封顶 8000ms");
  console.log("✓ 退避序列 1000→2000→4000→8000(封顶)");

  const runner = new AgentTaskRunner(task);
  // 网络超时 → 可重试
  const decision1 = runner.failStep("s3", "request timeout", policy);
  assert(decision1 === "retry", "timeout 应判定为重试");
  assert(task.retryCount === 1, "重试计数 +1");
  console.log(`✓ 步骤 s3 timeout → retry（计数 ${task.retryCount}）`);

  // 幂等键随 attempt 变化
  assert(
    idempotencyKey("t2", "s3", 1) !== idempotencyKey("t2", "s3", 2),
    "不同 attempt 的幂等键必须不同",
  );

  // 业务校验错误 → 不可重试
  const decision2 = runner.failStep("s3", "validation failed: invalid schema", policy);
  assert(decision2 === "giveup", "业务校验错误不应重试");
  console.log("✓ 业务校验错误 → giveup（不消耗重试次数）");

  // 超过最大重试次数 → giveup
  task.retryCount = 3;
  const decision3 = runner.failStep("s3", "503 service unavailable", policy);
  assert(decision3 === "giveup", "超过 maxRetries 应放弃");
  console.log("✓ 重试耗尽 → giveup");

  console.log("\n===== 4. awaiting_confirm：有副作用工具等待用户确认 =====");
  const confirmTask: AgentTask = {
    id: "t3", status: "running", retryCount: 0, maxRetries: 1,
    steps: [{ id: "send", title: "发送邮件", status: "running", progress: 100, tool: "sendEmail" }],
  };
  const cr = new AgentTaskRunner(confirmTask);
  cr.transition("awaiting_confirm");
  assert(confirmTask.status === "awaiting_confirm", "进入等待确认态");
  // 用户确认后回到 running 继续
  cr.transition("running");
  cr.completeStep("send");
  cr.transition("done");
  assert(confirmTask.status === "done", "确认后完成");
  console.log("✓ running → awaiting_confirm → running → done 全链路打通");

  console.log("\n✅ Agent 任务状态机 + 多步骤进度 + 重试恢复全部断言通过");
}

main();

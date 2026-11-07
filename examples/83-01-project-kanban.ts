// 文件: examples/83-01-project-kanban.ts
// ============ 项目管理：看板拖拽 + 任务进度 + 成员负载 ============
// 对应 JD「项目管理」。看板列状态迁移、子任务进度聚合、成员工作负载均衡，硬断言直跑。

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ 断言失败：${msg}`);
    process.exit(1);
  }
}

// ---------------- 1. 看板：列状态与迁移 ----------------

export type ColumnStatus = "backlog" | "todo" | "in_progress" | "review" | "done";

/** 看板列迁移规则：只能拖到相邻或合理的下一列，不能从 backlog 直接跳 done */
export const KANBAN_TRANSITIONS: Readonly<Record<ColumnStatus, readonly ColumnStatus[]>> = {
  backlog: ["todo"],
  todo: ["in_progress", "backlog"],
  in_progress: ["review", "todo"],
  review: ["done", "in_progress"],
  done: ["review"],
};

export function canMoveTo(from: ColumnStatus, to: ColumnStatus): boolean {
  return KANBAN_TRANSITIONS[from].includes(to);
}

// ---------------- 2. 任务与子任务进度聚合 ----------------

export interface SubTask {
  id: string;
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  status: ColumnStatus;
  assignee?: string;
  subtasks: SubTask[];
  /** 手动进度覆盖（0~100），undefined 时由子任务自动计算 */
  progressOverride?: number;
  priority: "low" | "medium" | "high";
  dueDate?: string;
}

/** 任务进度：有 override 用 override，否则按子任务完成比例 */
export function taskProgress(task: Task): number {
  if (task.progressOverride !== undefined) return task.progressOverride;
  if (task.subtasks.length === 0) return task.status === "done" ? 100 : 0;
  const doneCount = task.subtasks.filter((s) => s.done).length;
  return Math.round((doneCount / task.subtasks.length) * 100);
}

/** 项目整体进度 = 所有任务进度的平均值（按优先级加权可扩展） */
export function projectProgress(tasks: Task[]): number {
  if (tasks.length === 0) return 0;
  const total = tasks.reduce((sum, t) => sum + taskProgress(t), 0);
  return Math.round(total / tasks.length);
}

// ---------------- 3. 拖拽换列：守卫 + 审计 ----------------

/**
 * 拖拽任务到目标列：
 * 1. 校验迁移合法性；
 * 2. 更新状态；
 * 3. done 列自动把 progressOverride 设为 100。
 */
export function moveTask(task: Task, to: ColumnStatus): Task {
  if (!canMoveTo(task.status, to)) {
    throw new Error(`非法看板迁移: ${task.status} → ${to}`);
  }
  const updated: Task = { ...task, status: to };
  if (to === "done") {
    updated.progressOverride = 100;
    updated.subtasks = updated.subtasks.map((s) => ({ ...s, done: true }));
  }
  return updated;
}

// ---------------- 4. 成员工作负载 ----------------

export interface MemberWorkload {
  memberId: string;
  taskCount: number;
  /** 进行中 + 待办的任务数（已完成不计入负载） */
  activeCount: number;
  totalProgress: number;
}

/** 统计每个成员的工作负载，用于任务分配时的均衡决策 */
export function computeWorkload(tasks: Task[]): Map<string, MemberWorkload> {
  const map = new Map<string, MemberWorkload>();
  for (const t of tasks) {
    if (!t.assignee) continue;
    const w = map.get(t.assignee) || { memberId: t.assignee, taskCount: 0, activeCount: 0, totalProgress: 0 };
    w.taskCount += 1;
    if (t.status !== "done") w.activeCount += 1;
    w.totalProgress += taskProgress(t);
    map.set(t.assignee, w);
  }
  return map;
}

/** 推荐空闲成员：activeCount 最少的，用于自动分配任务 */
export function recommendAssignee(tasks: Task[], memberIds: string[]): string {
  const workload = computeWorkload(tasks);
  let best = memberIds[0];
  let minActive = Infinity;
  for (const id of memberIds) {
    const active = workload.get(id)?.activeCount ?? 0;
    if (active < minActive) { minActive = active; best = id; }
  }
  return best;
}

// ---------------- 演示与断言 ----------------

function main(): void {
  console.log("===== 1. 看板迁移守卫 =====");
  let task: Task = {
    id: "t1", title: "设计登录页", status: "backlog",
    subtasks: [{ id: "s1", title: "线框图", done: false }, { id: "s2", title: "高保真", done: false }],
    priority: "high",
  };
  // backlog 不能直接到 done
  let threw = false;
  try { moveTask(task, "done"); } catch { threw = true; }
  assert(threw, "backlog 不能直接跳 done");
  // 正常链路
  task = moveTask(task, "todo");
  task = moveTask(task, "in_progress");
  assert(task.status === "in_progress", "backlog → todo → in_progress 合法");
  console.log("✓ 看板迁移：backlog 不能跳 done，需逐步推进");

  console.log("\n===== 2. 子任务进度聚合 =====");
  const t2: Task = {
    id: "t2", title: "开发 API", status: "in_progress",
    subtasks: [
      { id: "s1", title: "接口定义", done: true },
      { id: "s2", title: "实现", done: true },
      { id: "s3", title: "测试", done: false },
    ],
    priority: "medium",
  };
  assert(taskProgress(t2) === 67, `3 个子任务完成 2 个 → 67%，实际 ${taskProgress(t2)}`);
  console.log(`✓ 子任务进度：2/3 完成 → ${taskProgress(t2)}%`);

  // done 列自动 100%
  const t2done = moveTask(t2, "review");
  const t2final = moveTask(t2done, "done");
  assert(taskProgress(t2final) === 100, "拖到 done 自动 100%");
  console.log("✓ 拖到 done 列 → 进度自动 100%，子任务全部标记完成");

  console.log("\n===== 3. 项目整体进度 =====");
  const tasks: Task[] = [
    task, // in_progress, 0%
    t2final, // done, 100%
    { id: "t3", title: "写文档", status: "todo", subtasks: [], priority: "low" }, // 0%
  ];
  assert(projectProgress(tasks) === 33, `项目进度应为 33，实际 ${projectProgress(tasks)}`);
  console.log(`✓ 项目整体进度：(0 + 100 + 0) / 3 = ${projectProgress(tasks)}%`);

  console.log("\n===== 4. 成员工作负载与分配推荐 =====");
  const assigned: Task[] = [
    { ...task, assignee: "alice" },
    { id: "t4", title: "联调", status: "in_progress", subtasks: [], priority: "medium", assignee: "alice" },
    { id: "t5", title: "部署", status: "todo", subtasks: [], priority: "high", assignee: "bob" },
  ];
  const wl = computeWorkload(assigned);
  assert(wl.get("alice")!.activeCount === 2, "alice 有 2 个活跃任务");
  assert(wl.get("bob")!.activeCount === 1, "bob 有 1 个活跃任务");
  const recommended = recommendAssignee(assigned, ["alice", "bob", "carol"]);
  assert(recommended === "carol", "carol 负载为 0，应被推荐");
  console.log(`✓ 负载：alice=${wl.get("alice")!.activeCount}，bob=${wl.get("bob")!.activeCount}`);
  console.log(`✓ 推荐分配给 ${recommended}（负载最低）`);

  console.log("\n✅ 看板迁移 + 子任务进度 + 项目进度 + 负载均衡全部通过");
}

main();

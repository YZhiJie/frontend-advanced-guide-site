// 文件: cases/04-mini-framework-lab/src/scheduler.ts
// ============ 优先级队列 + 批量 flush + idle 时间片 ============

export type SchedulerPriority = "high" | "normal" | "low" | "idle";

export type SchedulerFn = () => unknown | Promise<unknown>;

interface Task {
  fn: SchedulerFn;
  priority: SchedulerPriority;
  /** 用于去重 */
  id?: unknown;
  /** 记录入队顺序 */
  seq: number;
}

const highQueue: Task[] = [];
const normalQueue: Task[] = [];
const lowQueue: Task[] = [];
const idleQueue: Task[] = [];

let seq = 0;
let isFlushing = false;
let highScheduled = false;
let normalScheduled = false;
let lowScheduled = false;
let idleScheduled = false;

// 用 Map 去重：按 id 记录优先级 + task
const idMap = new Map<unknown, Task>();

// 执行记录，供测试查看
export interface RunRecord {
  fn: SchedulerFn;
  priority: SchedulerPriority;
  order: number;
}

export const lastRunRecords: RunRecord[] = [];

// ============================================================
// 入队
// ============================================================

/**
 * 调度一个任务。
 * @param fn 任务函数
 * @param priority 优先级
 * @param id 可选的唯一 id；相同 id 后来的会覆盖之前的
 */
export function schedule(
  fn: SchedulerFn,
  priority: SchedulerPriority = "normal",
  id?: unknown,
): void {
  // 去重
  if (id !== undefined) {
    const old = idMap.get(id);
    if (old) {
      // 旧任务从队列里移除，用新的覆盖
      removeFromQueue(old);
      idMap.delete(id);
    }
  }

  const task: Task = { fn, priority, id, seq: seq++ };

  switch (priority) {
    case "high":
      highQueue.push(task);
      break;
    case "low":
      lowQueue.push(task);
      break;
    case "idle":
      idleQueue.push(task);
      break;
    case "normal":
    default:
      normalQueue.push(task);
  }

  if (id !== undefined) idMap.set(id, task);

  ensureFlush(priority);
}

function removeFromQueue(task: Task) {
  const q =
    task.priority === "high"
      ? highQueue
      : task.priority === "low"
        ? lowQueue
        : task.priority === "idle"
          ? idleQueue
          : normalQueue;
  const idx = q.indexOf(task);
  if (idx >= 0) q.splice(idx, 1);
}

function ensureFlush(priority: SchedulerPriority) {
  // high：同步 flush，保证优先级最高，不管 normal/low 怎么注册
  if (priority === "high") {
    flushHighSync();
    return;
  }

  if (priority === "normal" && !normalScheduled) {
    normalScheduled = true;
    queueMicrotask(() => flushNormal());
  }
  if ((priority === "low" || priority === "normal") && !lowScheduled) {
    lowScheduled = true;
    setTimeout(() => flushLow(), 0);
  }
  if (!idleScheduled) {
    idleScheduled = true;
    scheduleIdleCallback(() => flushIdle());
  }
}

function flushHighSync() {
  // 递归 flush 所有 high（如果 high fn 内部又 schedule 了 high）
  // 但我们不想影响 normal 等队列
  runQueue(highQueue, "high");
  // 如果 high fn 内部又加了新的 high，继续 flush 直到空
  while (highQueue.length > 0) {
    runQueue(highQueue, "high");
  }
}

// ============================================================
// 各优先级刷新
// ============================================================

function flushHigh() {
  highScheduled = false;
  runQueue(highQueue, "high");
}

function flushNormal() {
  normalScheduled = false;
  runQueue(normalQueue, "normal");
}

function flushLow() {
  lowScheduled = false;
  runQueue(lowQueue, "low");
}

function flushIdle() {
  idleScheduled = false;
  runQueue(idleQueue, "idle");
}

let runOrder = 0;

function runQueue(q: Task[], priority: SchedulerPriority) {
  if (isFlushing) return;
  isFlushing = true;

  // 按入队顺序跑
  while (q.length > 0) {
    const task = q.shift()!;
    // 如果有 id，跑完移除
    if (task.id !== undefined) idMap.delete(task.id);

    lastRunRecords.push({
      fn: task.fn,
      priority: task.priority,
      order: runOrder++,
    });

    try {
      const ret = task.fn();
      // 忽略返回值，但若返回 Promise 也不阻塞（fire-and-forget）
      if (ret && typeof (ret as Promise<unknown>).then === "function") {
        (ret as Promise<unknown>).catch(() => {
          /* swallow */
        });
      }
    } catch (err) {
      console.error("[scheduler] task threw", err);
    }
  }

  isFlushing = false;
}

// ============================================================
// requestIdleCallback 模拟（Node 里没有，用 setTimeout + 时间片）
// ============================================================

type IdleCb = () => void;
const idleCallbacks: { cb: IdleCb; timeRemaining: number }[] = [];

function scheduleIdleCallback(cb: IdleCb): void {
  // 默认 5ms 时间片
  idleCallbacks.push({ cb, timeRemaining: 5 });
  setTimeout(() => {
    const { timeRemaining } = idleCallbacks.shift()!;
    const start = performance.now();
    cb();
    // 剩余时间（只是记录用）
    timeRemaining - (performance.now() - start);
  }, 16); // ~1 帧
}

// ============================================================
// 工具
// ============================================================

/** 清空内部状态（测试用） */
export function __resetScheduler(): void {
  highQueue.length = 0;
  normalQueue.length = 0;
  lowQueue.length = 0;
  idleQueue.length = 0;
  idMap.clear();
  lastRunRecords.length = 0;
  runOrder = 0;
  highScheduled = normalScheduled = lowScheduled = idleScheduled = false;
  isFlushing = false;
}

/** 等待所有队列跑完（测试用） */
export async function waitForIdle(delayMs = 50): Promise<void> {
  // 先等所有微任务 + 一个 setTimeout(0) + 再给 idle 足够时间
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, delayMs));
}

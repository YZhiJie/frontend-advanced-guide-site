// 文件: examples/27-03-mini-scheduler.ts
// ============ 手写迷你调度器（宏/微任务 + requestIdleCallback 模拟 + 优先级队列 + 批量合并）==========

type Priority = 'high' | 'medium' | 'low';

interface Job {
  id: number;
  priority: Priority;
  fn: () => void;
  createdAt: number;
}

let jobId = 0;

/* ============================================================
 * 1. Scheduler 类
 * ============================================================ */

export class Scheduler {
  private high: Job[] = [];
  private medium: Job[] = [];
  private low: Job[] = [];
  // 标记某档优先级是否已经有一个 flush 请求在排队
  private pending: Record<Priority, boolean> = { high: false, medium: false, low: false };

  stats = { scheduled: 0, flushed: 0 };

  private queueOf(p: Priority): Job[] {
    return p === 'high' ? this.high : p === 'medium' ? this.medium : this.low;
  }

  schedule(fn: () => void, priority: Priority = 'medium'): number {
    const job: Job = {
      id: ++jobId,
      priority,
      fn,
      createdAt: Date.now(),
    };
    this.queueOf(priority).push(job);
    this.stats.scheduled++;
    this.scheduleFlush(priority);
    return job.id;
  }

  /**
   * 每档优先级只排一个 flush 任务，合并多次 schedule。
   * - high: 用 Promise.resolve().then → 微任务（当前 call stack 跑完后立即执行）
   * - medium: 用 queueMicrotask
   * - low: 用 setTimeout 模拟 requestIdleCallback
   */
  private scheduleFlush(priority: Priority) {
    if (this.pending[priority]) return;
    this.pending[priority] = true;

    const flushNow = () => {
      const queue = this.queueOf(priority);
      // 取出所有 job
      const jobs = queue.splice(0, queue.length);
      this.stats.flushed += jobs.length;
      for (const j of jobs) {
        try { j.fn(); } catch (e) { console.error('[scheduler]', e); }
      }
      this.pending[priority] = false;
      // flush 过程中新来的同优先级任务, 在本次结束后再 schedule
      if (queue.length > 0) this.scheduleFlush(priority);
    };

    if (priority === 'high') {
      Promise.resolve().then(flushNow);
    } else if (priority === 'medium') {
      queueMicrotask(flushNow);
    } else {
      setTimeout(flushNow, 0);
    }
  }

  size() {
    return { high: this.high.length, medium: this.medium.length, low: this.low.length };
  }
}

/* ============================================================
 * 2. reactive + effect + scheduler 集成（测试批量合并）
 * ============================================================ */

type SEffect = (() => void) & { deps: Set<Set<SEffect>>; _scheduler?: () => void };

let activeSEffect: SEffect | null = null;
const effectDep = new WeakMap<object, Map<string | symbol, Set<SEffect>>>();

function track2(target: object, key: string | symbol) {
  if (!activeSEffect) return;
  let depsMap = effectDep.get(target);
  if (!depsMap) { depsMap = new Map(); effectDep.set(target, depsMap); }
  let deps = depsMap.get(key);
  if (!deps) { deps = new Set(); depsMap.set(key, deps); }
  deps.add(activeSEffect);
  activeSEffect.deps.add(deps);
}

function trigger2(target: object, key: string | symbol) {
  const deps = effectDep.get(target)?.get(key);
  if (!deps) return;
  // 拷贝一份, 遍历每个 effect 的 scheduler 或直接执行
  [...deps].forEach((fn) => {
    if (fn._scheduler) fn._scheduler();
    else fn();
  });
}

function miniReactive<T extends object>(obj: T): T {
  const proxy = new Proxy(obj, {
    get(t, k, r) {
      track2(t, k);
      const v = Reflect.get(t, k, r);
      return v && typeof v === 'object' ? miniReactive(v) : v;
    },
    set(t, k, v, r) {
      const old = (t as any)[k];
      const ok = Reflect.set(t, k, v, r);
      if (ok && !Object.is(old, v)) trigger2(t, k);
      return ok;
    },
  });
  return proxy as T;
}

/* ============================================================
 * 3. 主测试
 * ============================================================ */

async function main() {
  // --- 测试 1: 高优先级先于中、低 ---
  console.log('=== 测试 1: 优先级队列 ===');
  const sch = new Scheduler();
  const order: string[] = [];

  // 先排 medium 和 low
  for (let i = 0; i < 3; i++) {
    sch.schedule(() => order.push(`medium-${i}`), 'medium');
    sch.schedule(() => order.push(`low-${i}`), 'low');
  }
  // 再排 high（high 用 .then, 在同一个 tick 里会先跑完）
  for (let i = 0; i < 3; i++) {
    sch.schedule(() => order.push(`high-${i}`), 'high');
  }

  // 等所有 flush
  await new Promise((r) => setTimeout(r, 50));
  console.log('  执行顺序:', order);
  console.log('  ✓ high 先出现 =', order.findIndex((s) => s.startsWith('high')) <
    order.findIndex((s) => s.startsWith('medium')));

  // --- 测试 2: 连续 100 次 reactive 属性改动 → Scheduler 批量合并 → 只触发 1 次 effect ---
  console.log('\n=== 测试 2: 100 次改动 → 1 次 effect ===');
  const state = miniReactive({ x: 0 });
  let runCount = 0;

  const sch2 = new Scheduler();
  let scheduledTask: (() => void) | null = null;

  const effectFn: SEffect = (() => {
    // 清旧依赖
    effectFn.deps.forEach((d) => d.delete(effectFn));
    effectFn.deps.clear();
    activeSEffect = effectFn;
    runCount++;
    const _ = state.x; // 收集依赖
    activeSEffect = null;
    console.log('  [effect] run #' + runCount + ', state.x =', state.x);
  }) as SEffect;
  effectFn.deps = new Set();
  // scheduler: 把 effect 推入 Scheduler medium 队列, 多次 trigger 合并到同一个 flush
  effectFn._scheduler = () => {
    if (scheduledTask) return; // 已经有一个排好的, 等待合并
    scheduledTask = () => {
      scheduledTask = null;
      effectFn();
    };
    sch2.schedule(scheduledTask, 'medium');
  };
  // 首次执行
  effectFn();

  // 连续 100 次写 —— 每次只 trigger scheduler, scheduler 把同一个 fn 合并
  for (let i = 1; i <= 100; i++) {
    state.x = i;
  }

  // 等 medium 队列 flush
  await new Promise((r) => setTimeout(r, 10));
  console.log('  runCount =', runCount, '(初始 1 次 + flush 合并 1 次, 预期 = 2)');

  // --- 测试 3: Scheduler 统计 ---
  console.log('\n=== 测试 3: Scheduler stats ===');
  console.log('  scheduled:', sch2.stats.scheduled);
  console.log('  flushed:', sch2.stats.flushed);

  // --- 测试 4: 低优先级不阻塞同步执行流 ---
  console.log('\n=== 测试 4: 低优先级异步化 ===');
  const sch3 = new Scheduler();
  let syncDone = false;
  sch3.schedule(() => {
    console.log('  [low] 延迟任务, syncDone =', syncDone);
  }, 'low');
  sch3.schedule(() => {
    console.log('  [medium] 微任务, syncDone =', syncDone);
  }, 'medium');
  syncDone = true;
  // 等所有 flush
  await new Promise((r) => setTimeout(r, 50));

  console.log('\n✓ mini-scheduler 验证完毕');
}

main();

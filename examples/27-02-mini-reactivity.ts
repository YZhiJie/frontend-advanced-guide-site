// 文件: examples/27-02-mini-reactivity.ts
// ============ 手写迷你响应式系统（reactive / effect / Dep / 微任务 batch / computed）==========

type EffectFn = (() => void) & {
  deps: Set<Set<EffectFn>>;
  lazy?: boolean;
  scheduler?: () => void;
};

/* ============================================================
 * 1. Dep：依赖单元（简化版：Set<EffectFn>）
 * ============================================================ */

/* ============================================================
 * 2. 全局 activeEffect 栈 & targetMap
 * ============================================================ */

const effectStack: EffectFn[] = [];
let activeEffect: EffectFn | null = null;

// 全局依赖图: target → key → Set<EffectFn>
const targetMap = new WeakMap<object, Map<string | symbol, Set<EffectFn>>>();

function track(target: object, key: string | symbol) {
  if (!activeEffect) return;
  let depsMap = targetMap.get(target);
  if (!depsMap) {
    depsMap = new Map();
    targetMap.set(target, depsMap);
  }
  let deps = depsMap.get(key);
  if (!deps) {
    deps = new Set();
    depsMap.set(key, deps);
  }
  if (!deps.has(activeEffect)) {
    deps.add(activeEffect);
    activeEffect.deps.add(deps); // 双向记录，便于 cleanup
  }
}

function trigger(target: object, key: string | symbol) {
  const deps = targetMap.get(target)?.get(key);
  if (!deps) return;
  // 拷贝一份再遍历: 防止 effect 执行中增删依赖
  const effects = [...deps];
  for (const fn of effects) {
    // 避免递归: effect 内部又触发自己（如 count++ ）
    if (fn === activeEffect) continue;
    if (fn.scheduler) fn.scheduler();
    else fn();
  }
}

function cleanup(effectFn: EffectFn) {
  effectFn.deps.forEach((deps) => deps.delete(effectFn));
  effectFn.deps.clear();
}

/* ============================================================
 * 3. effect：副作用函数（懒收集 + cleanup 解决分支切换脏依赖）
 * ============================================================ */

export function effect(
  fn: () => void,
  options?: { lazy?: boolean; scheduler?: () => void },
): EffectFn {
  const effectFn: EffectFn = (() => {
    cleanup(effectFn); // 重新执行前清旧依赖
    effectStack.push(effectFn);
    activeEffect = effectFn;
    let result: any;
    try {
      result = fn();
    } finally {
      effectStack.pop();
      activeEffect = effectStack[effectStack.length - 1] ?? null;
    }
    return result;
  }) as EffectFn;
  effectFn.deps = new Set();
  if (options?.scheduler) effectFn.scheduler = options.scheduler;
  if (!options?.lazy) effectFn(); // 立即执行 → 触发依赖收集
  return effectFn;
}

/* ============================================================
 * 4. reactive：Proxy 实现（深层递归代理）
 * ============================================================ */

const proxyCache = new WeakMap<object, object>();

export function reactive<T extends object>(obj: T): T {
  const cached = proxyCache.get(obj);
  if (cached) return cached as T;

  const proxy = new Proxy(obj, {
    get(target, key, receiver) {
      track(target, key);
      const val = Reflect.get(target, key, receiver);
      if (val !== null && typeof val === "object") {
        return reactive(val as object); // 深层递归代理
      }
      return val;
    },
    set(target, key, value, receiver) {
      const old = (target as any)[key];
      const ok = Reflect.set(target, key, value, receiver);
      if (ok && !Object.is(old, value)) trigger(target, key);
      return ok;
    },
    deleteProperty(target, key) {
      const had = Reflect.has(target, key);
      const ok = Reflect.deleteProperty(target, key);
      if (had && ok) trigger(target, key);
      return ok;
    },
  }) as T;
  proxyCache.set(obj, proxy);
  return proxy;
}

/* ============================================================
 * 5. ref + computed
 * ============================================================ */

export function ref<T>(initial: T): { value: T } {
  return reactive({ value: initial });
}

export function computed<T>(getter: () => T): { value: T } {
  let value: T | undefined;
  let dirty = true;
  const runner = effect(getter, {
    lazy: true,
    scheduler: () => {
      dirty = true;
    },
  });
  return {
    get value() {
      if (dirty) {
        value = runner() as T;
        dirty = false;
      }
      return value!;
    },
  };
}

/* ============================================================
 * 6. Batch：微任务队列合并更新
 *    任何 scheduler 把 effect 加进 batchQueue 时，自动在微任务里 flush
 * ============================================================ */

const batchQueue = new Set<EffectFn>();
let flushing = false;

/** 把 effect 加入 batch 队列（供 scheduler 使用） */
export function scheduleBatch(fn: EffectFn) {
  batchQueue.add(fn);
  if (!flushing) {
    flushing = true;
    Promise.resolve().then(() => {
      const list = [...batchQueue];
      batchQueue.clear();
      flushing = false;
      list.forEach((f) => f());
    });
  }
}

/** 同步执行一个操作, 期间所有 scheduler 的 flush 合并 */
export function batch(fn: () => void) {
  const prev = flushing;
  flushing = true;
  fn();
  flushing = prev;
  if (!prev) {
    Promise.resolve().then(() => {
      const list = [...batchQueue];
      batchQueue.clear();
      flushing = false;
      list.forEach((f) => f());
    });
  }
}

/* ============================================================
 * 7. 测试
 * ============================================================ */

(async () => {
  console.log("=== 测试 1: 基础响应式（reactive + effect） ===");
  let countRuns = 0;
  const state = reactive({ count: 0, name: "alice" });
  effect(() => {
    countRuns++;
    console.log("  [effect] count =", state.count, "(run #" + countRuns + ")");
  });
  state.count++; // trigger → run #2
  state.count++; // trigger → run #3
  // state.count = state.count; // 值不变, 不触发
  console.log(
    "  state.count 最终值:",
    state.count,
    ", effect 跑了",
    countRuns,
    "次 (预期 3)",
  );

  console.log("\n=== 测试 2: 嵌套对象深层收集 ===");
  const obj = reactive({ a: { b: { c: 1 } } });
  effect(() => {
    console.log("  [effect] obj.a.b.c =", obj.a.b.c);
  });
  obj.a.b.c = 42; // → 自动触发

  console.log("\n=== 测试 3: 分支切换 cleanup ===");
  const branch = reactive({ flag: true, text: "hello" });
  let branchRuns = 0;
  effect(() => {
    branchRuns++;
    const v = branch.flag ? branch.text : "F";
    console.log("  [effect] branch:", v, "(run #" + branchRuns + ")");
  });
  branch.text = "world"; // flag=true → 依赖 text → 触发 run #2
  branch.flag = false; // 触发 run #3 (此时 effect 不再读 text)
  branch.text = "again"; // text 不依赖了 → 不再触发
  console.log(
    "  branchRuns 最终 =",
    branchRuns,
    "(预期 3, text 第 2 次不再触发)",
  );

  console.log("\n=== 测试 4: batch 合并 ===");
  let batchRuns = 0;
  const batchState = reactive({ x: 0 });
  const batchEffect = effect(
    () => {
      batchRuns++;
      console.log("  [batch] x =", batchState.x, "(run #" + batchRuns + ")");
    },
    {
      scheduler: () => {
        scheduleBatch(batchEffect);
      },
    },
  );
  // 连续 5 次同步改动, 全部进 queue, 最后只 flush 一次
  batchState.x = 1;
  batchState.x = 2;
  batchState.x = 3;
  batchState.x = 4;
  batchState.x = 5;
  await new Promise((r) => setTimeout(r, 10));
  console.log("  batchRuns =", batchRuns, "(预期 2: 首次 + batch flush)");

  console.log("\n=== 测试 5: computed（缓存 + 懒计算） ===");
  const cState = reactive({ firstName: "Yu", lastName: "Jie" });
  let computedRuns = 0;
  const full = computed(() => {
    computedRuns++;
    return `${cState.firstName} ${cState.lastName}`;
  });
  console.log("  full =", full.value, "(computed 计算 #" + computedRuns + ")");
  console.log("  full =", full.value, "(computed 计算 #" + computedRuns + ")"); // 缓存, 不触发
  cState.lastName = "ZZ";
  console.log("  full =", full.value, "(computed 计算 #" + computedRuns + ")"); // 触发一次

  console.log("\n✓ mini-reactivity 验证完毕");
})();

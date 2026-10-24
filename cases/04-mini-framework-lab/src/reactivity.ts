// 文件: cases/04-mini-framework-lab/src/reactivity.ts
// ============ Proxy 响应式 + effect 依赖收集 + 批量触发 ============

/** 副作用函数 */
export type EffectFn<T = unknown> = () => T;

/** 响应式标记 symbol */
export const REACTIVE_FLAG = Symbol("__reactive__");

/** 每个 key 对应的依赖集合 */
class Dep {
  effects: Set<ReactiveEffect> = new Set();

  track(effect: ReactiveEffect) {
    this.effects.add(effect);
  }

  trigger(): ReactiveEffect[] {
    // 复制一份再遍历，避免遍历中 effect 自己触发再次收集导致死循环
    return Array.from(this.effects);
  }
}

/** 一个 effect 实例 */
export class ReactiveEffect {
  fn: EffectFn;
  /** 该 effect 依赖了哪些 Dep（反向引用，用于 cleanup） */
  deps: Set<Dep> = new Set();
  /** 是否正在运行中（防止无限递归） */
  running = false;
  /** 结果缓存（首次跑后可读） */
  result: unknown = undefined;

  constructor(fn: EffectFn) {
    this.fn = fn;
  }

  run(): unknown {
    if (this.running) return this.result; // 递归保护

    // 先把上次的 deps 清空（cleanup）
    for (const d of this.deps) d.effects.delete(this);
    this.deps.clear();

    try {
      this.running = true;
      this.result = this.fn();
    } finally {
      this.running = false;
    }
    return this.result;
  }

  stop() {
    for (const d of this.deps) d.effects.delete(this);
    this.deps.clear();
  }
}

/** 当前正在执行的 effect，供 Proxy 的 get 捕获 */
let activeEffect: ReactiveEffect | null = null;

// ============================================================
// reactive —— Proxy 代理
// ============================================================

const rawToProxy = new WeakMap<object, object>();
const proxyToRaw = new WeakMap<object, object>();
const targetDeps = new WeakMap<object, Map<string | symbol, Dep>>();

export function isReactive(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    (value as Record<string | symbol, unknown>)[REACTIVE_FLAG] === true
  );
}

/**
 * 将对象变成响应式。返回值是同一结构的 Proxy，原对象不被修改。
 * 支持嵌套对象递归响应式；数组的 push/splice 等也能正确收集依赖。
 */
export function reactive<T extends object>(target: T): T {
  // 原对象已是 proxy -> 返回自身
  if (isReactive(target)) return target;
  // 已代理过 -> 返回缓存
  if (rawToProxy.has(target)) return rawToProxy.get(target) as T;

  const depsMap = new Map<string | symbol, Dep>();
  targetDeps.set(target, depsMap);

  const proxy = new Proxy(target, {
    get(obj, key, receiver) {
      // 内部标记
      if (key === REACTIVE_FLAG) return true;
      if (key === Symbol.toStringTag) return "Reactive";

      // 数组 push/splice 等需要 length 跟踪的方法，重写一下
      if (
        Array.isArray(obj) &&
        typeof (obj as Record<string, unknown>)[key as string] === "function"
      ) {
        // 让 Reflect.get 走不到这里
        const fn = Reflect.get(obj, key, receiver) as (
          ...args: unknown[]
        ) => unknown;
        return (...args: unknown[]) => {
          // 先建立 effect 跟踪
          trackDep(obj, "length");
          return fn.apply(receiver, args);
        };
      }

      const res = Reflect.get(obj, key, receiver);

      // 递归响应式（仅对象）
      if (res !== null && typeof res === "object") {
        const nested = reactive(res as object);
        trackDep(obj, key);
        return nested;
      }

      trackDep(obj, key);
      return res;
    },

    set(obj, key, newValue, receiver) {
      const isArr = Array.isArray(obj);

      // 数组场景：length 的 oldValue 要特别小心，因为 push/splice 等
      // 内部会先写索引再写 length，我们不能在 set 后再从 raw 读 oldValue。
      // 这里对数组的 length key，提前从 raw target 读一次。
      let oldValue: unknown;
      if (isArr && key === "length") {
        oldValue = (obj as unknown as { length: unknown }).length;
      } else if (isArr && typeof key === "string" && /^\d+$/.test(key)) {
        // 数组索引：保存当前 length 以便后续判断
        oldValue = (obj as unknown as Record<string, unknown>)[key];
      } else {
        oldValue = Reflect.get(obj, key, receiver);
      }

      const success = Reflect.set(obj, key, newValue, receiver);

      if (!success) return false;

      if (!Object.is(oldValue, newValue)) {
        triggerDep(obj, key);
        // 数组索引写入可能影响 length，也要触发 length
        if (isArr && typeof key === "string" && /^\d+$/.test(key)) {
          const newLen = (obj as unknown as { length: unknown }).length;
          if (
            (oldValue as number | undefined) !== undefined &&
            Number(key) >= Number(oldValue)
          ) {
            // 这种情况不一定触发 length 改变
          }
          triggerDep(obj, "length");
        }
      }

      return success;
    },

    deleteProperty(obj, key) {
      const had = Reflect.has(obj, key);
      const success = Reflect.deleteProperty(obj, key);
      if (had && success) {
        triggerDep(obj, key);
      }
      return success;
    },

    has(obj, key) {
      trackDep(obj, key);
      return Reflect.has(obj, key);
    },

    ownKeys(obj) {
      // 对 for...in / Object.keys 也建立依赖
      trackDep(obj, Symbol.iterator);
      return Reflect.ownKeys(obj);
    },
  }) as T;

  rawToProxy.set(target, proxy as unknown as object);
  proxyToRaw.set(proxy as unknown as object, target);

  return proxy;
}

function getOrCreateDep(target: object, key: string | symbol): Dep {
  let depsMap = targetDeps.get(target);
  if (!depsMap) {
    depsMap = new Map();
    targetDeps.set(target, depsMap);
  }
  let dep = depsMap.get(key);
  if (!dep) {
    dep = new Dep();
    depsMap.set(key, dep);
  }
  return dep;
}

function trackDep(target: object, key: string | symbol) {
  if (!activeEffect) return;
  // 如果 target 是 proxy，要找到它的 raw target 对应的 depsMap
  const raw = proxyToRaw.get(target) ?? target;
  const dep = getOrCreateDep(raw, key);
  dep.track(activeEffect);
  activeEffect.deps.add(dep);
}

function triggerDep(target: object, key: string | symbol) {
  const raw = proxyToRaw.get(target) ?? target;
  const depsMap = targetDeps.get(raw);
  if (!depsMap) return;
  const dep = depsMap.get(key);
  if (!dep) return;

  if (batchDepth > 0) {
    // 批处理中：先收集待触发 effect
    const effects = dep.trigger();
    for (const e of effects) {
      pendingEffects.add(e);
    }
  } else {
    // 直接跑：同一 tick 里收集到的 effect 立即执行
    const effects = dep.trigger();
    for (const e of effects) {
      queueRun(e);
    }
    flushScheduled();
  }
}

// ============================================================
// effect —— 运行 effect 并收集依赖
// ============================================================

/** effect 的返回值，用于手动 stop */
export interface EffectHandle {
  stop(): void;
  run(): unknown;
}

export function effect<T>(fn: EffectFn<T>): EffectHandle {
  const e = new ReactiveEffect(fn);
  runEffect(e);
  return {
    stop: () => e.stop(),
    run: () => runEffect(e),
  };
}

function runEffect(e: ReactiveEffect): unknown {
  activeEffect = e;
  try {
    return e.run();
  } finally {
    activeEffect = null;
  }
}

// ============================================================
// batch —— 批处理多个 set，合并触发
// ============================================================

let batchDepth = 0;
const pendingEffects = new Set<ReactiveEffect>();
let scheduled = false;

/**
 * 将多个修改合并到一个 flush：内部嵌套调用只累加 depth。
 * flush 默认同步执行，但在最外层用 queueMicrotask 避免嵌套。
 */
export function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) {
      flushBatch();
    }
  }
}

function flushBatch() {
  if (pendingEffects.size === 0) return;
  const effects = Array.from(pendingEffects);
  pendingEffects.clear();
  scheduled = false;
  // 同步执行所有待触发 effect
  for (const e of effects) {
    if (e.deps.size > 0) {
      runEffect(e);
    }
  }
}

// ============================================================
// 调度执行（非 batch 情况下）
// ============================================================

const scheduledEffects = new Set<ReactiveEffect>();

function queueRun(e: ReactiveEffect) {
  scheduledEffects.add(e);
  if (!scheduled) {
    scheduled = true;
    queueMicrotask(flushScheduled);
  }
}

function flushScheduled() {
  scheduled = false;
  const effects = Array.from(scheduledEffects);
  scheduledEffects.clear();
  for (const e of effects) {
    if (e.deps.size > 0) {
      runEffect(e);
    }
  }
}

// 给 scheduler.ts 用
export function __internal__getPendingEffectCount(): number {
  return pendingEffects.size + scheduledEffects.size;
}

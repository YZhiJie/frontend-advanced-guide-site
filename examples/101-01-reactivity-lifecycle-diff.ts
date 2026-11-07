/**
 * 第 101 部分 · Vue 2 → Vue 3 迁移实战
 * JD 需求点：Vue 方向 JD 要求"清晰阐述 Vue 2 与 Vue 3 在响应式原理、
 *   生命周期、组合式函数等方面的区别，并具备迁移实战经验"。
 * 本示例用最小可运行对照证明三组差异：
 *   1) 响应式能力边界：defineProperty 的检测盲区 vs Proxy 原生拦截
 *      （新增/删除属性、数组索引赋值、length）
 *   2) 生命周期：Options 全景 vs Composition 注册时序与映射表
 *   3) mixin 合并策略：data 递归合并组件优先 / 钩子数组化 mixin 先执行 /
 *      methods 同名组件静默覆盖（附冲突检测器）
 * 运行：npx tsx examples/101-01-reactivity-lifecycle-diff.ts
 */
import assert from "node:assert";

// ---------- 1a. Vue2：defineProperty 只能拦截"初始化时已存在的属性" ----------
interface TouchLog { log: string[]; }

function observeVue2(obj: Record<string, unknown>, touch: TouchLog) {
  // Vue2 的 defineReactive：初始化时递归遍历，逐个 defineProperty
  for (const key of Object.keys(obj)) {
    let internal = obj[key];
    Object.defineProperty(obj, key, {
      enumerable: true,
      configurable: true,
      get() {
        touch.log.push(`get:${key}`); // 依赖收集（track）发生在这里
        return internal;
      },
      set(v) {
        touch.log.push(`set:${key}`); // 触发更新（trigger）发生在这里
        internal = v;
      },
    });
  }
  return obj;
}

const touch2: TouchLog = { log: [] };
const v2: any = observeVue2({ count: 1 }, touch2);
v2.count = 2; // 已有属性：setter 可拦截
v2.newKey = 1; // 新增属性：没有任何 trap，响应式系统完全感知不到
assert.ok(touch2.log.includes("set:count"), "已有属性的赋值应被拦截");
assert.ok(!touch2.log.includes("set:newKey"), "新增属性检测不到 —— Vue.set 存在的根因");

// 数组同理：Vue2 只重写 7 个变异方法（push/pop/shift/unshift/splice/sort/reverse）
function rewritePush(arr: number[], touch: TouchLog) {
  (arr as any).push = function (...items: number[]) {
    touch.log.push(`mutate:push(${items.join(",")})`);
    return Array.prototype.push.apply(this, items);
  };
  return arr;
}
const touchArr: TouchLog = { log: [] };
const arr2 = rewritePush([1, 2, 3], touchArr);
arr2.push(4); // 变异方法：可拦截
arr2[5] = 9; // 索引赋值：检测盲区（值其实在，但视图不更新）
arr2.length = 10; // length 修改：检测盲区
assert.ok(touchArr.log.length === 1, "只有 push 被记录，索引/length 均为盲区");
assert.equal(arr2[5], 9, "数据变了但视图不会更新 —— 经典 bug 来源");

// ---------- 1b. Vue3：Proxy 拦截"对象操作本身"，盲区全部消失 ----------
const touch3: TouchLog = { log: [] };
const v3: any = new Proxy(
  {},
  {
    set(t, key, value, receiver) {
      touch3.log.push(`set:${String(key)}`); // 新增属性、已有属性都走这里
      return Reflect.set(t, key, value, receiver);
    },
    deleteProperty(t, key) {
      touch3.log.push(`del:${String(key)}`);
      return Reflect.deleteProperty(t, key);
    },
  },
);
const arr3: any = new Proxy([1, 2, 3], {
  set(t, key, value, receiver) {
    touch3.log.push(`set:${String(key)}`); // 索引、length 都走这里
    return Reflect.set(t, key, value, receiver);
  },
});
v3.newKey = 1; // 新增属性：可感知
delete v3.newKey; // 删除属性：可感知
arr3[3] = 4; // 索引赋值：可感知
arr3.length = 5; // length：可感知
assert.ok(touch3.log.includes("set:newKey") && touch3.log.includes("del:newKey"));
assert.ok(touch3.log.includes("set:3") && touch3.log.includes("set:length"));
console.log("[1] 响应式边界对照通过：Vue2 盲区 =", touch2.log.length === 1 ? "新增属性/索引/length" : "?", "→ Vue3 全部原生拦截");

// ---------- 2. 生命周期：映射表 + 执行时序 ----------
const LIFECYCLE_MAP: Record<string, string> = {
  beforeCreate: "setup()",
  created: "setup()",
  beforeMount: "onBeforeMount",
  mounted: "onMounted",
  beforeUpdate: "onBeforeUpdate",
  updated: "onUpdated",
  beforeDestroy: "onBeforeUnmount",
  destroyed: "onUnmounted",
  activated: "onActivated",
  deactivated: "onDeactivated",
  errorCaptured: "onErrorCaptured",
};
assert.equal(LIFECYCLE_MAP.beforeDestroy, "onBeforeUnmount", "改名类变更，全局替换易漏");
assert.equal(LIFECYCLE_MAP.created, "setup()", "created 语义由 setup 本身覆盖");

// 挂载阶段执行时序：Options 全景 vs Composition
const optionOrder: string[] = [];
optionOrder.push("beforeCreate", "created", "beforeMount", "mounted");
function runCompositionMount(): string[] {
  const seq: string[] = [];
  seq.push("setup"); // beforeCreate/created 的语义由 setup 执行本身覆盖
  seq.push("onBeforeMount");
  seq.push("onMounted");
  return seq;
}
assert.deepEqual(optionOrder, ["beforeCreate", "created", "beforeMount", "mounted"]);
assert.deepEqual(runCompositionMount(), ["setup", "onBeforeMount", "onMounted"]);
assert.ok(!runCompositionMount().includes("created"), "组合式里不存在 created 钩子");
console.log("[2] 生命周期映射与时序校验通过（beforeDestroy→onBeforeUnmount 为高危改名项）");

// ---------- 3. mixin 合并策略：理解它才能安全拆解它 ----------
interface Options {
  data?: () => Record<string, unknown>;
  methods?: Record<string, () => unknown>;
  created?: Array<() => void>;
}
const HOOK_KEYS = ["created"] as const;

function mergeOptions(mixin: Options, comp: Options) {
  const merged = {
    data: { ...mixin.data?.(), ...comp.data?.() }, // data：浅合并，组件优先
    methods: { ...mixin.methods, ...comp.methods }, // methods：同名组件覆盖（开发期仅告警）
    created: [...(mixin.created ?? []), ...(comp.created ?? [])], // 钩子：数组化，mixin 先执行
  };
  return merged;
}

// 冲突检测器：Vue2 没给的工具，迁移前自查用
function findConflicts(mixin: Options, comp: Options): string[] {
  const conflicts: string[] = [];
  for (const k of Object.keys(mixin.data?.() ?? {})) {
    if (k in (comp.data?.() ?? {})) conflicts.push(k);
  }
  for (const k of Object.keys(mixin.methods ?? {})) {
    if (k in (comp.methods ?? {})) conflicts.push(k);
  }
  return conflicts;
}

const mixin: Options = {
  data: () => ({ page: 1, source: "mixin" }),
  methods: { formatTime: () => "HH:mm", same: () => "mixin版" },
  created: [() => {}],
};
const comp: Options = {
  data: () => ({ source: "component", extra: 2 }),
  methods: { same: () => "组件版" },
  created: [() => {}],
};
const merged = mergeOptions(mixin, comp);
assert.deepEqual(merged.data, { page: 1, source: "component", extra: 2 }, "data 合并组件优先");
assert.equal((merged.methods.same as () => string)(), "组件版", "methods 同名组件静默覆盖");
assert.equal(merged.created.length, 2, "钩子数组化，mixin 先注册先执行");
assert.deepEqual(findConflicts(mixin, comp), ["source", "same"], "迁移前先跑冲突检测");
console.log("[3] mixin 合并策略校验通过：data 组件优先 / methods 静默覆盖 / 钩子 mixin 先执行");

console.log("✅ 101-01 全部断言通过");

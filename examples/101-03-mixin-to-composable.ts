/**
 * 第 101 部分 · Vue 2 → Vue 3 迁移实战
 * mixin → composable 的等价改造对照：
 *   1) 用 Vue2 的真实实例化方式（data() 得 state、methods bind this）跑一个
 *      "分页列表" mixin，与等价 composable 在同一 fetcher 脚本下产生一致轨迹
 *   2) 展示改造顺带修复的经典缺陷：无守卫的 async 赋值导致过期响应覆盖新数据
 *      （mixin 版复现 bug，composable 版用请求序号守卫修复）
 *   3) 演示组合式的显式 API：调用方解构重命名，命名冲突从静默覆盖变显式决策
 * 运行：npx tsx examples/101-03-mixin-to-composable.ts
 */
import assert from "node:assert";

type Fetcher = (page: number, pageSize: number) => Promise<number[]>;

// 最小 ref 实现：包装对象保证跨函数传递 / 解构不丢响应语义
function ref<T>(initial: T): { value: T } {
  return { value: initial };
}

// ---------- 1. Vue2 mixin 形态 ----------
function createPaginationMixin() {
  return {
    data() {
      return { page: 1, pageSize: 10, list: [] as number[] };
    },
    methods: {
      async load(this: any, fetcher: Fetcher) {
        this.list = await fetcher(this.page, this.pageSize);
      },
      nextPage(this: any) {
        this.page += 1;
      },
      prevPage(this: any) {
        this.page = Math.max(1, this.page - 1);
      },
    },
  };
}

// 复刻 Vue2 的实例化：data() 得到响应式 state，methods bind(this) 平铺挂载
function instantiateMixin(mixin: ReturnType<typeof createPaginationMixin>) {
  const inst: any = { ...mixin.data() };
  for (const [k, fn] of Object.entries(mixin.methods)) {
    inst[k] = (fn as any).bind(inst);
  }
  return inst as {
    page: number;
    pageSize: number;
    list: number[];
    load(f: Fetcher): Promise<void>;
    nextPage(): void;
    prevPage(): void;
  };
}

// ---------- 2. Vue3 composable 形态：逻辑等价 + API 显式 ----------
function usePagination(fetcher: Fetcher) {
  const page = ref(1);
  const pageSize = ref(10);
  const list = ref<number[]>([]);
  async function load() {
    list.value = await fetcher(page.value, pageSize.value);
  }
  function nextPage() {
    page.value += 1;
  }
  function prevPage() {
    page.value = Math.max(1, page.value - 1);
  }
  // 显式返回：来源可见、可重命名、可被 TS 推导 —— 与 mixin 的本质区别
  return { page, pageSize, list, load, nextPage, prevPage };
}

// ---------- 3. 等价性验收：同一脚本，两版轨迹与终态一致 ----------
const trace: string[] = [];
const scripted: Fetcher = (p, s) => {
  trace.push(`fetch p=${p} s=${s}`);
  return Promise.resolve(Array.from({ length: s }, (_, i) => p * 100 + i));
};

const m = instantiateMixin(createPaginationMixin());
m.nextPage(); // page: 1 → 2
await m.load(scripted);
const traceAfterMixin = [...trace];
assert.deepEqual(traceAfterMixin, ["fetch p=2 s=10"]);

trace.length = 0;
const c = usePagination(scripted);
c.nextPage(); // page.value: 1 → 2
await c.load();
assert.deepEqual(trace, traceAfterMixin, "两版产生完全一致的请求轨迹");
assert.equal(c.page.value, m.page, "翻页后状态一致");
assert.deepEqual(c.list.value, m.list, "列表终态一致");
console.log("[1] 等价性验收通过：轨迹 =", traceAfterMixin, "终态 page =", m.page, "list.length =", m.list.length);

// ---------- 4. 改造顺带修复的缺陷：过期响应覆盖（race） ----------
// 场景：连续两次翻页，第一次请求慢、第二次快；无守卫时旧响应最后落袋覆盖新数据
const slowThenFast: Fetcher = (p) =>
  new Promise((resolve) => setTimeout(() => resolve([p]), p === 1 ? 40 : 5));

const buggy = instantiateMixin(createPaginationMixin());
buggy.page = 1;
const p1 = buggy.load(slowThenFast); // 慢请求：40ms 后返回 [1]
buggy.page = 2;
const p2 = buggy.load(slowThenFast); // 快请求：5ms 后返回 [2]
await Promise.all([p1, p2]);
assert.deepEqual(buggy.list, [1], "mixin 版复现 bug：过期响应 [1] 覆盖了新数据");

function usePaginationSafe(fetcher: Fetcher) {
  const page = ref(1);
  const list = ref<number[]>([]);
  let seq = 0; // 请求序号：只采纳最新一次
  async function load() {
    const id = ++seq;
    const data = await fetcher(page.value, 10);
    if (id === seq) list.value = data; // 过期响应直接丢弃
  }
  function nextPage() {
    page.value += 1;
  }
  return { page, list, load, nextPage };
}
const safe = usePaginationSafe(slowThenFast);
const s1 = safe.load(); // 慢（p=1）
safe.nextPage(); // page → 2
const s2 = safe.load(); // 快（p=2）
await Promise.all([s1, s2]);
assert.deepEqual(safe.list.value, [2], "composable 版：序号守卫保证最新请求胜出");
console.log("[2] 竞态修复验收通过：mixin 终态 =", buggy.list, "→ composable 终态 =", safe.list.value);

// ---------- 5. 显式 API 的额外收益：解构重命名解决命名冲突 ----------
const orderList = usePagination(scripted);
// 调用方作用域已有 page 变量时，解构处显式重命名（mixin 只能静默覆盖或全局改名）
const { page: orderPage, load: loadOrder } = orderList;
assert.ok(orderPage.value === 1 && typeof loadOrder === "function", "显式解构 + 重命名 = 冲突变决策");
console.log("[3] 显式 API 验收通过：命名冲突从静默覆盖变成显式重命名");

console.log("✅ 101-03 全部断言通过");

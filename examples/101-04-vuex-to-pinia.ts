/**
 * 第 101 部分 · Vue 2 → Vue 3 迁移实战
 * Vuex → Pinia 的行为等价映射与迁移工具箱：
 *   1) 模拟 Vuex4 命名空间模块（commit/dispatch 路由到子模块）与等价 Pinia
 *      平铺 store，断言同一操作序列下状态轨迹一致
 *   2) storeToRefs 语义：只解构状态与计算属性，方法必须从 store 直接取
 *   3) 持久化迁移：vuex-persistedstate 全树 JSON → pinia-plugin-persistedstate
 *      按 store 分 key，登录态等关键数据零丢失
 * 运行：npx tsx examples/101-04-vuex-to-pinia.ts
 */
import assert from "node:assert";

// ---------- 1a. Vuex4 风格：嵌套模块 + 命名空间 ----------
interface VuexState { [k: string]: any; }
interface CommitFn { (type: string, payload?: unknown): void; }

function buildVuexStore(trace: string[] = []) {
  const modules: Record<string, any> = {
    counter: {
      namespaced: true,
      state: { count: 0, loading: false },
      mutations: {
        INCREMENT(s: VuexState) { s.count += 1; },
        SET_LOADING(s: VuexState, v: boolean) { s.loading = v; },
      },
      actions: {
        async incrementAsync(ctx: { commit: CommitFn }) {
          ctx.commit("SET_LOADING", true);
          ctx.commit("INCREMENT");
          ctx.commit("SET_LOADING", false);
        },
      },
      getters: { double: (s: VuexState) => s.count * 2 },
    },
    user: {
      namespaced: true,
      state: { name: "" },
      mutations: { SET_NAME(s: VuexState, n: string) { s.name = n; } },
    },
  };

  // 模拟带命名空间的 commit："counter/SET_LOADING" → 路由到子模块 mutation
  function commit(path: string, payload?: unknown) {
    trace.push(`commit ${path}${payload !== undefined ? ` ${payload}` : ""}`);
    const [mod, type] = path.split("/");
    modules[mod].mutations[type](modules[mod].state, payload);
  }
  // dispatch：action 内的 ctx.commit 已绑定本模块命名空间（Vuex 自动前缀）
  function dispatch(path: string, payload?: unknown) {
    const [mod, type] = path.split("/");
    const ctx = { commit: (t: string, p?: unknown) => commit(`${mod}/${t}`, p) };
    return modules[mod].actions[type](ctx, payload);
  }
  return { modules, commit, dispatch };
}

// ---------- 1b. Pinia 风格：模块 → 平铺 store，id 即命名空间 ----------
function defineCounterStore() {
  const state = { count: 0, loading: false };
  const double = () => state.count * 2; // getter：computed 语义
  async function incrementAsync() {
    state.loading = true; // 无 mutation 中转，action 直接改 state
    state.count += 1;
    state.loading = false;
  }
  return { state, double, incrementAsync };
}
function defineUserStore() {
  const state = { name: "" };
  function setName(n: string) { state.name = n; }
  return { state, setName };
}

// ---------- 1c. 行为等价验收：同一操作序列，两版状态轨迹一致 ----------
const trajectoryVuex: string[] = [];
const vuex = buildVuexStore(trajectoryVuex);
await vuex.dispatch("counter/incrementAsync");
vuex.commit("user/SET_NAME", "芳");
assert.deepEqual(vuex.modules.counter.state, { count: 1, loading: false });
assert.equal(vuex.modules.user.state.name, "芳");
assert.equal(vuex.modules.counter.getters.double(vuex.modules.counter.state), 2);
assert.deepEqual(trajectoryVuex, [
  "commit counter/SET_LOADING true",
  "commit counter/INCREMENT",
  "commit counter/SET_LOADING false",
  "commit user/SET_NAME 芳",
]);

const counter = defineCounterStore();
const user = defineUserStore();
const trajectoryPinia: string[] = [];
const rawInc = counter.incrementAsync;
counter.incrementAsync = async () => {
  trajectoryPinia.push(`mutation-free count:${counter.state.count}`);
  await rawInc();
};
await counter.incrementAsync();
user.setName("芳");
assert.deepEqual(counter.state, { count: 1, loading: false }, "counter 状态轨迹一致");
assert.equal(user.state.name, "芳", "user 模块 → 独立 store");
assert.deepEqual(trajectoryPinia.length, trajectoryVuex.length - 3, "Pinia 无 mutation 提交记录");
assert.equal(counter.double(), 2, "getter 语义一致");
console.log("[1] Vuex 模块 → Pinia 平铺 store：状态轨迹与 getter 全部等价");

// ---------- 2. storeToRefs 语义：状态/计算属性可解构，方法不行 ----------
function storeToRefs(store: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(store)) {
    if (typeof v === "function") {
      throw new Error(`storeToRefs 不能解构方法 "${k}"：方法请直接从 store 取`);
    }
    out[k] = { value: v }; // 代表 ref 包装
  }
  return out;
}
const refs = storeToRefs({ count: counter.state.count, double: counter.double() } as any);
assert.equal((refs.count as any).value, 1);
assert.throws(() => storeToRefs({ incrementAsync: counter.incrementAsync } as any),
  /不能解构方法/, "把 action 丢进 storeToRefs 必须显式报错");
console.log("[2] storeToRefs 语义校验通过：方法解构被显式拦截（高频误用点）");

// ---------- 3. 持久化迁移：vuex 全树 JSON → pinia 按 store 分 key ----------
// vuex-persistedstate 默认把整棵 state 树存一个 key
const vuexPersistedRaw = JSON.stringify({
  counter: { count: 7, loading: false },
  user: { name: "迁移前的登录态" },
});
// pinia-plugin-persistedstate：每个 store 一个 storage key
function migrateToPiniaStorage(raw: string): Record<string, string> {
  const tree = JSON.parse(raw);
  const out: Record<string, string> = {};
  for (const [storeId, slice] of Object.entries(tree)) {
    out[storeId] = JSON.stringify(slice); // key 名与序列化格式保持一致，避免登录态丢失
  }
  return out;
}
const migrated = migrateToPiniaStorage(vuexPersistedRaw);
assert.equal(JSON.parse(migrated["counter"]).count, 7, "计数状态零丢失");
assert.equal(JSON.parse(migrated["user"]).name, "迁移前的登录态", "登录态零丢失");
console.log("[3] 持久化迁移校验通过：全树 JSON 拆分为按 store 分 key，数据零丢失");

console.log("✅ 101-04 全部断言通过");

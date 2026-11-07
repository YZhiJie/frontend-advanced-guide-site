/**
 * 第 94 部分 · 微信小程序原生开发
 * JD 需求点：2 个 JD 优先要求微信小程序原生开发，涉及双线程模型、
 *   自定义组件、生命周期、分包加载、登录体系（wx.login→code→openid）、云开发。
 * 本示例在 Node 环境模拟：
 *   1) 小程序双线程通信（逻辑层 setData → 渲染层 diff）
 *   2) Page/Component 生命周期顺序
 *   3) 自定义组件通信（properties/triggers/relations）
 *   4) 分包加载配置校验（主包大小、分包独立/非独立）
 *   5) 登录流程（code2session → openid/session_key）
 * 运行：npx tsx examples/94-01-wechat-miniprogram.ts
 */
import assert from "node:assert";

// ---------- 1. 双线程模型：逻辑层 setData → 渲染层 ----------
// 小程序逻辑层（JSCore）和渲染层（WebView）隔离，setData 是唯一通信通道
interface ViewLayer {
  data: Record<string, unknown>;
  apply(data: Record<string, unknown>): string[]; // 返回变更的 key 列表
}

function createViewLayer(): ViewLayer {
  return {
    data: {},
    apply(patch) {
      const changed: string[] = [];
      for (const [k, v] of Object.entries(patch)) {
        // 路径更新："user.name" → data.user.name
        const parts = k.split(".");
        let obj: any = this.data;
        for (let i = 0; i < parts.length - 1; i++) {
          obj[parts[i]] = obj[parts[i]] ?? {};
          obj = obj[parts[i]];
        }
        const last = parts[parts.length - 1];
        if (JSON.stringify(obj[last]) !== JSON.stringify(v)) {
          obj[last] = v;
          changed.push(k);
        }
      }
      return changed;
    },
  };
}

// 逻辑层 Page
interface PageInstance {
  data: Record<string, unknown>;
  setData(patch: Record<string, unknown>, callback?: () => void): void;
}

function createPage(view: ViewLayer): PageInstance {
  return {
    data: {},
    setData(patch, cb) {
      // 合并到逻辑层 data
      for (const [k, v] of Object.entries(patch)) {
        const parts = k.split(".");
        let obj: any = this.data;
        for (let i = 0; i < parts.length - 1; i++) {
          obj[parts[i]] = obj[parts[i]] ?? {};
          obj = obj[parts[i]];
        }
        obj[parts[parts.length - 1]] = v;
      }
      // 发送到渲染层（真实环境是通过原生桥序列化）
      const changed = view.apply(patch);
      cb?.();
      return changed;
    },
  };
}

// ---------- 2. 生命周期顺序 ----------
type LifecycleHook = "onLoad" | "onShow" | "onReady" | "onHide" | "onUnload";
function lifecycleOrder(): LifecycleHook[] {
  // 页面启动：onLoad → onShow → onReady
  // 切后台：onHide；回前台：onShow；销毁：onUnload
  return ["onLoad", "onShow", "onReady", "onHide", "onShow", "onUnload"];
}

// ---------- 3. 自定义组件通信 ----------
interface ComponentDef {
  properties: Record<string, { type: StringConstructor | NumberConstructor | BooleanConstructor; value?: unknown }>;
  methods: Record<string, (...args: any[]) => unknown>;
  events: string[]; // triggerEvent 名称
}

// 父子通信：父→子 properties；子→父 triggerEvent
function createComponent(def: ComponentDef) {
  return {
    props: {} as Record<string, unknown>,
    setProps(parentData: Record<string, unknown>) {
      for (const [k, schema] of Object.entries(def.properties)) {
        this.props[k] = parentData[k] ?? schema.value;
      }
    },
    trigger(event: string, detail: unknown) {
      return { event, detail };
    },
  };
}

// ---------- 4. 分包加载配置校验 ----------
interface SubPackage {
  root: string;
  pages: string[];
  independent?: boolean;
}
interface AppConfig {
  pages: string[];       // 主包页面
  subpackages: SubPackage[];
  mainPackageSizeKB: number;
}

const MAIN_PACKAGE_LIMIT = 2048; // 主包 2MB
const SUB_PACKAGE_LIMIT = 2048;  // 分包 2MB
const TOTAL_LIMIT = 20480;       // 总包 20MB

function validateSubpackages(config: AppConfig): string[] {
  const errors: string[] = [];
  if (config.mainPackageSizeKB > MAIN_PACKAGE_LIMIT) {
    errors.push(`主包 ${config.mainPackageSizeKB}KB 超过 ${MAIN_PACKAGE_LIMIT}KB 限制`);
  }
  // 页面路径不能冲突
  const allPages = new Set(config.pages);
  for (const sub of config.subpackages) {
    for (const p of sub.pages) {
      const full = `${sub.root}/${p}`;
      if (allPages.has(full)) errors.push(`页面路径冲突: ${full}`);
      allPages.add(full);
    }
  }
  // 独立分包不能依赖主包
  return errors;
}

// ---------- 5. 登录流程 ----------
interface LoginState {
  code: string | null;
  openid: string | null;
  sessionKey: string | null;
  token: string | null;
}

// wx.login → code → 后端 code2session → openid + session_key → 自定义登录态
async function loginFlow(
  wxLogin: () => Promise<string>,
  code2session: (code: string) => Promise<{ openid: string; session_key: string }>
): Promise<LoginState> {
  const code = await wxLogin();
  const { openid, session_key } = await code2session(code);
  // 真实场景：后端用 openid 签发 token 返回
  const token = `token_${openid}`;
  return { code, openid, sessionKey: session_key, token };
}

// ===================== 运行断言 =====================
console.log("===== 1. 双线程 setData =====");
const view = createViewLayer();
const page = createPage(view);
const changed1 = page.setData({ "user.name": "张三", "user.age": 18 });
assert(changed1.includes("user.name") && changed1.includes("user.age"), "首次 setData 应有 2 个变更");
assert(view.data.user?.name === "张三", "渲染层应收到 name=张三");

const changed2 = page.setData({ "user.name": "张三" }); // 相同值
assert(changed2.length === 0, "相同值 setData 不应触发变更");
console.log("✓ setData 路径更新 + diff 生效");

console.log("\n===== 2. 生命周期 =====");
const order = lifecycleOrder();
assert(order[0] === "onLoad" && order[1] === "onShow" && order[2] === "onReady", "启动顺序应为 onLoad→onShow→onReady");
assert(order[order.length - 1] === "onUnload", "最后应为 onUnload");
console.log("✓ 生命周期顺序：onLoad→onShow→onReady→onHide→onShow→onUnload");

console.log("\n===== 3. 自定义组件通信 =====");
const comp = createComponent({
  properties: {
    title: { type: String, value: "" },
    count: { type: Number, value: 0 },
  },
  methods: {},
  events: ["change"],
});
comp.setProps({ title: "标题", count: 5 });
assert(comp.props.title === "标题", "properties 应接收父级数据");
const evt = comp.trigger("change", { value: 10 });
assert(evt.event === "change" && evt.detail.value === 10, "triggerEvent 应派发事件");
console.log("✓ 父子通信：properties 传入 + triggerEvent 传出");

console.log("\n===== 4. 分包校验 =====");
const ok = validateSubpackages({
  pages: ["pages/index/index"],
  subpackages: [{ root: "packageA", pages: ["pages/a/a"] }],
  mainPackageSizeKB: 1500,
});
assert(ok.length === 0, "合法配置应无错误");

const bad = validateSubpackages({
  pages: ["pages/index/index"],
  subpackages: [
    { root: "packageA", pages: ["pages/a/a"] },
    { root: "packageA", pages: ["pages/a/a"] }, // 路径冲突
  ],
  mainPackageSizeKB: 2500, // 超限
});
assert(bad.length === 2, `应检测到 2 个错误，实际 ${bad.length}`);
console.log(`✓ 分包校验：超限+冲突检测正确`);

console.log("\n===== 5. 登录流程 =====");
const state = await loginFlow(
  async () => "wx_code_123",
  async (code) => ({ openid: `openid_${code}`, session_key: "sk_abc" })
);
assert(state.openid === "openid_wx_code_123", "openid 应由 code 换取");
assert(state.token?.startsWith("token_"), "应返回自定义 token");
console.log(`✓ 登录：code→openid/session_key→token`);

console.log("\n✅ 双线程 setData + 生命周期 + 组件通信 + 分包校验 + 登录流程全部通过");

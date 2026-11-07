/**
 * 第 98 部分 · 微前端架构
 * JD 需求点：大型 B 端 JD 要求"微前端架构经验、qiankun/Module Federation、
 *   多团队协作、子应用隔离、样式/JS 沙箱"。微前端解决巨石应用拆分、多技术栈共存、
 *   独立部署的问题。
 * 本示例在 Node 环境模拟：
 *   1) 应用注册表 + 生命周期调度（bootstrap→mount→unmount）
 *   2) JS 沙箱（Proxy 代理 window，隔离全局变量污染）
 *   3) 样式隔离（CSS 作用域前缀 + shadow DOM 思路）
 *   4) 三种方案对比（qiankun / Module Federation / wujie）的特征矩阵
 *   5) 全局通信总线（事件 + 状态共享）
 * 运行：npx tsx examples/98-01-micro-frontend.ts
 */
import assert from "node:assert";

// ---------- 1. 应用注册与生命周期 ----------
type AppStatus = "NOT_LOADED" | "LOADING" | "BOOTSTRAPPING" | "MOUNTED" | "UNMOUNTING";

interface MicroApp {
  name: string;
  entry: string;
  activeWhen: (location: string) => boolean;
  lifecycle: {
    bootstrap?: () => Promise<void>;
    mount: (props: Record<string, unknown>) => Promise<void>;
    unmount: (props: Record<string, unknown>) => Promise<void>;
  };
  status: AppStatus;
}

class MicroFrontendRegistry {
  private apps = new Map<string, MicroApp>();
  private current: string | null = null;

  register(app: MicroApp) {
    this.apps.set(app.name, app);
  }

  // 路由匹配，激活对应子应用
  async route(location: string) {
    for (const app of this.apps.values()) {
      if (app.activeWhen(location)) {
        if (this.current && this.current !== app.name) {
          await this.unmount(this.current);
        }
        if (app.status === "NOT_LOADED") {
          app.status = "BOOTSTRAPPING";
          await app.lifecycle.bootstrap?.();
        }
        app.status = "MOUNTED";
        await app.lifecycle.mount({ container: `#${app.name}` });
        this.current = app.name;
        return;
      }
    }
    // 无匹配则卸载当前
    if (this.current) await this.unmount(this.current);
  }

  private async unmount(name: string) {
    const app = this.apps.get(name);
    if (!app || app.status !== "MOUNTED") return;
    app.status = "UNMOUNTING";
    await app.lifecycle.unmount({});
    app.status = "NOT_LOADED";
    if (this.current === name) this.current = null;
  }

  getCurrent() { return this.current; }
}

// ---------- 2. JS 沙箱：Proxy 隔离全局变量 ----------
// 子应用读写 window 时，用 Proxy 拦截，写入子应用私有副本，不污染主应用 window
class JSSandbox {
  private fakeWindow: Record<string, unknown> = {};
  private originalWindow: Record<string, unknown>;

  constructor(realWindow: Record<string, unknown>) {
    this.originalWindow = realWindow;
  }

  createProxy(): Record<string, unknown> {
    const self = this;
    return new Proxy(this.fakeWindow, {
      get(target, prop: string) {
        // 子应用私有优先，否则回退真实 window（只读）
        return prop in target ? target[prop] : self.originalWindow[prop];
      },
      set(target, prop: string, value) {
        // 所有写入都进私有副本，不污染主应用
        target[prop] = value;
        return true;
      },
      has(target, prop: string) {
        return prop in target || prop in self.originalWindow;
      },
    });
  }

  // 卸载时清空私有变量，防止内存泄漏
  destroy() {
    this.fakeWindow = {};
  }
}

// ---------- 3. 样式隔离：作用域前缀 ----------
// 给子应用 CSS 选择器加前缀，避免污染主应用
function scopeCSS(css: string, prefix: string): string {
  return css
    .split(/(?<=\})/)
    .map((rule) => {
      const match = rule.match(/^(.*?)\{/s);
      if (!match) return rule;
      const selectors = match[1].trim();
      const scoped = selectors
        .split(",")
        .map((s) => `${prefix} ${s.trim()}`)
        .join(", ");
      return rule.replace(match[1], ` ${scoped} `);
    })
    .join("");
}

// ---------- 4. 三种方案特征矩阵 ----------
interface MFSolution {
  name: "qiankun" | "module-federation" | "wujie";
  mechanism: "html-entry" | "runtime-remote" | "iframe-webcomponent";
  jsSandbox: "proxy-snapshot" | "none" | "iframe";
  cssIsolation: "scoped" | "shadow-dom" | "iframe";
  independentDeploy: boolean;
}

const solutions: MFSolution[] = [
  { name: "qiankun", mechanism: "html-entry", jsSandbox: "proxy-snapshot", cssIsolation: "scoped", independentDeploy: true },
  { name: "module-federation", mechanism: "runtime-remote", jsSandbox: "none", cssIsolation: "shadow-dom", independentDeploy: true },
  { name: "wujie", mechanism: "iframe-webcomponent", jsSandbox: "iframe", cssIsolation: "iframe", independentDeploy: true },
];

// 按场景选方案
function selectSolution(scene: { needIsolation: boolean; multiTech: boolean; legacyApps: boolean }): string {
  if (scene.legacyApps) return "wujie"; // 老旧应用用 iframe 最稳
  if (scene.multiTech) return "qiankun"; // 多技术栈 qiankun 更成熟
  return "module-federation"; // 同技术栈 MF 最自然
}

// ---------- 5. 全局通信总线 ----------
class GlobalEventBus {
  private listeners = new Map<string, Set<(data: unknown) => void>>();

  on(event: string, cb: (data: unknown) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => this.off(event, cb);
  }
  off(event: string, cb: (data: unknown) => void) {
    this.listeners.get(event)?.delete(cb);
  }
  emit(event: string, data: unknown) {
    this.listeners.get(event)?.forEach((cb) => cb(data));
  }
}

// ===================== 运行断言 =====================
console.log("===== 1. 应用注册与路由切换 =====");
const registry = new MicroFrontendRegistry();
let mounted = "";
registry.register({
  name: "app-order",
  entry: "//localhost:7101",
  activeWhen: (loc) => loc.startsWith("/order"),
  status: "NOT_LOADED",
  lifecycle: {
    async mount() { mounted = "app-order"; },
    async unmount() { mounted = ""; },
  },
});
registry.register({
  name: "app-user",
  entry: "//localhost:7102",
  activeWhen: (loc) => loc.startsWith("/user"),
  status: "NOT_LOADED",
  lifecycle: {
    async mount() { mounted = "app-user"; },
    async unmount() { mounted = ""; },
  },
});
await registry.route("/order/list");
assert(registry.getCurrent() === "app-order", "/order 应激活 app-order");
await registry.route("/user/profile");
assert(registry.getCurrent() === "app-user", "切到 /user 应激活 app-user 并卸载 order");
await registry.route("/home");
assert(registry.getCurrent() === null, "无匹配路由应卸载当前应用");
console.log("✓ 路由切换：order → user → 卸载，正确");

console.log("\n===== 2. JS 沙箱隔离 =====");
const realWindow: Record<string, unknown> = { location: "/", foo: "main" };
const sandbox = new JSSandbox(realWindow);
const proxy = sandbox.createProxy();
(proxy as any).bar = "sub-app";      // 子应用写入
assert((proxy as any).bar === "sub-app", "子应用能读到自己写入的变量");
assert(realWindow.bar === undefined, "主应用 window 不应被子应用污染");
assert((proxy as any).foo === "main", "子应用能读到主应用的只读全局变量");
sandbox.destroy();
console.log("✓ JS 沙箱：写入隔离，读取回退主应用");

console.log("\n===== 3. 样式隔离 =====");
const scoped = scopeCSS(".btn { color: red; } .title { font-size: 14px; }", "#app-order");
assert(scoped.includes("#app-order .btn"), "选择器应加前缀");
assert(scoped.includes("#app-order .title"), "多个选择器都应加前缀");
console.log("✓ 样式隔离：选择器加作用域前缀");

console.log("\n===== 4. 方案选型 =====");
assert(selectSolution({ needIsolation: true, multiTech: false, legacyApps: true }) === "wujie", "老旧应用选 wujie");
assert(selectSolution({ needIsolation: true, multiTech: true, legacyApps: false }) === "qiankun", "多技术栈选 qiankun");
assert(selectSolution({ needIsolation: true, multiTech: false, legacyApps: false }) === "module-federation", "同技术栈选 MF");
console.log("✓ 选型：wujie/qiankun/MF 路由正确");

console.log("\n===== 5. 全局通信总线 =====");
const bus = new GlobalEventBus();
let received: unknown = null;
const off = bus.on("user:login", (data) => { received = data; });
bus.emit("user:login", { token: "abc" });
assert(received && (received as any).token === "abc", "应收到登录事件");
off();
bus.emit("user:login", { token: "xyz" });
assert((received as any).token === "abc", "取消订阅后不应再收到");
console.log("✓ 通信总线：订阅/发布/取消订阅正确");

console.log("\n✅ 微前端注册路由 + JS 沙箱 + 样式隔离 + 方案选型 + 通信总线全部通过");

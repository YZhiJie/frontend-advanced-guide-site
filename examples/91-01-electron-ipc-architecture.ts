// 文件: examples/91-01-electron-ipc-architecture.ts
// ============ Electron 三层架构：main/preload/renderer IPC 通信 ============
// 对应 JD「Electron 多线程、主进程/渲染进程/preload、IPC、electron-builder 打包」。
// 当前 70 册偏 Tauri，本册深化 Electron。纯 TS 演示 IPC 通道设计、contextBridge、调用安全。硬断言直跑。

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ 断言失败：${msg}`);
    process.exit(1);
  }
}

// ---------------- 1. Electron 三层架构 ----------------
// main: 主进程，Node.js 环境，可访问 fs/net 等，管理窗口和生命周期
// preload: 预加载脚本，在渲染进程前执行，用 contextBridge 暴露受限 API
// renderer: 渲染进程，Chromium 环境，只能用 preload 暴露的 API，不能直接用 Node

export interface IpcChannel {
  name: string;
  /** 调用方向：renderer→main（invoke）还是 main→renderer（send） */
  direction: "invoke" | "send";
  /** 参数类型 schema（简化为字段名列表） */
  params: string[];
  /** 返回值类型 */
  returns: string;
  /** 是否需要权限校验 */
  requiresAuth: boolean;
}

/** IPC 通道注册表——所有跨进程通信必须先注册，防止未授权访问 */
export const IPC_CHANNELS: Record<string, IpcChannel> = {
  "fs:readFile": { name: "fs:readFile", direction: "invoke", params: ["path"], returns: "string", requiresAuth: false },
  "fs:writeFile": { name: "fs:writeFile", direction: "invoke", params: ["path", "content"], returns: "void", requiresAuth: true },
  "app:quit": { name: "app:quit", direction: "invoke", params: [], returns: "void", requiresAuth: true },
  "app:update-available": { name: "app:update-available", direction: "send", params: ["version"], returns: "void", requiresAuth: false },
  "window:minimize": { name: "window:minimize", direction: "invoke", params: [], returns: "void", requiresAuth: false },
  "shell:openExternal": { name: "shell:openExternal", direction: "invoke", params: ["url"], returns: "void", requiresAuth: false },
};

// ---------------- 2. contextBridge：安全暴露 API ----------------

/**
 * preload 脚本的核心：用 contextBridge 暴露受限 API 给渲染进程。
 * 渲染进程不能直接用 Node.js，只能通过 window.api 调用。
 */
export interface RendererAPI {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  quit: () => Promise<void>;
  minimize: () => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  onUpdateAvailable: (cb: (version: string) => void) => () => void;
}

/**
 * 校验渲染进程的调用是否合法：
 * 1. 通道必须已注册；
 * 2. 需要权限的通道必须带 token；
 * 3. 参数必须符合 schema。
 */
export function validateInvoke(channel: string, args: unknown[], authToken?: string): { ok: boolean; reason?: string } {
  const ch = IPC_CHANNELS[channel];
  if (!ch) return { ok: false, reason: `未注册的通道: ${channel}` };
  if (ch.direction !== "invoke") return { ok: false, reason: `通道 ${channel} 不是 invoke 类型` };
  if (ch.requiresAuth && !authToken) return { ok: false, reason: `通道 ${channel} 需要权限认证` };
  if (args.length !== ch.params.length) {
    return { ok: false, reason: `参数数量错误: 期望 ${ch.params.length}，实际 ${args.length}` };
  }
  return { ok: true };
}

// ---------------- 3. IPC 调用模拟 ----------------

class MockMainProcess {
  private files = new Map<string, string>();
  private authTokens = new Set<string>(["valid-token-123"]);
  private eventListeners = new Map<string, Set<(...args: unknown[]) => void>>();

  /** 主进程处理 invoke 请求 */
  handleInvoke(channel: string, args: unknown[], authToken?: string): unknown {
    const validation = validateInvoke(channel, args, authToken);
    if (!validation.ok) throw new Error(validation.reason);

    switch (channel) {
      case "fs:readFile":
        return this.files.get(args[0] as string) ?? null;
      case "fs:writeFile":
        this.files.set(args[0] as string, args[1] as string);
        return undefined;
      case "app:quit":
        return undefined; // 真实场景调用 app.quit()
      case "window:minimize":
        return undefined; // 真实场景调用 win.minimize()
      case "shell:openExternal":
        return undefined; // 真实场景调用 shell.openExternal()
      default:
        throw new Error(`未处理的通道: ${channel}`);
    }
  }

  /** 主进程主动向渲染进程发送事件 */
  send(channel: string, ...args: unknown[]): void {
    this.eventListeners.get(channel)?.forEach((cb) => cb(...args));
  }

  on(channel: string, cb: (...args: unknown[]) => void): () => void {
    if (!this.eventListeners.has(channel)) this.eventListeners.set(channel, new Set());
    this.eventListeners.get(channel)!.add(cb);
    return () => this.eventListeners.get(channel)?.delete(cb);
  }
}

// ---------------- 4. 打包配置校验（electron-builder） ----------------

export interface BuildConfig {
  appId: string;
  productName: string;
  mac: { target: string[]; category: string };
  win: { target: string[] };
  linux: { target: string[] };
  files: string[];
  /** asar 是否打包 */
  asar: boolean;
  /** 自动更新配置 */
  publish?: { provider: string; url: string };
}

/** 校验打包配置是否合法 */
export function validateBuildConfig(config: BuildConfig): string[] {
  const errors: string[] = [];
  if (!config.appId) errors.push("appId 不能为空");
  if (!config.productName) errors.push("productName 不能为空");
  if (config.mac.target.length === 0) errors.push("mac 至少要有一个 target");
  if (!config.files.includes("dist/**")) errors.push("files 必须包含构建产物 dist/**");
  if (config.asar && config.files.includes("*.node")) {
    // .node 原生模块在 asar 里可能加载失败，需要 unpack
    errors.push("asar 模式下 .node 原生模块需要配置 asarUnpack");
  }
  return errors;
}

// ---------------- 演示与断言 ----------------

function main(): void {
  console.log("===== 1. IPC 通道校验 =====");
  // 未注册通道
  assert(validateInvoke("fs:deleteFile", []).ok === false, "未注册通道被拦截");
  // invoke 通道可以正常调用
  assert(validateInvoke("fs:readFile", ["/tmp/a.txt"]).ok === true, "readFile 通道合法");
  // 需要权限的通道不带 token 被拦截
  assert(validateInvoke("app:quit", []).ok === false, "quit 需要 token");
  assert(validateInvoke("app:quit", [], "valid-token-123").ok === true, "带 token 可调用 quit");
  // 参数数量错误
  assert(validateInvoke("fs:readFile", []).ok === false, "readFile 缺参数被拦截");
  console.log("✓ IPC 通道校验：未注册/无权限/参数错误 都被拦截");

  console.log("\n===== 2. 主进程处理 invoke =====");
  const main = new MockMainProcess();
  // 写文件
  main.handleInvoke("fs:writeFile", ["/data/test.txt", "hello"], "valid-token-123");
  // 读文件
  const content = main.handleInvoke("fs:readFile", ["/data/test.txt"]) as string;
  assert(content === "hello", "读写文件正常");
  console.log("✓ 主进程 invoke 处理：writeFile → readFile 正常");

  console.log("\n===== 3. 主进程推送事件到渲染进程 =====");
  let receivedVersion = "";
  main.on("app:update-available", (v) => { receivedVersion = v as string; });
  main.send("app:update-available", "2.0.0");
  assert(receivedVersion === "2.0.0", "渲染进程收到更新事件");
  console.log("✓ 主进程推送 update-available 事件，渲染进程收到 2.0.0");

  console.log("\n===== 4. 打包配置校验 =====");
  const validConfig: BuildConfig = {
    appId: "com.example.app",
    productName: "MyApp",
    mac: { target: ["dmg"], category: "public.app-category.productivity" },
    win: { target: ["nsis"] },
    linux: { target: ["AppImage"] },
    files: ["dist/**", "package.json"],
    asar: true,
    publish: { provider: "generic", url: "https://example.com/releases" },
  };
  assert(validateBuildConfig(validConfig).length === 0, "合法配置无错误");

  const invalidConfig: BuildConfig = {
    ...validConfig,
    appId: "",
    files: ["src/**"], // 缺少 dist
  };
  const errs = validateBuildConfig(invalidConfig);
  assert(errs.includes("appId 不能为空"), "appId 为空被检测");
  assert(errs.some((e) => e.includes("dist")), "缺少 dist 被检测");
  console.log(`✓ 配置校验：合法无错，非法检测到 ${errs.length} 个问题`);

  console.log("\n✅ Electron 三层架构 + IPC 校验 + 事件推送 + 打包配置全部通过");
}

main();

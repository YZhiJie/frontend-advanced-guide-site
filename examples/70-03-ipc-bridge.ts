// 文件: examples/70-03-ipc-bridge.ts —— IPC 命令桥模拟：类型安全 invoke + 序列化边界 + 能力 allowlist

/** ============ ① 命令清单：前后端共享的「契约层」 ============
 * 真实项目里这份类型由 Rust 侧的 serde 定义生成（tauri-specta），
 * 前端不手写——保证 TS 类型与 Rust 结构体永远对齐。
 */
interface CommandTable {
  getAppVersion: { args: Record<string, never>; result: string };
  readTextFile: { args: { path: string }; result: string };
  writeConfig: { args: { key: string; value: string }; result: null };
  takeScreenshot: { args: { windowLabel: string }; result: string };
}

/** Rust 侧错误的统一传递约定：业务错误必须是结构化对象，不是裸字符串 */
interface BridgeError {
  code: "PERMISSION_DENIED" | "NOT_FOUND" | "IO_ERROR" | "INVALID_ARGS";
  message: string;
}

type BridgeResult<T> = { ok: true; data: T } | { ok: false; error: BridgeError };

/** ============ ② 序列化边界：Tauri IPC 走 JSON，JS 里很多东西过不去 ============ */
class SerializationError extends Error {}

function assertSerializable(value: unknown, path = "args"): void {
  // null / 布尔 / 数字 / 字符串：JSON 原生支持
  if (value === null) return;
  const t = typeof value;
  if (t === "boolean" || t === "string") return;
  if (t === "number") {
    if (!Number.isFinite(value as number)) {
      throw new SerializationError(`${path}: NaN/Infinity 无法 JSON 序列化，请显式转成字符串`);
    }
    return;
  }
  if (t === "bigint") {
    throw new SerializationError(`${path}: BigInt 不在 JSON 边界内，请用字符串表示大整数`);
  }
  if (t === "function" || t === "symbol") {
    throw new SerializationError(`${path}: ${t} 无法跨越 IPC 边界（函数没有序列化语义）`);
  }
  if (t === "undefined") {
    throw new SerializationError(`${path}: undefined 会被 JSON 静默丢弃，请用 null 显式表达空值`);
  }
  // 对象：只放行纯数据——数组与「普通对象字面量」
  if (value instanceof Date) {
    throw new SerializationError(`${path}: Date 序列化后类型丢失，请显式 toISOString()`);
  }
  if (value instanceof Map || value instanceof Set) {
    throw new SerializationError(`${path}: Map/Set 不在 JSON 边界内，请转成数组/对象再传`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertSerializable(item, `${path}[${i}]`));
    return;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new SerializationError(`${path}: 类实例跨边界会丢失方法，请传纯数据对象`);
  }
  // 普通对象：递归校验 + 环检测
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    assertSerializable(v, `${path}.${k}`);
  }
}

/** 环检测：JSON.stringify 遇到循环引用会抛 TypeError，我们提前给出可读的报错 */
function assertNoCircular(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null) return;
  if (seen.has(value as object)) {
    throw new SerializationError("检测到循环引用：IPC 参数必须是树形结构");
  }
  seen.add(value as object);
  for (const v of Object.values(value as Record<string, unknown>)) assertNoCircular(v, seen);
  seen.delete(value as object);
}

/** ============ ③ 能力 allowlist：每个窗口只拿到自己声明过的命令 ============ */
interface Capability {
  windowLabel: string;
  allow: (keyof CommandTable)[];
}

const CAPABILITIES: Capability[] = [
  { windowLabel: "main", allow: ["getAppVersion", "readTextFile", "writeConfig"] },
  // 设置窗口不需要截图能力 → 不声明，调用即拦截
  { windowLabel: "settings", allow: ["getAppVersion", "writeConfig"] },
];

class PermissionDeniedError extends Error {
  readonly code = "PERMISSION_DENIED" as const;
}

/** ============ ④ Rust 侧命令实现（模拟） ============ */
const rustHandlers: {
  [K in keyof CommandTable]: (args: CommandTable[K]["args"]) => BridgeResult<CommandTable[K]["result"]>;
} = {
  getAppVersion: () => ({ ok: true, data: "2.4.0" }),
  readTextFile: ({ path }) => {
    if (path.includes("..")) {
      return { ok: false, error: { code: "PERMISSION_DENIED", message: "路径穿越被拒绝" } };
    }
    if (!path.endsWith(".txt")) {
      return { ok: false, error: { code: "NOT_FOUND", message: `文件不存在: ${path}` } };
    }
    return { ok: true, data: `（模拟文件内容 of ${path}）` };
  },
  writeConfig: () => ({ ok: true, data: null }),
  takeScreenshot: ({ windowLabel }) => ({
    ok: true,
    data: `screenshot-of-${windowLabel}.png`,
  }),
};

/** ============ ⑤ 前端侧类型安全 invoke 封装 ============ */
function createInvoker(windowLabel: string) {
  const cap = CAPABILITIES.find((c) => c.windowLabel === windowLabel);
  if (!cap) throw new Error(`窗口 ${windowLabel} 未注册任何能力`);

  return async function invoke<K extends keyof CommandTable>(
    cmd: K,
    args: CommandTable[K]["args"],
  ): Promise<CommandTable[K]["result"]> {
    // 第一关：能力 allowlist（对应 Tauri 2 的 capabilities 配置文件）
    if (!cap.allow.includes(cmd)) {
      throw new PermissionDeniedError(
        `窗口 ${windowLabel} 未声明能力 ${String(cmd)}，调用被 allowlist 拦截`,
      );
    }
    // 第二关：序列化边界（对应 Tauri invoke 的 serde_json 序列化）
    // 注意顺序：必须先做环检测，否则递归校验会在循环引用上栈溢出
    assertNoCircular(args);
    assertSerializable(args);
    // 第三关：真正跨进程（这里同步模拟），Rust 返回 Result<T, E> 风格的结构
    const result = rustHandlers[cmd](args as never) as BridgeResult<CommandTable[K]["result"]>;
    // 第四关：错误传递约定——Rust 的 Err 必须变成前端的 reject，且保留结构化 code
    if (!result.ok) {
      const err = new Error(result.error.message) as Error & { code: string };
      err.code = result.error.code;
      throw err;
    }
    return result.data;
  };
}

/** ============ ⑥ 六个场景演示 ============ */
export async function runIpcDemo() {
  const mainInvoke = createInvoker("main");
  const settingsInvoke = createInvoker("settings");

  // 场景 1：正常调用，类型全链路对齐
  const version = await mainInvoke("getAppVersion", {});
  console.log(`场景 1：getAppVersion → ${version}`);
  console.assert(version === "2.4.0", "场景 1 应返回版本号");

  // 场景 2：Rust 业务错误按约定 reject，且带结构化 code
  let notFoundCode = "";
  try {
    await mainInvoke("readTextFile", { path: "/tmp/missing.md" });
  } catch (e) {
    notFoundCode = (e as Error & { code: string }).code;
  }
  console.assert(notFoundCode === "NOT_FOUND", "场景 2 应收到 NOT_FOUND");
  console.log(`场景 2：业务错误 reject，code=${notFoundCode} ✅`);

  // 场景 3：函数参数被序列化边界拒绝
  let funcRejected = false;
  try {
    await mainInvoke("writeConfig", {
      key: "callback",
      value: (() => "我是函数") as unknown as string,
    });
  } catch (e) {
    funcRejected = e instanceof SerializationError;
    console.log(`场景 3：${(e as Error).message}`);
  }
  console.assert(funcRejected, "场景 3 函数必须被序列化边界拒绝");

  // 场景 4：Date / 循环引用同样过不去
  let dateRejected = false;
  try {
    await mainInvoke("writeConfig", { key: "t", value: new Date() as unknown as string });
  } catch (e) {
    dateRejected = e instanceof SerializationError;
    console.log(`场景 4a：${(e as Error).message}`);
  }
  const circular: Record<string, unknown> = { key: "self" };
  circular.value = circular;
  let circularRejected = false;
  try {
    await mainInvoke("writeConfig", circular as unknown as { key: string; value: string });
  } catch (e) {
    circularRejected = e instanceof SerializationError;
    console.log(`场景 4b：${(e as Error).message}`);
  }
  console.assert(dateRejected && circularRejected, "场景 4 Date 与循环引用都必须被拒绝");

  // 场景 5：allowlist 拦截——settings 窗口没有截图能力
  let blocked = false;
  try {
    await settingsInvoke("takeScreenshot", { windowLabel: "settings" });
  } catch (e) {
    blocked = e instanceof PermissionDeniedError;
    console.log(`场景 5：${(e as Error).message}`);
  }
  console.assert(blocked, "场景 5 未声明能力的调用必须被拦截");

  // 场景 6：settings 窗口调用自己声明过的能力 → 放行
  await settingsInvoke("writeConfig", { key: "theme", value: "dark" });
  console.log("场景 6：settings 窗口调用已声明能力 writeConfig → 放行 ✅");

  console.log("\n✅ IPC 命令桥六个场景全部通过");
}

runIpcDemo();

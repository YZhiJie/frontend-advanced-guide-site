// 文件: examples/25-01-feature-detect.ts —— 能力检测三种姿势:in / typeof / try-catch
// ============ 用「运行时能力检测」替代 UA嗅探,是使用新 API 的第一道闸门============

// ── 姿势一:in 检测(适合"宿主对象上有没有这个键") ──
// 对 window/globalThis 上的 API 用 in;比 typeof 更能表达「宿主是否提供」的语义
function hasIn(obj: object, key: string): boolean {
  return key in obj;
}

// ── 姿势二:typeof 检测(适合"值可能来自任意来源"的场景) ──
// typeof 不触发求值,对未声明变量也安全;缺点是对「存在但为 undefined」误判
function hasTypeof(key: string): boolean {
  // @ts-expect-error 动态探测,编译期明知全局可能没有
  return typeof globalThis[key as never] === "function";
}

// ── 姿势三:构造一次试金石(适合"检测子成员"——in 只探一层) ──
// navigator.storage.estimate 这类两级成员,in 探不到,构造一次最可靠
function supportsStorageEstimate(): boolean {
  try {
    // @ts-expect-error 浏览器专属,Node 环境可能没有
    return typeof navigator !== "undefined" && typeof navigator.storage?.estimate === "function";
  } catch {
    return false; // 访问本身抛错(如隐私模式禁用)也按"不可用"处理
  }
}

// ── 统一探测面板:同一套代码在浏览器 / Node 里跑,结果随环境而异 ──
// Node 18+ 已内置其中大半(AbortController/structuredClone/BroadcastChannel/performance),
// 这正是本册示例能直接实跑的原因;requestIdleCallback 仍是浏览器专属。
const probes: [string, () => boolean][] = [
  ["AbortController", () => hasIn(globalThis, "AbortController")],
  ["structuredClone", () => hasTypeof("structuredClone")],
  ["BroadcastChannel", () => hasIn(globalThis, "BroadcastChannel")],
  ["performance.mark", () => hasTypeof("performance") && "mark" in performance],
  ["requestIdleCallback", () => hasIn(globalThis, "requestIdleCallback")],
  ["navigator.storage.estimate", supportsStorageEstimate],
];

console.log("能力检测面板(输出随运行环境而异):");
for (const [name, probe] of probes) {
  let ok = false;
  try {
    ok = probe();
  } catch {
    ok = false;
  }
  console.log(`  ${ok ? "✓" : "✗"} ${name}`);
}

// 反面教材:UA 嗅探 —— 为什么永远不要这么写
// /Chrome/.test(navigator.userAgent) 会把所有 Chromium 系(Ultral/夸克/360…)误判为
// 全功能 Chrome,还会随厂商伪装 UA 而漂移;能力检测问的是「能不能」,UA 问的是「是谁」。
console.log("\n结论:优先 in / typeof,子成员用试金石,UA 只做统计埋点不做功能开关。");

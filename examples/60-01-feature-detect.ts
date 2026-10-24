/** 60-01-feature-detect.ts —— 能力检测注册表与三级降级决策（native / polyfill / fallback / unsupported） */
type Env = Record<string, unknown>;
type Tier = "native" | "polyfill" | "fallback" | "unsupported";
interface CapDef {
  name: string;
  detect: (env: Env) => boolean; // 原生可用?
  polyfilled?: (env: Env) => boolean; // 不可用时可补?
  fallback?: string; // 补不了时的业务降级方案
}
export function resolveCapability(
  def: CapDef,
  env: Env,
): { tier: Tier; note: string } {
  if (def.detect(env)) return { tier: "native", note: `${def.name} 原生可用` };
  if (def.polyfilled?.(env))
    return { tier: "polyfill", note: `${def.name} 需引入 polyfill` };
  if (def.fallback)
    return {
      tier: "fallback",
      note: `${def.name} 不支持 → 降级:${def.fallback}`,
    };
  return {
    tier: "unsupported",
    note: `${def.name} 不可用且无降级,必须砍掉该特性`,
  };
}

const has = (env: Env, path: string): boolean =>
  path.split(".").reduce<unknown>((o, k) => (o as Env)?.[k], env) != null;

// 能力注册表:检测逻辑与业务代码解耦,新增能力只加一行
const CAPS: CapDef[] = [
  {
    name: "structuredClone",
    detect: (e) => typeof e.structuredClone === "function",
    polyfilled: () => true, // core-js / @ungap/structured-clone 可补
  },
  {
    name: "ResizeObserver",
    detect: (e) => has(e, "ResizeObserver"),
    polyfilled: () => true,
  },
  {
    // Proxy 是引擎级特性,无法 polyfill——检测失败只能换实现(见 27 册响应式)
    name: "Proxy",
    detect: (e) => typeof e.Proxy === "function",
  },
  {
    name: "WebBluetooth",
    detect: (e) => has(e, "navigator.bluetooth"),
    fallback: "原生壳 + WebView 桥接", // 见 50 册
  },
  {
    // flex gap:Safari 14.1+ 才支持(WebKit 大版本 ≥ 14)
    name: "flex-gap",
    detect: (e) => e.engine !== "webkit" || Number(e.webkitMajor) >= 14,
    fallback: "margin  hack 或 grid",
  },
];

// 三个真实环境剖面(字段即「特性检测看到的世界」,不读 UA)
const chromeAndroid: Env = {
  structuredClone() {},
  Proxy,
  ResizeObserver() {},
  navigator: { bluetooth: {} },
  engine: "blink",
};
const iosSafari15: Env = {
  structuredClone() {},
  Proxy,
  navigator: {}, // iOS Safari 无 Web Bluetooth
  engine: "webkit",
  webkitMajor: 15,
};
const oldAndroidWebview: Env = { engine: "webkit", webkitMajor: 11 };

console.assert(
  resolveCapability(CAPS[0], chromeAndroid).tier === "native",
  "Chrome 原生 structuredClone",
);
console.assert(
  resolveCapability(CAPS[1], iosSafari15).tier === "polyfill",
  "iOS15 无 RO 但可补",
);
console.assert(
  resolveCapability(CAPS[2], oldAndroidWebview).tier === "unsupported",
  "Proxy 不可 polyfill,老内核只能换实现",
);
console.assert(
  resolveCapability(CAPS[3], iosSafari15).tier === "fallback",
  "iOS 蓝牙走原生壳",
);
console.assert(
  resolveCapability(CAPS[4], oldAndroidWebview).tier === "fallback",
  "老 WebKit flex gap 降级",
);
console.assert(
  resolveCapability(CAPS[4], iosSafari15).tier === "native",
  "WebKit 15 flex gap 原生",
);

// 一键输出环境兼容矩阵:三行报告给 PM/QA 看,比口头描述可靠
for (const [label, env] of [
  ["Chrome Android", chromeAndroid],
  ["iOS Safari 15", iosSafari15],
  ["老 Android WebView", oldAndroidWebview],
] as const) {
  const row = CAPS.map((c) => `${c.name}:${resolveCapability(c, env).tier}`);
  console.log(`${label.padEnd(18)} → ${row.join(" | ")}`);
}
console.log("✅ 能力检测与降级决策通过");

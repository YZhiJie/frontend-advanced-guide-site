// 文件: examples/45-05-config-guard.ts
// ============ 启动防呆：配置校验、功能开关与稳定缓存键 ============
// 线上事故里有一类特别冤：配置少了一个字段、开关百分比算错、缓存键顺序不同导致击穿。
// 这三件事都能在启动时一次说清，而不是等用户点到才报错。
// 运行：npx tsx examples/45-05-config-guard.ts

/** 配置错误要一次性列出全部问题，别让用户改一个重启一次 */
class ConfigError extends Error {
  constructor(public readonly issues: readonly string[]) {
    super(`配置校验失败（${issues.length} 项）：\n- ${issues.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

type Validator<T> = (value: unknown) => value is T;

const isNonEmptyString: Validator<string> = (value): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isHttpUrl: Validator<string> = (value): value is string =>
  typeof value === "string" &&
  (typeof URL.canParse === "function"
    ? URL.canParse(value) && /^https?:/i.test(value)
    : /^https?:\/\/\S+$/i.test(value));

const isPort: Validator<number> = (value): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value > 0 &&
  value < 65536;

/** 只校验声明过的键；返回值是强类型配置，调用方不用再到处 as */
function readConfig<T extends object>(
  raw: Record<string, unknown>,
  schema: { [K in keyof T]: Validator<T[K]> },
): T {
  const issues: string[] = [];
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(schema) as Array<keyof T>) {
    const value = raw[key as string];
    if (!schema[key](value)) {
      issues.push(
        `${String(key)} 缺失或格式错误（收到 ${JSON.stringify(value)}）`,
      );
    } else {
      result[key as string] = value;
    }
  }
  if (issues.length > 0) throw new ConfigError(issues);
  return result as T;
}

// ============ Feature Flag：稳定分桶，同一用户永远落在同一侧 ============

interface Flag {
  key: string;
  /** 0~100，按稳定哈希分桶，不用 Math.random（否则每次刷新都可能变） */
  percentage: number;
  /** 白名单优先于百分比，用于内部账号先行验证 */
  allow?: readonly string[];
}

/** FNV-1a：短、稳定、无依赖，适合做灰度分桶 */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function bucketOf(flagKey: string, userId: string, salt = "v1"): number {
  return fnv1a(`${flagKey}:${salt}:${userId}`) % 100;
}

function isEnabled(flag: Flag, userId: string): boolean {
  if (flag.allow?.includes(userId)) return true;
  if (flag.percentage >= 100) return true;
  if (flag.percentage <= 0) return false;
  return bucketOf(flag.key, userId) < flag.percentage;
}

// ============ 缓存键：键顺序无关、嵌套结构稳定 ============

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(",")}}`;
}

function cacheKey(
  scope: string,
  params: Record<string, unknown>,
  version = 1,
): string {
  return `${scope}@v${version}:${stableStringify(params)}`;
}

// ============ 演示 ============

interface AppConfig {
  apiBase: string;
  port: number;
  appName: string;
}

// 1) 正常配置：通过校验并得到强类型结果
const ok = readConfig<AppConfig>(
  { apiBase: "https://api.example.com", port: 443, appName: "console" },
  { apiBase: isHttpUrl, port: isPort, appName: isNonEmptyString },
);
if (ok.port !== 443) throw new Error("配置应保留原始类型");

// 2) 错误配置：一次列出所有问题，而不是遇到第一个就抛
try {
  readConfig<AppConfig>(
    { apiBase: "ftp://api.example.com", port: "443", appName: "  " },
    { apiBase: isHttpUrl, port: isPort, appName: isNonEmptyString },
  );
  throw new Error("这份配置本应校验失败");
} catch (error) {
  if (!(error instanceof ConfigError))
    throw new Error("应抛出可读的 ConfigError");
  if (error.issues.length !== 3)
    throw new Error(`应一次列出 3 个问题，实际 ${error.issues.length}`);
}

// 3) 开关：同一用户稳定命中；白名单优先；0/100 是确定的关闭/开启
const flag: Flag = {
  key: "new-dashboard",
  percentage: 30,
  allow: ["u-internal"],
};
const enabledForInternal = isEnabled(flag, "u-internal");
if (!enabledForInternal) throw new Error("白名单必须优先放行");

const samples = Array.from({ length: 5000 }, (_, i) => `u-${i}`);
const hit = samples.filter((id) => isEnabled(flag, id)).length;
const ratio = hit / samples.length;
if (ratio < 0.25 || ratio > 0.35)
  throw new Error(
    `30% 灰度实际命中 ${(ratio * 100).toFixed(1)}%，分桶明显偏斜`,
  );

// 同一用户重复求值必须稳定，否则刷新页面就会“功能忽有忽无”
if (isEnabled(flag, "u-42") !== isEnabled(flag, "u-42"))
  throw new Error("特性开关必须稳定");

// 4) 缓存键：参数顺序不同、但语义相同时必须得到同一个键
const keyA = cacheKey("orders", { page: 1, status: "paid", user: "u-1" }, 2);
const keyB = cacheKey("orders", { user: "u-1", status: "paid", page: 1 }, 2);
if (keyA !== keyB) throw new Error("键顺序不应影响缓存键");
if (keyA === cacheKey("orders", { page: 2, status: "paid", user: "u-1" }, 2))
  throw new Error("参数变化必须换键");

// 嵌套对象也要稳定序列化
const nestedA = cacheKey("filter", {
  range: { from: 1, to: 9 },
  tags: ["a", "b"],
});
const nestedB = cacheKey("filter", {
  tags: ["a", "b"],
  range: { to: 9, from: 1 },
});
if (nestedA !== nestedB) throw new Error("嵌套结构应稳定序列化");

console.log(
  "\n✓ 启动防呆演示通过：配置一次性报错、灰度稳定分桶、缓存键顺序无关",
);
console.log(
  `  30% 开关在 5000 个用户上的实测命中率：${(ratio * 100).toFixed(1)}%`,
);

export {};

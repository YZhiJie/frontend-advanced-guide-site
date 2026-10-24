// 文件: examples/47-03-log-redactor.ts
// ============ 日志脱敏器:密钥不出现在日志/上报/错误上下文里 ============
// 设计要点:
// 1) 密钥泄漏的第二大通道是「日志与监控上报」——异常堆栈的 context、fetch 拦截器、console 都可能带密钥;
// 2) 两道闸门:key 名单(字段名含 password/token/secret…直接整体脱敏)+ value 模式(JWT/手机号/身份证);
// 3) 脱敏要「留头尾」:sk_l…wX9 既安全又能用于排查对账;全部打 *** 的日志等于没记;
// 4) 递归处理嵌套对象/数组,遇循环引用安全退出。

/** 硬断言:不满足即非零退出,让 CI 门禁能真的拦截 */
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

// ---------------- 1. 两道闸门 ----------------

const SENSITIVE_KEY =
  /password|passwd|secret|token|authorization|cookie|api[_-]?key|credential/i;

const VALUE_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  {
    name: "JWT",
    pattern: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g,
  },
  {
    name: "API Token",
    pattern:
      /\b(?:ghp_|github_pat_|sk_(?:live|test)_|AKIA)[A-Za-z0-9_-]{12,}\b/g,
  },
  { name: "手机号", pattern: /\b1[3-9]\d{9}\b/g },
  { name: "身份证", pattern: /\b\d{17}[\dXx]\b/g },
];

/** 留头尾脱敏:短串全遮,长串留前 3 后 3 */
function mask(raw: string): string {
  if (raw.length <= 8) return "***";
  return `${raw.slice(0, 3)}…${raw.slice(-3)}`;
}

function maskString(input: string): string {
  let out = input;
  for (const { pattern } of VALUE_PATTERNS) {
    out = out.replace(pattern, (m) => mask(m));
  }
  return out;
}

// ---------------- 2. 递归脱敏器 ----------------

function redact<T>(input: T, seen = new WeakSet<object>()): T {
  if (typeof input === "string") return maskString(input) as T;
  if (Array.isArray(input)) {
    return input.map((v) => redact(v, seen)) as T;
  }
  if (input !== null && typeof input === "object") {
    if (seen.has(input)) return "[Circular]" as T; // 循环引用安全退出
    seen.add(input);
    return Object.fromEntries(
      Object.entries(input).map(([k, v]) => [
        k,
        SENSITIVE_KEY.test(k) ? mask(String(v)) : redact(v, seen),
      ]),
    ) as T;
  }
  return input; // number/boolean/null 原样
}

// ---------------- 3. 演示 A:错误上报上下文脱敏 ----------------

const reportPayload = {
  message: "支付请求失败",
  context: {
    url: "https://api.example.com/pay?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c",
    headers: {
      authorization: "Bearer sk_live_9f8e7d6c5b4a3f2e1d",
      "x-trace-id": "t-20261022-001",
    },
    form: { phone: "13812345678", amount: 9900 },
    tags: ["retry-3", "id:110101199003077758"],
  },
};

const safe = redact(reportPayload);
console.log("✓ 1. 上报上下文脱敏后:");
console.log(JSON.stringify(safe, null, 2));

const safeStr = JSON.stringify(safe);
assert(!safeStr.includes("SflKxwRJSMeKKF2QT4"), "JWT 必须脱敏");
assert(!safeStr.includes("9f8e7d6c5b4a"), "authorization 必须脱敏");
assert(!safeStr.includes("13812345678"), "手机号必须脱敏");
assert(!safeStr.includes("110101199003077758"), "身份证必须脱敏");
assert(safeStr.includes("t-20261022-001"), "非敏感字段应原样保留");
assert(safe.context.form.amount === 9900, "数字字段原样保留");
assert(safeStr.includes("eyJ"), "脱敏应留头便于识别类型");

// ---------------- 4. 演示 B:包装 console,密钥永远打不出来 ----------------

const rawLog = console.log;
const lines: string[] = [];
console.log = (...args: unknown[]) => {
  const text = args.map((a) => redact(a)).join(" ");
  lines.push(text);
  rawLog("  [脱敏 console]", text);
};
console.log("用户登录 token=ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456 登录成功");
console.log = rawLog;

assert(!lines[0]!.includes("aBcDeFgHiJkLmNoP"), "console 包装层必须脱敏");
console.log("✓ 2. console 包装层拦截成功,GitHub PAT 未原样输出");

// ---------------- 5. 演示 C:循环引用不炸 ----------------

const circular: Record<string, unknown> = { name: "node" };
circular.self = circular;
const safeCircular = redact(circular);
assert(safeCircular.self === "[Circular]", "循环引用必须安全退出");
console.log("✓ 3. 循环引用安全退出,不会栈溢出");

console.log("\n全部断言通过:日志脱敏器已跑通");

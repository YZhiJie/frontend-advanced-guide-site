// 文件: examples/47-02-env-guard.ts
// ============ 环境配置启动门禁:缺配置就拒绝启动,且打印脱敏快照 ============
// 设计要点:
// 1) 「process.env.XXX 读到 undefined 运行时才炸」是最低级的配置事故——启动时一次性校验;
// 2) schema 校验三件事:必填、格式(url/枚举/长度)、类型转换(string → number/boolean);
// 3) 启动日志打印配置快照必须脱敏(只露前 4 位),快照是排查利器也是泄漏重灾区;
// 4) 校验通过后冻结配置对象,禁止运行期篡改。

/** 硬断言:不满足即非零退出,让 CI 门禁能真的拦截 */
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

// ---------------- 1. schema 定义:配置即契约 ----------------

interface FieldSpec {
  required: boolean;
  secret?: boolean; // 标记为密钥:快照脱敏 + 禁止出现在客户端注入白名单
  pattern?: RegExp;
  enum?: readonly string[];
  transform?: (raw: string) => unknown;
}

const SCHEMA: Record<string, FieldSpec> = {
  API_BASE_URL: {
    required: true,
    pattern: /^https:\/\//, // 内网http也不放行:强制 https
  },
  APP_ENV: { required: true, enum: ["dev", "staging", "prod"] as const },
  PAY_SECRET: { required: true, secret: true, pattern: /^sk_live_/ },
  REQUEST_TIMEOUT: {
    required: false,
    transform: (raw) => {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) throw new Error("必须是正数");
      return n;
    },
  },
};

// ---------------- 2. 校验器:聚合所有错误一次报完 ----------------

class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`配置校验失败:\n${problems.map((p) => `  ✗ ${p}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

function validateEnv(
  schema: Record<string, FieldSpec>,
  env: Record<string, string | undefined>,
): Record<string, unknown> {
  const problems: string[] = [];
  const config: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(schema)) {
    const raw = env[key];
    if (raw === undefined || raw === "") {
      if (spec.required) problems.push(`${key}: 缺失(必填)`);
      continue;
    }
    if (spec.pattern && !spec.pattern.test(raw)) {
      problems.push(`${key}: 格式不符 ${spec.pattern}`);
      continue;
    }
    if (spec.enum && !spec.enum.includes(raw)) {
      problems.push(`${key}: 必须是 ${spec.enum.join("/")} 之一`);
      continue;
    }
    try {
      config[key] = spec.transform ? spec.transform(raw) : raw;
    } catch (e) {
      problems.push(`${key}: ${(e as Error).message}`);
    }
  }
  if (problems.length) throw new ConfigError(problems);
  return Object.freeze(config); // ✅ 冻结:运行期改配置是事故温床
}

// ---------------- 3. 脱敏快照:启动日志只露前 4 位 ----------------

function snapshotOf(
  schema: Record<string, FieldSpec>,
  config: Record<string, unknown>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(config).map(([k, v]) => [
      k,
      schema[k]?.secret ? `${String(v).slice(0, 4)}****(已脱敏)` : String(v),
    ]),
  );
}

// ---------------- 4. 演示:失败案例聚合报错,成功案例脱敏快照 ----------------

// 场景 A:三处错误一次报完(不是炸一个修一个)
try {
  validateEnv(SCHEMA, {
    API_BASE_URL: "http://intra.local", // ✗ 非 https
    APP_ENV: "production", // ✗ 不在枚举
    PAY_SECRET: "sk_live_9f8e7d6c5b", // ✓
    REQUEST_TIMEOUT: "abc", // ✗ 非数字
  });
  assert(false, "坏配置必须被拒");
} catch (e) {
  const err = e as ConfigError;
  console.log(`✓ 1. 坏配置启动被拒,一次报完 ${err.problems.length} 处:`);
  console.log(err.message);
  assert(err.problems.length === 3, "应聚合 3 处错误一次报完");
}

// 场景 B:全绿配置 → 冻结 + 脱敏快照
const good = validateEnv(SCHEMA, {
  API_BASE_URL: "https://api.example.com",
  APP_ENV: "prod",
  PAY_SECRET: "sk_live_9f8e7d6c5b4a3f2e1d",
  REQUEST_TIMEOUT: "8000",
});
console.log("✓ 2. 启动快照(日志安全):", snapshotOf(SCHEMA, good));
assert(good.REQUEST_TIMEOUT === 8000, "transform 应完成类型转换");
assert(
  Object.isFrozen(good),
  "配置对象必须冻结",
);
assert(
  !JSON.stringify(snapshotOf(SCHEMA, good)).includes("9f8e7d6c5b4a"),
  "快照不得携带完整密钥",
);

// 场景 C:篡改拦截
try {
  (good as Record<string, unknown>).PAY_SECRET = "sk_live_hacked";
  // 非严格模式静默失败,但值确实没变——两种都要认
} catch {
  /* 严格模式直接 TypeError */
}
assert(good.PAY_SECRET === "sk_live_9f8e7d6c5b4a3f2e1d", "冻结后不可篡改");
console.log("✓ 3. 运行期篡改被冻结拦截,PAY_SECRET 原值不变");

console.log("\n全部断言通过:启动门禁已跑通");

// 文件: examples/44-01-register-pipeline.ts
// ============ 统一注册页：校验 → 验码 → 建号 → 自动登录 ============
// 多系统共用一个注册页，编排必须固定成一条管道：
//   ① 字段校验（前端提示 + 服务端复验，前端校验只是体验）
//   ② 验证码消费（先验码后建号：验证码一次性，防刷注册）
//   ③ 建号（手机号唯一索引兜底并发注册）
//   ④ 自动登录（签发全局会话 + 回跳业务系统）
// 两个容易漏的点：
// - 验证码「先消费再建号」：建号失败（如手机号已存在）也不退还验证码，
//   否则同一验证码可被拿来探测「手机号是否注册过」；
// - 并发注册：两个请求同时通过预检查时，靠唯一索引冲突兜底，冲突后按「已注册」处理。
// 教学哈希用 sha256(salt+pwd)；生产用 argon2id/scrypt（见 44.5）。

import { createHash, randomBytes } from "node:crypto";

export interface RegisterInput {
  phone: string;
  password: string;
  code: string;
  agreed: boolean;
}

/** 密码策略：长度 + 字符类别，返回问题列表（空数组 = 合规） */
export function passwordIssues(pwd: string): string[] {
  const issues: string[] = [];
  if (pwd.length < 10) issues.push("至少 10 位");
  const classes = [
    /[a-z]/.test(pwd),
    /[A-Z]/.test(pwd),
    /\d/.test(pwd),
    /[^A-Za-z0-9]/.test(pwd),
  ].filter(Boolean).length;
  if (classes < 3) issues.push("需包含大写/小写/数字/符号中的至少 3 类");
  if (/^(.)\1+$/.test(pwd)) issues.push("不能是单一字符重复");
  return issues;
}

/** 字段校验：一次返回全部错误，前端按字段展示 */
export function validateRegister(
  input: RegisterInput,
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  if (!/^1[3-9]\d{9}$/.test(input.phone)) errors.phone = ["手机号格式不正确"];
  const pwdIssues = passwordIssues(input.password);
  if (pwdIssues.length) errors.password = pwdIssues;
  if (!/^\d{6}$/.test(input.code)) errors.code = ["验证码为 6 位数字"];
  if (!input.agreed) errors.agreed = ["需同意服务条款与隐私政策"];
  return errors;
}

type Purpose = "register" | "reset";

interface CodeRecord {
  code: string;
  expiresAt: number;
  used: boolean;
}

/** 验证码仓：一次性 + TTL；生产落 Redis 并带发送频率限制 */
export class CodeStore {
  private codes = new Map<string, CodeRecord>();

  issue(phone: string, purpose: Purpose, now: number, ttlMs = 5 * 60_000): string {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    this.codes.set(`${purpose}:${phone}`, {
      code,
      expiresAt: now + ttlMs,
      used: false,
    });
    return code;
  }

  /** 校验并消费：ok / expired / mismatch / used */
  consume(
    phone: string,
    purpose: Purpose,
    code: string,
    now: number,
  ): "ok" | "expired" | "mismatch" | "used" {
    const rec = this.codes.get(`${purpose}:${phone}`);
    if (!rec) return "mismatch";
    if (rec.used) return "used";
    if (now > rec.expiresAt) return "expired";
    if (rec.code !== code) return "mismatch";
    rec.used = true; // 先消费：后续建号失败也不退码
    return "ok";
  }
}

export interface Account {
  id: string;
  phone: string;
  passwordHash: string;
  createdAt: number;
}

/** 账号仓：phone 唯一索引是并发注册的最终防线 */
export class AccountStore {
  readonly byPhone = new Map<string, Account>();
  private seq = 0;

  create(phone: string, password: string, now: number): Account {
    if (this.byPhone.has(phone)) throw new Error("UNIQUE_PHONE");
    const salt = randomBytes(8).toString("hex");
    const account: Account = {
      id: `u${++this.seq}`,
      phone,
      passwordHash: createHash("sha256").update(salt + password).digest("hex"),
      createdAt: now,
    };
    this.byPhone.set(phone, account);
    return account;
  }
}

export type RegisterResult =
  | { ok: true; userId: string; sessionId: string }
  | { ok: false; stage: "validate"; errors: Record<string, string[]> }
  | { ok: false; stage: "code"; reason: string }
  | { ok: false; stage: "conflict"; message: string };

/** 完整注册管道 */
export function register(
  input: RegisterInput,
  deps: { codes: CodeStore; accounts: AccountStore; now: number },
): RegisterResult {
  const errors = validateRegister(input);
  if (Object.keys(errors).length)
    return { ok: false, stage: "validate", errors };

  const codeResult = deps.codes.consume(
    input.phone,
    "register",
    input.code,
    deps.now,
  );
  if (codeResult !== "ok")
    return { ok: false, stage: "code", reason: codeResult };

  try {
    const acc = deps.accounts.create(input.phone, input.password, deps.now);
    const sessionId = `gs_${randomBytes(6).toString("hex")}`; // 全局会话
    return { ok: true, userId: acc.id, sessionId };
  } catch (e) {
    if ((e as Error).message === "UNIQUE_PHONE")
      return {
        ok: false,
        stage: "conflict",
        message: "手机号已注册，请直接登录或找回密码",
      };
    throw e;
  }
}

// ---------------- 验证 ----------------

const codes = new CodeStore();
const accounts = new AccountStore();
const now = 1_000_000;

console.log("=== ① 字段校验一次报全 ===");
console.log(
  register(
    { phone: "123", password: "12345678", code: "12", agreed: false },
    { codes, accounts, now },
  ),
);

console.log("\n=== ② 验证码错误 / 过期 ===");
const goodCode = codes.issue("13800000001", "register", now);
console.log("错误码:", register({ phone: "13800000001", password: "Aa12345678!", code: "000000", agreed: true }, { codes, accounts, now }));
console.log("过期码:", (() => {
  const c2 = codes.issue("13800000002", "register", now);
  return register({ phone: "13800000002", password: "Aa12345678!", code: c2, agreed: true }, { codes, accounts, now: now + 6 * 60_000 });
})());

console.log("\n=== ③ 正常注册 + 自动登录 ===");
console.log(
  register({ phone: "13800000001", password: "Aa12345678!", code: goodCode, agreed: true }, { codes, accounts, now }),
);

console.log("\n=== ④ 验证码重放被拒（一次性） ===");
console.log(
  register({ phone: "13800000001", password: "Aa12345678!", code: goodCode, agreed: true }, { codes, accounts, now }),
);

console.log("\n=== ⑤ 并发注册：唯一索引兜底 ===");
const dupCode = codes.issue("13800000001", "register", now);
console.log(
  register({ phone: "13800000001", password: "Bb12345678!", code: dupCode, agreed: true }, { codes, accounts, now }),
);

console.log("\n=== 密码策略细节 ===");
for (const pwd of ["short1A!", "alllowercase123", "Aa12345678!"])
  console.log(pwd, "→", passwordIssues(pwd));

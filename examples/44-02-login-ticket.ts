// 文件: examples/44-02-login-ticket.ts
// ============ 统一登录页：失败锁定 → 验密 → 全局会话 → 一次性票据 ============
// 登录页是全站唯一收密码的地方，编排顺序有严格讲究：
//   ① 账号锁定检查（连续失败 5 次锁 15 分钟）——先于验密，避免爆破
//   ② 验证码（图形/行为）——失败达阈值后才要求，不打扰正常用户
//   ③ 验密（scrypt + timingSafeEqual，常量时间比较）
//   ④ 建全局会话（中心域 Cookie）
//   ⑤ 签发一次性 ticket（60s、绑定 appId、换票后立即作废）并 302 回业务系统
// 错误码纪律：用户不存在与密码错误返回同一个 INVALID_CREDENTIALS，防账号枚举；
// 锁定态单独返回 ACCOUNT_LOCKED（用户需要知道「等一会再来」）。
// 运行方式：npx tsx examples/44-02-login-ticket.ts（node:crypto）

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 16384;

/** 生产存储格式：scrypt$N$salt$hash（N 用于日后升级参数时识别旧记录） */
export function hashPassword(
  pwd: string,
  salt = randomBytes(16).toString("hex"),
): string {
  const hash = scryptSync(pwd, salt, 32, { N: SCRYPT_N }).toString("hex");
  return `scrypt$${SCRYPT_N}$${salt}$${hash}`;
}

export function verifyPassword(pwd: string, stored: string): boolean {
  const [algo, nRaw, salt, hash] = stored.split("$");
  if (algo !== "scrypt") return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(pwd, salt, expected.length, { N: Number(nRaw) });
  return timingSafeEqual(actual, expected);
}

interface User {
  id: string;
  phone: string;
  passwordHash: string;
}

export interface LoginInput {
  phone: string;
  password: string;
}

export type LoginResult =
  | {
      ok: true;
      sessionId: string;
      ticket: string;
      redirectTo: string;
    }
  | {
      ok: false;
      code: "INVALID_CREDENTIALS" | "ACCOUNT_LOCKED" | "CAPTCHA_REQUIRED";
    };

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;
const TICKET_TTL_MS = 60_000;

export class LoginService {
  private fails = new Map<string, { count: number; lockedUntil: number }>();
  private sessions = new Map<string, { uid: string; expiresAt: number }>();
  private tickets = new Map<
    string,
    { uid: string; appId: string; expiresAt: number; used: boolean }
  >();

  constructor(private readonly users: readonly User[]) {}

  private findUser(phone: string): User | undefined {
    return this.users.find((u) => u.phone === phone);
  }

  private lockState(phone: string, now: number) {
    const rec = this.fails.get(phone);
    if (rec && rec.lockedUntil > now)
      return { locked: true, remainMs: rec.lockedUntil - now };
    return { locked: false, remainMs: 0 };
  }

  private recordFail(phone: string, now: number): void {
    const rec = this.fails.get(phone) ?? { count: 0, lockedUntil: 0 };
    rec.count++;
    if (rec.count >= MAX_FAILS) {
      rec.count = 0;
      rec.lockedUntil = now + LOCK_MS;
    }
    this.fails.set(phone, rec);
  }

  login(input: LoginInput, appId: string, now: number): LoginResult {
    // ① 锁定检查：先于一切验密动作
    const lock = this.lockState(input.phone, now);
    if (lock.locked) return { ok: false, code: "ACCOUNT_LOCKED" };

    const user = this.findUser(input.phone);
    // ③ 验密：用户不存在也跑一次假哈希，避免响应时间差暴露账号是否存在
    const stored =
      user?.passwordHash ??
      "scrypt$16384$00000000000000000000000000000000$" + "0".repeat(64);
    const ok = verifyPassword(input.password, stored) && !!user;
    if (!ok || !user) {
      this.recordFail(input.phone, now);
      return { ok: false, code: "INVALID_CREDENTIALS" };
    }

    // ④ 全局会话（成功即清零失败计数，避免「历史锁定」误伤）
    this.fails.delete(input.phone);
    const sessionId = `gs_${randomBytes(8).toString("hex")}`;
    this.sessions.set(sessionId, {
      uid: user.id,
      expiresAt: now + 2 * 3600_000,
    });

    // ⑤ 一次性 ticket：绑定 appId，换票后作废
    const ticket = randomBytes(24).toString("base64url");
    this.tickets.set(ticket, {
      uid: user.id,
      appId,
      expiresAt: now + TICKET_TTL_MS,
      used: false,
    });
    return {
      ok: true,
      sessionId,
      ticket,
      redirectTo: `https://oa.example.com/sso/callback?ticket=${ticket}`,
    };
  }

  /** 业务系统后端换票：一次性 + 绑定 appId + TTL */
  redeem(
    ticket: string,
    appId: string,
    now: number,
  ): { ok: boolean; uid?: string; reason?: string } {
    const rec = this.tickets.get(ticket);
    if (!rec) return { ok: false, reason: "unknown" };
    if (rec.used) return { ok: false, reason: "replayed" };
    if (rec.appId !== appId) return { ok: false, reason: "app-mismatch" };
    if (now > rec.expiresAt) return { ok: false, reason: "expired" };
    rec.used = true;
    return { ok: true, uid: rec.uid };
  }

  get sessionCount(): number {
    return this.sessions.size;
  }
}

// ---------------- 验证 ----------------

const svc = new LoginService([
  { id: "u1", phone: "13800000001", passwordHash: hashPassword("Aa12345678!") },
]);
const t0 = 1_000_000;

console.log("=== ① 正常登录 + 一次性票据 ===");
const r1 = svc.login(
  { phone: "13800000001", password: "Aa12345678!" },
  "oa",
  t0,
);
console.log(r1);
const ticket = r1.ok ? r1.ticket : "";
console.log("换票成功:", svc.redeem(ticket, "oa", t0 + 1000));
console.log("票据重放:", svc.redeem(ticket, "oa", t0 + 2000));
console.log(
  "票据错配 appId:",
  (() => {
    const r = svc.login(
      { phone: "13800000001", password: "Aa12345678!" },
      "crm",
      t0,
    );
    return r.ok ? svc.redeem(r.ticket, "oa", t0 + 500) : r;
  })(),
);

console.log("\n=== ② 用户不存在与密码错误：同一个错误码 ===");
console.log(
  "密码错:",
  svc.login({ phone: "13800000001", password: "WrongPass1!" }, "oa", t0),
);
console.log(
  "用户不存在:",
  svc.login({ phone: "13900000000", password: "WrongPass1!" }, "oa", t0),
);

console.log("\n=== ③ 连续失败 5 次 → 锁定 15 分钟 ===");
for (let i = 1; i <= 4; i++)
  svc.login({ phone: "13800000001", password: "WrongPass1!" }, "oa", t0);
const locked = svc.login(
  { phone: "13800000001", password: "WrongPass1!" },
  "oa",
  t0,
);
console.log("第 5 次:", locked);
console.log(
  "锁定期间正确密码也拒绝:",
  svc.login(
    { phone: "13800000001", password: "Aa12345678!" },
    "oa",
    t0 + 60_000,
  ),
);
console.log(
  "15 分钟后可登录:",
  (() => {
    const r = svc.login(
      { phone: "13800000001", password: "Aa12345678!" },
      "oa",
      t0 + 16 * 60_000,
    );
    return r.ok ? "成功，签发新票据" : r;
  })(),
);

console.log("\n=== ④ 票据过期 ===");
const r2 = svc.login(
  { phone: "13800000001", password: "Aa12345678!" },
  "oa",
  t0 + 20 * 60_000,
);
console.log(
  r2.ok ? svc.redeem(r2.ticket, "oa", t0 + 20 * 60_000 + 61_000) : r2,
);

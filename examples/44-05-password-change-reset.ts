// 文件: examples/44-05-password-change-reset.ts
// ============ 改密与找回：撤销会话、一次性重置令牌、哈希透明升级 ============
// 统一账号中心的两个密码入口，安全语义完全不同：
// 1) 修改密码（已登录）：验旧密码 → 策略 → 新密码不能与旧密码相同 →
//    更新哈希 → **撤销除当前会话外的所有会话**（密码泄露的第一时间止损）；
// 2) 找回密码（未登录）：手机验证码 → 一次性 reset token（哈希入库、15 分钟、单次）→
//    设新密码 → **撤销全部会话** + 通知用户。
// 两个细节常被漏：
// - 防用户枚举：未注册手机号也返回「已发送」（假成功），但不下发短信、不建 token；
// - 哈希透明升级：旧记录参数落后（如 N=8192）时，登录成功瞬间用新参数重算并覆盖，
//   用户无感，存量数据逐步迁移。
// 运行方式：npx tsx examples/44-05-password-change-reset.ts（node:crypto）

import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const CURRENT_N = 16384; // 生产建议 argon2id，或 scrypt N≥2^15

function scryptHash(pwd: string, n: number, salt: string): string {
  const hash = scryptSync(pwd, salt, 32, { N: n }).toString("hex");
  return `scrypt$${n}$${salt}$${hash}`;
}

export function hashPassword(pwd: string): string {
  return scryptHash(pwd, CURRENT_N, randomBytes(16).toString("hex"));
}

/** 验密并报告是否需要升级哈希参数 */
export function verifyAndUpgrade(
  pwd: string,
  stored: string,
): { ok: boolean; needsUpgrade: boolean } {
  const [algo, nRaw, salt, hash] = stored.split("$");
  if (algo !== "scrypt") return { ok: false, needsUpgrade: false };
  const n = Number(nRaw);
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(pwd, salt, expected.length, { N: n });
  const ok = timingSafeEqual(actual, expected);
  return { ok, needsUpgrade: ok && n < CURRENT_N };
}

export function passwordIssues(pwd: string): string[] {
  const issues: string[] = [];
  if (pwd.length < 10) issues.push("至少 10 位");
  const classes = [
    /[a-z]/.test(pwd),
    /[A-Z]/.test(pwd),
    /\d/.test(pwd),
    /[^A-Za-z0-9]/.test(pwd),
  ].filter(Boolean).length;
  if (classes < 3) issues.push("至少 3 类字符");
  return issues;
}

interface User {
  id: string;
  phone: string;
  passwordHash: string;
}

interface Session {
  sessionId: string;
  uid: string;
  device: string;
}

interface ResetToken {
  uid: string;
  expiresAt: number;
  used: boolean;
}

const RESET_TTL = 15 * 60_000;

export class CredentialService {
  private users = new Map<string, User>(); // uid → user
  readonly sessions = new Map<string, Session>();
  private resetTokens = new Map<string, ResetToken>();
  /** 仅教学演示：保存明文令牌方便验证；生产只存哈希、明文只出现在短信/邮件里 */
  private demoTokens = new Map<string, string>();
  readonly audit: string[] = [];

  addUser(user: User): void {
    this.users.set(user.id, user);
  }

  addSession(sessionId: string, uid: string, device: string): void {
    this.sessions.set(sessionId, { sessionId, uid, device });
  }

  private sessionsOf(uid: string): Session[] {
    return [...this.sessions.values()].filter((s) => s.uid === uid);
  }

  /** 已登录改密：保留当前会话，踢掉其它端 */
  changePassword(
    uid: string,
    oldPwd: string,
    newPwd: string,
    currentSessionId: string,
    now: number,
  ):
    | { ok: true; revoked: number }
    | { ok: false; code: "INVALID_OLD" | "WEAK" | "SAME_AS_OLD" } {
    const user = this.users.get(uid);
    if (!user) return { ok: false, code: "INVALID_OLD" };
    if (!verifyAndUpgrade(oldPwd, user.passwordHash).ok)
      return { ok: false, code: "INVALID_OLD" };
    const issues = passwordIssues(newPwd);
    if (issues.length) return { ok: false, code: "WEAK" };
    if (newPwd === oldPwd) return { ok: false, code: "SAME_AS_OLD" };

    user.passwordHash = hashPassword(newPwd);
    let revoked = 0;
    for (const s of this.sessionsOf(uid)) {
      if (s.sessionId !== currentSessionId) {
        this.sessions.delete(s.sessionId);
        revoked++;
      }
    }
    this.audit.push(
      `#${this.audit.length + 1} ${now} ${uid} 修改密码，撤销 ${revoked} 个会话`,
    );
    return { ok: true, revoked };
  }

  /** 找回密码：无论账号是否存在都返回 ok（防枚举），成功才真的建 token */
  requestReset(phone: string, now: number): { ok: true } {
    const user = [...this.users.values()].find((u) => u.phone === phone);
    if (!user) return { ok: true }; // 假成功：不建 token、不发短信
    const token = randomBytes(32).toString("hex");
    this.resetTokens.set(createHash("sha256").update(token).digest("hex"), {
      uid: user.id,
      expiresAt: now + RESET_TTL,
      used: false,
    });
    this.demoTokens.set(phone, token);
    this.audit.push(
      `#${this.audit.length + 1} ${now} 为 ${user.id} 签发重置令牌`,
    );
    return { ok: true };
  }

  /** 仅教学演示：把最近一次令牌取出用于验证（生产绝不返回） */
  peekLatestToken(phone: string): string | null {
    return this.demoTokens.get(phone) ?? null;
  }

  /** 用重置令牌设新密码：单次、TTL、成功后撤销全部会话 */
  resetPassword(
    token: string,
    newPwd: string,
    now: number,
  ):
    | { ok: true; revoked: number }
    | { ok: false; code: "INVALID_TOKEN" | "EXPIRED" | "USED" | "WEAK" } {
    const key = createHash("sha256").update(token).digest("hex");
    const rec = this.resetTokens.get(key);
    if (!rec) return { ok: false, code: "INVALID_TOKEN" };
    if (rec.used) return { ok: false, code: "USED" };
    if (now > rec.expiresAt) return { ok: false, code: "EXPIRED" };
    const issues = passwordIssues(newPwd);
    if (issues.length) return { ok: false, code: "WEAK" };

    const user = this.users.get(rec.uid)!;
    user.passwordHash = hashPassword(newPwd);
    rec.used = true;
    let revoked = 0;
    for (const s of this.sessionsOf(rec.uid)) {
      this.sessions.delete(s.sessionId);
      revoked++;
    }
    this.audit.push(
      `#${this.audit.length + 1} ${now} ${rec.uid} 重置密码，撤销 ${revoked} 个会话`,
    );
    return { ok: true, revoked };
  }

  /** 登录：验密 + 参数落后则透明升级 */
  login(
    phone: string,
    pwd: string,
    now: number,
  ): { ok: boolean; upgraded?: boolean } {
    const user = [...this.users.values()].find((u) => u.phone === phone);
    if (!user) return { ok: false };
    const r = verifyAndUpgrade(pwd, user.passwordHash);
    if (!r.ok) return { ok: false };
    if (r.needsUpgrade) {
      user.passwordHash = hashPassword(pwd);
      this.audit.push(
        `#${this.audit.length + 1} ${now} ${user.id} 哈希参数透明升级`,
      );
    }
    return { ok: true, upgraded: r.needsUpgrade };
  }

  sessionCount(uid: string): number {
    return this.sessionsOf(uid).length;
  }
}

// ---------------- 验证 ----------------

const svc = new CredentialService();
const t0 = 2_000_000;
svc.addUser({
  id: "u1",
  phone: "13800000001",
  passwordHash: hashPassword("OldPass123!"),
});
svc.addSession("s-mac", "u1", "MacBook");
svc.addSession("s-iphone", "u1", "iPhone");
svc.addSession("s-ipad", "u1", "iPad");

console.log("=== ① 修改密码：只保留当前会话 ===");
console.log(
  svc.changePassword("u1", "OldPass123!", "NewPass456!", "s-mac", t0),
);
console.log("剩余会话数:", svc.sessionCount("u1"), "（MacBook 保留）");
console.log("旧密码登录:", svc.login("13800000001", "OldPass123!", t0));
console.log("新密码登录:", svc.login("13800000001", "NewPass456!", t0));

console.log("\n=== ② 弱密码 / 新旧相同被拒 ===");
console.log(
  "弱密码:",
  svc.changePassword("u1", "NewPass456!", "short", "s-mac", t0),
);
console.log(
  "新旧相同:",
  svc.changePassword("u1", "NewPass456!", "NewPass456!", "s-mac", t0),
);

console.log("\n=== ③ 找回密码：未注册手机号假成功（防枚举） ===");
console.log("未注册:", svc.requestReset("13900000000", t0));
console.log("查不到令牌:", svc.peekLatestToken("13900000000"));

console.log("\n=== ④ 重置令牌：一次性 + 撤销全部会话 ===");
svc.addSession("s-android", "u1", "Android");
svc.requestReset("13800000001", t0);
const token = svc.peekLatestToken("13800000001")!;
console.log("重置:", svc.resetPassword(token, "ResetPass789!", t0 + 1000));
console.log("会话数（全部撤销）:", svc.sessionCount("u1"));
console.log(
  "令牌重放:",
  svc.resetPassword(token, "AnotherPass000!", t0 + 2000),
);

console.log("\n=== ⑤ 令牌过期 ===");
svc.requestReset("13800000001", t0);
const token2 = svc.peekLatestToken("13800000001")!;
console.log(svc.resetPassword(token2, "AnotherPass000!", t0 + RESET_TTL + 1));

console.log("\n=== ⑥ 哈希参数透明升级 ===");
const legacyHash = scryptHash(
  "LegacyPass123!",
  8192,
  randomBytes(16).toString("hex"),
);
svc.addUser({ id: "u2", phone: "13800000002", passwordHash: legacyHash });
console.log("登录（旧参数）:", svc.login("13800000002", "LegacyPass123!", t0));
console.log(
  "再次登录（已升级，无重复升级）:",
  svc.login("13800000002", "LegacyPass123!", t0),
);

console.log("\n=== 审计 ===");
for (const line of svc.audit) console.log(" ", line);

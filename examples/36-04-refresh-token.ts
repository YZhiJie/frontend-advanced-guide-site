// 文件: examples/36-04-refresh-token.ts
// ============ Refresh Token 轮换与复用检测 ============
// 双令牌：短效 access（如 15min）+ 长效 refresh（如 7d）。
// access 过期用 refresh 静默续期，避免频繁重登录，也让 JWT "难注销"的短板可控。
// 核心安全机制——轮换（rotate）：每次续期发新 refresh、旧的立即作废；
// 若检测到"已作废的 refresh 再次使用"（reuse），说明 token 可能泄露 → 撤销整个 token 家族。
// 运行方式：npx tsx examples/36-04-refresh-token.ts（依赖 node:crypto）

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SECRET = "dev-only-secret";
function sign(data: string): string {
  return createHmac("sha256", SECRET).update(data).digest("base64url");
}

export interface TokenPair {
  accessToken: string; // 格式 payload.sig（演示简化，完整 JWT 见 36-03）
  refreshToken: string; // 不透明随机串，服务端存表
  accessExpiresAt: number;
  refreshExpiresAt: number;
  familyId: string; // 一次登录派生的所有 token 同族
}

interface RefreshRecord {
  userId: string;
  familyId: string;
  expiresAt: number;
  revoked: boolean;
}

export class AuthService {
  private refreshStore = new Map<string, RefreshRecord>();

  login(userId: string, now: number): TokenPair {
    const familyId = randomBytes(8).toString("hex");
    return this.issuePair(userId, familyId, now);
  }

  private issuePair(userId: string, familyId: string, now: number): TokenPair {
    const payload = JSON.stringify({ sub: userId, exp: now + 15 * 60 * 1000 });
    const refreshToken = randomBytes(24).toString("hex");
    this.refreshStore.set(refreshToken, {
      userId,
      familyId,
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
      revoked: false,
    });
    return {
      accessToken: `${b64url(payload)}.${sign(payload)}`,
      refreshToken,
      accessExpiresAt: now + 15 * 60 * 1000,
      refreshExpiresAt: now + 7 * 24 * 60 * 60 * 1000,
      familyId,
    };
  }

  /** 校验 access（演示简化版；完整版见 36-03 的 verifyJwt） */
  verifyAccess(token: string, now: number): boolean {
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return false;
    const expected = Buffer.from(sign(payload));
    const actual = Buffer.from(sig);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      return false;
    return JSON.parse(Buffer.from(payload, "base64url").toString()).exp > now;
  }

  /**
   * 续期：refresh 轮换 + 复用检测。
   * - 合法 refresh → 发新对，旧 refresh 标记 revoked；
   * - 已 revoked 的 refresh 再次出现 → 泄露信号 → 整族撤销。
   */
  rotate(
    refreshToken: string,
    now: number,
  ):
    | { ok: true; pair: TokenPair }
    | { ok: false; reason: "invalid" | "expired" | "reused" } {
    const rec = this.refreshStore.get(refreshToken);
    if (!rec) return { ok: false, reason: "invalid" };
    if (now >= rec.expiresAt) return { ok: false, reason: "expired" };
    if (rec.revoked) {
      // 复用检测：把该家族所有还活着的 refresh 全部撤销
      for (const [, r] of this.refreshStore) {
        if (r.familyId === rec.familyId) r.revoked = true;
      }
      return { ok: false, reason: "reused" };
    }
    rec.revoked = true; // 一次性：立即作废旧的
    return { ok: true, pair: this.issuePair(rec.userId, rec.familyId, now) };
  }
}

function b64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}

// ---------------- 验证 ----------------

const t0 = 1_700_000_000_000;
const svc = new AuthService();
const pair = svc.login("u1", t0);

console.log("=== 正常续期：access 过期 → refresh 轮换 ===");
console.log(
  "access 在 16min 时有效?",
  svc.verifyAccess(pair.accessToken, t0 + 16 * 60 * 1000),
); // false（15min 过期）
const r1 = svc.rotate(pair.refreshToken, t0 + 16 * 60 * 1000);
console.log(
  "轮换结果:",
  r1.ok,
  "新 access 有效?",
  r1.ok && svc.verifyAccess(r1.pair.accessToken, t0 + 16 * 60 * 1000),
);
console.log(
  "新 refresh != 旧 refresh:",
  r1.ok && r1.pair.refreshToken !== pair.refreshToken,
);

console.log("\n=== 复用检测：旧 refresh 再次使用 → 整族撤销 ===");
const r2 = svc.rotate(pair.refreshToken, t0 + 17 * 60 * 1000); // 旧的已被轮换作废
console.log("旧 refresh 再用:", r2); // reused
if (r1.ok) {
  const r3 = svc.rotate(r1.pair.refreshToken, t0 + 17 * 60 * 1000);
  console.log(
    "族内其余 refresh 也失效:",
    r3.ok ? "仍有效(不应发生)" : r3.reason,
  ); // reused（整族被撤销）
}

console.log("\n=== 前端静默续期伪代码要点（真实实现见正文 36.4） ===");
console.log(`
// 响应拦截器：401 → 排队刷新 → 重放原请求
let refreshing: Promise<string> | null = null;
if (status === 401) {
    refreshing ??= fetch('/api/refresh', { method: 'POST' }).then(getAccessToken);
    await refreshing; refreshing = null; // 成功后重放；失败跳登录
}`);

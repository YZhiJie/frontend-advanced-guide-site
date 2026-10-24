// 文件: examples/36-02-session-auth.ts
// ============ Session-Cookie：有状态会话 ============
// 服务端存会话表，客户端只持有一个不透明凭据 sessionId（放 Cookie）。
// 关键点：
// 1) Cookie 三件套：HttpOnly（JS 读不到，防 XSS 窃取）/ Secure（仅 HTTPS）/ SameSite=Lax（缓解 CSRF）；
// 2) 过期两种策略：绝对过期（expiresAt 硬顶）+ 滑动过期（每次访问续期）；
// 3) 服务端可主动销毁会话 → "踢人下线"只有有状态方案能做到。

export interface Session {
  sessionId: string;
  userId: string;
  createdAt: number;
  /** 滑动过期：最后访问时间 + idleTTL */
  lastSeenAt: number;
  /** 绝对过期硬顶：无论多活跃，超过即重登录 */
  absoluteDeadline: number;
}

export interface SessionConfig {
  idleTtlMs: number; // 空闲过期
  absoluteTtlMs: number; // 绝对硬顶
}

/** 模拟 sessionId 生成（教学用确定性串；生产必须 crypto.randomBytes(32) 不可预测） */
let seq = 0;
function generateSessionId(userId: string): string {
  let hash = 5381;
  for (const ch of userId + seq++)
    hash = ((hash << 5) + hash + ch.charCodeAt(0)) >>> 0;
  return `sid_${hash.toString(36)}`;
}

export class SessionStore {
  private store = new Map<string, Session>();

  constructor(private config: SessionConfig) {}

  create(userId: string, now: number): Session {
    const session: Session = {
      sessionId: generateSessionId(userId),
      userId,
      createdAt: now,
      lastSeenAt: now,
      absoluteDeadline: now + this.config.absoluteTtlMs,
    };
    this.store.set(session.sessionId, session);
    return session;
  }

  /**
   * 校验 + 滑动续期。返回 null 表示会话无效（不存在 / 空闲超时 / 绝对过期）。
   * 滑动过期：空闲但未超过 absoluteDeadline → 续命并放行。
   */
  validate(sessionId: string, now: number): Session | null {
    const s = this.store.get(sessionId);
    if (!s) return null;
    if (now > s.absoluteDeadline) {
      this.store.delete(sessionId);
      return null;
    }
    if (now - s.lastSeenAt > this.config.idleTtlMs) {
      this.store.delete(sessionId);
      return null;
    }
    s.lastSeenAt = now; // 滑动续期
    return s;
  }

  /** 登出 / 踢下线：服务端单方面销毁 */
  destroy(sessionId: string): boolean {
    return this.store.delete(sessionId);
  }

  /** 按用户踢全部会话（改密码后强制重登录） */
  destroyAllByUser(userId: string): number {
    let n = 0;
    for (const [id, s] of this.store) {
      if (s.userId === userId) {
        this.store.delete(id);
        n++;
      }
    }
    return n;
  }
}

// ---------------- Cookie 工具（前端侧读到的只是字符串） ----------------

export function parseCookie(cookieHeader: string): Record<string, string> {
  return Object.fromEntries(
    cookieHeader.split("; ").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i), decodeURIComponent(kv.slice(i + 1))];
    }),
  );
}

/** 序列化 Set-Cookie：HttpOnly/Secure/SameSite 三件套 + maxAge */
export function serializeSessionCookie(
  sessionId: string,
  maxAgeSeconds: number,
): string {
  return `sid=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

// ---------------- 验证 ----------------

const t0 = 1_000_000;
const store = new SessionStore({
  idleTtlMs: 30 * 60 * 1000,
  absoluteTtlMs: 24 * 60 * 60 * 1000,
});
const s = store.create("u1", t0);

console.log("=== 签发与 Cookie ===");
console.log("sessionId:", s.sessionId);
console.log("Set-Cookie:", serializeSessionCookie(s.sessionId, 86400));

console.log("\n=== 校验与滑动续期 ===");
console.log(
  "t0+10min（距上次 10min < 30min）:",
  store.validate(s.sessionId, t0 + 10 * 60 * 1000) !== null,
); // true，且 lastSeenAt 续到 +10min
console.log(
  "t0+50min（距上次 40min > 30min，空闲超时）:",
  store.validate(s.sessionId, t0 + 50 * 60 * 1000) !== null,
); // false

console.log("\n=== 踢下线（有状态方案独有能力） ===");
const s2 = store.create("u1", t0);
console.log("销毁前:", store.validate(s2.sessionId, t0 + 1000) !== null); // true
store.destroy(s2.sessionId);
console.log("销毁后:", store.validate(s2.sessionId, t0 + 1000)); // null

console.log("\n=== 按用户全端下线 ===");
const s3 = store.create("u1", t0);
const s4 = store.create("u1", t0);
console.log("踢掉会话数:", store.destroyAllByUser("u1")); // 2
console.log("s3 现在有效?", store.validate(s3.sessionId, t0 + 1000) !== null); // false
console.log("s4 现在有效?", store.validate(s4.sessionId, t0 + 1000) !== null); // false

console.log("\n=== Cookie 解析 ===");
console.log(parseCookie("a=1; sid=sid_x; theme=dark"));

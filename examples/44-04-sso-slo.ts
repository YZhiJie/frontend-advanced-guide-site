// 文件: examples/44-04-sso-slo.ts
// ============ 一个账号全家通行：全局会话、静默换票与单点登出 ============
// SSO 的三层会话：
//   1) 全局会话（中心域 Cookie）：真正的「已登录」状态，只在 account.example.com 域下；
//   2) 一次性 ticket：中心 → 业务系统的一次性换票凭证（60s、绑定 appId、带全局 sid）；
//   3) 本地会话（业务域）：业务系统自己的会话，TTL 短（如 30 分钟），可无状态 JWT。
// 本地会话过期后不必让用户重新输密码：重定向到中心，中心有全局会话就
// 「静默换票」再重定向回来——这是 SSO 免密的全部秘密。
// 单点登出（SLO）是反向广播：中心登出 → 通知所有已登记系统销毁本地会话。
// 广播会失败（网络/系统下线），必须有兜底：本地会话仍在，但其续期会失败，
// 用户最多在本地 TTL 内「残留登录」，到期后必然回到登录页。

import { randomBytes } from "node:crypto";

const TICKET_TTL = 60_000;
const LOCAL_TTL = 30 * 60_000;
const GLOBAL_IDLE_TTL = 2 * 3600_000;

interface GlobalSession {
  sid: string;
  uid: string;
  lastActive: number;
}

interface Ticket {
  value: string;
  uid: string;
  sid: string;
  appId: string;
  expiresAt: number;
  used: boolean;
}

interface AppRegistration {
  appId: string;
  origin: string;
  reachable: boolean; // 模拟 SLO 广播时该系统的可用性
}

export class Center {
  private globalSessions = new Map<string, GlobalSession>();
  private tickets = new Map<string, Ticket>();
  readonly apps = new Map<string, AppRegistration>();
  private sloHandlers = new Map<string, (sid: string) => void>();

  registerApp(app: AppRegistration, onSlo: (sid: string) => void): void {
    this.apps.set(app.appId, app);
    this.sloHandlers.set(app.appId, onSlo);
  }

  login(uid: string, now: number): string {
    const sid = `gs_${randomBytes(6).toString("hex")}`;
    this.globalSessions.set(sid, { sid, uid, lastActive: now });
    return sid;
  }

  private issue(uid: string, sid: string, appId: string, now: number): string {
    const value = randomBytes(18).toString("base64url");
    this.tickets.set(value, {
      value,
      uid,
      sid,
      appId,
      expiresAt: now + TICKET_TTL,
      used: false,
    });
    return value;
  }

  /** 业务系统带 ticket 来换：一次性 + 绑定 appId + TTL + 全局会话仍有效 */
  redeem(
    ticket: string,
    appId: string,
    now: number,
  ): { ok: boolean; uid?: string; sid?: string; reason?: string } {
    const t = this.tickets.get(ticket);
    if (!t) return { ok: false, reason: "unknown" };
    if (t.used) return { ok: false, reason: "replayed" };
    if (t.appId !== appId) return { ok: false, reason: "app-mismatch" };
    if (now > t.expiresAt) return { ok: false, reason: "expired" };
    const session = this.globalSessions.get(t.sid);
    if (!session) return { ok: false, reason: "global-gone" };
    t.used = true;
    session.lastActive = now;
    return { ok: true, uid: t.uid, sid: t.sid };
  }

  /** 静默换票：本地会话过期后，浏览器带着全局 Cookie 重定向过来 */
  silentTicket(sid: string, appId: string, now: number): string | null {
    const session = this.globalSessions.get(sid);
    if (!session) return null;
    if (now - session.lastActive > GLOBAL_IDLE_TTL) {
      this.globalSessions.delete(sid);
      return null;
    }
    session.lastActive = now;
    return this.issue(session.uid, session.sid, appId, now);
  }

  /** 单点登出：删全局会话 + 广播 SLO，返回成功/失败清单 */
  logout(sid: string): { notified: string[]; failed: string[] } {
    this.globalSessions.delete(sid);
    const notified: string[] = [];
    const failed: string[] = [];
    for (const [appId, app] of this.apps) {
      if (!app.reachable) {
        failed.push(appId);
        continue;
      }
      this.sloHandlers.get(appId)?.(sid);
      notified.push(appId);
    }
    return { notified, failed };
  }
}

interface LocalSession {
  sessionId: string;
  uid: string;
  globalSid: string;
  expiresAt: number;
}

export class BusinessApp {
  private locals = new Map<string, LocalSession>();

  constructor(
    readonly appId: string,
    private readonly center: Center,
  ) {
    this.center.registerApp(
      { appId, origin: `https://${appId}.example.com`, reachable: true },
      (sid) => this.destroyLocalByGlobalSid(sid),
    );
  }

  /** 换票登录：ticket → 本地会话（记住全局 sid，供 SLO 精确清理） */
  ssoLogin(
    ticket: string,
    now: number,
  ): { ok: boolean; sessionId?: string; reason?: string } {
    const r = this.center.redeem(ticket, this.appId, now);
    if (!r.ok || !r.uid || !r.sid) return { ok: false, reason: r.reason };
    const sessionId = `ls_${this.appId}_${randomBytes(4).toString("hex")}`;
    this.locals.set(sessionId, {
      sessionId,
      uid: r.uid,
      globalSid: r.sid,
      expiresAt: now + LOCAL_TTL,
    });
    return { ok: true, sessionId };
  }

  /** 访问受保护页面：本地有效 → 放行；过期 → 静默换票；全局也没了 → 去登录 */
  ensureSession(
    sessionId: string | undefined,
    globalSid: string,
    now: number,
  ):
    | { status: "ok"; sessionId: string }
    | { status: "silent"; sessionId: string }
    | { status: "login-required"; reason: string } {
    const local = sessionId ? this.locals.get(sessionId) : undefined;
    if (local && now <= local.expiresAt)
      return { status: "ok", sessionId: local.sessionId };

    const ticket = this.center.silentTicket(globalSid, this.appId, now);
    if (!ticket)
      return { status: "login-required", reason: "global-session-gone" };
    const relogin = this.ssoLogin(ticket, now);
    if (!relogin.ok || !relogin.sessionId)
      return { status: "login-required", reason: relogin.reason ?? "unknown" };
    return { status: "silent", sessionId: relogin.sessionId };
  }

  /** SLO 广播落地：只清这个全局会话对应的本地会话，别误伤同系统其它用户 */
  private destroyLocalByGlobalSid(sid: string): void {
    for (const [sessionId, s] of this.locals)
      if (s.globalSid === sid) this.locals.delete(sessionId);
  }

  get localCount(): number {
    return this.locals.size;
  }
}

// ---------------- 验证 ----------------

const center = new Center();
const oa = new BusinessApp("oa", center);
const crm = new BusinessApp("crm", center);
const t0 = 1_000_000;

console.log("=== ① 中心登录 → OA 换票 ===");
const globalSid = center.login("u1", t0);
const oaTicket = center.silentTicket(globalSid, "oa", t0)!;
const oaLogin = oa.ssoLogin(oaTicket, t0);
console.log("OA:", oaLogin, "本地会话数:", oa.localCount);

console.log("\n=== ② CRM 免密通行（新 ticket） ===");
const crmTicket = center.silentTicket(globalSid, "crm", t0 + 1000)!;
const crmLogin = crm.ssoLogin(crmTicket, t0 + 1000);
console.log("CRM:", crmLogin, "本地会话数:", crm.localCount);

console.log("\n=== ③ 票据一次性：重放被拒 ===");
console.log("重放 OA ticket:", center.redeem(oaTicket, "oa", t0 + 2000));

console.log("\n=== ④ 本地会话过期 → 静默换票（不输密码） ===");
console.log(
  "OA 访问:",
  oa.ensureSession(oaLogin.sessionId, globalSid, t0 + LOCAL_TTL + 1),
);

console.log("\n=== ⑤ 单点登出：CRM 不可达 → 广播部分失败 ===");
center.apps.get("crm")!.reachable = false;
console.log("登出结果:", center.logout(globalSid));
console.log("OA 本地会话数（收到 SLO）:", oa.localCount);
console.log("CRM 本地会话数（未收到）:", crm.localCount);

console.log("\n=== ⑥ 兜底：未收到 SLO 的系统到期后回登录页 ===");
console.log(
  "CRM 未过期仍在用:",
  crm.ensureSession(crmLogin.sessionId, globalSid, t0 + LOCAL_TTL - 1000)
    .status,
);
console.log(
  "CRM 过期后:",
  crm.ensureSession(crmLogin.sessionId, globalSid, t0 + LOCAL_TTL + 2000),
);

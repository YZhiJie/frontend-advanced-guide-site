// 文件: examples/44-03-redirect-whitelist.ts
// ============ 回跳白名单：开放重定向的八种攻击形态 ============
// 统一登录页的关键参数是 redirect（登录成功后回哪）。
// 它同时是最大的漏洞入口：只要允许任意 URL，攻击者就能把
// 「https://account.example.com/login?redirect=https://evil.com」发给受害者，
// 受害者看到的是真域名，登录成功后却被送去钓鱼站。
// 防御不是「字符串包含判断」，而是：解析成 URL 对象 → 逐项严格校验。
// 校验四道关：
//   ① 协议必须 https（拒绝 javascript:/data:）
//   ② 不允许 userinfo（oa.example.com@evil.com 这类障眼法）
//   ③ origin 必须与登记的回调域完全相等（后缀包含 oa.example.com.evil.com 会漏）
//   ④ path 必须命中登记的回调路径（防路径穿越到站内其它页面）
// state 单独校验：发起时生成随机串，回调必须原样带回（防 CSRF 伪造回调）。

import { randomBytes } from "node:crypto";

export interface AllowedApp {
  appId: string;
  name: string;
  origin: string; // 登记的回调域，如 https://oa.example.com
  callbackPath: string; // 登记的回调路径，如 /sso/callback
}

export const REGISTERED_APPS: readonly AllowedApp[] = [
  { appId: "oa", name: "OA 办公", origin: "https://oa.example.com", callbackPath: "/sso/callback" },
  { appId: "crm", name: "CRM 客户", origin: "https://crm.example.com", callbackPath: "/auth/sso" },
];

export type RedirectCheck =
  | { ok: true; url: string }
  | { ok: false; reason: "missing" | "unparsable" | "protocol" | "userinfo" | "origin" | "path" };

export function resolveRedirect(
  raw: string | undefined | null,
  app: AllowedApp,
): RedirectCheck {
  if (!raw) return { ok: false, reason: "missing" };
  let u: URL;
  try {
    u = new URL(raw); // 相对地址（含 //evil.com）在这里直接失败
  } catch {
    return { ok: false, reason: "unparsable" };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "protocol" };
  if (u.username || u.password) return { ok: false, reason: "userinfo" };
  if (u.origin !== app.origin) return { ok: false, reason: "origin" };
  const pathOk =
    u.pathname === app.callbackPath ||
    u.pathname.startsWith(`${app.callbackPath}/`);
  if (!pathOk) return { ok: false, reason: "path" };
  return { ok: true, url: `${u.origin}${u.pathname}${u.search}` };
}

export interface AuthRequest {
  appId: string;
  authorizeUrl: string;
  state: string;
}

/** 发起登录：校验回跳 + 生成 state，组装授权地址 */
export function buildAuthRequest(
  app: AllowedApp,
  rawRedirect: string | undefined,
  center = "https://account.example.com",
): { ok: true; request: AuthRequest } | { ok: false; reason: string } {
  const checked = resolveRedirect(rawRedirect, app);
  if (!checked.ok) return { ok: false, reason: checked.reason };
  const state = randomBytes(16).toString("base64url");
  const qs = new URLSearchParams({
    app_id: app.appId,
    redirect: checked.url,
    state,
  });
  return {
    ok: true,
    request: { appId: app.appId, authorizeUrl: `${center}/login?${qs}`, state },
  };
}

/** 回调校验：state 必须一致；redirect 必须再过一次白名单（不能在回调时才信任） */
export function verifyCallback(
  callbackUrl: string,
  expectedState: string,
  app: AllowedApp,
): { ok: true; code: string } | { ok: false; reason: string } {
  let u: URL;
  try {
    u = new URL(callbackUrl);
  } catch {
    return { ok: false, reason: "unparsable" };
  }
  const state = u.searchParams.get("state");
  if (state !== expectedState) return { ok: false, reason: "state-mismatch" };
  const redirect = u.searchParams.get("redirect") ?? undefined;
  const checked = resolveRedirect(redirect, app);
  if (!checked.ok) return { ok: false, reason: `redirect:${checked.reason}` };
  return { ok: true, code: u.searchParams.get("code") ?? "" };
}

// ---------------- 验证 ----------------

const oa = REGISTERED_APPS[0];

console.log("=== 正常回跳 ===");
console.log(resolveRedirect("https://oa.example.com/sso/callback?from=home", oa));

console.log("\n=== 八种攻击形态全部拦截 ===");
const attacks: Array<[string, string]> = [
  ["外域直跳", "https://evil.com/sso/callback"],
  ["后缀障眼", "https://oa.example.com.evil.com/sso/callback"],
  ["userinfo 障眼", "https://oa.example.com@evil.com/sso/callback"],
  ["协议降级", "http://oa.example.com/sso/callback"],
  ["协议相对", "//evil.com/sso/callback"],
  ["反斜杠绕过", "https:\\\\evil.com\\sso\\callback"],
  ["路径穿越", "https://oa.example.com/sso/callback/../../evil"],
  ["伪协议", "javascript:alert(document.cookie)"],
];
for (const [label, url] of attacks)
  console.log(`  ${label}:`, resolveRedirect(url, oa));

console.log("\n=== 发起 → 回调全链路 ===");
const built = buildAuthRequest(oa, "https://oa.example.com/sso/callback?from=home");
console.log(built);
if (built.ok) {
  const state = built.request.state;
  console.log(
    "state 一致:",
    verifyCallback(
      `https://account.example.com/callback?code=abc&state=${state}&redirect=https%3A%2F%2Foa.example.com%2Fsso%2Fcallback`,
      state,
      oa,
    ),
  );
  console.log(
    "state 被伪造:",
    verifyCallback(
      `https://account.example.com/callback?code=abc&state=forged&redirect=https%3A%2F%2Foa.example.com%2Fsso%2Fcallback`,
      state,
      oa,
    ),
  );
  console.log(
    "回调里偷偷换 redirect:",
    verifyCallback(
      `https://account.example.com/callback?code=abc&state=${state}&redirect=https%3A%2F%2Fevil.com%2F`,
      state,
      oa,
    ),
  );
}

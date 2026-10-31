// 文件: examples/36-05-oauth-code-flow.ts
// ============ OAuth2 授权码流程（含 state 防 CSRF + PKCE） ============
// 四角色：用户代理（浏览器）/ 客户端（你的前端）/ 授权服务器 / 资源服务器。
// 前端在 OAuth2 里的职责边界：发起跳转 → 接收回调 → 用 code 换 token（有后端时换 token 这步在后端做）。
// 两个必做防御：
// 1) state：发起时生成随机串存 sessionStorage，回调时必须原样带回 → 防 CSRF 伪造回调；
// 2) PKCE：code_verifier（随机串）→ code_challenge（其 SHA256），code 被截获也无法单独换 token。
// 本示例为纯逻辑模拟，无网络请求，可页内运行。

export interface AuthorizeServerState {
  /** 已发放且未消费的授权码：code → { clientId, challenge, expiresAt } */
  codes: Map<
    string,
    { clientId: string; challenge: string; expiresAt: number }
  >;
  issuedAccessTokens: Map<string, string>; // accessToken → userId
}

function randomId(len = 16): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < len; i++)
    s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/** PKCE：S256 方法——challenge = base64url(sha256(verifier))。这里用教学简化版哈希演示确定性映射 */
export function codeChallenge(verifier: string): string {
  let h1 = 0x811c9dc5,
    h2 = 0x1000193;
  for (const ch of verifier) {
    h1 = ((h1 ^ ch.charCodeAt(0)) * 0x01000193) >>> 0;
    h2 = ((h2 + ch.charCodeAt(0)) * 0x85ebca6b) >>> 0;
  }
  return `c_${h1.toString(36)}${h2.toString(36)}`;
}

// ---------------- 步骤模拟 ----------------

const t0 = 1_700_000_000_000;
const CODE_TTL = 10 * 60 * 1000;
const authServer: AuthorizeServerState = {
  codes: new Map(),
  issuedAccessTokens: new Map(),
};
const CLIENT_ID = "web-app";
const REDIRECT_URI = "https://app.example.com/callback";

/** ① 前端生成 state + verifier，带 challenge 跳转授权页 */
function buildAuthorizeUrl(): { url: string; state: string; verifier: string } {
  const state = randomId();
  const verifier = randomId(32);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "profile orders",
    state,
    code_challenge: codeChallenge(verifier),
    code_challenge_method: "S256",
  });
  return {
    url: `https://auth.example.com/authorize?${params}`,
    state,
    verifier,
  };
}

/** ② 授权服务器：用户登录同意后发放授权码（重定向回 redirect_uri?code=..&state=..） */
function issueCode(
  challenge: string,
  now: number,
): { code: string; state: string } {
  const code = randomId(24);
  authServer.codes.set(code, {
    clientId: CLIENT_ID,
    challenge,
    expiresAt: now + CODE_TTL,
  });
  return { code, state: "（与请求时一致）" };
}

/** ③ 客户端（前端/后端）用 code + verifier 换 token */
function exchangeCode(
  code: string,
  verifier: string,
  now: number,
): { ok: true; accessToken: string } | { ok: false; error: string } {
  const rec = authServer.codes.get(code);
  if (!rec) return { ok: false, error: "code 无效或已被消费（一次性）" };
  authServer.codes.delete(code); // 授权码一次性
  if (now >= rec.expiresAt)
    return { ok: false, error: "code 已过期（10 分钟）" };
  if (codeChallenge(verifier) !== rec.challenge)
    return { ok: false, error: "PKCE 校验失败" };
  const accessToken = randomId(32);
  authServer.issuedAccessTokens.set(accessToken, "u1");
  return { ok: true, accessToken };
}

// ---------------- 验证 ----------------

console.log("=== 完整授权码流程 ===");
const { url, state, verifier } = buildAuthorizeUrl();
console.log("① authorize URL:", url);
console.log("   前端保存 state（sessionStorage）与 verifier（内存）");

const { code } = issueCode(codeChallenge(verifier), t0);
console.log(
  "② 授权服务器发码并重定向:",
  `${REDIRECT_URI}?code=${code}&state=${state}`,
);

console.log(
  "③ 回调页校验 state === 发起时保存的 state:",
  true,
  "→ 用 code + verifier 换 token",
);
const res = exchangeCode(code, verifier, t0 + 1000);
console.log(
  "④ 换 token:",
  res.ok ? `${res.accessToken.slice(0, 8)}...` : res.error,
);

console.log("\n=== 防御演示 ===");
console.log(
  "code 二次使用（一次性）:",
  exchangeCode(code, verifier, t0 + 1000).ok
    ? "不应成功"
    : "code 无效或已被消费（一次性）",
);
const { code: code2 } = issueCode(codeChallenge("right-verifier"), t0);
console.log(
  "verifier 不对（code 被截获也没用）:",
  exchangeCode(code2, "wrong-verifier", t0).ok ? "不应成功" : "PKCE 校验失败",
);

console.log(
  "\n=== state 防 CSRF：回调 state 与 sessionStorage 不一致 → 拒绝 ===",
);
console.log(
  `if (qs.state !== sessionStorage.getItem('oauth_state')) throw new Error('CSRF');`,
);

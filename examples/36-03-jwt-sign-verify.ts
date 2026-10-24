// 文件: examples/36-03-jwt-sign-verify.ts
// ============ JWT：无状态令牌（手写签发与校验） ============
// JWT 三段式：header.payload.signature，前两段 base64url 明文（只是编码不是加密！），
// 第三段 HMAC-SHA256 签名保证不可篡改。
// 关键点：
// 1) payload 只放"声明"（sub/role/exp），绝不能放密码等敏感数据；
// 2) 校验必须先比签名再看 exp——顺序反了等于先信任了不可信内容；
// 3) alg 字段由校验方自己决定算法，绝不信任 token 里的 alg（防 alg:none / RS-HS 混淆攻击）。
// 运行方式：npx tsx examples/36-03-jwt-sign-verify.ts（依赖 node:crypto，属 Node 示例）

import { createHmac, timingSafeEqual } from "node:crypto";

export interface JwtPayload {
  sub: string; // subject：用户 ID
  name?: string;
  scope?: string[]; // 权限码（第 35 册模型）
  iat: number; // 签发时间
  exp: number; // 过期时间
}

const SECRET = "dev-only-secret"; // 生产放服务端环境变量，且足够长

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function hmacSha256(data: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

/** 签发 JWT */
export function signJwt(
  payload: Omit<JwtPayload, "iat" | "exp">,
  expiresInSeconds: number,
  now = Date.now(),
): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const full: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds * 1000,
  };
  const body = b64url(JSON.stringify(full));
  const signature = b64url(hmacSha256(`${header}.${body}`, SECRET));
  return `${header}.${body}.${signature}`;
}

export type VerifyResult =
  | { ok: true; payload: JwtPayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

/**
 * 校验 JWT。顺序：结构 → 签名 → 过期。
 * 用 timingSafeEqual 防时序攻击（逐字节提前 return 会泄露比对进度）。
 */
export function verifyJwt(token: string, now = Date.now()): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [header, body, signature] = parts;

  // 算法由校验方锁定为 HS256，不读 token 内的 alg 字段
  const expected = hmacSha256(`${header}.${body}`, SECRET);
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { ok: false, reason: "bad_signature" };
  }

  const payload = JSON.parse(
    Buffer.from(body, "base64url").toString(),
  ) as JwtPayload;
  if (now >= payload.exp) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}

// ---------------- 验证 ----------------

const t0 = 1_700_000_000_000;
console.log("=== 签发 ===");
const token = signJwt(
  { sub: "u1", name: "Alice", scope: ["user:view"] },
  60 * 15,
  t0,
);
console.log("token:", token);
const [, body] = token.split(".");
console.log("payload 明文可见:", Buffer.from(body, "base64url").toString());

console.log("\n=== 校验 ===");
console.log("有效:", verifyJwt(token, t0 + 60 * 1000)); // ok
console.log("过期:", verifyJwt(token, t0 + 16 * 60 * 1000)); // { ok: false, reason: 'expired' }

console.log("\n=== 防篡改：改一个字符即失败 ===");
const tampered = token.replace("Alice", "Hacker");
console.log("篡改后:", verifyJwt(tampered, t0)); // bad_signature（base64url 内嵌改动后签名对不上）

console.log("\n=== 防伪造：不知道密钥就造不出合法签名 ===");
const forged = `${token.split(".")[0]}.${token.split(".")[1]}.${b64url(hmacSha256(token.split(".")[0] + "." + token.split(".")[1], "attacker-secret"))}`;
console.log("伪造签名:", verifyJwt(forged, t0)); // bad_signature

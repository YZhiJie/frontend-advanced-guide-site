// 文件: examples/54-02-jwt-inspect.ts
// ============ JWT 解析与过期判断:jwt-decode 只解码,不验签 ============
// 设计要点:
// 1) JWT 的 payload 是 base64url 编码,不是加密——任何人都能读,不要放敏感数据;
// 2) 前端解析只用于「读用户信息/判断过期」,安全校验必须在服务端验签;
// 3) exp 是秒级时间戳,判断过期要留时钟偏差(skew),避免临界点来回跳。

interface JwtPayload {
  sub?: string;
  exp?: number;
  iat?: number;
  [key: string]: unknown;
}

interface InspectResult {
  header: Record<string, unknown>;
  payload: JwtPayload;
  expired: boolean;
  expiresIn: number;
  warnings: string[];
}

function base64urlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  // atob 在浏览器与 Node 18+ 均可用;中文需再按 UTF-8 解码
  const binary = atob(padded + pad);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function base64urlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function inspect(token: string, nowMs: number, skewSec = 30): InspectResult {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("JWT 必须由 header.payload.signature 三段组成");
  const warnings: string[] = [];
  const header = JSON.parse(base64urlDecode(parts[0])) as Record<string, unknown>;
  const payload = JSON.parse(base64urlDecode(parts[1])) as JwtPayload;

  if (header.alg === "none") warnings.push("alg=none:禁止在服务端接受此类 token");
  if (payload.exp === undefined) warnings.push("缺少 exp:token 永不过期,存在安全风险");
  if (payload.exp !== undefined && payload.exp - (payload.iat ?? 0) > 24 * 3600) {
    warnings.push("有效期超过 24 小时:建议缩短并配合 refresh token");
  }

  const nowSec = nowMs / 1000;
  const exp = payload.exp ?? Number.POSITIVE_INFINITY;
  // 时钟偏差:exp 在 skew 秒内仍视为有效,避免客户端时间慢几秒就误判过期
  const expired = nowSec - skewSec >= exp;
  const expiresIn = Math.round(exp - nowSec);
  return { header, payload, expired, expiresIn, warnings };
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

const now = 1_700_000_000_000; // 2023-11-14 22:13:20 UTC
const header = base64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
const make = (payload: JwtPayload) => `${header}.${base64urlEncode(JSON.stringify(payload))}.signature`;

// ---------------- 场景 1:未过期 ----------------
const valid = make({ sub: "u-1", name: "张三", iat: now / 1000, exp: now / 1000 + 3600 });
const r1 = inspect(valid, now);
console.log("未过期:", { sub: r1.payload.sub, name: r1.payload.name, expired: r1.expired, expiresIn: r1.expiresIn });
assert(r1.payload.sub === "u-1" && r1.payload.name === "张三", "中文 payload 应正确解码");
assert(!r1.expired && r1.expiresIn === 3600, "1 小时后过期");

// ---------------- 场景 2:已过期 ----------------
const expired = make({ sub: "u-2", exp: now / 1000 - 60 });
const r2 = inspect(expired, now);
console.log("已过期:", r2.expired, "expiresIn:", r2.expiresIn);
assert(r2.expired, "过期 60 秒应判定为过期");

// ---------------- 场景 3:时钟偏差内不误判 ----------------
const borderline = make({ sub: "u-3", exp: now / 1000 + 10 });
const r3 = inspect(borderline, now, 30);
console.log("临界点(10s 后过期,skew 30s):", r3.expired);
assert(!r3.expired, "skew 内不应误判过期");

// ---------------- 场景 4:无 exp / alg none 告警 ----------------
const risky = make({ sub: "u-4" });
const r4 = inspect(risky, now);
console.log("告警:", r4.warnings);
assert(r4.warnings.some((w) => w.includes("缺少 exp")), "无 exp 应告警");

const noneAlg = `${base64urlEncode(JSON.stringify({ alg: "none" }))}.${base64urlEncode(
  JSON.stringify({ sub: "u-5", exp: now / 1000 + 60 }),
)}.`;
const r5 = inspect(noneAlg, now);
assert(r5.warnings.some((w) => w.includes("alg=none")), "alg=none 应告警");

// ---------------- 场景 5:格式错误 ----------------
let threw = false;
try {
  inspect("not-a-jwt", now);
} catch {
  threw = true;
}
assert(threw, "格式错误应抛异常");

console.log("\nJWT 解析通过:中文 payload、过期、时钟偏差、风险告警、格式校验均有确定行为。");
console.log("注意:以上只做解码,签名校验必须在服务端完成。");

// 标记为模块,避免与其它示例的顶层变量重名
export {};

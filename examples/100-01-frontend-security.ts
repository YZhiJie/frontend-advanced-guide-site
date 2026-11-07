/**
 * 第 100 部分 · 前端安全实战
 * JD 需求点：B 端/金融 JD 要求"前端安全、XSS/CSRF 防御、CSP、
 *   依赖漏洞、安全编码规范"。前端是攻击的第一道防线，
 *   需掌握输入过滤、输出转义、安全头、依赖审计。
 * 本示例在 Node 环境模拟：
 *   1) XSS 防御：HTML 转义 + 富文本白名单过滤
 *   2) CSRF 防御：Token 校验 + SameSite Cookie
 *   3) CSP 策略解析与校验（script-src/frame-ancestors）
 *   4) 依赖漏洞扫描（模拟 npm audit，匹配 CVE 数据库）
 *   5) 安全头检查清单（X-Frame-Options/HSTS/X-Content-Type-Options）
 * 运行：npx tsx examples/100-01-frontend-security.ts
 */
import assert from "node:assert";

// ---------- 1. XSS 防御：HTML 转义 ----------
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// 富文本白名单：只允许安全标签和属性
const ALLOWED_TAGS = new Set(["b", "i", "em", "strong", "p", "br", "ul", "ol", "li", "span"]);
const ALLOWED_ATTRS = new Set(["href", "title", "class"]);
const DANGEROUS_PROTOCOLS = ["javascript:", "vbscript:", "data:"];

function sanitizeHtml(html: string): string {
  // 移除 <script> 及其内容
  html = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  // 移除事件处理器 on*
  html = html.replace(/\son\w+="[^"]*"/gi, "");
  html = html.replace(/\son\w+='[^']*'/gi, "");
  // 检查标签白名单
  html = html.replace(/<(\/?)(\w+)([^>]*)>/g, (match, close, tag, attrs) => {
    const lowerTag = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(lowerTag)) return ""; // 非白名单标签删除
    // 过滤属性
    const safeAttrs = attrs.replace(/(\w+)="([^"]*)"/g, (m, attr, val) => {
      const lowerAttr = attr.toLowerCase();
      if (!ALLOWED_ATTRS.has(lowerAttr)) return "";
      // href 不能是危险协议
      if (lowerAttr === "href" && DANGEROUS_PROTOCOLS.some((p) => val.toLowerCase().startsWith(p))) {
        return "";
      }
      return m;
    });
    return `<${close}${lowerTag}${safeAttrs}>`;
  });
  return html;
}

// ---------- 2. CSRF 防御 ----------
interface CsrfConfig {
  token: string;          // 服务端下发的 token
  cookieSameSite: "strict" | "lax" | "none";
}

function verifyCsrf(
  config: CsrfConfig,
  requestToken: string | undefined,
  requestMethod: string
): { ok: boolean; reason?: string } {
  // 安全方法（GET/HEAD/OPTIONS）不校验
  if (["GET", "HEAD", "OPTIONS"].includes(requestMethod.toUpperCase())) {
    return { ok: true };
  }
  if (!requestToken) return { ok: false, reason: "缺少 CSRF token" };
  if (requestToken !== config.token) return { ok: false, reason: "CSRF token 不匹配" };
  // SameSite=strict 时第三方站点请求不带 cookie，天然防 CSRF
  if (config.cookieSameSite === "strict") return { ok: true };
  return { ok: true };
}

// ---------- 3. CSP 策略解析与校验 ----------
interface CSPDirective {
  name: string;
  values: string[];
}

function parseCSP(csp: string): CSPDirective[] {
  return csp.split(";").map((dir) => {
    const [name, ...values] = dir.trim().split(/\s+/);
    return { name, values };
  });
}

function checkCSP(csp: string): { secure: boolean; issues: string[] } {
  const directives = parseCSP(csp);
  const issues: string[] = [];
  const find = (n: string) => directives.find((d) => d.name === n);

  const scriptSrc = find("script-src");
  if (!scriptSrc) issues.push("缺少 script-src，易受 XSS");
  else if (scriptSrc.values.includes("'unsafe-inline'")) issues.push("script-src 含 unsafe-inline，降低 XSS 防护");

  const frameAncestors = find("frame-ancestors");
  if (!frameAncestors) issues.push("缺少 frame-ancestors，可能被点击劫持");

  return { secure: issues.length === 0, issues };
}

// ---------- 4. 依赖漏洞扫描 ----------
interface Vulnerability {
  name: string;
  severity: "low" | "moderate" | "high" | "critical";
  range: string; // 受影响版本范围
  fixedIn: string;
}

const CVE_DB: Vulnerability[] = [
  { name: "lodash", severity: "high", range: "<4.17.21", fixedIn: "4.17.21" },
  { name: "axios", severity: "high", range: "<0.21.4", fixedIn: "0.21.4" },
  { name: "minimist", severity: "critical", range: "<0.0.8", fixedIn: "0.0.8" },
];

// 简化版 semver 比较：只处理 < 前缀
function isVulnerable(version: string, range: string): boolean {
  const [op, ver] = [range.slice(0, 1), range.slice(1)];
  const a = version.split(".").map(Number);
  const b = ver.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] < b[i]) return op === "<" || op === "<=";
    if (a[i] > b[i]) return false;
  }
  return op === "<=";
}

function auditDependencies(deps: Record<string, string>): Vulnerability[] {
  const found: Vulnerability[] = [];
  for (const [name, version] of Object.entries(deps)) {
    const vuln = CVE_DB.find((v) => v.name === name);
    if (vuln && isVulnerable(version, vuln.range)) {
      found.push(vuln);
    }
  }
  return found;
}

// ---------- 5. 安全头检查 ----------
interface SecurityHeaders {
  "x-frame-options"?: string;
  "strict-transport-security"?: string;
  "x-content-type-options"?: string;
  "content-security-policy"?: string;
}

function checkSecurityHeaders(h: SecurityHeaders): { score: number; missing: string[] } {
  const missing: string[] = [];
  let score = 100;
  if (!h["x-frame-options"]) { missing.push("X-Frame-Options"); score -= 20; }
  if (!h["strict-transport-security"]) { missing.push("HSTS"); score -= 20; }
  if (h["x-content-type-options"] !== "nosniff") { missing.push("X-Content-Type-Options: nosniff"); score -= 20; }
  if (!h["content-security-policy"]) { missing.push("Content-Security-Policy"); score -= 40; }
  return { score: Math.max(0, score), missing };
}

// ===================== 运行断言 =====================
console.log("===== 1. XSS 防御 =====");
const escaped = escapeHtml("<script>alert('xss')</script>");
assert(!escaped.includes("<script>"), "转义后不应含 <script>");
assert(escaped.includes("&lt;script&gt;"), "尖括号应被转义");

const clean = sanitizeHtml('<p>hello</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><img src=x onerror=alert(1)>');
assert(!clean.includes("<script>"), "白名单过滤应删 script");
assert(!clean.includes("onerror"), "应删事件处理器");
assert(!clean.includes("javascript:"), "应删危险协议 href");
assert(clean.includes("<p>hello</p>"), "安全标签应保留");
console.log("✓ XSS：转义 + 白名单过滤生效");

console.log("\n===== 2. CSRF 防御 =====");
const cfg: CsrfConfig = { token: "secret123", cookieSameSite: "lax" };
assert(verifyCsrf(cfg, undefined, "POST").ok === false, "无 token 应拒绝");
assert(verifyCsrf(cfg, "wrong", "POST").ok === false, "token 不匹配应拒绝");
assert(verifyCsrf(cfg, "secret123", "POST").ok === true, "正确 token 应通过");
assert(verifyCsrf(cfg, undefined, "GET").ok === true, "GET 不校验 CSRF");
console.log("✓ CSRF：token 校验 + 安全方法豁免");

console.log("\n===== 3. CSP 校验 =====");
const goodCsp = "default-src 'self'; script-src 'self'; frame-ancestors 'none'";
assert(checkCSP(goodCsp).secure === true, "完整 CSP 应安全");

const badCsp = "script-src 'self' 'unsafe-inline'";
const bad = checkCSP(badCsp);
assert(bad.secure === false && bad.issues.length >= 2, `不安全 CSP 应检测到问题，实际 ${bad.issues.length}`);
console.log(`✓ CSP：安全策略通过，不安全检测到 ${bad.issues.length} 个问题`);

console.log("\n===== 4. 依赖漏洞扫描 =====");
const vulns = auditDependencies({ lodash: "4.17.20", axios: "0.21.3", react: "18.0.0" });
assert(vulns.length === 2, `应检测到 2 个漏洞，实际 ${vulns.length}`);
assert(vulns.some((v) => v.name === "lodash" && v.severity === "high"), "lodash 应为 high");
const safe = auditDependencies({ lodash: "4.17.21", axios: "0.21.4" });
assert(safe.length === 0, "升级到修复版本后应无漏洞");
console.log(`✓ 依赖审计：检测到 ${vulns.length} 个漏洞，升级后清零`);

console.log("\n===== 5. 安全头检查 =====");
const full = checkSecurityHeaders({
  "x-frame-options": "DENY",
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'self'",
});
assert(full.score === 100, "全量安全头应 100 分");

const partial = checkSecurityHeaders({ "x-frame-options": "DENY" });
assert(partial.score < 100 && partial.missing.length === 3, `缺 3 个头应扣分，实际 ${partial.missing.length}`);
console.log(`✓ 安全头：全量=100分，缺头=${partial.missing.length}个`);

console.log("\n✅ XSS 转义 + CSRF 校验 + CSP 审计 + 依赖扫描 + 安全头检查全部通过");

/**
 * 第 127 部分配套：Nginx 生产配置审计器
 * JD 需求点：发版前能对 nginx.conf 做静态体检，拦住「丢安全头、缓存分层错、
 *   upstream 不复用连接、SPA 回退缺失、TLS 过旧」这类上线后才暴露的问题。
 * 本示例直接读取 examples/deploy/nginx/frontend.conf，做三类检查：
 *   1) TLS 与安全头（HSTS / CSP / nosniff / frame / referrer）
 *   2) 缓存分层与压缩（map 注入、immutable、gzip_static、brotli）
 *   3) 反向代理与可观测（keepalive、http/1.1、Connection 清空、/healthz、日志）
 * 并专门检查 nginx 的 add_header 继承陷阱：location 里出现 add_header 会让
 * server 层的安全头全部失效。
 * 运行：npx tsx examples/127-04-nginx-prod-audit.ts
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";

interface Finding {
  level: "error" | "warn";
  rule: string;
  message: string;
}

const SRC = readFileSync("examples/deploy/nginx/frontend.conf", "utf8");

/** 提取所有 location 块（花括号计数，够用于本配置的静态检查） */
function locationBlocks(src: string): string[] {
  const out: string[] = [];
  const re = /\blocation\s+[^{]+\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      i++;
    }
    out.push(src.slice(start, i - 1));
  }
  return out;
}

function audit(raw: string): Finding[] {
  // Nginx 会忽略注释；审计前先剔除，避免注释里的示例指令造成误判
  const src = raw.replace(/^\s*#.*$/gm, "");
  const findings: Finding[] = [];
  const err = (rule: string, message: string) =>
    findings.push({ level: "error", rule, message });
  const warn = (rule: string, message: string) =>
    findings.push({ level: "warn", rule, message });

  // ---------- TLS ----------
  if (!/listen\s+443\s+ssl\b/.test(src)) err("tls.listen", "缺少 443 ssl 监听");
  const earlyHttp2 = /listen\s+443\s+ssl\s+http2\b/.test(src);
  if (!/^\s*http2\s+on\s*;/m.test(src) && !earlyHttp2) {
    err("tls.http2", "未启用 HTTP/2（nginx ≥1.25.1 用 `http2 on;`，更早用 listen ... http2）");
  }
  if (!/ssl_protocols\s+TLSv1\.2\s+TLSv1\.3\s*;/.test(src)) {
    err("tls.protocols", "ssl_protocols 必须且只能包含 TLSv1.2 TLSv1.3");
  }
  if (/ssl_protocols[^;]*\b(?:TLSv1\.1|TLSv1(?!\.)|SSLv3|SSLv2)\b/.test(src)) {
    err("tls.legacy", "ssl_protocols 仍包含已淘汰协议");
  }
  if (!/ssl_certificate\s+\S+fullchain\.pem\s*;/.test(src)) {
    err("tls.cert", "ssl_certificate 应指向 fullchain.pem（缺中间证书会影响部分客户端）");
  }
  if (!/ssl_certificate_key\s+\S+privkey\.pem\s*;/.test(src)) {
    err("tls.key", "缺少 ssl_certificate_key");
  }
  if (!/ssl_session_cache\s+shared:/.test(src)) warn("tls.session", "建议配置 ssl_session_cache 减少握手开销");
  if (!/ssl_stapling\s+on\s*;/.test(src)) warn("tls.ocsp", "建议开启 OCSP stapling");
  if (!/resolver\s+\S+/.test(src)) warn("tls.resolver", "OCSP stapling 需要 resolver");

  // ---------- 安全头 ----------
  const hsts = src.match(/Strict-Transport-Security\s+"max-age=(\d+)([^"]*)"/);
  if (!hsts) err("header.hsts", "缺少 HSTS");
  else if (Number(hsts[1]) < 15_552_000) {
    err("header.hsts-age", `HSTS max-age=${hsts[1]} 小于 180 天`);
  }
  for (const [rule, name] of [
    ["header.nosniff", "X-Content-Type-Options"],
    ["header.frame", "X-Frame-Options"],
    ["header.referrer", "Referrer-Policy"],
    ["header.csp", "Content-Security-Policy"],
    ["header.permissions", "Permissions-Policy"],
  ] as const) {
    if (!src.includes(name)) err(rule, `缺少安全头 ${name}`);
  }
  if (!/server_tokens\s+off\s*;/.test(src)) err("header.tokens", "server_tokens 未关闭，会暴露版本号");

  // add_header 继承陷阱：location 里一旦出现 add_header，server 层安全头全部失效
  const leaky = locationBlocks(src).filter((b) => /\badd_header\b/.test(b));
  if (leaky.length) {
    err(
      "header.inheritance",
      `${leaky.length} 个 location 内出现 add_header，导致 server 层安全头不再继承；请改用 map + server 层统一注入`,
    );
  }

  // ---------- 缓存 ----------
  if (!/map\s+\$uri\s+\$cache_control\s*\{/.test(src)) {
    err("cache.map", "缺少按 URI 生成 Cache-Control 的 map");
  }
  if (!/max-age=31536000,\s*immutable/.test(src)) {
    err("cache.immutable", "/assets 未设置一年 immutable");
  }
  if (!/=\/index\.html\s+"no-cache"/.test(src)) {
    err("cache.html", "index.html 未声明 no-cache");
  }
  if (!/=\/sw\.js\s+"no-cache"/.test(src)) {
    err("cache.sw", "sw.js 未声明 no-cache（会导致 SW 更新不生效）");
  }

  // ---------- 压缩 ----------
  if (!/^\s*gzip\s+on\s*;/m.test(src)) err("gzip.on", "gzip 未开启");
  if (!/^\s*gzip_static\s+on\s*;/m.test(src)) {
    err("gzip.static", "gzip_static 未开启（构建期预压缩文件无法直接命中）");
  }
  if (!/gzip_types[^;]*application\/javascript/.test(src)) {
    err("gzip.types", "gzip_types 缺少 application/javascript");
  }
  if (!/^\s*brotli\s+on\s*;/m.test(src)) {
    warn("brotli.module", "未启用 brotli（需要 ngx_brotli 模块；未安装时不能写该指令）");
  }

  // ---------- 反向代理 ----------
  if (!/upstream\s+frontend_bff\s*\{/.test(src)) err("proxy.upstream", "缺少 BFF upstream");
  if (!/^\s*keepalive\s+\d+\s*;/m.test(src)) {
    err("proxy.keepalive", "upstream 未配置 keepalive，每个请求都会新建 TCP 连接");
  }
  if (!/proxy_http_version\s+1\.1\s*;/.test(src)) {
    err("proxy.http11", "反向代理必须使用 HTTP/1.1 才能复用长连接");
  }
  if (!/proxy_set_header\s+Connection\s+""/.test(src)) {
    err("proxy.connection", "缺少 `proxy_set_header Connection \"\";`，keepalive 会被客户端 Connection 头破坏");
  }
  if (!/proxy_set_header\s+X-Forwarded-Proto\s+\$scheme\s*;/.test(src)) {
    warn("proxy.forwarded-proto", "缺少 X-Forwarded-Proto，后端生成绝对 URL 时可能写成 http");
  }
  if (!/proxy_set_header\s+X-Request-Id\s+\$request_id\s*;/.test(src)) {
    warn("proxy.request-id", "建议透传 X-Request-Id，便于前后端日志串联");
  }

  // ---------- SPA 与可观测 ----------
  if (!/try_files\s+\$uri\s+\$uri\/\s+\/index\.html\s*;/.test(src)) {
    err("spa.fallback", "缺少 SPA history 回退");
  }
  if (!/location\s+=\s+\/healthz\s*\{[\s\S]*?return\s+200/.test(src)) {
    err("ops.healthz", "缺少 /healthz 健康检查端点");
  }
  if (!/location\s+\/\.well-known\/acme-challenge\//.test(src)) {
    err("ops.acme", "缺少 ACME challenge 通道，certbot webroot 续期会失败");
  }
  if (!/return\s+301\s+https:\/\/\$host\$request_uri/.test(src)) {
    err("ops.redirect", "80 端口未配置到 https 的 301");
  }
  if (!/access_log\s+\S+/.test(src)) warn("ops.access-log", "缺少 access_log");
  if (!/error_log\s+\S+/.test(src)) warn("ops.error-log", "缺少 error_log");

  return findings;
}

function format(fs: Finding[]): string {
  return fs.map((f) => `${f.level === "error" ? "✗" : "△"} [${f.rule}] ${f.message}`).join("\n");
}

// ===================== 运行断言 =====================
console.log("===== 1. 真实生产配置体检 =====");
const findings = audit(SRC);
const errors = findings.filter((f) => f.level === "error");
const warns = findings.filter((f) => f.level === "warn");
assert.deepStrictEqual(errors, [], `生产配置不应有 error：\n${format(errors)}`);
console.log(`✓ error=0 / warn=${warns.length}`);
if (warns.length) console.log(format(warns));

console.log("\n===== 2. 逐项破坏，审计器必须命中 =====");

const withoutHsts = SRC.replace(/add_header Strict-Transport-Security[^\n]*\n/, "");
assert(
  audit(withoutHsts).some((f) => f.rule === "header.hsts"),
  "删除 HSTS 后必须报 header.hsts",
);

const weakHsts = SRC.replace(/max-age=63072000/, "max-age=600");
assert(
  audit(weakHsts).some((f) => f.rule === "header.hsts-age"),
  "HSTS 时长过短必须报错",
);

const noHttp2 = SRC.replace(/^\s*http2 on;\n/m, "");
assert(
  audit(noHttp2).some((f) => f.rule === "tls.http2"),
  "删除 http2 必须报错",
);

const noKeepalive = SRC.replace(/^\s*keepalive 32;\n/m, "");
assert(
  audit(noKeepalive).some((f) => f.rule === "proxy.keepalive"),
  "删除 upstream keepalive 必须报错",
);

const noFallback = SRC.replace(/try_files \$uri \$uri\/ \/index\.html;/, "try_files $uri =404;");
assert(
  audit(noFallback).some((f) => f.rule === "spa.fallback"),
  "删除 SPA 回退必须报错",
);

console.log("✓ HSTS 缺失 / HSTS 过短 / HTTP2 关闭 / keepalive 缺失 / SPA 回退缺失 全部命中");

console.log("\n===== 3. add_header 继承陷阱 =====");
const trap = SRC.replace(
  "    location /assets/ {\n        access_log off;",
  '    location /assets/ {\n        add_header Cache-Control "public, max-age=31536000, immutable" always;\n        access_log off;',
);
const trapFindings = audit(trap);
assert(
  trapFindings.some((f) => f.rule === "header.inheritance"),
  "location 内出现 add_header 必须触发继承陷阱检查",
);
console.log("✓ location 内新增 add_header 被拦截（安全头会静默失效）");

console.log("\n===== 4. 检查项覆盖度 =====");
// 正确配置本身可能零告警，覆盖度用「破坏样本能触发的规则集合」衡量
const triggered = new Set(
  [withoutHsts, weakHsts, noHttp2, noKeepalive, noFallback, trap].flatMap((s) =>
    audit(s).map((f) => f.rule),
  ),
);
assert(triggered.size >= 6, `审计器有效规则过少：${[...triggered].join(", ")}`);
assert(!findings.some((f) => f.rule === "header.inheritance"), "正确配置不应触发继承陷阱");
console.log(`✓ 破坏样本触发 ${triggered.size} 条规则：${[...triggered].join(", ")}`);

console.log("\n✅ Nginx 生产审计：TLS + 安全头 + 缓存 + 压缩 + 代理 + SPA + 运维端点全部通过");

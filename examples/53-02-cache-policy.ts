// 文件: examples/53-02-cache-policy.ts
// ============ 静态资源缓存策略:哪些能 immutable,哪些必须 no-cache ============
// 设计要点:
// 1) HTML 是「入口」,必须每次校验,否则用户永远打不开新版本;
// 2) 带内容哈希的静态资源可以一年 immutable,因为 URL 变了才会重新请求;
// 3) Service Worker、manifest 这类「控制层文件」必须 no-cache,否则更新不生效;
// 4) API 响应默认 no-store,除非明确可缓存。

interface CacheRule {
  match: (path: string) => boolean;
  header: string;
  reason: string;
}

const HASHED = /[-.][0-9a-f]{8,}\.(js|css|woff2?|png|jpe?g|svg|webp|avif)$/i;

const RULES: CacheRule[] = [
  {
    match: (p) => /(^|\/)sw\.js$/.test(p) || /(^|\/)service-worker\.js$/.test(p),
    header: "no-cache",
    reason: "Service Worker 控制缓存与更新,必须每次校验",
  },
  {
    match: (p) => /(^|\/)manifest\.webmanifest$/.test(p) || /(^|\/)manifest\.json$/.test(p),
    header: "no-cache",
    reason: "PWA 清单变更需要及时生效",
  },
  {
    match: (p) => /\.html?$/.test(p) || p === "/" || p.endsWith("/"),
    header: "no-cache",
    reason: "HTML 是版本入口,必须协商缓存",
  },
  {
    match: (p) => /(^|\/)(index|runtime|polyfills)[-.][0-9a-f]{6,}\.js$/i.test(p),
    header: "no-cache",
    reason: "入口 chunk 文件名稳定但内容随构建变化,不能长缓存",
  },
  {
    match: (p) => HASHED.test(p),
    header: "public, max-age=31536000, immutable",
    reason: "文件名含内容哈希,内容变则 URL 变",
  },
  {
    match: (p) => /\.(png|jpe?g|gif|webp|avif|svg|ico)$/i.test(p),
    header: "public, max-age=604800",
    reason: "无哈希图片短缓存,兼顾更新与流量",
  },
  {
    match: (p) => /\.(woff2?|ttf|otf)$/i.test(p),
    header: "public, max-age=31536000, immutable",
    reason: "字体文件极少变化,可长缓存",
  },
  {
    match: (p) => /^\/api\//.test(p),
    header: "no-store",
    reason: "接口数据默认不缓存,由业务层决定",
  },
];

function cacheControl(path: string): { header: string; reason: string } {
  for (const rule of RULES) {
    if (rule.match(path)) return { header: rule.header, reason: rule.reason };
  }
  return { header: "public, max-age=3600", reason: "未匹配资源,保守短缓存" };
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

const samples = [
  "/",
  "/index.html",
  "/assets/index-a1b2c3d4.js",
  "/assets/vendor-9f8e7d6c.js",
  "/assets/logo-1a2b3c4d.png",
  "/img/banner.png",
  "/fonts/inter-7c8d9e0f.woff2",
  "/sw.js",
  "/manifest.webmanifest",
  "/api/orders",
];

console.log("=== 缓存策略 ===");
for (const path of samples) {
  const { header, reason } = cacheControl(path);
  console.log(`${path.padEnd(34)} → ${header}`);
  console.log(`  理由:${reason}`);
}

// ---------------- 断言:关键路径必须正确 ----------------
assert(cacheControl("/index.html").header === "no-cache", "HTML 必须协商缓存");
assert(cacheControl("/").header === "no-cache", "根路径必须协商缓存");
assert(cacheControl("/sw.js").header === "no-cache", "Service Worker 必须 no-cache");
assert(
  cacheControl("/assets/vendor-9f8e7d6c.js").header.includes("immutable"),
  "哈希资源应 immutable",
);
assert(
  cacheControl("/assets/index-a1b2c3d4.js").header === "no-cache",
  "入口 chunk 优先命中 no-cache 规则",
);
assert(cacheControl("/api/orders").header === "no-store", "API 默认不缓存");

// ---------------- 边界:未哈希的 JS 不应长缓存 ----------------
const unhashed = cacheControl("/assets/app.js");
console.log("\n未哈希 JS:", unhashed);
assert(!unhashed.header.includes("immutable"), "无哈希资源不能 immutable");

console.log("\n缓存策略通过:入口、哈希资源、Service Worker、API 四类边界清晰。");

// 标记为模块,避免与其它示例的顶层变量重名
export {};

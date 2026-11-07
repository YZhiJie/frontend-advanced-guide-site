/**
 * 第 95 部分 · Next.js Google SEO 与海外站点
 * JD 需求点：海外 Web JD 要求 Next.js + Google SEO、SSR/SSG、
 *   Metadata / Open Graph / sitemap / robots / 结构化数据、Core Web Vitals、多语言。
 * 本示例在 Node 环境模拟：
 *   1) 渲染策略路由（SSR/SSG/ISR/CSR 按场景选择）
 *   2) SEO Metadata 校验（title/description/OG/Twitter 必填）
 *   3) sitemap.xml 生成 + robots.txt 规则
 *   4) JSON-LD 结构化数据校验（Article/Product/FAQ）
 *   5) Core Web Vitals 评分（LCP/CLS/INP → 是否达标）
 * 运行：npx tsx examples/95-01-nextjs-google-seo.ts
 */
import assert from "node:assert";

// ---------- 1. 渲染策略路由 ----------
type RenderStrategy = "SSR" | "SSG" | "ISR" | "CSR";
interface PageContext {
  dataFreshness: "realtime" | "hourly" | "daily" | "static"; // 数据新鲜度
  seo: boolean;           // 是否需要 SEO
  userSpecific: boolean;  // 是否用户个性化
}

function selectStrategy(ctx: PageContext): RenderStrategy {
  // 用户个性化且不需要 SEO → CSR
  if (ctx.userSpecific && !ctx.seo) return "CSR";
  // 实时数据 → SSR
  if (ctx.dataFreshness === "realtime") return "SSR";
  // 静态内容 → SSG
  if (ctx.dataFreshness === "static") return "SSG";
  // 小时/天级更新 → ISR
  return "ISR";
}

// ---------- 2. SEO Metadata 校验 ----------
interface SeoMetadata {
  title: string;
  description: string;
  canonical?: string;
  openGraph?: { title: string; description: string; image: string; url: string };
  twitter?: { card: "summary" | "summary_large_image"; title: string; image: string };
}

function validateSeo(meta: SeoMetadata): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!meta.title || meta.title.length < 10) errors.push("title 过短（<10 字符）");
  if (meta.title.length > 60) errors.push("title 过长（>60 字符，Google 截断）");
  if (!meta.description || meta.description.length < 50) errors.push("description 过短（<50 字符）");
  if (meta.description.length > 160) errors.push("description 过长（>160 字符）");
  if (meta.openGraph) {
    if (!meta.openGraph.image) errors.push("OG image 缺失");
    if (!meta.openGraph.url) errors.push("OG url 缺失");
  }
  if (meta.twitter && !meta.twitter.image) errors.push("Twitter image 缺失");
  return { valid: errors.length === 0, errors };
}

// ---------- 3. sitemap.xml + robots.txt 生成 ----------
interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: number;
}

function generateSitemap(urls: SitemapUrl[]): string {
  const body = urls
    .map((u) => {
      let xml = `  <url><loc>${u.loc}</loc>`;
      if (u.lastmod) xml += `<lastmod>${u.lastmod}</lastmod>`;
      if (u.changefreq) xml += `<changefreq>${u.changefreq}</changefreq>`;
      if (u.priority !== undefined) xml += `<priority>${u.priority.toFixed(1)}</priority>`;
      return xml + `</url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`;
}

function generateRobots(opts: {
  allow: string[];
  disallow: string[];
  sitemap: string;
}): string {
  let txt = "User-agent: *\n";
  for (const p of opts.allow) txt += `Allow: ${p}\n`;
  for (const p of opts.disallow) txt += `Disallow: ${p}\n`;
  txt += `Sitemap: ${opts.sitemap}\n`;
  return txt;
}

// ---------- 4. JSON-LD 结构化数据校验 ----------
type SchemaType = "Article" | "Product" | "FAQPage" | "BreadcrumbList";

function validateJsonLd(type: SchemaType, data: Record<string, unknown>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  // 必须有 @context 和 @type
  if (data["@context"] !== "https://schema.org") errors.push("@context 必须是 https://schema.org");
  if (data["@type"] !== type) errors.push(`@type 应为 ${type}`);

  switch (type) {
    case "Article":
      if (!data.headline) errors.push("Article 缺 headline");
      if (!data.datePublished) errors.push("Article 缺 datePublished");
      break;
    case "Product":
      if (!data.name) errors.push("Product 缺 name");
      if (!data.offers) errors.push("Product 缺 offers");
      break;
    case "FAQPage":
      if (!Array.isArray(data.mainEntity) || data.mainEntity.length === 0)
        errors.push("FAQPage 缺 mainEntity 数组");
      break;
    case "BreadcrumbList":
      if (!Array.isArray(data.itemListElement)) errors.push("BreadcrumbList 缺 itemListElement");
      break;
  }
  return { valid: errors.length === 0, errors };
}

// ---------- 5. Core Web Vitals 评分 ----------
interface WebVitals {
  lcp: number; // ms，最大内容绘制
  cls: number; // 累计布局偏移
  inp: number; // ms，交互到下一帧
}

// Google 阈值：LCP < 2500, CLS < 0.1, INP < 200 为 Good
function assessVitals(v: WebVitals): { overall: "good" | "needs-improvement" | "poor"; details: Record<string, string> } {
  const lcp = v.lcp < 2500 ? "good" : v.lcp < 4000 ? "needs-improvement" : "poor";
  const cls = v.cls < 0.1 ? "good" : v.cls < 0.25 ? "needs-improvement" : "poor";
  const inp = v.inp < 200 ? "good" : v.inp < 500 ? "needs-improvement" : "poor";
  const levels = [lcp, cls, inp];
  const overall = levels.includes("poor")
    ? "poor"
    : levels.includes("needs-improvement")
    ? "needs-improvement"
    : "good";
  return { overall, details: { LCP: lcp, CLS: cls, INP: inp } };
}

// ===================== 运行断言 =====================
console.log("===== 1. 渲染策略路由 =====");
assert(selectStrategy({ dataFreshness: "static", seo: true, userSpecific: false }) === "SSG", "静态内容→SSG");
assert(selectStrategy({ dataFreshness: "realtime", seo: true, userSpecific: false }) === "SSR", "实时→SSR");
assert(selectStrategy({ dataFreshness: "hourly", seo: true, userSpecific: false }) === "ISR", "小时级→ISR");
assert(selectStrategy({ dataFreshness: "static", seo: false, userSpecific: true }) === "CSR", "用户个性化无SEO→CSR");
console.log("✓ 渲染策略：SSG/SSR/ISR/CSR 路由正确");

console.log("\n===== 2. SEO Metadata 校验 =====");
const okMeta = validateSeo({
  title: "Best SaaS Tool for Teams 2025",
  description: "The all-in-one SaaS platform that boosts team productivity with AI-powered workflows.",
  openGraph: { title: "Best SaaS Tool", description: "...", image: "https://x.com/og.png", url: "https://x.com" },
  twitter: { card: "summary_large_image", title: "Best SaaS", image: "https://x.com/tw.png" },
});
assert(okMeta.valid, "合法 metadata 应通过");

const badMeta = validateSeo({ title: "Hi", description: "short" });
assert(!badMeta.valid && badMeta.errors.length >= 2, `非法 metadata 应报错，实际 ${badMeta.errors.length} 个`);
console.log(`✓ Metadata：合法通过，非法检测到 ${badMeta.errors.length} 个问题`);

console.log("\n===== 3. sitemap + robots =====");
const sitemap = generateSitemap([
  { loc: "https://x.com/", changefreq: "daily", priority: 1.0 },
  { loc: "https://x.com/about", lastmod: "2025-01-01", priority: 0.8 },
]);
assert(sitemap.includes("<loc>https://x.com/</loc>"), "sitemap 应包含 URL");
assert(sitemap.includes("<priority>1.0</priority>"), "sitemap 应包含 priority");

const robots = generateRobots({
  allow: ["/"],
  disallow: ["/admin", "/api/"],
  sitemap: "https://x.com/sitemap.xml",
});
assert(robots.includes("Disallow: /admin"), "robots 应禁止 /admin");
assert(robots.includes("Sitemap: https://x.com/sitemap.xml"), "robots 应指向 sitemap");
console.log("✓ sitemap.xml + robots.txt 生成正确");

console.log("\n===== 4. JSON-LD 结构化数据 =====");
const article = validateJsonLd("Article", {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "How to use Next.js",
  datePublished: "2025-01-01",
});
assert(article.valid, "合法 Article 应通过");

const badFaq = validateJsonLd("FAQPage", {
  "@context": "https://schema.org",
  "@type": "Product", // 类型错误
});
assert(!badFaq.valid, "类型错误应不通过");
console.log("✓ JSON-LD：Article 通过，类型错误被拦截");

console.log("\n===== 5. Core Web Vitals =====");
const good = assessVitals({ lcp: 1800, cls: 0.05, inp: 120 });
assert(good.overall === "good", "全优应 overall=good");

const poor = assessVitals({ lcp: 5000, cls: 0.3, inp: 800 });
assert(poor.overall === "poor", "全差应 overall=poor");
console.log(`✓ CWV：全优=good，全差=poor`);

console.log("\n✅ 渲染策略 + Metadata + sitemap/robots + JSON-LD + Core Web Vitals 全部通过");

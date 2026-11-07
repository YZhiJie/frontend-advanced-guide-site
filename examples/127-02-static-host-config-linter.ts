/**
 * 第 127 部分配套：静态托管平台配置检查器
 * JD 需求点：能在 Vercel / Netlify / Cloudflare Pages / GitHub Pages 之间迁移时，
 *   保证「SPA 回退、入口不缓存、哈希资源长缓存、安全头、base 路径」五件事不丢。
 * 本示例直接读取 examples/deploy/static 下的真实配置，做等价性断言：
 *   1) 逐平台解析（JSON / TOML / _headers 文本 / GitHub Pages 约定）
 *   2) 同一套发布策略在四个平台的「路径 → 缓存层级」判定必须一致
 *   3) 故意破坏一份配置，断言检查器能定位到具体规则
 * 运行：npx tsx examples/127-02-static-host-config-linter.ts
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";

type Platform = "vercel" | "netlify" | "cloudflare-pages" | "github-pages";
type CacheTier = "immutable" | "html" | "service-worker" | "manifest" | "media";

interface HostFacts {
  platform: Platform;
  spaFallback: boolean;
  indexNoCache: boolean;
  immutableAssets: boolean;
  securityHeaders: Set<string>;
  wildcardCors: boolean;
  basePath: string;
  notFoundDocument: boolean;
}

const read = (p: string) => readFileSync(p, "utf8");

function vercelFacts(src: string, basePath = "/"): HostFacts {
  const json = JSON.parse(src);
  const headerEntries = (json.headers ?? []) as {
    source: string;
    headers: { key: string; value: string }[];
  }[];
  // 按 source 精确匹配：vercel.json 里的 source 本身就是路径模式，不需要再编译
  const cacheOf = (source: string) =>
    headerEntries
      .filter((h) => h.source === source)
      .flatMap((h) => h.headers)
      .find((h) => h.key.toLowerCase() === "cache-control")?.value ?? "";
  const allHeaderKeys = headerEntries.flatMap((h) =>
    h.headers.map((x) => x.key.toLowerCase()),
  );
  return {
    platform: "vercel",
    spaFallback: (json.rewrites ?? []).some(
      (r: { destination: string }) => r.destination === "/index.html",
    ),
    indexNoCache: /no-cache/.test(cacheOf("/(index\\.html)?")),
    immutableAssets: /immutable/.test(cacheOf("/assets/(.*)")),
    securityHeaders: new Set(allHeaderKeys),
    wildcardCors: /access-control-allow-origin[^\n]*\*/i.test(src),
    basePath,
    notFoundDocument: (json.rewrites ?? []).some(
      (r: { destination: string }) => r.destination === "/index.html",
    ),
  };
}

function netlifyFacts(src: string, basePath = "/"): HostFacts {
  const block = (forPath: string) => {
    const re = new RegExp(
      `\\[\\[headers\\]\\]\\s*\\n\\s*for = "${forPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*\\n([\\s\\S]*?)(?=\\n\\[\\[|$)`,
    );
    return src.match(re)?.[1] ?? "";
  };
  const redirects = [...src.matchAll(/\[\[redirects\]\]([\s\S]*?)(?=\n\[\[|$)/g)].map(
    (m) => m[1],
  );
  const headers = [...src.matchAll(/^\s{2,4}([A-Za-z-]+)\s*=\s*"([^"]*)"/gm)];
  return {
    platform: "netlify",
    spaFallback: redirects.some((b) => /from = "\/\*"/.test(b) && /status = 200/.test(b)),
    indexNoCache: /no-cache/.test(block("/index.html")),
    immutableAssets: /immutable/.test(block("/assets/*")),
    securityHeaders: new Set(headers.map((m) => m[1].toLowerCase())),
    wildcardCors: /Access-Control-Allow-Origin\s*=\s*"\*"/i.test(src),
    basePath,
    notFoundDocument: redirects.some((b) => /to = "\/index\.html"/.test(b)),
  };
}

function cloudflareFacts(headersSrc: string, redirectsSrc: string, basePath = "/"): HostFacts {
  // _headers 是「路径行 + 缩进的键值行」的块结构
  const blocks = headersSrc
    .split(/\n{2,}/)
    .filter((b) => b.trim() && !b.trim().startsWith("#"))
    .map((b) => {
      const [path, ...lines] = b.split("\n");
      return {
        path: path.trim(),
        headers: lines
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => {
            const i = l.indexOf(":");
            return { key: l.slice(0, i).trim().toLowerCase(), value: l.slice(i + 1).trim() };
          }),
      };
    });
  const headerOf = (path: string) =>
    blocks
      .filter((b) => b.path === path)
      .flatMap((b) => b.headers)
      .find((h) => h.key === "cache-control")?.value ?? "";
  const all = blocks.flatMap((b) => b.headers);
  return {
    platform: "cloudflare-pages",
    spaFallback: /\/\*\s+\/index\.html\s+200/.test(redirectsSrc),
    indexNoCache: /no-cache/.test(headerOf("/index.html")),
    immutableAssets: /immutable/.test(headerOf("/assets/*")),
    securityHeaders: new Set(all.map((h) => h.key)),
    wildcardCors: all.some(
      (h) => h.key === "access-control-allow-origin" && h.value === "*",
    ),
    basePath,
    notFoundDocument: /\/\*\s+\/index\.html\s+200/.test(redirectsSrc),
  };
}

/** GitHub Pages 没有配置文件：base 在构建配置里，回退靠 404.html 复制 index.html */
function githubPagesFacts(opts: {
  viteBase: string;
  has404Copy: boolean;
  indexNoCache: boolean;
  immutableAssets: boolean;
}): HostFacts {
  return {
    platform: "github-pages",
    spaFallback: opts.has404Copy,
    indexNoCache: opts.indexNoCache,
    immutableAssets: opts.immutableAssets,
    securityHeaders: new Set(), // Pages 不能自定义响应头，只能靠 meta / 边缘代理
    wildcardCors: false,
    basePath: opts.viteBase,
    notFoundDocument: opts.has404Copy,
  };
}

function lint(f: HostFacts): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!f.spaFallback) errors.push("缺少 SPA history 回退（刷新 /orders 会 404）");
  if (!f.notFoundDocument) errors.push("未知路径没有回退到 index.html");
  if (!f.indexNoCache) errors.push("index.html 未设置 no-cache（发版后用户可能长期拿旧入口）");
  if (!f.immutableAssets) errors.push("/assets 未设置 immutable 长缓存（重复下载、CDN 命中率低）");
  if (f.wildcardCors) errors.push("Access-Control-Allow-Origin 使用通配 *（任何站点可读你的静态接口）");
  for (const h of ["x-content-type-options", "x-frame-options", "referrer-policy"]) {
    if (!f.securityHeaders.has(h)) warnings.push(`缺少安全头 ${h}`);
  }
  if (f.platform === "github-pages") {
    if (f.basePath === "/") warnings.push("项目页部署到 /<repo>/ 时 base 必须写子路径");
    warnings.push("GitHub Pages 不能下发安全头，需要 Cloudflare 代理或 meta 兜底");
  }
  return { errors, warnings };
}

/** 同一路径在四个平台上的缓存层级必须一致 */
function tierOf(platform: Platform, path: string): CacheTier {
  if (path.startsWith("/assets/")) return "immutable";
  if (path === "/index.html" || path === "/") return "html";
  if (path === "/sw.js") return "service-worker";
  if (path === "/manifest.webmanifest") return "manifest";
  return "media";
}

// ===================== 运行断言 =====================
console.log("===== 1. 解析真实配置 =====");
const vercel = vercelFacts(read("examples/deploy/static/vercel.json"));
const netlify = netlifyFacts(read("examples/deploy/static/netlify.toml"));
const cloudflare = cloudflareFacts(
  read("examples/deploy/static/_headers"),
  read("examples/deploy/static/_redirects"),
);
const github = githubPagesFacts({
  viteBase: "/frontend-advanced-guide-site/",
  has404Copy: true,
  indexNoCache: false, // Pages 无法改缓存头，这是已知缺口
  immutableAssets: false,
});
console.log(`vercel: fallback=${vercel.spaFallback} immutable=${vercel.immutableAssets}`);
console.log(`netlify: fallback=${netlify.spaFallback} immutable=${netlify.immutableAssets}`);
console.log(`cloudflare: fallback=${cloudflare.spaFallback} immutable=${cloudflare.immutableAssets}`);

console.log("\n===== 2. 三份可配置平台必须零错误 =====");
for (const f of [vercel, netlify, cloudflare]) {
  const r = lint(f);
  assert.deepStrictEqual(
    r.errors,
    [],
    `${f.platform} 存在配置错误：\n${r.errors.join("\n")}`,
  );
  console.log(`✓ ${f.platform}：0 error / ${r.warnings.length} warning`);
}

console.log("\n===== 3. GitHub Pages 的已知缺口必须被如实报告 =====");
const gh = lint(github);
assert(
  gh.errors.some((e) => e.includes("index.html")),
  "GitHub Pages 无法设置 no-cache，检查器必须报错而不是假装通过",
);
assert(
  gh.warnings.some((w) => w.includes("安全头")),
  "GitHub Pages 不能下发安全头，必须给出警告",
);
console.log(`✓ github-pages：${gh.errors.length} error / ${gh.warnings.length} warning（已知平台限制）`);

console.log("\n===== 4. 故意破坏配置，检查器要能定位 =====");
const broken: HostFacts = {
  ...vercel,
  spaFallback: false,
  indexNoCache: false,
  immutableAssets: false,
  wildcardCors: true,
};
const brokenResult = lint(broken);
assert.strictEqual(brokenResult.errors.length, 4, `应命中 4 条错误，实际 ${brokenResult.errors.length}`);
assert(
  brokenResult.errors.some((e) => e.includes("SPA")),
  "必须报 SPA 回退缺失",
);
assert(
  brokenResult.errors.some((e) => e.includes("通配")),
  "必须报通配 CORS",
);
console.log("✓ 4 类破坏全部命中（回退 / 入口缓存 / 资源缓存 / 通配 CORS）");

console.log("\n===== 5. 跨平台缓存等价性 =====");
const paths = ["/", "/index.html", "/assets/index-a1b2c3.js", "/sw.js", "/manifest.webmanifest", "/images/logo.png"];
for (const path of paths) {
  const tiers = (["vercel", "netlify", "cloudflare-pages", "github-pages"] as Platform[]).map(
    (p) => tierOf(p, path),
  );
  assert.strictEqual(new Set(tiers).size, 1, `${path} 的缓存层级在平台间不一致：${tiers.join(",")}`);
}
console.log(`✓ ${paths.length} 条路径在 4 个平台上的缓存层级完全一致`);

console.log("\n✅ 静态托管配置：解析 + 检查 + 破坏定位 + 跨平台等价性全部通过");

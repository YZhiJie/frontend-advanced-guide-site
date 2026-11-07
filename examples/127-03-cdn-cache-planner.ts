/**
 * 第 127 部分配套：CDN 缓存分层与发布顺序规划器
 * JD 需求点：能给出「哪些文件长缓存、哪些必须回源、先传什么后传什么、刷新哪些路径」
 *   的可执行发布计划，避免「先刷 HTML 后传资源」造成的白屏窗口。
 * 本示例：
 *   1) 路径 → 缓存层判定（顺序敏感：精确匹配优先于通配）
 *   2) 生成 Cache-Control 与 CDN TTL 建议
 *   3) 发布批次排序：哈希资源 → HTML → SW/manifest，并断言依赖关系
 *   4) 刷新计划：只刷入口与 SW，哈希资源靠换名而不是 purge
 *   5) 预热列表与回滚计划
 * 运行：npx tsx examples/127-03-cdn-cache-planner.ts
 */
import assert from "node:assert";

type Tier = "immutable" | "html" | "service-worker" | "manifest" | "api" | "media";

interface Rule {
  tier: Tier;
  match: (path: string) => boolean;
  cacheControl: string;
  cdnTtlSeconds: number;
  purgeOnRelease: boolean;
  note: string;
}

const RULES: Rule[] = [
  {
    tier: "service-worker",
    match: (p) => p === "/sw.js",
    cacheControl: "no-cache",
    cdnTtlSeconds: 0,
    purgeOnRelease: true,
    note: "SW 必须每次回源校验，否则更新永远不生效",
  },
  {
    tier: "manifest",
    match: (p) => p === "/manifest.webmanifest",
    cacheControl: "public, max-age=3600",
    cdnTtlSeconds: 3600,
    purgeOnRelease: true,
    note: "manifest 可短缓存；改名/换图标后 1 小时内生效",
  },
  {
    tier: "html",
    match: (p) => p === "/" || p === "/index.html" || p.endsWith(".html"),
    cacheControl: "no-cache",
    cdnTtlSeconds: 0,
    purgeOnRelease: true,
    note: "入口每次协商缓存，保证新版本引用立刻可见",
  },
  {
    tier: "immutable",
    match: (p) =>
      p.startsWith("/assets/") && /[-.][a-f0-9]{6,}\.(js|css|woff2?|png|svg|webp)$/i.test(p),
    cacheControl: "public, max-age=31536000, immutable",
    cdnTtlSeconds: 31536000,
    purgeOnRelease: false,
    note: "内容哈希命名，换版本即换 URL，永不需要 purge",
  },
  {
    tier: "api",
    match: (p) => p.startsWith("/api/"),
    cacheControl: "no-store",
    cdnTtlSeconds: 0,
    purgeOnRelease: false,
    note: "接口不进 CDN 缓存；需要缓存时由 BFF 显式声明",
  },
  {
    tier: "media",
    match: (p) => /^\/images\/.+\.(png|jpe?g|webp|avif|svg)$/i.test(p) || /^\/fonts\//.test(p),
    cacheControl: "public, max-age=2592000",
    cdnTtlSeconds: 2592000,
    purgeOnRelease: true,
    note: "未哈希的运营图：中长缓存，替换时按路径刷新",
  },
];

function plan(path: string): Rule {
  const hit = RULES.find((r) => r.match(path));
  assert(hit, `未覆盖的路径：${path}（必须在规则表里显式声明，不能靠默认值）`);
  return hit;
}

type Phase = "assets" | "html" | "service-worker" | "manifest";

interface Batch {
  phase: Phase;
  paths: string[];
  dependsOn: Phase[];
  reason: string;
}

function buildBatches(files: string[]): Batch[] {
  const byPhase = (phase: Phase) => files.filter((f) => plan(f).tier === phase);
  return [
    {
      phase: "assets",
      paths: byPhase("immutable"),
      dependsOn: [],
      reason: "先让新资源在边缘就位；旧 HTML 仍能引用旧资源，无白屏窗口",
    },
    {
      phase: "html",
      paths: [...byPhase("html"), ...files.filter((f) => plan(f).tier === "media")],
      dependsOn: ["assets"],
      reason: "HTML 引用了新资源，必须在资源上传之后再切换",
    },
    {
      phase: "manifest",
      paths: byPhase("manifest"),
      dependsOn: ["html"],
      reason: "manifest 指向的图标通常由 HTML 同批发布",
    },
    {
      phase: "service-worker",
      paths: byPhase("service-worker"),
      dependsOn: ["html", "manifest"],
      reason: "SW 最后发：它一旦接管，就会按新清单缓存资源",
    },
  ];
}

/** 拓扑排序校验：依赖必须排在前面 */
function assertOrder(batches: Batch[]): void {
  const seen = new Set<Phase>();
  for (const b of batches) {
    for (const dep of b.dependsOn) {
      assert(seen.has(dep), `${b.phase} 依赖 ${dep}，但 ${dep} 尚未发布`);
    }
    seen.add(b.phase);
  }
}

interface PurgePlan {
  paths: string[];
  reason: string;
}

function purgePlan(files: string[]): PurgePlan {
  const purge = files.filter((f) => plan(f).purgeOnRelease);
  return {
    paths: [...new Set(purge)],
    reason: "只刷入口 / SW / manifest；哈希资源靠 URL 变化天然失效，刷了既慢又浪费配额",
  };
}

interface WarmupPlan {
  urls: string[];
  budgetMs: number;
}

/** 预热：只预热首屏关键资源，按文件体积与优先级限流 */
function warmupPlan(files: string[], budgetMs = 3000): WarmupPlan {
  const priority = (f: string) => {
    if (f === "/index.html" || f === "/") return 0;
    if (/\.css$/.test(f)) return 1;
    if (/\.js$/.test(f)) return 2;
    if (/\.(woff2?|png|svg|webp)$/.test(f)) return 3;
    return 4;
  };
  const urls = [...files].sort((a, b) => priority(a) - priority(b)).slice(0, 12);
  const perRequest = 250; // 单个预热的经验耗时上限
  return { urls, budgetMs: Math.min(budgetMs, urls.length * perRequest) };
}

interface RollbackPlan {
  restore: string[];
  purge: string[];
  keep: string[];
}

function rollbackPlan(previousRelease: string, files: string[]): RollbackPlan {
  return {
    restore: files.filter((f) => plan(f).tier === "html" || plan(f).tier === "service-worker"),
    purge: files.filter((f) => plan(f).purgeOnRelease),
    keep: files.filter((f) => plan(f).tier === "immutable"),
  };
}

// ===================== 运行断言 =====================
const RELEASE = [
  "/index.html",
  "/assets/index-7f3a2b.js",
  "/assets/index-7f3a2b.css",
  "/assets/vendor-91c0de.js",
  "/sw.js",
  "/manifest.webmanifest",
  "/images/banner.png",
  "/api/config",
];

console.log("===== 1. 路径 → 缓存层 =====");
assert.strictEqual(plan("/index.html").tier, "html");
assert.strictEqual(plan("/assets/index-7f3a2b.js").tier, "immutable");
assert.strictEqual(plan("/sw.js").tier, "service-worker");
assert.strictEqual(plan("/manifest.webmanifest").tier, "manifest");
assert.strictEqual(plan("/api/config").tier, "api");
assert.strictEqual(plan("/images/banner.png").tier, "media");
assert.strictEqual(plan("/assets/index-7f3a2b.js").cacheControl, "public, max-age=31536000, immutable");
console.log("✓ 6 类路径全部命中显式规则，无默认兜底");

console.log("\n===== 2. 发布批次顺序 =====");
const batches = buildBatches(RELEASE);
assertOrder(batches);
assert.deepStrictEqual(
  batches.map((b) => b.phase),
  ["assets", "html", "manifest", "service-worker"],
);
const htmlBatch = batches.find((b) => b.phase === "html")!;
assert(htmlBatch.dependsOn.includes("assets"), "HTML 必须在资源之后发布");
const swBatch = batches.find((b) => b.phase === "service-worker")!;
assert(swBatch.dependsOn.includes("html"), "SW 必须在 HTML 之后发布");
console.log(`✓ ${batches.length} 个批次，依赖链 assets → html → manifest → service-worker`);

console.log("\n===== 3. 乱序必须被拒绝 =====");
const wrong = [...batches].reverse();
assert.throws(() => assertOrder(wrong), /依赖/, "倒序发布必须触发依赖断言");
console.log("✓ 倒序批次被拓扑排序断言拦截");

console.log("\n===== 4. 刷新计划 =====");
const purge = purgePlan(RELEASE);
assert.deepStrictEqual(purge.paths.sort(), [
  "/images/banner.png",
  "/index.html",
  "/manifest.webmanifest",
  "/sw.js",
]);
assert(!purge.paths.some((p) => p.startsWith("/assets/")), "哈希资源不应进入 purge 列表");
console.log(`✓ 刷新 ${purge.paths.length} 条（入口 + SW + manifest + 未哈希运营图），哈希资源 0 条`);

console.log("\n===== 5. 预热计划 =====");
const warm = warmupPlan(RELEASE, 3000);
assert.strictEqual(warm.urls[0], "/index.html", "预热必须先打首页（它触发后续资源发现）");
assert(warm.urls.length <= 12, "预热条数必须受限，避免打爆源站");
assert(warm.budgetMs <= 3000, "预热总预算不得超过 3s");
console.log(`✓ 预热 ${warm.urls.length} 条，预算 ${warm.budgetMs}ms`);

console.log("\n===== 6. 回滚计划 =====");
const rb = rollbackPlan("sha-prev", RELEASE);
assert(rb.restore.includes("/index.html"), "回滚必须恢复 HTML 入口");
assert(rb.restore.includes("/sw.js"), "回滚必须恢复 SW，否则旧 SW 会继续缓存新版本资源");
assert(rb.keep.every((f) => f.startsWith("/assets/")), "哈希资源应保留，回滚不需要重传");
assert(!rb.purge.some((p) => p.startsWith("/assets/")), "回滚也不应 purge 哈希资源");
console.log(`✓ 回滚恢复 ${rb.restore.length} 条 / 刷新 ${rb.purge.length} 条 / 保留 ${rb.keep.length} 条`);

console.log("\n✅ CDN 计划：缓存分层 + 发布顺序 + 刷新 + 预热 + 回滚全部通过");

// 文件: examples/55-02-vite-base-resolver.ts
// ============ base 路径解析:子路径部署时资源为什么 404 ============
// 设计要点:
// 1) base 决定「构建产物里资源 URL 的前缀」,与路由 base 是两件事;
// 2) 绝对路径 `/assets/a.js` 要拼上 base;相对路径与完整 URL/data URI 不能动;
// 3) base 的规范化:补前后斜杠、去重复斜杠,避免出现 `//app//assets`。

function normalizeBase(input: string): string {
  if (!input) return "/";
  if (input === "./" || input === ".") return "./";
  let base = input.trim();
  if (/^https?:\/\//.test(base)) return base.replace(/\/+$/, "") + "/";
  if (!base.startsWith("/")) base = "/" + base;
  return base.replace(/\/+/g, "/").replace(/\/$/, "") + "/";
}

function isExternal(url: string): boolean {
  return /^(https?:)?\/\//.test(url) || /^(data|blob|mailto|tel):/.test(url) || url.startsWith("#");
}

function resolveAsset(url: string, base: string): string {
  if (!url || isExternal(url)) return url;
  const normalized = normalizeBase(base);
  if (url.startsWith("./") || url.startsWith("../")) return url;
  if (normalized === "./") return url.replace(/^\/+/, "./");
  return normalized + url.replace(/^\/+/, "");
}

function resolveHtmlReference(ref: string, base: string): string {
  return resolveAsset(ref, base);
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

// ---------------- 场景 1:子路径部署 ----------------
console.log("base 规范化:", ["/app", "app", "/app/", "//app//"].map(normalizeBase));
assert(normalizeBase("/app") === "/app/", "缺少尾斜杠应补齐");
assert(normalizeBase("app") === "/app/", "缺少前斜杠应补齐");
assert(normalizeBase("//app//") === "/app/", "重复斜杠应收敛");

const base = "/frontend-advanced-guide-site/";
const cases: Array<[string, string]> = [
  ["/assets/index-a1b2c3d4.js", `${base}assets/index-a1b2c3d4.js`],
  ["assets/logo.svg", `${base}assets/logo.svg`],
  ["https://cdn.example.com/x.js", "https://cdn.example.com/x.js"],
  ["data:image/png;base64,AAAA", "data:image/png;base64,AAAA"],
  ["#anchor", "#anchor"],
  ["./relative.png", "./relative.png"],
];

console.log("\n=== 资源解析 ===");
for (const [input, expected] of cases) {
  const actual = resolveAsset(input, base);
  console.log(`${input.padEnd(34)} → ${actual}`);
  assert(actual === expected, `${input} 应解析为 ${expected}`);
}

// ---------------- 场景 2:根路径部署 ----------------
assert(resolveAsset("/assets/a.js", "/") === "/assets/a.js", "根路径不应重复加斜杠");
assert(resolveAsset("/assets/a.js", "") === "/assets/a.js", "空 base 等价于 /");

// ---------------- 场景 3:相对 base(离线/文件协议) ----------------
assert(resolveAsset("/assets/a.js", "./") === "./assets/a.js", "相对 base 应去掉前导斜杠");

// ---------------- 场景 4:HTML 引用与路由回退的一致性 ----------------
const htmlRefs = ["/assets/app.js", "/assets/app.css", "/favicon.ico"].map((r) =>
  resolveHtmlReference(r, "frontend-advanced-guide-site"),
);
console.log("\nHTML 引用:", htmlRefs);
assert(htmlRefs.every((r) => r.startsWith(base)), "所有本地引用都应带同一 base");

// ---------------- 场景 5:路由 base 与资源 base 必须同源同前缀 ----------------
const routeBase = "/frontend-advanced-guide-site";
const assetBase = normalizeBase(base);
console.log("路由 base:", routeBase, "| 资源 base:", assetBase);
assert(
  assetBase.startsWith(normalizeBase(routeBase)),
  "资源 base 必须以路由 base 为前缀,否则刷新子路由会 404",
);

console.log("\nbase 解析通过:子路径、根路径、相对 base、外部 URL、HTML 引用全部对齐。");

// 标记为模块,避免与其它示例的顶层变量重名
export {};

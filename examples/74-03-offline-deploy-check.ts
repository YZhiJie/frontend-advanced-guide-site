// 文件: examples/74-03-offline-deploy-check.ts
// ============ 内网离线部署检查器:资源本地化审计 + 离线包完整性校验 ============
// 设计要点:
// 1. 政企内网无公网,任何外链资源(CDN/字体/地图瓦片/外联接口)上线即「静默坏」
// 2. 审计规则按严重度分级:致命(脚本/样式)→ 高(字体/瓦片/外联接口)→ 中(图片/图标)
// 3. 离线包用 manifest(路径 + 摘要)做完整性校验,揪出缺失/篡改/混入三类问题
//    (本示例用 sha256 演示流程;信创验收若要求国密,可换成 74-01 的 SM3 做指纹)

import { createHash } from "node:crypto";

/** 断言工具:校验不通过直接抛错,让示例在门禁里「红得响亮」 */
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

// ---------- 1. 资源本地化审计 ----------

interface Finding {
  file: string;
  severity: "致命" | "高" | "中";
  kind: string;
  url: string;
}

/** 外链检测规则:按「引用方式 + URL 特征」定级 */
const AUDIT_RULES: { re: RegExp; severity: Finding["severity"]; kind: string }[] = [
  { re: /<script[^>]+src=["'](https?:\/\/[^"']+)["']/g, severity: "致命", kind: "外链脚本" },
  { re: /<link[^>]+href=["'](https?:\/\/[^"']+\.css[^"']*)["']/g, severity: "致命", kind: "外链样式" },
  { re: /url\(["']?(https?:\/\/[^)"']+\.(?:woff2?|ttf|otf)[^)"']*)["']?\)/g, severity: "高", kind: "外链字体" },
  { re: /(https?:\/\/[^\s"']*(?:tile|is\.autonavi\.com|tianditu\.gov\.cn)[^\s"']*)/g, severity: "高", kind: "外链地图瓦片" },
  { re: /fetch\(["'](https?:\/\/[^"']+)["']/g, severity: "高", kind: "外联接口" },
  { re: /(https?:\/\/[^\s"']+\.(?:png|jpe?g|gif|svg|ico))/g, severity: "中", kind: "外链图片/图标" },
];

function auditLocalization(files: Map<string, string>): Finding[] {
  const findings: Finding[] = [];
  for (const [file, content] of files) {
    for (const rule of AUDIT_RULES) {
      for (const m of content.matchAll(rule.re)) {
        findings.push({ file, severity: rule.severity, kind: rule.kind, url: m[1] });
      }
    }
  }
  const order = { 致命: 0, 高: 1, 中: 2 } as const;
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}

// ---------- 2. 离线包完整性校验 ----------

interface ManifestEntry {
  path: string;
  sha256: string;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** 由真实文件树生成 manifest(打包机侧) */
function buildManifest(disk: Map<string, string>): ManifestEntry[] {
  return [...disk.keys()].sort().map((path) => ({ path, sha256: sha256(disk.get(path)!) }));
}

/** 用 manifest 校验交付现场的离线包(部署机侧) */
function verifyPackage(manifest: ManifestEntry[], disk: Map<string, string>) {
  const missing: string[] = [];
  const corrupted: string[] = [];
  for (const entry of manifest) {
    const content = disk.get(entry.path);
    if (content === undefined) missing.push(entry.path);
    else if (sha256(content) !== entry.sha256) corrupted.push(entry.path);
  }
  const declared = new Set(manifest.map((e) => e.path));
  const extra = [...disk.keys()].filter((p) => !declared.has(p));
  return { ok: missing.length === 0 && corrupted.length === 0 && extra.length === 0, missing, corrupted, extra };
}

/** ============ 演示:审计 + 校验 ============ */
export function runOfflineDeployDemo() {
  // ---- 模拟一份「刚从 CI 下来」的 dist ----
  const dist = new Map<string, string>([
    [
      "index.html",
      `<html><head>
        <link href="https://cdn.example-cdn.com/element-plus/index.css" rel="stylesheet">
        <script src="https://cdn.example-cdn.com/vue@3/vue.global.prod.js"></script>
        <link href="./assets/index-abc.css" rel="stylesheet">
      </head><body><div id="app"></div><script src="./assets/index-abc.js"></script></body></html>`,
    ],
    [
      "assets/index-abc.css",
      `@font-face{font-family:"Noto";src:url("https://fonts.example-fonts.com/noto-sans-sc.woff2")}`,
    ],
    [
      "assets/index-abc.js",
      `const tiles="https://webrd01.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}";
       fetch("https://api.example-weather.com/v1/now").then(r=>r.json());
       const logo="https://cdn.example-cdn.com/logo.png";`,
    ],
    ["assets/logo-local.svg", `<svg xmlns="http://www.w3.org/2000/svg"></svg>`],
  ]);

  console.log("===== 资源本地化审计 =====");
  const findings = auditLocalization(dist);
  for (const f of findings) console.log(`[${f.severity}] ${f.kind} @ ${f.file}\n      ${f.url}`);
  const countBy = (s: Finding["severity"]) => findings.filter((f) => f.severity === s).length;
  console.log(`合计: 致命 ${countBy("致命")} / 高 ${countBy("高")} / 中 ${countBy("中")}`);
  assert(countBy("致命") === 2, "应检出 2 个致命项(外链脚本+外链样式)");
  assert(countBy("高") === 3, "应检出 3 个高危项(字体+瓦片+外联接口)");
  assert(countBy("中") === 1, "应检出 1 个中危项(外链图片)");
  assert(!findings.some((f) => f.url.startsWith("./")), "相对路径资源不应误报");

  // ---- 离线包完整性校验 ----
  console.log("\n===== 离线包完整性校验 =====");
  const manifest = buildManifest(dist);

  // 场景一:完好包 → 通过
  const intact = verifyPackage(manifest, new Map(dist));
  assert(intact.ok, "完好离线包应通过校验");
  console.log(`完好包: 通过(共 ${manifest.length} 个文件)`);

  // 场景二:现场拷贝丢了一个 js + css 被旧版本覆盖 + 混入一个来历不明的文件
  const site = new Map(dist);
  site.delete("assets/index-abc.js"); // 拷贝不完整
  site.set("assets/index-abc.css", "/* 上一版本的旧样式残留 */"); // 内容对不上
  site.set("assets/patch-hotfix.js", "// 现场工程师手工塞的补丁"); // manifest 之外
  const broken = verifyPackage(manifest, site);
  assert(!broken.ok, "受损离线包不应通过");
  assert(broken.missing.includes("assets/index-abc.js"), "应检出缺失文件");
  assert(broken.corrupted.includes("assets/index-abc.css"), "应检出被篡改文件");
  assert(broken.extra.includes("assets/patch-hotfix.js"), "应检出混入文件");
  console.log(
    `受损包: 拦截成功 → 缺失[${broken.missing.join(",")}] 篡改[${broken.corrupted.join(",")}] 混入[${broken.extra.join(",")}]`,
  );

  console.log("\n✅ 离线部署检查器全部断言通过");
}

runOfflineDeployDemo();

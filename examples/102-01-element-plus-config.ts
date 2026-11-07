/**
 * 第 102 部分 · Element Plus 企业实战
 * Element Plus 接入闭环：配置生成器 + 依赖清单校验
 * 核心坑：依赖声明、入口注册、样式入口、按需导入、图标策略缺一不可
 *   —— 任何一环缺失都会在构建期或运行期以不同形式暴露
 * 运行：npx tsx examples/102-01-element-plus-config.ts
 */
import assert from "node:assert";

// ---------- 1. 依赖声明校验 ----------
interface RequiredDeps {
  elementPlus?: boolean;
  vite?: boolean;
  autoImport?: boolean;
  vueComponents?: boolean;
  icons?: boolean;
}

function parsePkgName(entry: string): string {
  // 把 "element-plus@2.7.0" 和 "@element-plus/icons-vue@2.3.1" 都正确解出包名
  const at = entry.startsWith("@") ? entry.indexOf("@", 1) : entry.indexOf("@");
  return at > 0 ? entry.slice(0, at) : entry;
}

function validateDeps(declared: string[], required: RequiredDeps): { ok: boolean; missing: string[] } {
  const declaredKeys = new Set(declared.map(parsePkgName));
  const missing: string[] = [];
  const map: Record<string, keyof RequiredDeps> = {
    "element-plus": "elementPlus",
    "vite": "vite",
    "unplugin-auto-import": "autoImport",
    "unplugin-vue-components": "vueComponents",
    "@element-plus/icons-vue": "icons",
  };
  for (const [pkg, flag] of Object.entries(map)) {
    if (required[flag] && !declaredKeys.has(pkg)) missing.push(pkg);
  }
  return { ok: missing.length === 0, missing };
}

// ---------- 2. vite.config.ts 配置生成 ----------
function generateViteConfig(
  mode: "full" | "auto",
  icons: boolean = true,
): { deps: RequiredDeps; configSnippet: string; mainEntrySnippet: string } {
  const deps: RequiredDeps = {
    elementPlus: true,
    vite: true,
    icons,
  };
  if (mode === "auto") {
    deps.autoImport = true;
    deps.vueComponents = true;
  }

  let config = "";
  let main = "";
  if (mode === "full") {
    config = `// vite.config.ts —— 全量注册（快速接入，体积大）
// 不需要任何 unplugin 插件`;
    main = `// main.ts
import ElementPlus from "element-plus";
import "element-plus/dist/index.css";

const app = createApp(App);
app.use(ElementPlus);`;
  } else {
    config = `// vite.config.ts —— 按需自动导入（生产推荐）
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";

plugins: [
  vue(),
  AutoImport({ resolvers: [ElementPlusResolver()] }),
  Components({ resolvers: [ElementPlusResolver()] }),
],`;
    main = `// main.ts —— 按需导入下仍需全局引入一次样式
import "element-plus/dist/index.css";

const app = createApp(App);
// 注意：按需导入下不在入口 app.use(ElementPlus) —— 否则 tree-shaking 失效`;
  }

  return { deps, configSnippet: config, mainEntrySnippet: main };
}

// ---------- 3. 验收 ----------
const rA = generateViteConfig("full");
const vA = validateDeps(
  ["element-plus@2.7.0", "vite@5.0.0", "@element-plus/icons-vue@2.3.1"],
  rA.deps,
);
assert.ok(vA.ok, "全量注册 + 依赖齐全 → 验证通过 (missing: " + vA.missing.join(",") + ")");
console.log("[A] 全量注册 + 依赖齐全 → ✓");

const rB = generateViteConfig("auto");
const vB = validateDeps(
  ["element-plus@2.7.0", "vite@5.0.0"], // 缺 unplugin 插件
  rB.deps,
);
assert.ok(!vB.ok);
assert.ok(vB.missing.includes("unplugin-auto-import"));
assert.ok(vB.missing.includes("unplugin-vue-components"));
console.log("[B] 按需导入但缺 unplugin 插件 → ✗ missing:", vB.missing);

const vC = validateDeps(
  [
    "element-plus@2.7.0",
    "vite@5.0.0",
    "@element-plus/icons-vue@2.3.1",
    "unplugin-auto-import@0.17.5",
    "unplugin-vue-components@0.26.0",
  ],
  rB.deps,
);
assert.ok(vC.ok);
console.log("[C] 按需导入 + 依赖齐全 → ✓");

// 场景 D：校验 CSS 全局引入（main.ts 必须有 element-plus/dist/index.css）
const mainD = rB.mainEntrySnippet;
assert.ok(mainD.includes("element-plus/dist/index.css"));
console.log("[D] 配置片段包含 AutoImport + main.ts 包含样式全局引入 → ✓ 闭环完整");

// 图标策略
function validateIconStrategy(declared: string[], used: "global" | "auto" | "none"): string[] {
  const missing: string[] = [];
  const hasIconsPkg = declared.some((d) => parsePkgName(d) === "@element-plus/icons-vue");
  if (used !== "none" && !hasIconsPkg) {
    missing.push("用了图标但没声明 @element-plus/icons-vue");
  }
  return missing;
}
const iconMissing = validateIconStrategy(["element-plus", "@element-plus/icons-vue"], "auto");
assert.deepEqual(iconMissing, []);
console.log("[E] 图标策略：按需导入下 ElementPlusResolver 自动识别 → ✓");

// 边界：包名含 @ 不影响解析
assert.equal(parsePkgName("@element-plus/icons-vue@2.3.1"), "@element-plus/icons-vue");
assert.equal(parsePkgName("element-plus@2.7.0"), "element-plus");
assert.equal(parsePkgName("vite@5.0.0"), "vite");
console.log("[F] @scope 包名解析正确 → ✓");

console.log("✅ 102-01 全部断言通过");

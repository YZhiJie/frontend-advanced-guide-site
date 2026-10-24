// 文件: examples/55-01-split-chunks.ts
// ============ splitChunks 分组模拟:vendor / common / entry 如何切分 ============
// 设计要点:
// 1) 代码分割的目标不是「越小越好」,而是「缓存命中率 + 首屏请求数」的平衡;
// 2) vendor 按依赖稳定性分组:react/vue 这类不常变的包单独成 chunk,升级才失效;
// 3) 被多个入口复用的业务模块抽 common,避免每个入口各打一份;
// 4) 小于 minSize 的模块不值得单独请求,留在入口 chunk 里。

interface Module {
  id: string;
  /** 体积(KB) */
  size: number;
  /** vendor = node_modules,app = 业务代码 */
  kind: "vendor" | "app";
  /** 被哪些入口引用 */
  entries: string[];
}

interface Chunk {
  name: string;
  modules: Module[];
  size: number;
}

interface SplitConfig {
  /** 小于该体积的共享模块不单独拆 */
  minSize: number;
  /** 被至少 N 个入口引用才算 common */
  minChunks: number;
}

function splitChunks(
  modules: Module[],
  entries: string[],
  config: SplitConfig,
): Chunk[] {
  const vendor: Module[] = [];
  const common: Module[] = [];
  const entryChunks = new Map<string, Module[]>(entries.map((e) => [e, []]));

  for (const mod of modules) {
    if (mod.kind === "vendor") {
      vendor.push(mod);
      continue;
    }
    if (mod.entries.length >= config.minChunks && mod.size >= config.minSize) {
      common.push(mod);
      continue;
    }
    for (const entry of mod.entries) {
      entryChunks.get(entry)?.push(mod);
    }
  }

  const chunks: Chunk[] = [];
  for (const [name, mods] of entryChunks) {
    chunks.push({ name, modules: mods, size: sum(mods) });
  }
  if (vendor.length)
    chunks.push({ name: "vendor", modules: vendor, size: sum(vendor) });
  if (common.length)
    chunks.push({ name: "common", modules: common, size: sum(common) });
  return chunks;
}

const sum = (mods: Module[]) => mods.reduce((n, m) => n + m.size, 0);

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

// ---------------- 场景:两个入口共享组件库与工具函数 ----------------
const modules: Module[] = [
  { id: "react", size: 140, kind: "vendor", entries: ["home", "admin"] },
  { id: "react-dom", size: 130, kind: "vendor", entries: ["home", "admin"] },
  { id: "lodash-es", size: 40, kind: "vendor", entries: ["admin"] },
  { id: "ui-button", size: 12, kind: "app", entries: ["home", "admin"] },
  { id: "ui-table", size: 38, kind: "app", entries: ["admin"] },
  { id: "format-date", size: 3, kind: "app", entries: ["home", "admin"] },
  { id: "home-page", size: 80, kind: "app", entries: ["home"] },
  { id: "admin-page", size: 120, kind: "app", entries: ["admin"] },
];

const chunks = splitChunks(modules, ["home", "admin"], {
  minSize: 10,
  minChunks: 2,
});
console.log("=== 切分结果 ===");
for (const c of chunks) {
  console.log(
    `${c.name.padEnd(8)} ${String(c.size).padStart(4)}KB  [${c.modules.map((m) => m.id).join(", ")}]`,
  );
}

const byName = new Map(chunks.map((c) => [c.name, c]));
const vendorChunk = byName.get("vendor");
const commonChunk = byName.get("common");
const home = byName.get("home");
const admin = byName.get("admin");

assert(vendorChunk?.size === 310, "vendor 应包含 react/react-dom/lodash-es");
assert(
  commonChunk?.modules.some((m) => m.id === "ui-button"),
  "共享 UI 组件应进入 common",
);
assert(
  !commonChunk?.modules.some((m) => m.id === "format-date"),
  "小于 minSize 的模块不单独拆",
);
assert(
  home?.modules.every((m) => m.entries.includes("home")),
  "入口 chunk 只能含自己的模块",
);
assert(
  !admin?.modules.some(
    (m) => m.id === "ui-table" && commonChunk?.modules.includes(m),
  ),
  "模块不应重复打包",
);

// ---------------- 体积:小于 minSize 的共享模块会在多个入口重复 ----------------
const totalBefore = sum(modules);
const totalAfter = chunks.reduce((n, c) => n + c.size, 0);
const duplicated = modules.filter(
  (m) => chunks.filter((c) => c.modules.includes(m)).length > 1,
);
console.log(
  `\n切分前 ${totalBefore}KB → 切分后 ${totalAfter}KB,重复模块: ${duplicated.map((m) => m.id).join(", ") || "无"}`,
);
assert(
  totalAfter === totalBefore + sum(duplicated),
  "总量差应恰好等于重复模块体积",
);
assert(
  duplicated.every((m) => m.size < 10),
  "只有小于 minSize 的共享模块才会重复",
);
assert(
  modules.every((m) => chunks.some((c) => c.modules.includes(m))),
  "每个模块至少应出现在一个 chunk 中",
);

// ---------------- 调参:提高 minSize 后共享模块回流入口 ----------------
const coarse = splitChunks(modules, ["home", "admin"], {
  minSize: 20,
  minChunks: 2,
});
const coarseCommon = coarse.find((c) => c.name === "common");
console.log(
  "minSize=20 时 common:",
  coarseCommon?.modules.map((m) => m.id) ?? "无",
);
assert(
  !coarseCommon || !coarseCommon.modules.some((m) => m.id === "ui-button"),
  "提高阈值后小组件留在入口",
);

console.log(
  "\n切分模拟通过:vendor、common、入口三组归属明确,体积守恒,阈值可调。",
);

// 标记为模块,避免与其它示例的顶层变量重名
export {};

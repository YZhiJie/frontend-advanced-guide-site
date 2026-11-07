// 文件: examples/27-05-mini-bundler.ts
// ============ 手写迷你 Bundler（ESM → CJS, 正则 AST + 拓扑排序 + 循环安全）==========

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

/* ============================================================
 * 1. 解析模块
 * ============================================================ */

interface ParsedModule {
  file: string;
  code: string;
  imports: { spec: string; source: string }[];
  hasDefaultExport: boolean;
  namedExports: string[];
}

function parseModule(code: string, file: string): ParsedModule {
  const imports: { spec: string; source: string }[] = [];
  const re = /import\s+(.+?)\s+from\s+['"]([^'"]+)['"];?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) imports.push({ spec: m[1].trim(), source: m[2] });

  const hasDefaultExport = /export\s+default\b/.test(code);
  const namedExports: string[] = [];
  const singleRe = /export\s+(?:function|class|const|let|var)\s+(\w+)/g;
  while ((m = singleRe.exec(code))) namedExports.push(m[1]);
  const namedBlockRe = /export\s+\{([^}]+)\}/g;
  while ((m = namedBlockRe.exec(code))) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(" as ").pop()?.trim();
      if (name) namedExports.push(name);
    }
  }
  return { file, code, imports, hasDefaultExport, namedExports };
}

/* ============================================================
 * 2. 依赖图 + 拓扑排序
 *    Kahn 算法: 入度为 0 的先执行（被依赖的先跑）
 * ============================================================ */

function resolveImport(source: string, fromFile: string): string | null {
  if (!source.startsWith(".") && !source.startsWith("/")) return null;
  const base = path.dirname(fromFile);
  const candidates = [
    path.resolve(base, source),
    path.resolve(base, source + ".ts"),
    path.resolve(base, source + ".js"),
    path.resolve(base, source + ".mjs"),
    path.join(path.resolve(base, source), "index.ts"),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

function buildGraph(entry: string): ParsedModule[] {
  const resolved = path.resolve(entry);
  const all: ParsedModule[] = [];
  const indexMap = new Map<string, number>();

  // BFS 收集
  const queue: string[] = [resolved];
  const seen = new Set<string>();
  while (queue.length) {
    const f = queue.shift()!;
    if (seen.has(f) || !fs.existsSync(f)) continue;
    seen.add(f);
    indexMap.set(f, all.length);
    all.push(parseModule(fs.readFileSync(f, "utf-8"), f));
    for (const imp of all[all.length - 1].imports) {
      const r = resolveImport(imp.source, f);
      if (r && !seen.has(r)) queue.push(r);
    }
  }

  // Kahn 拓扑排序（依赖先于被依赖执行）
  const n = all.length;
  const inDegree = new Array(n).fill(0);
  const dependents: number[][] = all.map(() => []);
  for (let i = 0; i < n; i++) {
    for (const imp of all[i].imports) {
      const r = resolveImport(imp.source, all[i].file);
      if (r && indexMap.has(r)) {
        const depIdx = indexMap.get(r)!;
        dependents[depIdx].push(i);
        inDegree[i]++;
      }
    }
  }
  const q: number[] = [];
  for (let i = 0; i < n; i++) if (inDegree[i] === 0) q.push(i);
  const order: number[] = [];
  while (q.length) {
    const cur = q.shift()!;
    order.push(cur);
    for (const dep of dependents[cur]) {
      if (--inDegree[dep] === 0) q.push(dep);
    }
  }
  // 处理有环的兜底
  for (let i = 0; i < n; i++) if (!order.includes(i)) order.push(i);

  return order.map((i) => all[i]);
}

/* ============================================================
 * 3. 生成 bundle
 * ============================================================ */

function bundle(mods: ParsedModule[]): string {
  const lines: string[] = [];
  lines.push("// === mini-bundler output (CJS) ===");
  lines.push("");

  // 先预注册占位（解决循环引用）
  for (let i = 0; i < mods.length; i++) {
    lines.push(`const _M${i} = { exports: {} };`);
  }
  lines.push("");

  // require helper
  lines.push(`function __key_of(p) {`);
  lines.push(
    `  return [p, p + '.js', p + '.ts', p.replace(/\\.(ts|js|mjs)$/, ''), './' + (p.split('/').pop()||'').replace(/\\.(ts|js|mjs)$/, ''), './' + (p.split('/').pop()||'').replace(/\\.(ts|js|mjs)$/, '') + '.js'];`,
  );
  lines.push(`}`);
  lines.push(
    `function __R_find(p) { for (const k of __key_of(p)) { if (__R[k]) return __R[k]; } return null; }`,
  );
  lines.push("");

  // registry
  lines.push(`const __R = {};`);
  for (let i = 0; i < mods.length; i++) {
    const m = mods[i];
    const bn = path.basename(m.file).replace(/\.(ts|js|mjs)$/, "");
    for (const key of [`./${bn}`, `./${bn}.js`, bn]) {
      lines.push(`__R[${JSON.stringify(key)}] = _M${i}.exports;`);
    }
  }
  lines.push("");

  // 模块代码
  for (let i = 0; i < mods.length; i++) {
    const m = mods[i];
    lines.push(`// --- ${path.basename(m.file)} ---`);
    lines.push(`(function(module) {`);
    lines.push(`  let exports = module.exports;`);
    lines.push(`  let __default__ = undefined;`);
    lines.push(`  function require(p) {`);
    lines.push(`    const f = __R_find(p);`);
    lines.push(`    if (f) return f;`);
    lines.push(`    throw new Error('Module not found: ' + p);`);
    lines.push(`  }`);

    let code = m.code;

    // import
    code = code.replace(
      /import\s+(.+?)\s+from\s+['"]([^'"]+)['"];?/g,
      (_mm, spec: string, src: string) => {
        const s = spec.trim();
        const ss = JSON.stringify(src);
        const mixed = s.match(/^(\w+)\s*,\s*\{([^}]+)\}$/);
        if (mixed) {
          const t = `__t${Math.random().toString(36).slice(2, 6)}`;
          return `const ${t} = require(${ss});\nconst ${mixed[1]} = ${t}.default !== undefined ? ${t}.default : ${t};\nconst { ${mixed[2].trim()} } = ${t};`;
        }
        const ns = s.match(/^\*\s+as\s+(\w+)$/);
        if (ns) return `const ${ns[1]} = require(${ss});`;
        if (s.startsWith("{")) return `const ${s} = require(${ss});`;
        return `const ${s} = (() => { const m = require(${ss}); return m.default !== undefined ? m.default : m; })();`;
      },
    );

    // export default
    code = code.replace(/export\s+default\s+/g, "__default__ = ");

    // export { a, b };
    code = code.replace(/export\s+\{([^}]+)\}\s*;?/g, (_mm, names: string) => {
      return names
        .split(",")
        .map((n: string) => {
          const parts = n.trim().split(" as ");
          const local = parts[0].trim();
          const exported = (parts[1] ?? parts[0]).trim();
          if (local === "default")
            return `module.exports.default = __default__;`;
          return `module.exports.${exported} = ${local};`;
        })
        .join("\n");
    });

    // export function/class/const: 只去掉 export
    const assigns: string[] = [];
    code = code.replace(
      /export\s+(const|let|var|function|class)\s+(\w+)/g,
      (_mm, kw: string, name: string) => {
        assigns.push(`  module.exports.${name} = ${name};`);
        return `${kw} ${name}`;
      },
    );

    // 缩进 + 导出行
    const body = code
      .split("\n")
      .map((l) => (l ? "  " + l : ""))
      .join("\n");
    lines.push(body);
    if (assigns.length) lines.push(`  // named exports`);
    for (const a of assigns) lines.push(a);
    if (m.hasDefaultExport) {
      lines.push(`  if (typeof __default__ !== 'undefined') {`);
      lines.push(`    module.exports.default = __default__;`);
      lines.push(`  }`);
    }
    lines.push(`})(_M${i});`);
    lines.push("");
  }

  // 入口
  const entryVar = `_M${mods.length - 1}`; // 拓扑排序后, entry 会是最后一个（它依赖 util, util 入度 0 先排）
  lines.push(`// 入口执行`);
  lines.push(`module.exports = ${entryVar};`);

  return lines.join("\n");
}

/* ============================================================
 * 4. 测试
 * ============================================================ */

(async () => {
  console.log("=== 测试: mini-bundler ===");

  const tmp = "/tmp/mini-bundler-test";
  fs.mkdirSync(tmp, { recursive: true });
  const utilPath = path.join(tmp, "util.ts");
  const appPath = path.join(tmp, "app.ts");

  fs.writeFileSync(
    utilPath,
    `export function add(a, b) { return a + b; }
export function greet(name) { return "Hello, " + name + "!"; }
export const MAGIC = 42;
export default { add, greet };
`,
  );

  fs.writeFileSync(
    appPath,
    `import util, { greet, add } from "./util";
console.log("App start");
console.log(greet("bundler"));
console.log("1 + 2 =", add(1, 2));
export { util };
`,
  );

  const mods = buildGraph(appPath);
  console.log(
    "  模块顺序 (拓扑排序后):",
    mods.map((m) => path.basename(m.file)),
  );

  const out = bundle(mods);
  const outFile = path.join(tmp, "bundle.cjs");
  fs.writeFileSync(outFile, out);

  const r = spawnSync("node", [outFile], { cwd: tmp, encoding: "utf-8" });
  console.log("\n  stdout:", JSON.stringify(r.stdout.trim()));
  if (r.stderr) console.log("  stderr:", r.stderr.trim());
  console.log("  exit:", r.status);

  const passed =
    r.status === 0 && r.stdout.includes("Hello") && r.stdout.includes("3");
  if (!passed) {
    console.log("\n--- bundle ---");
    console.log(out);
  } else {
    console.log("\n✓ mini-bundler 验证完毕");
  }
  fs.rmSync(tmp, { recursive: true, force: true });
})();

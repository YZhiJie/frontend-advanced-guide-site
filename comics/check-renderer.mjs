/**
 * 门禁 2：漫画阅读器迷你渲染器回归。
 * comics/index.html 的 renderMarkdown 是一个受控迷你渲染器（无 DOM 依赖的纯函数段），
 * 本脚本把它整段抽出在 Node 里 eval，对全部 36 话讲解 MD 实跑渲染，
 * 检测「渲染残留」：表格行落入段落、未配对的反引号/加粗/链接、h4 被段落吞、图片语法原样露出。
 *
 * 用法：node comics/check-renderer.mjs
 *
 * 内容约定（违反即本门禁报红）：
 * - 讲解 MD 不裸写三连反引号（奇数个反引号无法配对会原文露出）；
 * - 表格单元格的行内代码里不放裸 `|`（会被 splitRow 当分隔符切碎）；
 * - 不使用 h4+、嵌套列表、原生 HTML、图片语法。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// import.meta.dirname 需 Node 20.11+，CI 矩阵含 Node 18，用 fileURLToPath 兼容写法
const dir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(dir, "index.html"), "utf8");

// 渲染器纯函数段：从 escapeHtml 起、到「进度记忆」注释止，整段无 DOM 依赖
const start = html.indexOf("function escapeHtml");
const end = html.indexOf("/* ---------- 进度记忆");
if (start < 0 || end < 0 || end <= start) {
  console.error(
    "✗ 未能从 index.html 定位渲染器源码段（escapeHtml ~ 进度记忆），请检查锚点注释是否被改动",
  );
  process.exit(1);
}
const renderMarkdown = new Function(
  `${html.slice(start, end)}; return renderMarkdown;`,
)();

// 输出中剔掉 code/pre 内部后再查残留（行内代码里允许出现 `、** 等字面量）
const stripCode = (h) =>
  h.replace(/<pre>[\s\S]*?<\/pre>/g, "").replace(/<code>[\s\S]*?<\/code>/g, "");

const files = readdirSync(dir)
  .filter((x) => /^EP\.\d+.*\.md$/.test(x))
  .sort();
let bad = 0;
for (const f of files) {
  const out = renderMarkdown(readFileSync(join(dir, f), "utf8"));
  const plain = stripCode(out);
  const issues = [];
  if (/<p>[^<]*\|/.test(plain)) issues.push("表格行落入段落（未识别为 table）");
  if (plain.includes("**")) issues.push("加粗 ** 未渲染");
  if (plain.includes("`"))
    issues.push("行内代码 ` 未渲染（奇数反引号或跨块配对）");
  if (plain.includes("](")) issues.push("链接 ]( 未渲染");
  if (/^#{4,}\s/m.test(plain) || plain.includes("####"))
    issues.push("h4+ 标题或标题被段落吞");
  if (/<p>[^<]*!\[/.test(plain)) issues.push("图片语法未渲染");
  if (issues.length) {
    bad++;
    console.log(`✗ ${f}`);
    issues.forEach((x) => console.log("   ", x));
  } else {
    const tables = (out.match(/<table>/g) || []).length;
    console.log(`✓ ${f}${tables ? `（${tables} 个表格）` : ""}`);
  }
}
console.log(`\n${files.length} 话：${files.length - bad} 绿 / ${bad} 红`);
if (bad > 0) process.exit(1);

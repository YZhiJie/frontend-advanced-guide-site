// 文件: examples/28-04-cascade.ts
// ============ Specificity 计算 + Cascade 层叠 ============
// 把匹配到节点的所有 declaration 按「!important → specificity → 源码顺序」排序，
// 后 set 进 Map 的自然覆盖前者，得到最终样式。

import { parseStylesheet, type Rule, type Declaration, type CssNode } from "./28-01-css-parser.js";
import { matches, type DomNode } from "./28-02-selector.js";

// specificity: [inline, id, class+attr+pseudo, tag+pseudo-element]
export type Specificity = [number, number, number, number];

export function specificity(selector: string): Specificity {
  const parts = selector.split(",").map((s) => s.trim());
  let max: Specificity = [0, 0, 0, 0];
  for (const p of parts) {
    const sp = oneSpecificity(p);
    if (cmp(sp, max) > 0) max = sp;
  }
  return max;
}

function oneSpecificity(sel: string): Specificity {
  const s = sel.replace(/\([^)]*\)/g, ""); // 去掉伪类参数
  let id = count(s, /#[a-zA-Z_][\w-]*/g);
  let cls = count(s, /\.[a-zA-Z_][\w-]*/g) + count(s, /\[[^\]]+\]/g) + count(s, /(^|[^:]):(?!:)[\w-]+/g);
  let tag = count(s, /::[\w-]+/g);
  const first = s.split(/[\s>+~]/)[0]
    .replace(/#[a-zA-Z_][\w-]*/g, "").replace(/\.[a-zA-Z_][\w-]*/g, "")
    .replace(/\[[^\]]+\]/g, "").replace(/:[a-zA-Z][\w-]*/g, "").replace(/::[a-zA-Z][\w-]*/g, "").trim();
  if (first && first !== "*") tag += count(first, /^[a-zA-Z][\w-]*/g);
  return [0, id, cls, tag];
}

function count(s: string, re: RegExp) { return (s.match(re) ?? []).length; }
function cmp(a: Specificity, b: Specificity) { for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; }

// ---------------------------------------------------------------------------
// 收集匹配节点的所有可层叠 declaration
// ---------------------------------------------------------------------------

interface Cascadable {
  declaration: Declaration;
  specificity: Specificity;
  order: number;
  selector: string;
}

function walk(nodes: CssNode[], cb: (rule: Rule) => void) {
  for (const n of nodes) {
    if (n.type === "rule") { cb(n); walk(n.children, cb); }
    else if (n.type === "atrule") walk(n.children, cb);
  }
}

export function collectCascadable(node: DomNode, stylesheet: CssNode[]): Cascadable[] {
  const out: Cascadable[] = [];
  let order = 0;
  walk(stylesheet, (rule) => {
    for (const sel of rule.selectors) {
      try {
        if (matches(node, sel)) {
          for (const d of rule.declarations) {
            out.push({ declaration: d, specificity: specificity(sel), order, selector: sel });
          }
          break;
        }
      } catch { /* selector 解析失败跳过 */ }
    }
    order += rule.declarations.length;
  });
  return out;
}

// ---------------------------------------------------------------------------
// 层叠：排序后 Map.set 覆盖
// ---------------------------------------------------------------------------

export function cascade(decls: Cascadable[]): Map<string, Declaration> {
  const sorted = [...decls].sort((a, b) => {
    if (a.declaration.important !== b.declaration.important) return a.declaration.important ? 1 : -1;
    const s = cmp(a.specificity, b.specificity);
    if (s !== 0) return s;
    return a.order - b.order;
  });
  const map = new Map<string, Declaration>();
  for (const d of sorted) map.set(d.declaration.property, d.declaration);
  return map;
}

export function resolveStyle(node: DomNode, css: string): Map<string, Declaration> {
  const sheet = parseStylesheet(css).children;
  return cascade(collectCascadable(node, sheet));
}

// ---------------------------------------------------------------------------
// 演示
// ---------------------------------------------------------------------------

// 构造一棵 DOM（selector 模块需要 parent/index，这里手动建）
function el(tag: string, extra: Partial<DomNode> = {}): DomNode {
  return { tag, ...extra, children: [], parent: undefined, index: 1 };
}
const span = el("span", { className: "title" });
const div = el("div", { id: "header", className: "nav", children: [span] });
span.parent = div; span.index = 1;

const css = `
div { color: black; font-size: 14px; }
.nav { color: blue; }
#header { color: red; }
div.nav { color: green; font-size: 16px; }
.title { font-weight: bold; }
#header .title { color: purple; font-size: 20px; }
`;

console.log("=== Specificity 对比 ===");
const sp = (s: string) => console.log(`  ${s.padEnd(22)} → [${specificity(s).join(",")}]`);
sp("div");
sp(".nav");
sp("#header");
sp("div.nav");
sp("#header .title");

console.log("\n=== 层叠结果：div#header.nav ===");
const divStyle = resolveStyle(div, css);
console.log(`  color     = ${divStyle.get("color")?.value}（#header [0,1,0,0] 胜出，应为 red）`);
console.log(`  font-size = ${divStyle.get("font-size")?.value}（div.nav [0,0,1,1] > .nav [0,0,1,0]，应为 16px）`);

console.log("\n=== 层叠结果：span.title（在 #header 内） ===");
const spanStyle = resolveStyle(span, css);
console.log(`  color      = ${spanStyle.get("color")?.value}（#header .title [0,1,1,0]，应为 purple）`);
console.log(`  font-weight = ${spanStyle.get("font-weight")?.value}（.title 命中，应为 bold）`);
console.log(`  font-size  = ${spanStyle.get("font-size")?.value}（#header .title [0,1,1,0]，应为 20px）`);

console.log("\n✓ mini-cascade 验证完毕");

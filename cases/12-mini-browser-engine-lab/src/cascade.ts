// 文件: cases/12-mini-browser-engine-lab/src/cascade.ts
// cascade.ts
// specificity 计算 + cascade 层叠
// 输出：给定 selector 匹配到节点后，把所有匹配到的 rule 的 declaration 合并成最终 Map

import type { CssNode, Declaration, Rule } from "./css-parser.js";
import type { DomNode } from "./selector.js";
import { matches } from "./selector.js";

// specificity: [inline, id, class, tag] 四元组
// inline style 记为 [1,0,0,0]，普通 rule 记为 [0,...]
export type Specificity = [number, number, number, number];

// ---------------------------------------------------------------------------
// specificity 计算
// ---------------------------------------------------------------------------

export function specificityForSelector(selector: string): Specificity {
  // 按逗号切分后取最大的那个
  const parts = selector.split(",").map((s) => s.trim());
  let max: Specificity = [0, 0, 0, 0];
  for (const p of parts) {
    const sp = computeCompoundSpecificity(p);
    max = compareSpecificity(sp, max) > 0 ? sp : max;
  }
  return max;
}

function computeCompoundSpecificity(sel: string): Specificity {
  let id = 0,
    cls = 0,
    tag = 0;

  // 先去掉伪类里的参数
  const s = sel.replace(/\([^)]*\)/g, "");

  // 伪类（:hover, :first-child, ...）记为 class 优先级
  cls += countMatches(s, /(^|[^:]):(?!:)[\w-]+/g);

  // ::pseudo-element 记为 tag 优先级
  tag += countMatches(s, /::[\w-]+/g);

  // #id
  id += countMatches(s, /#[a-zA-Z_][\w-]*/g);

  // .class
  cls += countMatches(s, /\.[a-zA-Z_][\w-]*/g);

  // [attr] [attr=v]
  cls += countMatches(s, /\[[^\]]+\]/g);

  // tag：从开头找标识符（非 combinator 部分）
  const firstPart = s.split(/[\s>+~]/)[0];
  // 去掉已统计的 id / class / attr / pseudo
  const stripped = firstPart
    .replace(/#[a-zA-Z_][\w-]*/g, "")
    .replace(/\.[a-zA-Z_][\w-]*/g, "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/:[a-zA-Z][\w-]*/g, "")
    .replace(/::[a-zA-Z][\w-]*/g, "");
  if (stripped.trim() && stripped.trim() !== "*") {
    tag += countMatches(stripped, /^[a-zA-Z][\w-]*/g);
  }

  return [0, id, cls, tag];
}

function countMatches(s: string, re: RegExp): number {
  const m = s.match(re);
  return m ? m.length : 0;
}

export function compareSpecificity(a: Specificity, b: Specificity): number {
  for (let i = 0; i < 4; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

// ---------------------------------------------------------------------------
// 带匹配结果的 Rule 收集
// ---------------------------------------------------------------------------

export interface CascadableDeclaration {
  declaration: Declaration;
  specificity: Specificity;
  order: number; // 全局源码位置（在 stylesheet 里的序号）
  selector: string;
  matchedBy: string; // 匹配到哪个 selector（调试用）
}

// 收集一个节点从 stylesheet 中匹配到的所有可层叠 declaration
export function collectCascadable(
  node: DomNode,
  stylesheet: CssNode[],
  sourceOrderStart = 0,
): CascadableDeclaration[] {
  const out: CascadableDeclaration[] = [];
  let order = sourceOrderStart;
  walkStylesheet(stylesheet, (rule, ctx) => {
    // rule 可能是 nested —— 合并所有祖先的 selector context
    const effectiveSelectors = mergeAncestorSelectors(ctx.ancestors, rule);
    for (const decl of rule.declarations) {
      for (const sel of effectiveSelectors) {
        // 只尝试匹配有效 selector
        try {
          if (matches(node, sel)) {
            out.push({
              declaration: decl,
              specificity: specificityForSelector(sel),
              order,
              selector: sel,
              matchedBy: sel,
            });
            break; // 对一个 rule 的所有 selector，节点只要匹配一个就收集一次该 declaration
          }
        } catch {
          // 匹配器无法解析的 selector 跳过
        }
      }
      order++;
    }
  });
  return out;
}

interface WalkContext {
  ancestors: Rule[];
}

function walkStylesheet(
  nodes: CssNode[],
  cb: (rule: Rule, ctx: WalkContext) => void,
  ctx: WalkContext = { ancestors: [] },
): void {
  for (const node of nodes) {
    if (node.type === "rule") {
      cb(node, ctx);
      // 嵌套 rule 也参与层叠
      walkStylesheet(node.children, cb, {
        ancestors: [...ctx.ancestors, node],
      });
    } else if (node.type === "atrule") {
      // @media / @supports 等：条件成立（简化：一律成立）则继续深入
      walkStylesheet(node.children, cb, ctx);
    }
  }
}

function mergeAncestorSelectors(ancestors: Rule[], rule: Rule): string[] {
  if (ancestors.length === 0) return rule.selectors;
  // 简化：只把直接父 rule 的 selector 作为 descendant combinator 前缀
  let prefixes = ancestors[ancestors.length - 1].selectors;
  for (let i = ancestors.length - 2; i >= 0; i--) {
    prefixes = cartesian(ancestors[i].selectors, prefixes, " ");
  }
  return cartesian(prefixes, rule.selectors, " ");
}

function cartesian(a: string[], b: string[], comb: string): string[] {
  const out: string[] = [];
  for (const x of a) for (const y of b) out.push(x + comb + y);
  return out;
}

// ---------------------------------------------------------------------------
// cascade：按优先级排序后生成最终 Map
// ---------------------------------------------------------------------------

export interface FinalStyleMap {
  properties: Map<string, Declaration>; // 最终 property -> declaration
}

// 层叠：按优先级升序排列（低优先级在前，高优先级在后），后 set() 自动覆盖前一个
// 优先级：!important > specificity > 源码顺序
export function cascade(
  decls: CascadableDeclaration[],
  inlineImportant: Declaration[] = [],
): FinalStyleMap {
  const sorted = [...decls].sort((a, b) => {
    // !important 升序：非 important 在前，important 在后（important 覆盖非 important）
    if (a.declaration.important !== b.declaration.important) {
      return a.declaration.important ? 1 : -1;
    }
    // specificity 升序：低在前，高在后
    const sp = compareSpecificity(a.specificity, b.specificity);
    if (sp !== 0) return sp;
    // 源码顺序升序：先定义在前，后定义在后（同 specificity 后者覆盖前者）
    return a.order - b.order;
  });

  const properties = new Map<string, Declaration>();

  // 按排序顺序放入 Map，后者自动覆盖前者
  for (const d of sorted) {
    properties.set(d.declaration.property, d.declaration);
  }

  // inline !important 优先级最高
  for (const d of inlineImportant) {
    properties.set(d.property, d);
  }

  return { properties };
}

// 便捷入口：给定节点 + stylesheet，产出最终样式 Map
export function resolveStyle(
  node: DomNode,
  stylesheet: CssNode[],
  inlineStyle?: Declaration[],
): FinalStyleMap {
  const collected = collectCascadable(node, stylesheet);
  const inlineImportant = (inlineStyle ?? []).filter((d) => d.important);
  return cascade(collected, inlineImportant);
}

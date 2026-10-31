// 文件: cases/12-mini-browser-engine-lab/src/selector.ts
// selector.ts
// selector 解析 + 从右到左匹配（BOF 原理）
// 支持：后代 / 子 / 相邻 / 兄弟 / 伪类(:hover/:first-child/:last-child/:nth-child) / 属性选择器([attr] [attr=v] [attr~=v] [attr|=v] [attr^=v] [attr$=v] [attr*=v])

import type { Declaration } from "./css-parser.ts";

// ---------------------------------------------------------------------------
// DOM 结构（手写轻量 DOM，避免 jsdom）
// ---------------------------------------------------------------------------

export interface DomNode {
  tag: string;
  id?: string;
  className?: string; // 原始 class="" 字符串
  attrs?: Record<string, string>;
  children?: DomNode[];
  parent?: DomNode; // 运行时匹配时会被填充
  index?: number; // 父节点下的位置（运行时填充，1-based 给 nth-child 用）
}

// ---------------------------------------------------------------------------
// Selector AST
// ---------------------------------------------------------------------------

export type Selector = SelectorList | ComplexSelector | CompoundSelector;

export interface SelectorList {
  type: "list";
  selectors: ComplexSelector[]; // "," 分隔
}

export interface ComplexSelector {
  type: "complex";
  parts: Array<{ combinator: CombinatorType; compound: CompoundSelector }>;
  // parts[0].combinator 表示前缀（通常为 null）
}

export type CombinatorType =
  | null
  | "descendant"
  | "child"
  | "adjacent"
  | "sibling";

export interface CompoundSelector {
  type: "compound";
  tag?: string; // '*' 表示通配
  id?: string;
  classes: string[];
  attributes: AttributeMatcher[];
  pseudos: Pseudo[];
}

export interface AttributeMatcher {
  name: string;
  op?: "=" | "~=" | "|=" | "^=" | "$=" | "*=";
  value?: string;
  caseInsensitive?: boolean;
}

export interface Pseudo {
  name: string; // hover / first-child / last-child / nth-child / ...
  args?: string; // nth-child(2n+1) 里的 "2n+1"
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parseSelector(input: string): Selector {
  // 先按逗号切分
  const parts = splitTopLevelSelector(input);
  const complexes: ComplexSelector[] = parts.map((p) => parseComplex(p.trim()));
  if (complexes.length === 1) {
    return complexes[0];
  }
  return { type: "list", selectors: complexes };
}

function splitTopLevelSelector(s: string): string[] {
  const out: string[] = [];
  let buf = "";
  let depth = 0;
  let inStr: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ((c === '"' || c === "'") && s[i - 1] !== "\\") {
      if (inStr) inStr = null;
      else inStr = c;
    }
    if (!inStr) {
      if (c === "(") depth++;
      else if (c === ")") depth = Math.max(0, depth - 1);
    }
    if (c === "," && depth === 0 && !inStr) {
      const p = buf.trim();
      if (p) out.push(p);
      buf = "";
    } else {
      buf += c;
    }
  }
  const last = buf.trim();
  if (last) out.push(last);
  return out;
}

function parseComplex(s: string): ComplexSelector {
  const parts: ComplexSelector["parts"] = [];
  let remaining = s;
  let prevHadExplicitComb = false;

  while (remaining.length > 0) {
    // 先检查原始字符串开头（trim 之前）是否有 combinator 字符
    const trimmed = remaining.replace(/^\s+/, "");
    const leadingWs = remaining.length - trimmed.length;
    remaining = trimmed;
    if (remaining.length === 0) break;

    let comb: CombinatorType = null;

    if (remaining.startsWith(">")) {
      comb = "child";
      remaining = remaining.slice(1).replace(/^\s+/, "");
      prevHadExplicitComb = true;
    } else if (remaining.startsWith("+")) {
      comb = "adjacent";
      remaining = remaining.slice(1).replace(/^\s+/, "");
      prevHadExplicitComb = true;
    } else if (remaining.startsWith("~")) {
      comb = "sibling";
      remaining = remaining.slice(1).replace(/^\s+/, "");
      prevHadExplicitComb = true;
    } else if (leadingWs > 0 && parts.length > 0) {
      // 前面有空白但没其他 combinator → descendant（只在非第一次时生效）
      comb = "descendant";
      prevHadExplicitComb = false;
    } else {
      prevHadExplicitComb = false;
    }

    const { compound, rest } = parseCompound(remaining);
    parts.push({ combinator: comb, compound });
    remaining = rest;
  }

  return { type: "complex", parts };
}

function parseCompound(s: string): {
  compound: CompoundSelector;
  rest: string;
} {
  const compound: CompoundSelector = {
    type: "compound",
    classes: [],
    attributes: [],
    pseudos: [],
  };

  let i = 0;
  let buf = "";

  const flushIdent = () => {
    if (buf) {
      if (!compound.tag) compound.tag = buf.toLowerCase();
      buf = "";
    }
  };

  while (i < s.length) {
    const c = s[i];

    if (c === " " || c === ">" || c === "+" || c === "~" || c === ",") {
      flushIdent();
      break;
    }

    if (c === "#") {
      flushIdent();
      i++;
      let id = "";
      while (i < s.length && /[\w\-]/.test(s[i])) {
        id += s[i];
        i++;
      }
      compound.id = id;
      continue;
    }

    if (c === ".") {
      flushIdent();
      i++;
      let cls = "";
      while (i < s.length && /[\w\-]/.test(s[i])) {
        cls += s[i];
        i++;
      }
      compound.classes.push(cls);
      continue;
    }

    if (c === "[") {
      flushIdent();
      const { matcher, consumed } = parseAttribute(s.slice(i));
      compound.attributes.push(matcher);
      i += consumed;
      continue;
    }

    if (c === ":") {
      flushIdent();
      const { pseudo, consumed } = parsePseudo(s.slice(i));
      compound.pseudos.push(pseudo);
      i += consumed;
      continue;
    }

    if (c === "*") {
      compound.tag = "*";
      i++;
      continue;
    }

    if (/[\w\-]/.test(c) || c === "\\") {
      if (c === "\\" && i + 1 < s.length) {
        buf += s[i + 1];
        i += 2;
      } else {
        buf += c;
        i++;
      }
    } else {
      // 未知字符，停止
      break;
    }
  }

  flushIdent();
  return { compound, rest: s.slice(i) };
}

function parseAttribute(s: string): {
  matcher: AttributeMatcher;
  consumed: number;
} {
  let i = 0;
  const matcher: AttributeMatcher = {} as AttributeMatcher;
  if (s[i] !== "[") throw new Error("Expected [");
  i++;

  // 读取属性名
  let name = "";
  while (
    i < s.length &&
    s[i] !== "]" &&
    s[i] !== "=" &&
    s[i] !== "~" &&
    s[i] !== "|" &&
    s[i] !== "^" &&
    s[i] !== "$" &&
    s[i] !== "*"
  ) {
    if (s[i] === " " && name) {
      i++;
      break;
    }
    name += s[i];
    i++;
  }
  matcher.name = name.trim().toLowerCase();

  // 跳过空白
  while (i < s.length && s[i] === " ") i++;

  if (s[i] === "]") {
    i++;
    return { matcher, consumed: i };
  }

  // 匹配操作符
  let op = "=";
  if (s[i] === "|" && s[i + 1] === "=") {
    op = "|=";
    i += 2;
  } else if (s[i] === "~" && s[i + 1] === "=") {
    op = "~=";
    i += 2;
  } else if (s[i] === "^" && s[i + 1] === "=") {
    op = "^=";
    i += 2;
  } else if (s[i] === "$" && s[i + 1] === "=") {
    op = "$=";
    i += 2;
  } else if (s[i] === "*" && s[i + 1] === "=") {
    op = "*=";
    i += 2;
  } else if (s[i] === "=") {
    i++;
  }
  matcher.op = op as AttributeMatcher["op"];

  // 跳过空白
  while (i < s.length && s[i] === " ") i++;

  // 读取值
  let value = "";
  let quote: string | null = null;
  if (s[i] === '"' || s[i] === "'") {
    quote = s[i];
    i++;
    while (i < s.length && s[i] !== quote) {
      value += s[i];
      i++;
    }
    i++; // skip closing quote
    if (s[i] === " " && (s[i + 1] === "i" || s[i + 1] === "I")) {
      matcher.caseInsensitive = true;
      i += 2;
    }
  } else {
    while (i < s.length && s[i] !== "]" && s[i] !== " ") {
      value += s[i];
      i++;
    }
    if (s[i] === " " && (s[i + 1] === "i" || s[i + 1] === "I")) {
      matcher.caseInsensitive = true;
      i += 2;
    }
  }
  matcher.value = value;

  while (i < s.length && s[i] === " ") i++;
  if (s[i] === "]") i++;

  return { matcher, consumed: i };
}

function parsePseudo(s: string): { pseudo: Pseudo; consumed: number } {
  let i = 0;
  if (s[i] !== ":") throw new Error("Expected :");
  i++;
  if (s[i] === ":") i++; // ::pseudo-element 简化处理

  let name = "";
  while (i < s.length && /[\w\-]/.test(s[i])) {
    name += s[i];
    i++;
  }

  let args: string | undefined;
  if (s[i] === "(") {
    i++;
    let depth = 1;
    let a = "";
    while (i < s.length && depth > 0) {
      if (s[i] === "(") depth++;
      else if (s[i] === ")") depth--;
      if (depth > 0) a += s[i];
      i++;
    }
    args = a.trim();
  }

  return { pseudo: { name: name.toLowerCase(), args }, consumed: i };
}

// ---------------------------------------------------------------------------
// DOM 工具
// ---------------------------------------------------------------------------

export function buildDomTree(nodes: DomNode[]): void {
  const walk = (node: DomNode, parent: DomNode | undefined, index: number) => {
    node.parent = parent;
    node.index = index;
    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        walk(node.children[i], node, i + 1);
      }
    }
  };
  for (let i = 0; i < nodes.length; i++) {
    walk(nodes[i], undefined, i + 1);
  }
}

export function flatten(nodes: DomNode[]): DomNode[] {
  const out: DomNode[] = [];
  const walk = (ns: DomNode[]) => {
    for (const n of ns) {
      out.push(n);
      if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

function getAttr(node: DomNode, name: string): string | undefined {
  if (name === "class") return node.className;
  if (name === "id") return node.id;
  const key = Object.keys(node.attrs ?? {}).find(
    (k) => k.toLowerCase() === name,
  );
  return key ? node.attrs![key] : undefined;
}

function hasClass(node: DomNode, cls: string): boolean {
  if (!node.className) return false;
  return node.className.split(/\s+/).includes(cls);
}

function evalPseudo(node: DomNode, p: Pseudo): boolean {
  switch (p.name) {
    case "first-child":
      return node.index === 1;
    case "last-child": {
      if (!node.parent) return false;
      return node.parent.children?.[node.parent.children.length - 1] === node;
    }
    case "only-child":
      return (
        node.index === 1 &&
        (!node.parent || (node.parent.children?.length ?? 0) === 1)
      );
    case "nth-child":
      return evalNthChild(node, p.args);
    case "nth-last-child":
      return evalNthLastChild(node, p.args);
    case "hover":
    case "active":
    case "focus":
      return false; // 交互伪类需要运行时状态，匹配时一律 false
    default:
      return false;
  }
}

function evalNthChild(node: DomNode, args?: string): boolean {
  const n = parseAnB(args);
  if (n === null) return false;
  if (n.a === 0) return node.index === n.b;
  return (node.index! - n.b) % n.a === 0 && (node.index! - n.b) / n.a >= 0;
}

function evalNthLastChild(node: DomNode, args?: string): boolean {
  if (!node.parent) return false;
  const total = node.parent.children?.length ?? 0;
  const rev = total - (node.index ?? 1) + 1;
  const n = parseAnB(args);
  if (n === null) return false;
  if (n.a === 0) return rev === n.b;
  return (rev - n.b) % n.a === 0 && (rev - n.b) / n.a >= 0;
}

function parseAnB(s?: string): { a: number; b: number } | null {
  if (!s) return { a: 0, b: 1 };
  s = s.trim();
  if (s === "odd") return { a: 2, b: 1 };
  if (s === "even") return { a: 2, b: 0 };
  if (/^\d+$/.test(s)) return { a: 0, b: parseInt(s, 10) };

  const m = s.match(/^([+-]?)(\d*)n([+-])(\d+)$/i);
  if (m) {
    let a = m[2] === "" ? 1 : parseInt(m[2], 10);
    if (m[1] === "-") a = -a;
    let b = parseInt(m[4], 10);
    if (m[3] === "-") b = -b;
    return { a, b };
  }
  return null;
}

function matchCompound(node: DomNode, c: CompoundSelector): boolean {
  if (c.tag && c.tag !== "*") {
    if (c.tag.toLowerCase() !== node.tag.toLowerCase()) return false;
  }
  if (c.id) {
    if (node.id !== c.id) return false;
  }
  for (const cls of c.classes) {
    if (!hasClass(node, cls)) return false;
  }
  for (const a of c.attributes) {
    const v = getAttr(node, a.name);
    if (v === undefined) return false;
    const lhs = a.caseInsensitive ? v.toLowerCase() : v;
    const rhs = a.caseInsensitive
      ? (a.value ?? "").toLowerCase()
      : (a.value ?? "");
    if (a.op === undefined) continue;
    switch (a.op) {
      case "=":
        if (lhs !== rhs) return false;
        break;
      case "~=":
        if (!v.split(/\s+/).includes(a.value!)) return false;
        break;
      case "|=":
        if (v !== a.value && !v.startsWith(a.value! + "-")) return false;
        break;
      case "^=":
        if (!v.startsWith(a.value!)) return false;
        break;
      case "$=":
        if (!v.endsWith(a.value!)) return false;
        break;
      case "*=":
        if (!v.includes(a.value!)) return false;
        break;
    }
  }
  for (const p of c.pseudos) {
    if (!evalPseudo(node, p)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// BOF 匹配（从右到左）
// ---------------------------------------------------------------------------

export function matches(node: DomNode, selector: string | Selector): boolean {
  const sel = typeof selector === "string" ? parseSelector(selector) : selector;
  if (sel.type === "compound") return matchCompound(node, sel);
  if (sel.type === "list") {
    return sel.selectors.some((s) => matchesComplex(node, s));
  }
  return matchesComplex(node, sel as ComplexSelector);
}

function matchesComplex(node: DomNode, complex: ComplexSelector): boolean {
  // 从右到左匹配：右端 compound 必须匹配 node
  const parts = complex.parts;
  if (parts.length === 0) return false;
  if (!matchCompound(node, parts[parts.length - 1].compound)) return false;

  if (parts.length === 1) return true;

  // 向左回溯，parts[0].combinator 为 null（忽略）
  let curNode: DomNode | undefined = node;
  for (let i = parts.length - 2; i >= 0; i--) {
    const { combinator, compound } = parts[i + 1];
    const prev = parts[i].compound;

    // combinator 决定 prev 的候选范围
    let candidates: DomNode[] = [];
    if (combinator === "descendant") {
      let p = curNode?.parent;
      while (p) {
        candidates.push(p);
        p = p.parent;
      }
    } else if (combinator === "child") {
      if (curNode?.parent) candidates.push(curNode.parent);
    } else if (combinator === "adjacent") {
      const parent = curNode?.parent;
      if (parent) {
        const idx = (curNode.index ?? 1) - 1;
        if (idx > 0 && parent.children)
          candidates.push(parent.children[idx - 1]);
      }
    } else if (combinator === "sibling") {
      const parent = curNode?.parent;
      if (parent && parent.children) {
        const idx = curNode.index ?? 1;
        for (let j = 0; j < idx - 1; j++) {
          candidates.push(parent.children[j]);
        }
      }
    }

    // candidates 中必须存在一个匹配 prev.compound
    let found = false;
    for (const c of candidates) {
      if (matchCompound(c, prev)) {
        curNode = c;
        found = true;
        break;
      }
    }
    if (!found) return false;
  }

  return true;
}

// 收集所有匹配节点（去重）
export function queryAll(
  root: DomNode,
  selector: string | Selector,
): DomNode[] {
  const sel = typeof selector === "string" ? parseSelector(selector) : selector;
  const all = flatten([root]);
  const out: DomNode[] = [];
  const seen = new Set<DomNode>();
  for (const n of all) {
    if (!seen.has(n) && matches(n, sel)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

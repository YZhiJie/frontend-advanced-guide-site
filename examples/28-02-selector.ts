// 文件: examples/28-02-selector.ts
// ============ Selector 解析 + BOF（从右到左）匹配 ============
// AST: SelectorList → ComplexSelector → CompoundSelector
// BOF 原理：从最右侧 compound 开始匹配当前节点，再按 combinator 向左回溯候选。

export interface DomNode {
  tag: string;
  id?: string;
  className?: string;
  attrs?: Record<string, string>;
  children?: DomNode[];
  parent?: DomNode;
  index?: number; // 1-based
}

type Combinator = null | "descendant" | "child" | "adjacent" | "sibling";

interface Compound {
  tag?: string;
  id?: string;
  classes: string[];
  attrs: AttrMatcher[];
  pseudos: Pseudo[];
}
interface AttrMatcher {
  name: string;
  op?: string;
  value?: string;
}
interface Pseudo {
  name: string;
  args?: string;
}
interface Complex {
  parts: { combinator: Combinator; compound: Compound }[];
}

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

function parseSelector(input: string): Complex[] {
  return splitTopLevel(input, ",").map((p) => parseComplex(p.trim()));
}

function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let buf = "";
  let depth = 0;
  let inStr: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ((c === '"' || c === "'") && s[i - 1] !== "\\") inStr = inStr ? null : c;
    if (!inStr) {
      if (c === "(") depth++;
      else if (c === ")") depth = Math.max(0, depth - 1);
    }
    if (c === sep && depth === 0 && !inStr) {
      const p = buf.trim();
      if (p) out.push(p);
      buf = "";
    } else buf += c;
  }
  const last = buf.trim();
  if (last) out.push(last);
  return out;
}

function parseComplex(s: string): Complex {
  const parts: Complex["parts"] = [];
  let rest = s;
  while (rest.length > 0) {
    const trimmed = rest.replace(/^\s+/, "");
    const leadingWs = rest.length - trimmed.length;
    rest = trimmed;
    if (!rest) break;
    let comb: Combinator = null;
    if (rest.startsWith(">")) {
      comb = "child";
      rest = rest.slice(1).replace(/^\s+/, "");
    } else if (rest.startsWith("+")) {
      comb = "adjacent";
      rest = rest.slice(1).replace(/^\s+/, "");
    } else if (rest.startsWith("~")) {
      comb = "sibling";
      rest = rest.slice(1).replace(/^\s+/, "");
    } else if (leadingWs > 0 && parts.length > 0) comb = "descendant";
    const { compound, rest: r2 } = parseCompound(rest);
    parts.push({ combinator: comb, compound });
    rest = r2;
  }
  return { parts };
}

function parseCompound(s: string): { compound: Compound; rest: string } {
  const c: Compound = { classes: [], attrs: [], pseudos: [] };
  let i = 0,
    buf = "";
  const flush = () => {
    if (buf) {
      if (!c.tag) c.tag = buf.toLowerCase();
      buf = "";
    }
  };
  while (i < s.length) {
    const ch = s[i];
    if (" >+~,".includes(ch)) {
      flush();
      break;
    }
    if (ch === "#") {
      flush();
      i++;
      let v = "";
      while (i < s.length && /[\w-]/.test(s[i])) v += s[i++];
      c.id = v;
      continue;
    }
    if (ch === ".") {
      flush();
      i++;
      let v = "";
      while (i < s.length && /[\w-]/.test(s[i])) v += s[i++];
      c.classes.push(v);
      continue;
    }
    if (ch === "[") {
      flush();
      const { matcher, consumed } = parseAttr(s.slice(i));
      c.attrs.push(matcher);
      i += consumed;
      continue;
    }
    if (ch === ":") {
      flush();
      const { pseudo, consumed } = parsePseudo(s.slice(i));
      c.pseudos.push(pseudo);
      i += consumed;
      continue;
    }
    if (ch === "*") {
      c.tag = "*";
      i++;
      continue;
    }
    if (/[\w-]/.test(ch)) {
      buf += ch;
      i++;
    } else break;
  }
  flush();
  return { compound: c, rest: s.slice(i) };
}

function parseAttr(s: string): { matcher: AttrMatcher; consumed: number } {
  let i = 1;
  const m: AttrMatcher = { name: "" };
  while (
    i < s.length &&
    s[i] !== "]" &&
    s[i] !== "=" &&
    !"~|^$*".includes(s[i])
  ) {
    if (s[i] === " ") break;
    m.name += s[i++];
  }
  m.name = m.name.trim().toLowerCase();
  while (i < s.length && s[i] === " ") i++;
  if (s[i] === "]") return { matcher: m, consumed: i + 1 };
  let op = "=";
  if ("|~^$*".includes(s[i]) && s[i + 1] === "=") {
    op = s[i] + "=";
    i += 2;
  } else if (s[i] === "=") {
    i++;
  }
  m.op = op;
  while (i < s.length && s[i] === " ") i++;
  let v = "";
  if (s[i] === '"' || s[i] === "'") {
    const q = s[i++];
    while (i < s.length && s[i] !== q) v += s[i++];
    i++;
  } else {
    while (i < s.length && s[i] !== "]" && s[i] !== " ") v += s[i++];
  }
  m.value = v;
  while (i < s.length && s[i] !== "]") i++;
  return { matcher: m, consumed: i + 1 };
}

function parsePseudo(s: string): { pseudo: Pseudo; consumed: number } {
  let i = 1;
  if (s[i] === ":") i++;
  let name = "";
  while (i < s.length && /[\w-]/.test(s[i])) name += s[i++];
  let args: string | undefined;
  if (s[i] === "(") {
    i++;
    let d = 1,
      a = "";
    while (i < s.length && d > 0) {
      if (s[i] === "(") d++;
      else if (s[i] === ")") d--;
      if (d > 0) a += s[i];
      i++;
    }
    args = a.trim();
  }
  return { pseudo: { name: name.toLowerCase(), args }, consumed: i };
}

// ---------------------------------------------------------------------------
// DOM 工具 + compound 匹配
// ---------------------------------------------------------------------------

function buildTree(nodes: DomNode[]): void {
  const walk = (n: DomNode, p?: DomNode, i = 1) => {
    n.parent = p;
    n.index = i;
    n.children?.forEach((c, j) => walk(c, n, j + 1));
  };
  nodes.forEach((n, i) => walk(n, undefined, i + 1));
}

function getAttr(n: DomNode, name: string): string | undefined {
  if (name === "class") return n.className;
  if (name === "id") return n.id;
  const k = Object.keys(n.attrs ?? {}).find((x) => x.toLowerCase() === name);
  return k ? n.attrs![k] : undefined;
}

function matchCompound(n: DomNode, c: Compound): boolean {
  if (c.tag && c.tag !== "*" && c.tag !== n.tag.toLowerCase()) return false;
  if (c.id && n.id !== c.id) return false;
  for (const cls of c.classes)
    if (!(n.className ?? "").split(/\s+/).includes(cls)) return false;
  for (const a of c.attrs) {
    const v = getAttr(n, a.name);
    if (v === undefined) return false;
    if (a.op && a.op !== "=") {
      if (a.op === "~=" && !v.split(/\s+/).includes(a.value!)) return false;
      if (a.op === "|=" && v !== a.value && !v.startsWith(a.value! + "-"))
        return false;
      if (a.op === "^=" && !v.startsWith(a.value!)) return false;
      if (a.op === "$=" && !v.endsWith(a.value!)) return false;
      if (a.op === "*=" && !v.includes(a.value!)) return false;
    } else if (a.op === "=" && v !== a.value) return false;
  }
  for (const p of c.pseudos) if (!evalPseudo(n, p)) return false;
  return true;
}

function evalPseudo(n: DomNode, p: Pseudo): boolean {
  switch (p.name) {
    case "first-child":
      return n.index === 1;
    case "last-child":
      return n.parent?.children?.[n.parent.children.length - 1] === n;
    case "only-child":
      return n.index === 1 && (n.parent?.children?.length ?? 0) === 1;
    case "nth-child":
      return evalNth(n.index ?? 1, p.args);
    default:
      return false;
  }
}
function evalNth(idx: number, args?: string): boolean {
  if (!args) return idx === 1;
  if (args === "odd") return idx % 2 === 1;
  if (args === "even") return idx % 2 === 0;
  if (/^\d+$/.test(args)) return idx === parseInt(args, 10);
  // an+b：2n / 2n+1 / -n+3 / n 等
  const m = args.match(/^([+-]?)(\d*)n([+-]\d+)?$/i);
  if (!m) return false;
  const a = (m[2] === "" ? 1 : parseInt(m[2], 10)) * (m[1] === "-" ? -1 : 1);
  const b = m[3] ? parseInt(m[3], 10) : 0;
  return (idx - b) % a === 0 && (idx - b) / a >= 0;
}

// ---------------------------------------------------------------------------
// BOF 匹配
// ---------------------------------------------------------------------------

export function matches(node: DomNode, selector: string): boolean {
  const complexes = parseSelector(selector);
  return complexes.some((cx) => matchComplex(node, cx));
}

function matchComplex(node: DomNode, cx: Complex): boolean {
  const parts = cx.parts;
  if (parts.length === 0) return false;
  if (!matchCompound(node, parts[parts.length - 1].compound)) return false;
  if (parts.length === 1) return true;

  let cur: DomNode | undefined = node;
  for (let i = parts.length - 2; i >= 0; i--) {
    const { combinator } = parts[i + 1];
    const prev = parts[i].compound;
    let cands: DomNode[] = [];
    if (combinator === "descendant") {
      let p = cur?.parent;
      while (p) {
        cands.push(p);
        p = p.parent;
      }
    } else if (combinator === "child") {
      if (cur?.parent) cands.push(cur.parent);
    } else if (combinator === "adjacent") {
      const p = cur?.parent;
      if (p?.children) {
        const idx = (cur.index ?? 1) - 1;
        if (idx > 0) cands.push(p.children[idx - 1]);
      }
    } else if (combinator === "sibling") {
      const p = cur?.parent;
      if (p?.children) {
        for (let j = 0; j < (cur.index ?? 1) - 1; j++)
          cands.push(p.children[j]);
      }
    }
    const hit = cands.find((c) => matchCompound(c, prev));
    if (!hit) return false;
    cur = hit;
  }
  return true;
}

export function queryAll(root: DomNode, selector: string): DomNode[] {
  const out: DomNode[] = [];
  const walk = (n: DomNode) => {
    if (matches(n, selector)) out.push(n);
    n.children?.forEach(walk);
  };
  walk(root);
  return out;
}

// ---------------------------------------------------------------------------
// 演示
// ---------------------------------------------------------------------------

const tree: DomNode = {
  tag: "html",
  children: [
    {
      tag: "body",
      children: [
        {
          tag: "div",
          className: "container",
          id: "main",
          children: [
            {
              tag: "ul",
              children: [
                {
                  tag: "li",
                  className: "item",
                  attrs: { "data-role": "item" },
                  children: [
                    {
                      tag: "span",
                      children: [{ tag: "a", attrs: { href: "#" } }],
                    },
                  ],
                },
                {
                  tag: "li",
                  className: "item active",
                  attrs: { "data-role": "item" },
                },
                { tag: "li", className: "item" },
              ],
            },
          ],
        },
        { tag: "p", children: [{ tag: "span", className: "note" }] },
      ],
    },
  ],
};
buildTree([tree]);

console.log("=== BOF 匹配演示 ===");
const cases: [string, number][] = [
  ["div.container", 1],
  ["div#main", 1],
  [".item", 3],
  ["li.item.active", 1],
  ["div li", 3], // descendant
  ["ul > li", 3], // child
  ["li + li", 2], // adjacent
  ["li ~ li", 2], // sibling
  ['[data-role="item"]', 2],
  [".item:first-child", 1],
  [".item:nth-child(2n)", 1],
  ["div.container a", 1],
];
let pass = 0;
for (const [sel, expect] of cases) {
  const got = queryAll(tree, sel).length;
  const ok = got === expect;
  if (ok) pass++;
  console.log(`${ok ? "✓" : "✗"} ${sel.padEnd(28)} → ${got}（期望 ${expect}）`);
}
console.log(`\n通过 ${pass}/${cases.length}`);
console.log("\n✓ mini-selector 验证完毕");

// 文件: examples/28-01-css-parser.ts
// ============ 手写 CSS Tokenizer + Parser ============
// 把 CSS 字符串切成 token 流，再组装成 Rule / AtRule / Declaration AST。
// 关键边界：字符串里的 } 不是 rule 边界、@media 嵌套要保留、comment 直接跳过。

export interface Declaration {
  type: "declaration";
  property: string;
  value: string;
  important: boolean;
}

export interface Rule {
  type: "rule";
  selectors: string[];
  children: Array<Rule | AtRule | Declaration>;
  declarations: Declaration[];
}

export interface AtRule {
  type: "atrule";
  name: string;
  prelude: string;
  children: Array<Rule | AtRule | Declaration>;
}

type CssNode = Rule | AtRule | Declaration;
export type { CssNode };

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenType =
  | "ident"
  | "string"
  | "number"
  | "dimension"
  | "percentage"
  | "hash"
  | "at-keyword"
  | "pseudo"
  | "comma"
  | "semicolon"
  | "lbrace"
  | "rbrace"
  | "lparen"
  | "rparen"
  | "colon"
  | "dot"
  | "asterisk"
  | "gt"
  | "plus"
  | "tilde"
  | "pipe"
  | "match-op"
  | "whitespace"
  | "EOF";

interface Token {
  type: TokenType;
  value: string;
}

class Tokenizer {
  private pos = 0;
  constructor(private src: string) {}

  private peek(o = 0) {
    return this.src[this.pos + o] ?? "\0";
  }
  private consume(n = 1) {
    const c = this.src.slice(this.pos, this.pos + n);
    this.pos += n;
    return c;
  }
  private isIdentStart(c: string) {
    return /[a-zA-Z_\-]/.test(c) || c.charCodeAt(0) >= 0x80;
  }
  private isIdentChar(c: string) {
    return /[a-zA-Z0-9_\-]/.test(c) || c.charCodeAt(0) >= 0x80;
  }
  private isDigit(c: string) {
    return /[0-9]/.test(c);
  }

  next(): Token {
    // 跳过注释
    while (this.peek() === "/" && this.peek(1) === "*") {
      while (
        !(this.peek() === "*" && this.peek(1) === "/") &&
        this.pos < this.src.length
      )
        this.pos++;
      this.consume(2);
    }
    if (this.pos >= this.src.length) return { type: "EOF", value: "" };

    const c = this.peek();
    if (/\s/.test(c)) {
      const start = this.pos;
      while (/\s/.test(this.peek())) this.pos++;
      return { type: "whitespace", value: this.src.slice(start, this.pos) };
    }
    // 字符串优先识别：内部标点原样保留
    if (c === '"' || c === "'") {
      const quote = this.consume();
      let val = "";
      while (this.pos < this.src.length && this.peek() !== quote) {
        if (this.peek() === "\\") {
          this.consume();
          val += this.consume();
        } else val += this.consume();
      }
      this.consume();
      return { type: "string", value: val };
    }
    if (this.isDigit(c) || (c === "." && this.isDigit(this.peek(1))))
      return this.readNumber();
    if (c === "#") {
      this.consume();
      let v = "";
      while (this.isIdentChar(this.peek())) v += this.consume();
      return { type: "hash", value: v };
    }
    if (c === "@") {
      this.consume();
      let v = "";
      while (this.isIdentChar(this.peek())) v += this.consume();
      return { type: "at-keyword", value: v };
    }
    if (c === ":") {
      this.consume();
      let val = ":";
      if (this.peek() === ":") {
        val += this.consume();
      }
      if (this.isIdentStart(this.peek())) {
        while (this.isIdentChar(this.peek())) val += this.consume();
        return { type: "pseudo", value: val };
      }
      return { type: "colon", value: val };
    }
    if (["^", "$", "*", "~", "|"].includes(c) && this.peek(1) === "=") {
      const op = this.consume(2);
      return { type: "match-op", value: op };
    }
    if (c === "=") {
      this.consume();
      return { type: "pipe", value: "=" };
    }
    if (this.isIdentStart(c)) {
      let v = "";
      while (this.pos < this.src.length) {
        const cc = this.peek();
        if (cc === "\\" && this.peek(1) !== "\n") {
          this.consume();
          v += this.consume();
        } else if (this.isIdentChar(cc)) v += this.consume();
        else break;
      }
      return { type: "ident", value: v };
    }
    const map: Record<string, TokenType> = {
      ",": "comma",
      ";": "semicolon",
      "{": "lbrace",
      "}": "rbrace",
      "(": "lparen",
      ")": "rparen",
      ".": "dot",
      "*": "asterisk",
      ">": "gt",
      "+": "plus",
      "~": "tilde",
      "|": "pipe",
    };
    this.consume();
    return { type: map[c] ?? "pipe", value: c };
  }

  private readNumber(): Token {
    let num = "";
    if (this.peek() === "." && this.isDigit(this.peek(1)))
      num += this.consume();
    while (this.isDigit(this.peek())) num += this.consume();
    if (this.peek() === ".") {
      num += this.consume();
      while (this.isDigit(this.peek())) num += this.consume();
    }
    if (this.peek() === "%") {
      this.consume();
      return { type: "percentage", value: num + "%" };
    }
    if (this.isIdentStart(this.peek())) {
      let u = "";
      while (this.isIdentChar(this.peek())) u += this.consume();
      return { type: "dimension", value: num + u };
    }
    return { type: "number", value: num };
  }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}
  private peek(o = 0) {
    return this.tokens[this.pos + o] ?? { type: "EOF" as TokenType, value: "" };
  }
  private advance() {
    return this.tokens[this.pos++] ?? { type: "EOF" as TokenType, value: "" };
  }
  private skipSemi() {
    while (["semicolon", "whitespace"].includes(this.peek().type))
      this.advance();
  }

  parseRuleList(): CssNode[] {
    const nodes: CssNode[] = [];
    this.skipSemi();
    while (this.peek().type !== "EOF" && this.peek().type !== "rbrace") {
      if (this.peek().type === "at-keyword") nodes.push(this.parseAtRule());
      else
        nodes.push(
          this.isDeclaration() ? this.parseDeclaration() : this.parseRule(),
        );
      this.skipSemi();
    }
    return nodes;
  }

  // 启发式：遇到 '{' 前先遇到 ':' 且没遇到 ';' → 是 declaration
  private isDeclaration(): boolean {
    let i = 0;
    while (true) {
      const t = this.tokens[this.pos + i];
      if (!t || t.type === "EOF" || t.type === "rbrace") return false;
      if (t.type === "lbrace") return false;
      if (t.type === "semicolon") return false;
      if (t.type === "colon") return true;
      i++;
    }
  }

  parseAtRule(): AtRule {
    const name = this.advance().value.toLowerCase();
    const preludeToks: Token[] = [];
    while (!["lbrace", "semicolon", "EOF"].includes(this.peek().type))
      preludeToks.push(this.advance());
    const prelude = joinTokens(preludeToks);
    if (this.peek().type === "semicolon") {
      this.advance();
      return { type: "atrule", name, prelude, children: [] };
    }
    this.advance(); // {
    const children = this.parseRuleList();
    this.advance(); // }
    return { type: "atrule", name, prelude, children };
  }

  parseRule(): Rule {
    const preludeToks: Token[] = [];
    let depth = 0;
    while (this.peek().type !== "lbrace" && this.peek().type !== "EOF") {
      const t = this.advance();
      if (t.type === "lparen") depth++;
      else if (t.type === "rparen") depth = Math.max(0, depth - 1);
      preludeToks.push(t);
    }
    const prelude = joinTokens(preludeToks).trim();
    const selectors = splitTopLevel(prelude, ",");
    this.advance(); // {
    const children = this.parseRuleList();
    this.advance(); // }
    const declarations = children.filter(
      (c): c is Declaration => c.type === "declaration",
    );
    return { type: "rule", selectors, children, declarations };
  }

  parseDeclaration(): Declaration {
    let prop = "";
    while (this.peek().type === "ident" || this.peek().type === "pipe")
      prop += this.advance().value;
    prop = prop.trim().toLowerCase();
    if (this.peek().type === "colon") this.advance();
    const valToks: Token[] = [];
    while (!["semicolon", "rbrace", "EOF"].includes(this.peek().type))
      valToks.push(this.advance());
    let value = joinTokens(valToks);
    const important = value.toLowerCase().endsWith("!important");
    if (important) value = value.slice(0, -"!important".length).trim();
    return { type: "declaration", property: prop, value, important };
  }
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

function joinTokens(tokens: Token[]): string {
  const word = new Set([
    "ident",
    "number",
    "dimension",
    "percentage",
    "hash",
    "pseudo",
    "at-keyword",
    "string",
  ]);
  let out = "";
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "whitespace") {
      out += " "; // 后代选择器的空白还原为空格
      continue;
    }
    const prev = tokens[i - 1];
    if (i > 0 && prev && prev.type !== "whitespace") {
      if (prev.type === "ident" && t.type === "lparen") {
        /* no space */
      } else if (
        (word.has(prev.type) && word.has(t.type)) ||
        prev.type === "rparen"
      )
        out += " ";
    }
    out += t.type === "hash" ? "#" + t.value : t.value;
  }
  return out.trim().replace(/\s+/g, " ");
}

export function parseStylesheet(src: string) {
  const t = new Tokenizer(src);
  const tokens: Token[] = [];
  let tok = t.next();
  while (tok.type !== "EOF") {
    tokens.push(tok);
    tok = t.next();
  }
  tokens.push({ type: "EOF", value: "" });
  return {
    type: "stylesheet" as const,
    children: new Parser(tokens).parseRuleList(),
  };
}

// ---------------------------------------------------------------------------
// 打印 AST
// ---------------------------------------------------------------------------

function printNode(n: CssNode, depth = 0): void {
  const pad = "  ".repeat(depth);
  if (n.type === "declaration") {
    console.log(
      `${pad}✎ ${n.property}: ${n.value}${n.important ? " !important" : ""}`,
    );
  } else if (n.type === "rule") {
    console.log(`${pad}█ rule  ${n.selectors.join(" , ")}`);
    for (const c of n.children) printNode(c, depth + 1);
  } else {
    console.log(`${pad}⚑ @${n.name} ${n.prelude}`);
    for (const c of n.children) printNode(c, depth + 1);
  }
}

// ---------------------------------------------------------------------------
// 演示
// ---------------------------------------------------------------------------

const css = `
/* 顶部 comment */
body {
  color: #333;
  font-size: 14px;
  content: "}" ;   /* 字符串里的 } 不会打断 parser */
}

div.a:hover, span[data-role="item"] {
  color: red;
  background: rgba(255, 0, 0, 0.5);
}

@media (max-width: 600px) {
  .container {
    padding: 8px 16px;
  }
  .nested { font-weight: bold !important; }
}
`;

console.log("=== 解析 CSS 源码 ===");
const sheet = parseStylesheet(css);
for (const n of sheet.children) printNode(n);

console.log("\n=== 边界验证 ===");
// 1. 字符串里的 } 被正确当作 declaration value
const bodyRule = sheet.children.find(
  (n) => n.type === "rule" && n.selectors.includes("body"),
) as Rule;
const contentDecl = bodyRule.declarations.find((d) => d.property === "content");
console.log(
  `body content = "${contentDecl?.value}"（应为 }，证明字符串优先识别）`,
);

// 2. @media 嵌套完整保留
const media = sheet.children.find(
  (n) => n.type === "atrule" && n.name === "media",
) as AtRule;
console.log(
  `@media 嵌套规则数 = ${media.children.length}（应为 2：.container + .nested）`,
);

// 3. !important 标记
const nested = media.children.find(
  (n) => n.type === "rule" && n.selectors.includes(".nested"),
) as Rule;
console.log(
  `.nested font-weight important = ${nested.declarations[0]?.important}（应为 true）`,
);

console.log("\n✓ mini-css-parser 验证完毕");

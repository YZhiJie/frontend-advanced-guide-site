// 文件: cases/12-mini-browser-engine-lab/src/css-parser.ts
// css-parser.ts
// 手写 CSS tokenizer + AST parser
// 支持：Rule、AtRule（@media/@keyframes/@import/@charset）、Declaration
// AST 类型：{ type: 'rule'|'atrule', ... } / { type: 'declaration', ... }

export type CssNode = Rule | AtRule | Declaration;

export interface Rule {
  type: "rule";
  selectors: string[];
  prelude: string;
  children: CssNode[];
  declarations: Declaration[]; // 平铺出的声明（非嵌套）
}

export interface AtRule {
  type: "atrule";
  name: string; // media / keyframes / import / charset / ...
  prelude: string; // "screen and (max-width: 600px)"
  children: CssNode[]; // 嵌套节点，仅 block 型 at-rule 有
}

export interface Declaration {
  type: "declaration";
  property: string;
  value: string;
  important: boolean;
}

export interface Stylesheet {
  type: "stylesheet";
  children: CssNode[];
}

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
  | "dash-match" // |=
  | "prefix-match" // ^=
  | "suffix-match" // $=
  | "substring-match" // *=
  | "includes-match" // ~=
  | "whitespace"
  | "EOF";

interface Token {
  type: TokenType;
  value: string;
}

class Tokenizer {
  private src: string;
  private pos = 0;

  constructor(src: string) {
    this.src = src;
  }

  private peek(offset = 0): string {
    return this.src[this.pos + offset] ?? "\0";
  }

  private consume(n = 1): string {
    const chunk = this.src.slice(this.pos, this.pos + n);
    this.pos += n;
    return chunk;
  }

  private isIdentStart(c: string): boolean {
    return /[a-zA-Z_\-]/.test(c) || c.charCodeAt(0) >= 0x80;
  }

  private isIdentChar(c: string): boolean {
    return /[a-zA-Z0-9_\-]/.test(c) || c.charCodeAt(0) >= 0x80;
  }

  private isDigit(c: string): boolean {
    return /[0-9]/.test(c);
  }

  next(): Token {
    // 跳过注释
    while (this.peek() === "/" && this.peek(1) === "*") {
      while (
        !(this.peek() === "*" && this.peek(1) === "/") &&
        this.pos < this.src.length
      ) {
        this.pos++;
      }
      this.consume(2);
    }

    // EOF
    if (this.pos >= this.src.length) return { type: "EOF", value: "" };

    const c = this.peek();

    // 空白
    if (/\s/.test(c)) {
      let start = this.pos;
      while (/\s/.test(this.peek())) this.pos++;
      return { type: "whitespace", value: this.src.slice(start, this.pos) };
    }

    // 字符串
    if (c === '"' || c === "'") {
      const quote = this.consume();
      let val = "";
      while (this.pos < this.src.length && this.peek() !== quote) {
        if (this.peek() === "\\") {
          this.consume();
          val += this.consume();
        } else {
          val += this.consume();
        }
      }
      this.consume(); // closing quote
      return { type: "string", value: val };
    }

    // 数字 / dimension / percentage
    if (this.isDigit(c) || (c === "." && this.isDigit(this.peek(1)))) {
      return this.readNumber();
    }

    // #
    if (c === "#") {
      this.consume();
      let val = "";
      while (this.isIdentChar(this.peek())) val += this.consume();
      return { type: "hash", value: val };
    }

    // @keyword
    if (c === "@") {
      this.consume();
      let val = "";
      while (this.isIdentChar(this.peek())) val += this.consume();
      return { type: "at-keyword", value: val };
    }

    // :pseudo 或 : 分隔符
    if (c === ":") {
      this.consume();
      // :: 伪元素
      let isPseudo = false;
      let val = ":";
      if (this.peek() === ":") {
        val += this.consume();
        isPseudo = true;
      }
      // 只有当 : 后面紧跟 ident（无空白）时才算 pseudo
      if (this.isIdentStart(this.peek())) {
        isPseudo = true;
        while (this.isIdentChar(this.peek())) val += this.consume();
        return { type: "pseudo", value: val };
      }
      return { type: "colon", value: val };
    }

    // = 或 复合 matcher
    if (c === "=") {
      this.consume();
      return { type: "pipe", value: "=" };
    }

    // 复合属性：^= $= *= ~= |=
    if (
      (c === "^" || c === "$" || c === "*" || c === "~" || c === "|") &&
      this.peek(1) === "="
    ) {
      const op = c;
      this.consume(2);
      const map: Record<string, TokenType> = {
        "|=": "dash-match",
        "^=": "prefix-match",
        "$=": "suffix-match",
        "*=": "substring-match",
        "~=": "includes-match",
      };
      return { type: map[op + "="] ?? "pipe", value: op + "=" };
    }

    // 标识符
    if (this.isIdentStart(c)) {
      let val = "";
      // escape
      while (this.pos < this.src.length) {
        const cc = this.peek();
        if (cc === "\\" && this.peek(1) !== "\n") {
          this.consume();
          val += this.consume();
        } else if (this.isIdentChar(cc)) {
          val += this.consume();
        } else {
          break;
        }
      }
      return { type: "ident", value: val };
    }

    // 单字符
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
    if (this.peek() === "." && this.isDigit(this.peek(1))) {
      num += this.consume();
    }
    while (this.isDigit(this.peek())) num += this.consume();
    if (this.peek() === ".") {
      num += this.consume();
      while (this.isDigit(this.peek())) num += this.consume();
    }
    if (this.peek() === "e" || this.peek() === "E") {
      num += this.consume();
      if (this.peek() === "+" || this.peek() === "-") num += this.consume();
      while (this.isDigit(this.peek())) num += this.consume();
    }

    if (this.peek() === "%") {
      this.consume();
      return { type: "percentage", value: num + "%" };
    }
    if (this.isIdentStart(this.peek())) {
      let unit = "";
      while (this.isIdentChar(this.peek())) unit += this.consume();
      return { type: "dimension", value: num + unit };
    }
    return { type: "number", value: num };
  }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parseStylesheet(src: string): Stylesheet {
  const tokens: Token[] = [];
  const t = new Tokenizer(src);
  let tok = t.next();
  while (tok.type !== "EOF") {
    if (tok.type !== "whitespace") tokens.push(tok);
    tok = t.next();
  }
  tokens.push({ type: "EOF", value: "" });

  const ctx = new ParseContext(tokens);
  const children = ctx.parseRuleList();
  return { type: "stylesheet", children };
}

class ParseContext {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(offset = 0): Token {
    return this.tokens[this.pos + offset] ?? { type: "EOF", value: "" };
  }
  private advance(): Token {
    return this.tokens[this.pos++] ?? { type: "EOF", value: "" };
  }
  private match(type: TokenType): boolean {
    return this.peek().type === type;
  }
  private expect(type: TokenType): Token {
    const t = this.advance();
    if (t.type !== type) {
      throw new Error(`Expected ${type}, got ${t.type} ("${t.value}")`);
    }
    return t;
  }
  private skipSemicolons(): void {
    while (this.match("semicolon")) this.advance();
  }

  parseRuleList(): CssNode[] {
    const nodes: CssNode[] = [];
    this.skipSemicolons();
    while (!this.match("EOF") && !this.match("rbrace")) {
      if (this.match("at-keyword")) {
        nodes.push(this.parseAtRule());
      } else {
        // 试探：看前面是否有冒号且没有 '{'——是 declaration；否则是 rule
        const t0 = this.peek();
        // declaration 以 ident 或 pipe 开头
        if (t0.type === "ident" || t0.type === "pipe") {
          // 向前看：在遇到 '{' / ';' / 'EOF' 之前是否先遇到 ':'，且中间没有 '{'
          let sawColon = false;
          let sawLBrace = false;
          let i = 0;
          while (true) {
            const tt = this.tokens[this.pos + i];
            if (!tt || tt.type === "EOF" || tt.type === "rbrace") break;
            if (tt.type === "lbrace") {
              sawLBrace = true;
              break;
            }
            if (tt.type === "semicolon") break;
            if (tt.type === "colon") {
              sawColon = true;
              break;
            }
            i++;
          }
          if (sawColon && !sawLBrace) {
            nodes.push(this.parseDeclaration());
          } else {
            nodes.push(this.parseRule());
          }
        } else {
          nodes.push(this.parseRule());
        }
      }
      this.skipSemicolons();
    }
    return nodes;
  }

  parseAtRule(): AtRule {
    const at = this.expect("at-keyword");
    const name = at.value.toLowerCase();

    // 读取 prelude 直到 '{' 或 ';'
    let prelude = "";
    const preludeTokens: Token[] = [];
    while (
      !this.match("lbrace") &&
      !this.match("semicolon") &&
      !this.match("EOF")
    ) {
      preludeTokens.push(this.advance());
    }
    prelude = preludeTokens
      .map((t) => t.value)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    // 无 block：@charset / @import
    if (this.match("semicolon")) {
      this.advance();
      return { type: "atrule", name, prelude, children: [] };
    }

    // 有 block
    this.expect("lbrace");
    const children = this.parseRuleList();
    this.expect("rbrace");

    return { type: "atrule", name, prelude, children };
  }

  parseRule(): Rule {
    const preludeTokens: Token[] = [];
    let depth = 0;
    while (!this.match("lbrace") && !this.match("EOF")) {
      const t = this.advance();
      if (t.type === "lparen") depth++;
      else if (t.type === "rparen") depth = Math.max(0, depth - 1);
      preludeTokens.push(t);
    }

    // prelude 直接拼 token value；只有当 ident 紧跟 ident 或 ident 紧跟 [ / : / . / # 等修饰时需要空格
    // 但 selector 里 ident 紧跟 ident 本身就是 descendant combinator，所以加空格
    const prelude = joinPrelude(preludeTokens).trim();
    const selectors = splitTopLevel(prelude, ",");

    this.expect("lbrace");
    const bodyChildren = this.parseRuleList();
    this.expect("rbrace");

    const declarations: Declaration[] = [];
    const nested: CssNode[] = [];
    for (const child of bodyChildren) {
      if (child.type === "atrule") {
        nested.push(child);
      } else if (child.type === "rule") {
        nested.push(child);
      } else {
        declarations.push(child as Declaration);
      }
    }

    return {
      type: "rule",
      selectors,
      prelude,
      children: bodyChildren,
      declarations,
    };
  }

  // 顶层：parseDeclaration 只在简单属性声明路径使用（用于 value 里不含嵌套 block 的情况）
  parseDeclaration(): Declaration {
    let prop = "";
    while (this.match("ident") || this.match("pipe")) {
      prop += this.advance().value;
    }
    if (!prop) throw new Error("Expected property");
    prop = prop.trim().toLowerCase();

    if (this.match("colon")) {
      this.advance();
    }

    const valueTokens: Token[] = [];
    while (
      !this.match("semicolon") &&
      !this.match("rbrace") &&
      !this.match("EOF")
    ) {
      const t = this.advance();
      if (t.type === "lbrace") {
        // 遇到 {：说明这其实是 selector list + block，不是声明
        // 回退
        this.pos--;
        throw new Error("Unexpected block in declaration");
      }
      valueTokens.push(t);
    }
    let value = joinTokensWithSpacing(valueTokens);
    const important = value.toLowerCase().endsWith("!important");
    if (important) {
      value = value.slice(0, -"!important".length).trim();
    }
    return {
      type: "declaration",
      property: prop,
      value,
      important,
    };
  }
}

function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = [];
  let buf = "";
  let depth = 0;
  let inStr: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ((c === '"' || c === "'") && (i === 0 || s[i - 1] !== "\\")) {
      if (inStr) inStr = null;
      else inStr = c;
    }
    if (!inStr) {
      if (c === "(") depth++;
      else if (c === ")") depth = Math.max(0, depth - 1);
    }
    if (c === sep && depth === 0 && !inStr) {
      const p = buf.trim();
      if (p) parts.push(p);
      buf = "";
    } else {
      buf += c;
    }
  }
  const last = buf.trim();
  if (last) parts.push(last);
  return parts;
}

function joinTokensWithSpacing(tokens: Token[]): string {
  const wordTypes = new Set<string>([
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
    if (i > 0) {
      const prev = tokens[i - 1];
      const prevWord = wordTypes.has(prev.type);
      const curWord = wordTypes.has(t.type);
      const prevCloseParen = prev.type === "rparen";
      // ident 后跟 lparen 是函数调用（calc(...), url(...)），不加空格
      if (prev.type === "ident" && t.type === "lparen") {
        // no space
      } else if ((prevWord && curWord) || prevCloseParen) {
        out += " ";
      }
    }
    out += t.value;
  }
  return out.trim().replace(/\s+/g, " ");
}

function joinPrelude(tokens: Token[]): string {
  // selector prelude 里：ident+ident 是 descendant combinator（原始有空格），需要加空格
  // ident+hash/dot/pseudo 等是紧连的复合选择器，不加空格
  // 注意：tokenizer 里 hash token value 不含 '#'，dot value 是 '.'，pseudo 含 ':'
  let out = "";
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (i > 0) {
      const prev = tokens[i - 1];
      if (prev.type === "ident" && t.type === "ident") {
        out += " "; // descendant combinator
      } else if (prev.type === "ident" && t.type === "asterisk") {
        out += " ";
      } else if (prev.type === "hash" && t.type === "ident") {
        // hash('main') 后面紧跟 ident —— 不应该发生，但保险起见
      }
    }
    if (t.type === "hash") {
      out += "#" + t.value;
    } else {
      out += t.value;
    }
  }
  return out;
}

// 把 Stylesheet / Rule 内的 declaration 列表展开，方便外部直接用
export function flattenDeclarations(node: CssNode): Declaration[] {
  const out: Declaration[] = [];
  const walk = (n: CssNode) => {
    if (n.type === "declaration") {
      out.push(n);
    } else if (n.type === "rule") {
      for (const c of n.children) walk(c);
    } else if (n.type === "atrule") {
      for (const c of n.children) walk(c);
    }
  };
  walk(node);
  return out;
}

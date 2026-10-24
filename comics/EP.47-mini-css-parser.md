# EP.47 CSS 字符串变盒子

> 对应正文：[第二十八部分 · 手写浏览器内核](../28-mini-browser-engine.md#_28-1-mini-css-parser-css-字符串变盒子)

## 剧情回顾

- **第 1 格**：标签君困惑——浏览器收到一坨 CSS 字符串，`body` 和 `color` 看起来都是普通标识符，凭啥前者就是 selector、后者就是 property？字符串里没有任何显式标记区分它们。
- **第 2 格**：码叔点破两层分工——先让 tokenizer 按语法字符把字符串切成 token 流（`identifier`、`{`、`:`、`;`、`}`、`combinator`……），再让 parser 根据 token 的**位置**决定语义：遇到 `{`，它前面那段就是 selector；遇到 `:`，它前面那个 identifier 就是 property。
- **第 3 格**：像素酱手写 tokenizer + parser，对复杂 selector `div.a:hover { color: red; }` 也能正确产出 Rule AST：`{ type: 'Rule', selector: 'div.a:hover', declarations: [{ property: 'color', value: 'red' }] }`。
- **第 4 格**：码叔结案——别以为就是 split 几下。@media 嵌套 rule、字符串里的 `}`、CSS comment 跳过，这三种是新手 parser 最容易漏的边界。

## 知识点拆解

### 第 1 格 · CSS 字符串的困境

CSS 语法没有显式的"这是 selector"标记，selector 和 declaration 靠的是**位置关系**：

```
div.a:hover { color: red; }
 ↑ selector   ↑ declaration block
```

这种设计让手写 parser 必须先 tokenize 再 parse——光靠正则匹配很难正确处理嵌套和字符串。

### 第 2 格 · Tokenizer 是第一关

tokenizer 职责：逐字符扫描 CSS 字符串，产出有序 token 数组。

```js
function tokenize(css) {
  const tokens = [];
  let i = 0;
  while (i < css.length) {
    // 跳过空白和注释
    if (/\s/.test(css[i])) { i++; continue; }
    if (css.startsWith('/*', i)) {
      const j = css.indexOf('*/', i + 2);
      i = j === -1 ? css.length : j + 2; continue;
    }
    // 字符串
    if (css[i] === '"' || css[i] === "'") {
      const quote = css[i]; let j = i + 1;
      while (j < css.length && css[j] !== quote) j++;
      tokens.push({ type: 'string', value: css.slice(i, j + 1) });
      i = j + 1; continue;
    }
    // 单字符标点
    if ('{};:,'.includes(css[i])) {
      tokens.push({ type: 'punct', value: css[i++] }); continue;
    }
    // identifier 或数字
    let j = i;
    while (j < css.length && !/[{};:,\s]/.test(css[j])) j++;
    tokens.push({ type: 'ident', value: css.slice(i, j) });
    i = j;
  }
  return tokens;
}
```

### 第 3 格 · Parser 组装 AST

```js
function parse(tokens) {
  const rules = [];
  let i = 0;
  while (i < tokens.length) {
    // 找 { 的位置
    let j = i;
    let depth = 0;
    while (j < tokens.length) {
      if (tokens[j].value === '{') break;
      j++;
    }
    if (j >= tokens.length) break;
    const selector = tokens.slice(i, j).map(t => t.value).join('').trim();
    // 解析 declaration block
    const declarations = [];
    let k = j + 1;
    while (k < tokens.length && tokens[k].value !== '}') {
      // 找 : 分隔 property/value
      const colonIdx = tokens.findIndex((t, idx) => idx >= k && t.value === ':');
      if (colonIdx === -1) break;
      const property = tokens.slice(k, colonIdx).map(t => t.value).join('').trim();
      // 找 ; 或 } 结束 declaration
      let endIdx = colonIdx + 1;
      while (endIdx < tokens.length && tokens[endIdx].value !== ';' && tokens[endIdx].value !== '}') endIdx++;
      const value = tokens.slice(colonIdx + 1, endIdx).map(t => t.value).join('').trim();
      declarations.push({ property, value });
      k = endIdx + 1;
    }
    rules.push({ type: 'Rule', selector, declarations });
    i = k + 1; // 跳过 }
  }
  return rules;
}
```

### 第 4 格 · 三种边缘

| 边界 | 正确处理 |
| ---- | -------- |
| `@media (max-width: 600px) { ... }` | @ 开头是 at-rule，内部完整嵌套 parse 后挂在 `rules` 里 |
| `content: "}"` / `content: "/*"` | tokenizer 里字符串优先识别，不会误把里面的 `}` 当 rule 边界 |
| `/* comment */` | tokenizer 直接跳过，不产出任何 token |

## 坑点清单

> 🔗 正文对照：[《28.7 本章避坑清单》](../28-mini-browser-engine#_28-7-本章避坑清单)

1. **字符串里的 `}` 不是 rule 边界**：`content: "}"` 里的 `}` 会把简单的 split 版 parser 直接搞崩。正确做法是在 tokenizer 里优先识别字符串（引号匹配），字符串内部的一切标点都原样保留。
2. **@media 嵌套要完整保留**：不要试图在 tokenizer 阶段就把 `@media` 丢掉。parser 要能识别 at-rule 并完整 parse 内部嵌套的 rules，最终挂到 AST 的 `rules` 数组里。
3. **comment 直接跳过**：`/* ... */` 在 CSS 里不算任何东西。tokenizer 阶段识别后直接 `continue`，不要产出 token。注意 comment 可以跨行。
4. **不要用正则 parse CSS**：CSS 语法有嵌套、字符串、转义、Unicode 这些特性，正则永远会在边界翻车。正确姿势是 tokenizer + parser 两层。

## 自测 3 题

**1. 手写 CSS parser 时，为什么必须是 tokenizer + parser 两层架构，不能直接用字符串 split 或正则？**

<details>
<summary>参考答案</summary>

- split/正则无法正确处理嵌套：`@media { .a { color: red; } }` 里有多个 `{` `}`；
- 字符串内部的标点会被误切：`content: "}"`；
- comment 跨多行也会干扰 split 结果；
- tokenizer 先产出**有类型**的 token 数组，parser 才能基于类型做结构化判断，而不是对着字符瞎猜。
</details>

**2. tokenizer 怎么识别字符串？为什么字符串处理必须在标点处理之前？**

<details>
<summary>参考答案</summary>

```js
if (css[i] === '"' || css[i] === "'") {
  const quote = css[i];
  let j = i + 1;
  while (j < css.length && css[j] !== quote) {
    if (css[j] === '\\') j += 2; // 跳过转义
    else j++;
  }
  tokens.push({ type: 'string', value: css.slice(i, j + 1) });
  i = j + 1; continue;
}
// 之后才处理 {} ; : 等标点
```

如果先处理标点，字符串里的 `{` `}` `;` 会被当成标点产出——彻底乱套。

</details>

**3. `div.a:hover, span[b] { color: red; }` 这个多选择器 rule，parser 怎么正确切出 declarations？**

<details>
<summary>参考答案</summary>

关键是 selector 部分可能包含多个 selector 用逗号分隔，parser 不能在第一个 `,` 就停下来。正确做法是：
- 找 selector 结束：直到遇到 `{`；
- 花括号内部 declaration block：循环找 `:` 切 property/value，找 `;` 或 `}` 切 declaration 边界；
- 每个 declaration 的 value 部分可能包含函数 `rgba(255,0,0,0.5)`，里面的 `,` 不是 declaration 分隔——所以 parser 在 value 收集阶段要跳过括号深度内的 `,`。

```js
// value 收集时跳过嵌套函数
let depth = 0;
while (endIdx < tokens.length) {
  if (tokens[endIdx].value === '(') depth++;
  else if (tokens[endIdx].value === ')') depth--;
  else if ((tokens[endIdx].value === ';' || tokens[endIdx].value === '}') && depth === 0) break;
  endIdx++;
}
```

</details>

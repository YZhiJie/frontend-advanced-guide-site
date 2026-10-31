# case 12：手写浏览器内核小工程

用纯 TypeScript + Node 原生模块手写一个精简但闭环的浏览器内核子系统：从 CSS 源码到 AST、从 selector 解析到 DOM 匹配、从 specificity 层叠到最终样式、再从盒模型到 Flex 布局，完整串起浏览器渲染 pipeline 里 **CSSOM → Style → Layout** 这三个阶段。

## 目录结构

```
12-mini-browser-engine-lab/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── css-parser.ts      # CSS tokenizer → AST（Rule / AtRule / Declaration）
│   ├── selector.ts        # selector 解析 + 从右到左（BOF）匹配
│   ├── cascade.ts         # specificity 四元组 + cascade 层叠
│   ├── box-model.ts       # 盒模型计算 + 简易 block flow
│   └── flex-layout.ts     # Flex 布局（主轴交叉轴空间分配）
└── test/
    ├── css-parser.test.ts   14 个用例
    ├── selector.test.ts     16 个用例
    ├── cascade.test.ts      10 个用例
    ├── box-model.test.ts    13 个用例
    └── flex-layout.test.ts  17 个用例
```

## 运行

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm test        # tsx --test test/*.test.ts（70 个用例）
```

## 关键设计

### 1. CSS Tokenizer / Parser

**无第三方依赖**，纯手写 tokenizer 按字符流识别 ident、number、dimension、percentage、hash、string、at-keyword、pseudo、各种 bracket/combinator，遇到注释和 whitespace 直接跳过。Parser 维护一个 token 索引指针，`parseRuleList` 里用"向前看一个冒号"的启发式区分 `Declaration`（`prop: value;`）和 `Rule`（`selector { ... }`），因此一个函数就同时支持顶层 stylesheet 和 rule body 里的混合声明/嵌套规则。

`AtRule` 区分两种形态：带 block 的（`@media`、`@keyframes`）和不带 block 的（`@import`、`@charset`）。`splitTopLevel` 负责在逗号切分 selector 列表时跳过括号深度和字符串内容。

### 2. Selector 解析 + BOF 匹配

**Selector AST** 分三层：`SelectorList`（逗号分隔）→ `ComplexSelector`（空格/`>`/`+`/`~` 分隔）→ `CompoundSelector`（tag、id、class、attribute、pseudo 的合集）。

**BOF（Bottom-Up Matching）原理**：匹配从**最右侧 compound** 开始（它必须直接命中当前节点），然后向左回溯——对每个前序 compound，根据 combinator 决定候选范围：

| Combinator | 候选来源 |
|---|---|
| descendant (空格) | 所有祖先 |
| child (`>`) | 直接 parent |
| adjacent (`+`) | 前一个兄弟 |
| sibling (`~`) | 所有前方兄弟 |

候选集合中**只要有一个命中前序 compound** 就继续向上回溯；整条链走通返回 `true`，任意一步候选为空返回 `false`。这样写天然符合"左结合"的直觉，且对每个节点只向上爬 O(depth)，不会多做无意义匹配。

Pseudo-class 覆盖 `:first-child`、`:last-child`、`:nth-child(an+b)`、`:only-child`（基于运行时维护的 `index` 和 `parent`）；attribute selector 支持 presence / `=` / `~=` / `\|=` / `^=` / `$=` / `*=`，并正确处理 `class` 和 `id` 这两个"属性名 ≠ DOM 字段名"的特例。

### 3. Cascade 层叠

**Specificity 四元组** `[inline, id, class+attr+pseudo, tag+pseudo-element]` 直接按 CSS 规范累积：`#x` 加 `[0,1,0,0]`，`.a` / `[attr]` / `:hover` 加 `[0,0,1,0]`，`div` 加 `[0,0,0,1]`。SelectorList 用逗号分隔时取**每个 selector 最大的**那个。

**层叠排序**只按一个稳定排序：`!important` 升序（非 important 在前）→ specificity 升序（低在前）→ 源码顺序升序。之后依次 `Map.set(property, declaration)`，后 set 的自然覆盖前 set 的——这样一条排序就同时处理了 specificity 和源码位置两个维度，而且 inline `!important` 最后 set 进去直接覆盖所有 stylesheet 声明，逻辑一目了然。

`collectCascadable` 会把所有匹配某个节点的 declaration 收集起来，同时记录每个 rule 嵌套的祖先 selector（用 descendant combinator 拼接），所以 `@media` 内部或嵌套 rule 的 selector 也能正确被匹配。

### 4. 盒模型

**content-box vs border-box**：width 在 content-box 里直接作为内容宽度，在 border-box 里减去 padding 和 border 后才是内容宽度。百分比基于 `parentWidth`（调用方在构建 Box 树时填充），margin 不计入 border-box 但计入 marginBoxWidth/Height。

`parseShorthand` 支持 padding/margin/border-width 的 1/2/3/4 值简写：`8px` → 四边 8px；`4px 8px` → 上下 4 左右 8；`1px 2px 3px` → 上 1、左右 2、下 3；`1 2 3 4` → 顺时针。

`computeBoxTree` 递归构建 Box 树，每个节点的 style 从 `resolveStyle(node, stylesheet)` 里取，再交给 LayoutContext 处理百分比。

### 5. Flex 布局

完整实现 Flex 的三步 pipeline：

1. **分行（wrap）**：按 `flex-basis + margin` 累加，超过容器主轴尺寸时断行。
2. **主轴空间分配**：先算 `flex-grow` 分配剩余空间，再算 `flex-shrink` 按 `basis * shrink` 加权分摊 deficit。`flex: none / auto / <g> / <g> <s> <b>` 四种简写全覆盖。
3. **主轴定位 + 交叉轴对齐**：`justify-content` 六种模式统一用 `(start, step)` 模型，`align-items` / `align-self` 覆盖 `flex-start / flex-end / center / stretch`（stretch 时交叉尺寸拉满剩余空间）。`order` 重排在构建行时一次完成，`row-reverse / column-reverse` 通过坐标翻转实现。

## 对应章节

- [10.1 从输入 URL 到页面呈现](../10-browser-rendering.md#_10-1-从输入-url-到页面呈现)：CSSOM 构建与渲染流水线
- [10.2 渲染流程与重排重绘](../10-browser-rendering.md#_10-2-渲染流程与重排重绘)：Style / Layout / Paint 的阶段划分

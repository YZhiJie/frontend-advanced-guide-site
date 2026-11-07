# EP.12 CSS 工程化

> 对应正文：[12-css-engineering.md](../12-css-engineering.md)（12.1 现代布局体系 / 12.3 设计令牌与主题系统 / 12.4 CSS 性能优化）· 示例：`examples/12-11-box-model-margin.html`、`examples/12-02-container-query.html`、`examples/12-07-theme-toggle.html`、`examples/12-08-typed-tokens.ts`

## 剧情回顾

- **第 1 格**：标签君的卡片组件放进侧边栏就变形——媒体查询只看视口，不看容器。
- **第 2 格**：码叔揭秘容器查询：组件跟随自己的容器自适应，放哪都对。
- **第 3 格**：像素酱实证设计令牌：颜色间距收敛成 CSS 变量，切主题就是换 `data-theme`。
- **第 4 格**：码叔结案——盒模型定实占宽度（content-box 260 vs border-box 200），上下 margin 相邻取大合并，flex/grid 子项免疫。

## 知识点拆解

### 第 1 格 · 媒体查询的盲区

```css
@media (max-width: 768px) { ... }
/* 视口 1200px 时永远不生效 —— 哪怕组件在 300px 的侧栏里 */
```

- 响应式断点绑定了「页面」而不是「组件」，组件失去可复用性；
- 布局一改（侧栏宽度、分栏数），所有断点都要跟着调。

### 第 2 格 · 容器查询（Container Queries）

```css
.wrap { container-type: inline-size; }
@container (max-width: 400px) {
  .card { flex-direction: column; }
}
```

- 组件对**自己的容器宽度**做出响应，与页面布局解耦；
- 配合 Grid（`repeat(auto-fit, minmax(...))`）实现真正的组件级响应式；
- 这是设计系统组件「放哪都对」的基石。

### 第 3 格 · 设计令牌与主题

```css
:root { --brand: #7c3aed; }
[data-theme='dark'] { --brand: #22d3ee; }
```

- 令牌是**命名过的设计决策**：颜色、间距、圆角、字号全部变量化；
- 主题切换 = 换一组变量值，组件代码零改动；
- 进阶：TypeScript 类型化令牌（`examples/12-08-typed-tokens.ts`）让拼写错误在编译期暴露。

### 第 4 格 · 盒模型与外边距合并（画面已画对照）

- **盒模型**：`content-box`（W3C 标准，`width` 只含内容区——`width:200; padding:20; border:10` 实占 **260px**，第 4 格上条）vs `border-box`（IE 怪异盒，width 含 padding+border，实占恒为 **200px**，下条）；reset 全局设 `box-sizing: border-box`，组件宽度才等于"最终占位"；
- **外边距合并**：普通块级盒子**垂直方向**相邻 margin 取 `max()`（30px 遇 20px 只得 30px）；父元素无 border/padding/BFC 时首子 `margin-top` **穿透**到父级；空块自我合并；
- **隔断手段**：`display: flow-root`（首选）、1px border/padding、`overflow: hidden` 建 BFC；**flex / grid 子项天然不合并**——这也是现代布局间距更直觉的原因；
- 像素级交互实验：`examples/12-11-box-model-margin.html`（含三种穿透修法开关）。

### 附 · CSS 性能速记

- 选择器**从右往左**匹配：嵌套越深回溯越多，两层以内足矣；
- `content-visibility: auto` 跳过屏外元素的布局与绘制，长页面渲染成本骤降；
- 必须配 `contain-intrinsic-size` 给出占位高度，否则滚动条乱跳（正文 12.4）。

## 坑点清单

> 🔗 正文对照：[《12.6 本章避坑清单》](../12-css-engineering#_12-6-本章避坑清单)

1. 选择器嵌套越深越「精确」是错觉：匹配更慢、权重更高、复用更难；
2. 魔法数字乱飞（`padding: 13px`、`#7c3aed` 到处复制）：没有令牌就没有一致性；
3. `content-visibility` 不给 `contain-intrinsic-size`：屏外元素高度为 0，滚动条疯狂跳动。

## 自测 3 题（含答案）

1. 容器查询和媒体查询的区别？——**媒体查询看视口，容器查询看组件所在容器的尺寸，组件级自适应**。
2. 主题切换为什么推荐 CSS 变量而不是两套样式表？——**变量切换零组件改动、无闪烁、可局部作用域，成本低且可组合**。
3. `content-visibility: auto` 为什么要配 `contain-intrinsic-size`？——**屏外元素被跳过渲染后高度为 0，占位尺寸让滚动条与布局保持稳定**。

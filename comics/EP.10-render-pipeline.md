# EP.10 浏览器渲染流水线

> 对应正文：[10-browser-rendering.md](../10-browser-rendering.md)（10.1 从输入 URL 到页面呈现 / 10.2 渲染流程与重排重绘 / 10.3 渲染性能优化实战 / 10.4 高性能虚拟列表）· 示例：`examples/10-05-critical-render-path.html`、`examples/10-01-layout-thrashing.js`、`examples/10-02-raf-scroll.ts`

## 剧情回顾

- **第 1 格**：标签君在 onScroll 里高频改 width，每次都触发重排，60fps 根本来不及。
- **第 2 格**：码叔揭秘完整渲染流水线：先建树（HTML→DOM、CSS→CSSOM→渲染树），再 Style → Layout → Paint → Composite，越靠后越便宜。
- **第 3 格**：像素酱实证——改 `left` 触发 Layout，改 `transform` 只走 Composite。
- **第 4 格**：码叔结案——读写交错造成布局抖动，rAF 里先批量读、再批量写。

## 知识点拆解

### 第 1 格 · 帧预算 16.7ms

- 60fps 意味着每帧只有约 16.7ms，主线程被长任务占满就掉帧；
- onScroll/resize 是高频事件，里面改几何样式 = 高频重排；
- 重排代价：重新计算布局树，大页面上一次就是几十毫秒。

### 第 2 格 · 从建树到上屏的完整流水线

首次渲染要先"建树"，然后才是更新阶段的四步管线：

```
HTML 字节 → 分词解析 → DOM 树  ┐
                              ├→ 渲染树（只含可见节点）→ Style → Layout → Paint → Composite
CSS 字节 → 解析层叠 → CSSOM 树 ┘
```

- **DOM 边解析边构建**：普通 `<script>` 会中断解析（JS 阻塞解析），`defer/async` 可绕过；阻塞期间预加载扫描器会提前预取后续外链资源；
- **CSS 阻塞渲染但不阻塞解析**：CSSOM 没算完浏览器宁可白屏也不画（避免无样式闪烁）；
- **渲染树取舍**：`display:none` 不进渲染树（不占位），`visibility:hidden` 保留盒子（占位不可见）；
- 建树之后进入更新管线：**改几何**（width/top）走完全程，**改外观**（color）跳过 Layout，**只改合成属性**（transform/opacity）跳过前三步。
- 可观测实验：`examples/10-05-critical-render-path.html` 打开即输出 head 脚本读 DOM 为 null、display/visibility 占位差异等实测数据。

### 第 3 格 · transform 与合成层

```js
box.style.left = x + 'px';                    // ❌ 重排
box.style.transform = `translateX(${x}px)`;   // ✅ 合成
```

- `transform`/`opacity` 由 GPU 在合成阶段处理，不占主线程；
- `will-change: transform` 提前提升为合成层，动画启动更稳（滥用会内存暴涨）；
- 动画/位移/缩放场景一律优先 transform。

### 第 4 格 · 布局抖动与 rAF

```js
// ❌ 读写交错：每次读都强制同步布局
for (const el of els) {
  const h = el.offsetHeight;   // 读
  el.style.height = h + 1;     // 写 → 下一行读又失效
}
// ✅ 先批量读，再批量写（rAF 内）
```

- **布局抖动（layout thrashing）**：读（触发同步 Layout）→ 写（使缓存失效）→ 再读……
- 解决：同一帧内**先批量读、后批量写**，用 rAF 对齐渲染节奏；
- 长列表滚动掉帧的另一条路：全量 DOM → 虚拟列表只渲染可视区。

## 坑点清单

> 🔗 正文对照：[《10.8 本章避坑清单》](../10-browser-rendering#_10-8-本章避坑清单)

1. 循环里读写交错：每次读 offsetHeight 都强制同步布局，页面直接卡死；
2. 用 top/left/width 做动画：每帧重排，换 transform 后帧率立刻起飞；
3. 万级数据全量渲染 DOM：内存和重排都扛不住，虚拟列表是正解。

## 自测 3 题（含答案）

1. 重排和重绘的区别？哪个更贵？——**重排重新计算几何（必然引发重绘），重绘只重新画像素不改布局；重排更贵**。
2. 哪些 CSS 属性只走 Composite？——**transform、opacity（部分场景含 filter），不触发布局与绘制**。
3. 什么是布局抖动？怎么解决？——**读写交错导致每次读都强制同步布局；同一帧内先批量读、再批量写，用 rAF 对齐**。

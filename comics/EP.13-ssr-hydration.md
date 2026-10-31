# EP.13 SSR 与水合

> 对应正文：[13-ssr-meta-frameworks.md](../13-ssr-meta-frameworks.md)（13.1 渲染模式全景 / 13.2 Hydration 原理与疑难排查）· 示例：`examples/13-01-ssr-manual.ts`、`examples/13-02-hydration-safe.tsx`

## 剧情回顾

- **第 1 格**：标签君的 CSR 页面首屏白屏三秒——HTML 是空壳，全等 JS 下载执行。
- **第 2 格**：码叔揭秘渲染模式全景：CSR/SSR/SSG/ISR，首屏速度依次 SSG ≈ ISR > SSR > CSR。
- **第 3 格**：像素酱实证水合：JS 接管服务端 HTML 并挂事件，两端结果必须一致。
- **第 4 格**：码叔结案——流式 SSR 分块送达、选择性水合让交互区先可用。

## 知识点拆解

### 第 1 格 · CSR 的白屏根源

```html
<div id="root"></div>  <!-- 首个响应只有空壳 -->
```

- 用户要等：HTML → JS 下载 → JS 执行 → 渲染，四步全串行；
- SEO 也不友好：爬虫拿到的是空壳；
- 解法：把「渲染」提前到服务端做。

### 第 2 格 · 渲染模式全景

- **CSR**：客户端渲染，适合重交互后台；
- **SSR**：每请求服务端渲染，内容始终新鲜，服务器有压力；
- **SSG**：构建时产出静态 HTML，CDN 直接回，最快；
- **ISR**：SSG + 按需/定时再生成，兼顾新鲜与快（Next.js `revalidate`）。

### 第 3 格 · 水合（Hydration）

- 服务端 HTML 先到（**用户立刻能看**），客户端 JS 再「接管」：复用 DOM、挂事件、绑定状态；
- 接管时客户端必须渲染出**与 HTML 完全一致**的结构，否则抛 hydration mismatch；
- 三大 mismatch 元凶：`new Date()`（两端时间不同）、`Math.random()`、`localStorage`（服务端不存在）；
- 修法：时间/随机值由服务端下发或两端统一，浏览器专属值放到 `mounted`/`useEffect` 之后再渲染。

### 第 4 格 · 流式与选择性水合

- **流式 SSR**：`renderToPipeableStream` 分块推送，先到的先渲染，不用等全页就绪；
- **选择性水合**：交互优先——用户点哪块，哪块先水合，其余排队；
- RSC（服务端组件）进一步把「不交互的部分」留在服务端，客户端 JS 体积骤减。

## 坑点清单

> 🔗 正文对照：[《13.6 本章避坑清单》](../13-ssr-meta-frameworks#_13-6-本章避坑清单)

1. hydration mismatch：时间/随机/localStorage 导致两端渲染不一致，控制台报错且整树重建；
2. 水合完成前直接操作 DOM（或第三方插件改 DOM）：水合时结构对不上，轻则重渲染重则崩溃；
3. 在服务端组件/SSR 环境里用 `window`/`document`：服务端没有这些对象，直接 ReferenceError。

## 自测 3 题（含答案）

1. CSR/SSR/SSG/ISR 怎么选？——**重交互后台选 CSR；内容新鲜度高的选 SSR；内容基本静态选 SSG；静态为主但需定时更新选 ISR**。
2. 什么是 hydration mismatch？举两个常见诱因？——**客户端接管时渲染结果与服务端 HTML 不一致；诱因如 new Date() 两端时间不同、localStorage 服务端不存在**。
3. 流式 SSR 的好处？——**HTML 分块推送，先就绪先展示；配合选择性水合，用户交互的区域优先变得可交互**。

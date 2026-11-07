# EP.69 让 Google 搜到你的站

> 对应正文：[95-nextjs-google-seo.md](../95-nextjs-google-seo.md)（95.1 渲染策略 / 95.2 Metadata / 95.3 sitemap+JSON-LD / 95.4 CWV）· 示例：`examples/95-01-nextjs-google-seo.ts`

## 剧情回顾

- **第 1 格**：海外站点 Google 搜不到——CSR 渲染爬虫拿不到内容。
- **第 2 格**：码叔揭秘渲染策略与 Metadata——SEO 页面用 SSG/SSR/ISR，写对 title/description/OG。
- **第 3 格**：像素酱实证 sitemap + JSON-LD——让爬虫发现并理解页面。
- **第 4 格**：码叔结案——Core Web Vitals 达标直接影响搜索排名。

## 知识点拆解

### 第 1 格 · CSR 不利于 SEO

- 纯客户端渲染的页面，爬虫拿到的是空 HTML；
- Googlebot 虽能执行 JS，但不稳定且慢；
- 需要 SEO 的页面必须服务端渲染（SSG/SSR/ISR）。

### 第 2 格 · 渲染策略与 Metadata

- SSG（构建时）/ SSR（请求时）/ ISR（定时重建）/ CSR（客户端）；
- Metadata：title<60字符，description 50-160字符，OG image 1200×630。

### 第 3 格 · sitemap 与 JSON-LD

- `sitemap.xml` 列出所有 URL，`robots.txt` 指向它；
- JSON-LD 结构化数据（Article/Product/FAQPage）让搜索结果展示富片段。

### 第 4 格 · Core Web Vitals

- LCP<2.5s、CLS<0.1、INP<200ms 为 Good；
- 三项直接影响 Google 搜索排名。

## 坑点清单

> 🔗 正文对照：[《95.7 本章避坑清单》](../95-nextjs-google-seo#_95-7-本章避坑清单)

1. 用 CSR 做 SEO 页面 → 用 SSG/SSR/ISR；
2. title 超 60 字符被截断 → 控制长度；
3. 图片加载后布局跳动（CLS）→ 固定宽高。

## 自测 3 题（含答案）

1. 需要 SEO 的页面该用哪种渲染策略？——**SSG/SSR/ISR，不能用纯 CSR**。
2. JSON-LD 结构化数据有什么用？——**让 Google 理解页面语义，搜索结果展示富片段（FAQ、评分等）**。
3. Core Web Vitals 三个指标的 Good 阈值？——**LCP<2.5s, CLS<0.1, INP<200ms**。

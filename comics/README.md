# 🎬 进阶漫画剧场 · 霓虹墨 Neon Ink

> 把专题画成 59 话四格漫画：每话一幅 **1200×840 SVG 原画** + 一篇**讲解 MD**（剧情回顾 / 知识点拆解 / 坑点清单 / 自测题）。
> 视觉体系：深墨底 + 霓虹青/紫/品红 + 斜切光楔；三角色——**像素酱**（提问担当）、**标签君**（行动派）、**码叔**（教授总结）。规范见 [style-guide.md](./style-guide.md)，定妆稿见 [samples/character-sheet.svg](./samples/character-sheet.svg)。

## 📖 一键阅读（整合阅读器）

打开 <a href="/comics/index.html" target="_blank" rel="noopener">index.html</a>（需经本地 HTTP 服务访问，命令见文末「本地预览」），在封面点击「一键打开完整漫画」即可：

- 按 `manifest.json` 组织全部 **59 话**资源（SVG 内联，矢量无损缩放）；
- **翻页 / 长卷双模式**：默认翻页模式一话一屏（←/→ 键盘、两侧悬停大按钮、顶部计数器、按需加载并预取相邻话），点「📜 长卷」或按 `M` 切换到全文连续滚动；
- **讲解抽屉**：每话「📖 讲解」按钮从右侧滑出知识点拆解，`Esc` 关闭、抽屉内 ←/→ 或底部导航切换上下篇、`md` 按钮新窗口打开原始文件；
- **阅读进度记忆**：自动记住话与位置，下次封面出现「继续阅读」；
- **章节导航**：当前话自动高亮、已读绿点标记；桌面固定侧栏，移动端抽屉目录；
- **话目网格**：点顶部 `⊞` 或按 `G` 打开全部话目卡片，支持关键词（话号 / 标题）即时筛选与「按分册」下拉跳转，卡片标出已读 ✓ 与当前话，点击直达；
- **错误处理**：单话加载失败显示独立错误卡片并可单独重试，不影响其他话。

## 建议读法

1. 先看原画 SVG（浏览器直接打开），跟着剧情把概念"看见"；
2. 再读同 slug 的讲解 MD，把每一格落成可运行的机制与代码；
3. 最后点开"正文"与"示例"链接，回到本项目主线深读并亲手跑一遍。

## 目录

| 话 | 主题 | 原画 | 讲解 | 对应正文 |
| ---- | ---- | ---- | ---- | ---- |
| EP.01 | 闭包与事件循环 | [SVG](./EP.01-closure-and-event-loop.svg) | [MD](./EP.01-closure-and-event-loop.md) | [01 JavaScript 高级](../01-javascript-advanced.md) |
| EP.02 | TypeScript 类型体操 | [SVG](./EP.02-type-gymnastics.svg) | [MD](./EP.02-type-gymnastics.md) | [02 TypeScript](../02-typescript.md) |
| EP.03 | 工程化与摇树优化 | [SVG](./EP.03-tree-shaking-build.svg) | [MD](./EP.03-tree-shaking-build.md) | [03 工程化](../03-engineering.md) |
| EP.04 | React Fiber 与 Vue 响应式 | [SVG](./EP.04-fiber-and-reactivity.svg) | [MD](./EP.04-fiber-and-reactivity.md) | [04 框架](../04-frameworks.md) |
| EP.05 | 状态管理思想 | [SVG](./EP.05-state-management.svg) | [MD](./EP.05-state-management.md) | [05 状态管理](../05-state-management.md) |
| EP.06 | HTTP 缓存与竞态 | [SVG](./EP.06-http-cache-and-race.svg) | [MD](./EP.06-http-cache-and-race.md) | [06 网络](../06-network.md) |
| EP.07 | XSS 与 CSRF 攻防 | [SVG](./EP.07-xss-csrf-defense.svg) | [MD](./EP.07-xss-csrf-defense.md) | [07 安全](../07-security.md) |
| EP.08 | JSBridge 与跨端 | [SVG](./EP.08-jsbridge-hybrid.svg) | [MD](./EP.08-jsbridge-hybrid.md) | [08 跨端](../08-cross-platform.md) |
| EP.09 | 测试金字塔 | [SVG](./EP.09-testing-pyramid.svg) | [MD](./EP.09-testing-pyramid.md) | [09 测试](../09-testing.md) |
| EP.10 | 浏览器渲染流水线 | [SVG](./EP.10-render-pipeline.svg) | [MD](./EP.10-render-pipeline.md) | [10 浏览器渲染](../10-browser-rendering.md) |
| EP.11 | 设计模式实战 | [SVG](./EP.11-design-patterns.svg) | [MD](./EP.11-design-patterns.md) | [11 模式与架构](../11-patterns-architecture.md) |
| EP.12 | CSS 工程化 | [SVG](./EP.12-css-engineering.svg) | [MD](./EP.12-css-engineering.md) | [12 CSS 工程化](../12-css-engineering.md) |
| EP.13 | SSR 与水合 | [SVG](./EP.13-ssr-hydration.svg) | [MD](./EP.13-ssr-hydration.md) | [13 SSR](../13-ssr-meta-frameworks.md) |
| EP.14 | AI 流式 UI | [SVG](./EP.14-ai-streaming-ui.svg) | [MD](./EP.14-ai-streaming-ui.md) | [14 前端 AI](../14-frontend-ai.md) |
| EP.15 | 可访问性与语义化 | [SVG](./EP.15-a11y-semantic.svg) | [MD](./EP.15-a11y-semantic.md) | [15 可访问性](../15-accessibility-i18n.md) |
| EP.16 | Node 流与背压 | [SVG](./EP.16-node-stream-backpressure.svg) | [MD](./EP.16-node-stream-backpressure.md) | [16 Node 服务端](../16-node-server.md) |
| EP.17 | Web 新能力 | [SVG](./EP.17-web-platform.svg) | [MD](./EP.17-web-platform.md) | [17 Web 平台](../17-web-platform.md) |
| EP.18 | Worker 家族与跨 Tab | [SVG](./EP.18-worker-family.svg) | [MD](./EP.18-worker-family.md) | [18 Worker 通信](../18-worker-messaging.md) |
| EP.19 | 业务片段百宝箱 | [SVG](./EP.19-business-snippets.svg) | [MD](./EP.19-business-snippets.md) | [19 业务片段](../19-business-snippets.md) |
| EP.20 | SSE 流式传输 | [SVG](./EP.20-sse-streaming.svg) | [MD](./EP.20-sse-streaming.md) | [21 前端 AI 面试](../21-frontend-ai-interview.md) |
| EP.21 | 打字机渲染 | [SVG](./EP.21-typewriter-render.svg) | [MD](./EP.21-typewriter-render.md) | [21 前端 AI 面试](../21-frontend-ai-interview.md) |
| EP.22 | AI 客服系统 | [SVG](./EP.22-ai-cs-system.svg) | [MD](./EP.22-ai-cs-system.md) | [21 前端 AI 面试](../21-frontend-ai-interview.md) |
| EP.23 | MCP 协议 | [SVG](./EP.23-mcp-protocol.svg) | [MD](./EP.23-mcp-protocol.md) | [21 前端 AI 面试](../21-frontend-ai-interview.md) |
| EP.24 | Markdown 增量渲染 | [SVG](./EP.24-markdown-incremental.svg) | [MD](./EP.24-markdown-incremental.md) | [21 前端 AI 面试](../21-frontend-ai-interview.md) |
| EP.25 | WebSocket 实时渲染 | [SVG](./EP.25-websocket-render.svg) | [MD](./EP.25-websocket-render.md) | [21 前端 AI 面试](../21-frontend-ai-interview.md) |
| EP.26 | 栈与队列 | [SVG](./EP.26-ds-stack-queue.svg) | [MD](./EP.26-ds-stack-queue.md) | [22 数据结构](../22-frontend-data-structures.md) |
| EP.27 | 链表指针舞 | [SVG](./EP.27-ds-linked-list.svg) | [MD](./EP.27-ds-linked-list.md) | [22 数据结构](../22-frontend-data-structures.md) |
| EP.28 | 哈希表一秒定位 | [SVG](./EP.28-ds-hash-table.svg) | [MD](./EP.28-ds-hash-table.md) | [22 数据结构](../22-frontend-data-structures.md) |
| EP.29 | 二叉搜索树 | [SVG](./EP.29-ds-tree.svg) | [MD](./EP.29-ds-tree.md) | [22 数据结构](../22-frontend-data-structures.md) |
| EP.30 | 图与堆 | [SVG](./EP.30-ds-graph-heap.svg) | [MD](./EP.30-ds-graph-heap.md) | [22 数据结构](../22-frontend-data-structures.md) |
| EP.31 | 排序大比武 | [SVG](./EP.31-ds-sorting.svg) | [MD](./EP.31-ds-sorting.md) | [22 数据结构](../22-frontend-data-structures.md) |
| EP.32 | 动态规划五步法 | [SVG](./EP.32-ds-dp.svg) | [MD](./EP.32-ds-dp.md) | [22 数据结构](../22-frontend-data-structures.md) |
| EP.33 | 描述符·Proxy 与现代 ES | [SVG](./EP.33-descriptor-proxy-iterator.svg) | [MD](./EP.33-descriptor-proxy-iterator.md) | [01 JavaScript 高级](../01-javascript-advanced.md) |
| EP.34 | JS 高频面试题通关 | [SVG](./EP.34-js-high-frequency-interview.svg) | [MD](./EP.34-js-high-frequency-interview.md) | [23 JS 高频面试题](../23-js-high-frequency-interview.md) |
| EP.35 | 正则高级用法通关 | [SVG](./EP.35-regex-advanced.svg) | [MD](./EP.35-regex-advanced.md) | [01 JavaScript 高级](../01-javascript-advanced.md) |
| EP.36 | 生成器高阶模式 | [SVG](./EP.36-generator-advanced.svg) | [MD](./EP.36-generator-advanced.md) | [01 JavaScript 高级](../01-javascript-advanced.md) |
| EP.37 | AI 协作工程化 | [SVG](./EP.37-ai-collaboration.svg) | [MD](./EP.37-ai-collaboration.md) | [24 AI 协作工程化](../24-ai-collaboration.md) |
| EP.38 | vdom diff 里的 key 魔法 | [SVG](./EP.38-vdom-diff-key.svg) | [MD](./EP.38-vdom-diff-key.md) | [27 手写前端框架](../27-mini-framework.md) |
| EP.39 | Proxy 里偷偷收集依赖 | [SVG](./EP.39-proxy-reactivity.svg) | [MD](./EP.39-proxy-reactivity.md) | [27 手写前端框架](../27-mini-framework.md) |
| EP.40 | Fiber 为啥长这样 | [SVG](./EP.40-fiber.svg) | [MD](./EP.40-fiber.md) | [27 手写前端框架](../27-mini-framework.md) |
| EP.41 | AST 里藏了啥 | [SVG](./EP.41-ast-mini-bundler.svg) | [MD](./EP.41-ast-mini-bundler.md) | [27 手写前端框架](../27-mini-framework.md) |
| EP.44 | HTTP 报文那七行字 | [SVG](./EP.44-http-parser.svg) | [MD](./EP.44-http-parser.md) | [26 手写网络栈](../26-mini-network-stack.md) |
| EP.45 | fetch 背后那个 URL 对象 | [SVG](./EP.45-mini-fetch.svg) | [MD](./EP.45-mini-fetch.md) | [26 手写网络栈](../26-mini-network-stack.md) |
| EP.46 | SSE 那三种冒号 | [SVG](./EP.46-mini-sse.svg) | [MD](./EP.46-mini-sse.md) | [26 手写网络栈](../26-mini-network-stack.md) |
| EP.47 | CSS 字符串变盒子 | [SVG](./EP.47-mini-css-parser.svg) | [MD](./EP.47-mini-css-parser.md) | [28 手写浏览器内核](../28-mini-browser-engine.md) |
| EP.48 | .a .b 为啥慢 | [SVG](./EP.48-mini-selector.svg) | [MD](./EP.48-mini-selector.md) | [28 手写浏览器内核](../28-mini-browser-engine.md) |
| EP.49 | flex 主轴交叉轴那点事 | [SVG](./EP.49-mini-flex-layout.svg) | [MD](./EP.49-mini-flex-layout.md) | [28 手写浏览器内核](../28-mini-browser-engine.md) |
| EP.50 | 响应式的流思维 | [SVG](./EP.50-rxjs-stream.svg) | [MD](./EP.50-rxjs-stream.md) | [29 RxJS 响应式编程](../29-rxjs.md) |
| EP.51 | 数据变换瑞士军刀 | [SVG](./EP.51-lodash-toolbelt.svg) | [MD](./EP.51-lodash-toolbelt.md) | [30 Lodash 工具库实战](../30-lodash.md) |
| EP.52 | 表格那三层模型 | [SVG](./EP.52-xlsx-table-io.svg) | [MD](./EP.52-xlsx-table-io.md) | [31 XLSX 表格工程](../31-xlsx.md) |
| EP.53 | 日期那点不精确的事 | [SVG](./EP.53-dayjs-date.svg) | [MD](./EP.53-dayjs-date.md) | [32 Day.js 日期工程](../32-dayjs.md) |
| EP.54 | 运行时那道边界墙 | [SVG](./EP.54-zod-boundary.svg) | [MD](./EP.54-zod-boundary.md) | [33 Zod 运行时校验](../33-zod.md) |
| EP.55 | 角色不是权限 | [SVG](./EP.55-rbac-model.svg) | [MD](./EP.55-rbac-model.md) | [35 后台管理系统权限方案](../35-admin-system-auth.md) |
| EP.56 | 路由那道门卫 | [SVG](./EP.56-dynamic-route.svg) | [MD](./EP.56-dynamic-route.md) | [35 后台管理系统权限方案](../35-admin-system-auth.md) |
| EP.57 | 销毁还是隐藏 | [SVG](./EP.57-permission-directive.svg) | [MD](./EP.57-permission-directive.md) | [35 后台管理系统权限方案](../35-admin-system-auth.md) |
| EP.58 | 一个账号，全家通行 | [SVG](./EP.58-unified-account-center.svg) | [MD](./EP.58-unified-account-center.md) | [44 多系统统一账号中心](../44-account-center.md) |
| EP.59 | 错误捕获四张网 | [SVG](./EP.59-error-catching.svg) | [MD](./EP.59-error-catching.md) | [46 前端错误捕获处理方案](../46-error-handling.md) |
| EP.60 | 密钥零泄漏防线 | [SVG](./EP.60-secrets-zero-leak.svg) | [MD](./EP.60-secrets-zero-leak.md) | [47 企业级密钥管理与零泄漏方案](../47-secrets-management.md) |
| EP.61 | 依赖供应链暗门 | [SVG](./EP.61-dependency-supply-chain.svg) | [MD](./EP.61-dependency-supply-chain.md) | [66 第三方依赖治理与高危漏洞修复](../66-dependency-governance.md) |

## 目录结构

```
comics/
├── index.html                # 整合阅读器（翻页/长卷双模式 + 讲解抽屉 + 导航 + 话目网格 + 进度记忆）
├── style-guide.md            # 霓虹墨风格规范（唯一视觉标准）
├── samples/
│   └── character-sheet.svg   # 三角色定妆稿 v2
├── manifest.json             # 59 话清单（校验脚本的依据）
├── check-comics.mjs          # 校验：manifest 一致性 + parts 映射双向一致 + SVG 良构 + 文本溢出启发式
├── EP.NN-*.svg               # 每话原画（1200×840 四格）
└── EP.NN-*.md                # 每话讲解（剧情/拆解/坑点/自测）
```

## 本地预览

```bash
cd frontend-advanced-guide
python3 -m http.server 8899
# 整合阅读器（推荐）：http://127.0.0.1:8899/comics/index.html
# 单话原画直开：http://127.0.0.1:8899/comics/EP.01-closure-and-event-loop.svg
```

> 阅读器依赖 `fetch` 合并资源，`file://` 直开会被浏览器拦截，页面会给出上述启动提示。

## 校验

```bash
node comics/check-comics.mjs
```

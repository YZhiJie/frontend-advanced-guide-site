# case 13：最小 SSR 与岛屿 hydration 协议

不引 React/Vue、不依赖 DOM，用纯 Node 手写一条最小「服务端渲染 → 交付静态 HTML + 岛屿清单 → 客户端按清单 hydration」的链路：`renderToString` 递归渲染并做 HTML 转义，把 `island: true` 的子树降级为 `data-island-id` 占位节点并收集岛屿描述，`hydrateIslands` 再按清单把注册表里的组件挂载到占位节点。

## 目录结构

```
13-ssr-island-lab/
├── package.json
├── tsconfig.json
├── src/
│   ├── vnode.ts       # h + escapeHtml + renderToString / renderPage + 岛屿清单收集
│   └── hydrate.ts     # hydrateIslands：按清单挂载，注册表与宿主查找均可注入
├── test/
│   └── ssr-island.test.ts   # 转义/XSS、岛屿占位、hydration 行为回归
└── README.md
```

## 运行

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # tsx --test test/*.test.ts（20 个用例）
```

## 关键设计

- **HTML 转义表**：`& < > " '` 五类字符统一转义（`&amp; &lt; &gt; &quot; &#39;`），文本内容与属性值都过一遍，杜绝 `<script>` 注入与属性逃逸。
- **岛屿边界标记**：props 里 `island: true` 即岛屿；服务端不渲染其子树，只输出 `<div data-island-id="...">` 占位，并把 `{ id, name, props }` 收进清单。
- **稳定编号**：自动 id 按遍历顺序产出 `island-0`、`island-1`，可用 `islandId` 显式覆盖，保证多次渲染结果确定。
- **职责划分**：服务端只交付「静态 HTML + 岛屿清单」，客户端只按清单挂载——因此非岛屿节点天然不会被 hydration，避免「无差别全量 hydrate」的浪费。
- **可注入**：注册表与占位节点查找函数都是参数，测试用 spy 断言挂载次数、props 原样透传（同一引用）、以及跳过/报错策略（`requireAll`）。

## 对应章节

- [13.1 渲染模式全景](../13-ssr-meta-frameworks.md#_13-1-渲染模式全景)
- [13.2 Hydration 原理与疑难排查](../13-ssr-meta-frameworks.md#_13-2-hydration-原理与疑难排查)

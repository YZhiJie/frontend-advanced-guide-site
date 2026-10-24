# 示例代码仓库

《高级前端进阶技能指南》全部可独立运行示例的真实存放处，文件路径与文中 `// 文件:` 注释一一对应。

## npx 一键体验（无需克隆仓库）

```bash
npx frontend-advanced-guide-examples list        # 列出全部 140 个示例（按册分组）
npx frontend-advanced-guide-examples run 01-03   # 运行指定示例（编号前缀匹配）
npx frontend-advanced-guide-examples pick        # 随机抽一个跑（学习模式）
```

> 简写别名 `fag-examples` 同样可用；示例经 `npx tsx` 执行，首次运行自动下载。

## 本地运行（克隆仓库后）

```bash
npm install
npx tsx 01-03-closure-wallet.ts     # 运行任意纯 Node 示例
npx tsx 02-08-decorators.ts         # 装饰器示例(已配置 experimentalDecorators)
npx vitest run                      # 运行单元测试(src/utils 的配套测试)
```

> 💡 现代 ES 特性示例（`01-28`/`01-29` 等）含 ES2025/ES2026/ES2027 候选 API，建议使用 **Node 22+**（Node 26 可看到全部 `✓` 输出）；旧版本运行时示例会打印 `○` 特性未实现标记并自动走降级分支，不影响其余演示。

## 目录说明

| 前缀 | 内容 | 运行环境 |
| ---- | ---- | -------- |
| 01-xx ~ 11-xx | JS/TS/工程化/框架原理/状态/网络/安全/跨端/测试/浏览器/模式 的示例 | 标注 [浏览器] 的用浏览器打开,其余 `npx tsx` 直跑 |
| 01-26 ~ 01-38 | 属性描述符/继承六代演进/Symbol 与集合/ES2022→ES2027 特性总览/Proxy·Reflect/迭代器生成器/错误体系/JSON 深入/提升·this·arguments/Promise 与事件循环陷阱/ES2026·2027 兼容性检测与降级封装/正则高级用法(贪婪惰性·分组·反向引用·四种断言)/生成器高阶模式(yield* 返回值·递归剪枝·throw 注入·洋葱模型) | `npx tsx 01-xx.ts` 直跑,新 API 逐项特性检测,建议 Node 22+/26 |
| 12-xx | CSS 示例(HTML 直接打开) | 浏览器 |
| 13-xx / 14-xx | SSR 与 AI 工程示例 | 部分需 Next.js 项目环境(见文档运行说明) |
| 18-01 ~ 18-05 | Worker 家族与跨 Tab 通信示例(纯静态,零依赖) | 浏览器,**需静态服务器**:`npx serve .` 后打开对应目录的 index.html(file:// 下 Worker 源为 opaque 会失败) |
| 19-01 ~ 19-08 | 常用业务功能片段(表单/输入/列表查询/存储/树/文件/埋点/权限) | `npx tsx 19-xx.ts` 直跑;19-06 的下载剪贴板、19-07 的曝光/委托函数需在浏览器页面中调用 |
| 19-09 | IndexedDB 仓储模式:开库升级/Repository/索引/游标/单事务原子性与回滚(纯静态单 HTML) | 浏览器直接打开 `19-09-indexeddb.html` |
| 23-01 | 第二十三部分配套：手写 Promise.all / allSettled / race / any 四件套（含 AggregateError 特性检测降级） | `npx tsx 23-01-promise-all.ts` 直跑 |
| 24-01 | 第二十四部分配套：AI 协作四阶段最小闭环——契约定义（6 用例 + 3 不变式）→ 故意埋入 AI 典型缺陷的 SSE 解析 v1 → 契约门禁 runner 实证击穿 → 修复版 v2 全绿 | `npx tsx 24-01-ai-collab-contract.ts` 直跑 |
| 46-01 ~ 46-04 | 第四十六部分配套：同步捕获边界（setTimeout 盲区·executor 特例·cause）/ Promise 异步捕获规则（冒泡·rethrow·unhandledrejection）/ 多任务错误编排（all 短路·allSettled·并发池·Saga 补偿）/ 错误治理管线（归一化·分级·指纹聚合·批量上报） | `npx tsx 46-xx.ts` 直跑 |
| 47-01 ~ 47-04 | 第四十七部分配套：密钥泄漏扫描器（模式库·白名单·截断预览）/ 环境配置启动门禁（schema 校验·脱敏快照·冻结配置）/ 日志脱敏器（key 名单 + value 模式·递归·循环引用安全）/ 泄漏应急响应（定级·四步处置单·双密钥并行轮换状态机） | `npx tsx 47-xx.ts` 直跑 |
| 48-01 ~ 48-02 | 第四十八部分配套：跨端选型加权决策（维度权重·敏感性检查）/ Widget/Element 协调与 key 复用 | `npx tsx 48-xx.ts` 直跑 |
| 49-01 ~ 49-02 | 第四十九部分配套：AntD 3→5 API 适配层（visible→open·overlay→menu·message.warn→warning）/ 受控字段二次封装（异步校验竞态·展示时机） | `npx tsx 49-xx.ts` 直跑 |
| 50-01 ~ 50-02 | 第五十部分配套：BLE 帧编解码（CRC-8·分帧·半帧·粘包·噪声跳过）/ 设备重连状态机（指数退避 + jitter + 上限） | `npx tsx 50-xx.ts` 直跑 |
| 51-01 ~ 51-02 | 第五十一部分配套：弹幕按帧预算调度（礼物优先·背压丢弃）/ 聊天管道（幂等去重·滑动窗口限流·重复合并） | `npx tsx 51-xx.ts` 直跑 |
| 52-01 ~ 52-02 | 第五十二部分配套：N+1 查询实证与批量/分片修复 / Cache-Aside（单飞·TTL+jitter·空值缓存·写后失效） | `npx tsx 52-xx.ts` 直跑 |
| 53-01 ~ 53-02 | 第五十三部分配套：Nginx 配置静态检查（尾斜杠·WebSocket 头·SSE buffering·SPA 回退）/ 缓存策略生成（HTML/哈希资源/SW/API） | `npx tsx 53-xx.ts` 直跑 |
| 54-01 ~ 54-04 | 第五十四部分配套：可 seek 迷你时间线（标签·缓动·`<`/`+=`）/ JWT 负载解码与过期检查 / qs 风格查询串往返（嵌套·数组·原型污染防护）/ uuid v4 与 v7（版本位·时间戳还原） | `npx tsx 54-xx.ts` 直跑 |
| 55-01 ~ 55-03 | 第五十五部分配套：splitChunks 分组模拟 / Vite base 解析器 / PostCSS 插件顺序验证 | `npx tsx 55-xx.ts` 直跑 |
| 56-01 ~ 56-02 | 第五十六部分配套：离线优先同步队列（落盘·幂等重放·指数退避·冲突策略·重启恢复）/ 离线包管理器（清单 diff·差量下载·请求拦截·哈希校验回滚） | `npx tsx 56-xx.ts` 直跑 |
| 60-01 ~ 60-03 | 第六十部分配套：能力检测注册表与四级降级决策（native/polyfill/fallback/unsupported）/ 跨浏览器安全日期解析（WebKit 非法格式·进位溢出回验）/ UA 解析→引擎画像→风险清单（iOS 微信·双核浏览器·Safari 日期） | `npx tsx 60-xx.ts` 直跑 |
| src/ + tests/ | 文档 9.2 的被测代码与 Vitest 测试 | `npx vitest run` |
| 03-01-modules/ | ESM/CJS 模块机制对照 | `npx tsx 03-01-modules/esm/main.ts` |
| 13-04-app-router-demo/ | Next.js App Router 示例页 | 需放入 Next.js 项目 |
| ai-interview/ | 第二十一部分配套：SSE 客户端与 Node/Python 服务端、打字机 Hook、MCP Schema 与重试熔断、WebSocket 重连、流式 Markdown | 浏览器示例；mjs 用 `node` 直跑；纯 TS `npx tsx`；Python 需 `pip install fastapi uvicorn` |

# 示例代码仓库

《高级前端进阶技能指南》全部可独立运行示例的真实存放处，文件路径与文中 `// 文件:` 注释一一对应。

## npx 一键体验（无需克隆仓库）

```bash
npx frontend-advanced-guide-examples list        # 列出全部 348 个示例（按册分组）
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
| `deploy/` | 第一百二十七部分配套的**部署配置真身**：`nginx/frontend.conf`、`nginx/container.conf`、`docker/Dockerfile.frontend`、`docker/Dockerfile.bff`、`docker/.dockerignore`、`k8s/{deployment,service,ingress,hpa}.yaml`、`github-actions/deploy.yml`、`static/{vercel.json,netlify.toml,_headers,_redirects,wrangler.toml}` | 静态配置文件，**不参与页内沙箱（Playground）**，也不作为可执行示例；正文以 `// 文件: examples/deploy/...` 单源引用，供直接复制或对照审计 |
| 01-xx ~ 11-xx | JS/TS/工程化/框架原理/状态/网络/安全/跨端/测试/浏览器/模式 的示例 | 标注 [浏览器] 的用浏览器打开,其余 `npx tsx` 直跑 |
| 01-26 ~ 01-38 | 属性描述符/继承六代演进/Symbol 与集合/ES2022→ES2027 特性总览/Proxy·Reflect/迭代器生成器/错误体系/JSON 深入/提升·this·arguments/Promise 与事件循环陷阱/ES2026·2027 兼容性检测与降级封装/正则高级用法(贪婪惰性·分组·反向引用·四种断言)/生成器高阶模式(yield* 返回值·递归剪枝·throw 注入·洋葱模型) | `npx tsx 01-xx.ts` 直跑,新 API 逐项特性检测,建议 Node 22+/26 |
| 12-xx | CSS 示例(HTML 直接打开) | 浏览器 |
| 13-xx / 14-xx | SSR 与 AI 工程示例 | 部分需 Next.js 项目环境(见文档运行说明) |
| 18-01 ~ 18-05 | Worker 家族与跨 Tab 通信示例(纯静态,零依赖) | 浏览器,**需静态服务器**:`npx serve .` 后打开对应目录的 index.html(file:// 下 Worker 源为 opaque 会失败) |
| 19-01 ~ 19-08 | 常用业务功能片段(表单/输入/列表查询/存储/树/文件/埋点/权限) | `npx tsx 19-xx.ts` 直跑;19-06 的下载剪贴板、19-07 的曝光/委托函数需在浏览器页面中调用 |
| 19-09 | IndexedDB 仓储模式:开库升级/Repository/索引/游标/单事务原子性与回滚(纯静态单 HTML) | 浏览器直接打开 `19-09-indexeddb.html` |
| 23-01 | 第二十三部分配套：手写 Promise.all / allSettled / race / any 四件套（含 AggregateError 特性检测降级） | `npx tsx 23-01-promise-all.ts` 直跑 |
| 24-01 | 第二十四部分配套：AI 协作四阶段最小闭环——契约定义（6 用例 + 3 不变式）→ 故意埋入 AI 典型缺陷的 SSE 解析 v1 → 契约门禁 runner 实证击穿 → 修复版 v2 全绿 | `npx tsx 24-01-ai-collab-contract.ts` 直跑 |
| 29-00 | 第二十九部分配套：RxJS 自测题答案册（全 20 题）+ 四个案例的详细运行指南（环境/三种跑法/逐场景帧时间线/动手实验/marble 排坑） | 直接阅读 `29-00-quiz-answers.md`、`29-run-guide.md` |
| 29-01 ~ 29-04 | 第二十九部分配套：草稿自动保存（防抖只存最新·失败不死·卸载收口）/ WebSocket 心跳与自动重连（退避封顶·心跳停表·share 单连接）/ 批量聚合上传（双阈值·空窗过滤·并发上限·整批重试）/ 拖拽动画（帧主时钟·抬起即停·钳制防 NaN），全部 TestScheduler 虚拟时钟硬断言 | `npx tsx 29-xx.ts` 直跑 |
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
| 61-01 ~ 61-02 | 第六十一部分配套：租户上下文（四来源优先级解析·请求注入·私货头拒绝·缓存键命名空间）/ 租户配置三层合并（undefined/null 三态·数组替换）与特性开关灰度分桶 | `npx tsx 61-xx.ts` 直跑 |
| 62-01 ~ 62-02 | 第六十二部分配套：未读数归约器（幂等回执·乐观扣减·服务端对账·下限钳制·Badge 截断）/ 通知通道降级链（WS→SSE→轮询·可见性自适应）与推拉合并（id 索引去重·游标分页·断线补偿） | `npx tsx 62-xx.ts` 直跑 |
| 63-01 ~ 63-02 | 第六十三部分配套：审计字段级 diff（叶子路径·数组集合对比·敏感字段剔除·幂等审计编号）/ 审计查询端（AND 组合筛选·action 前缀通配·diff 三态视图·游标翻页） | `npx tsx 63-xx.ts` 直跑 |
| 64-01 ~ 64-02 | 第六十四部分配套：虚拟滚动内核（固定行高窗口·动态行高前缀和二分·滚动锚定补偿）/ 单元格编辑状态机（五态迁移）与脏检查（A→B→A 净除）+ TSV 粘贴矩形填充 | `npx tsx 64-xx.ts` 直跑 |
| 65-01 ~ 65-02 | 第六十五部分配套：打印分页计算器（mm↔px 规范换算·装箱换页·keepWithNext 孤行控制·unbreakable 独占页）/ 套打模板引擎（mm 坐标·越界重叠自检·格式化截断·缺数检测） | `npx tsx 65-xx.ts` 直跑 |
| 66-01 ~ 66-02 | 第六十六部分配套：依赖准入评分器（下载量/维护度/许可证/安装脚本/依赖深度五维评分·硬门槛覆盖·审批分级）/ 高危漏洞修复决策器（有效严重度折减加成·分级 SLA·升级/覆盖/补丁/替换/隔离/接受路径·审批与截止时间） | `npx tsx 66-xx.ts` 直跑 |
| 67-01 ~ 67-04 | 第六十七部分配套：询盘表单（字段三层·条件必填·反垃圾四信号·首触末触归因）/ 大额资金状态机（金额分级审批·自审拦截·幂等重放·审计轨迹）/ KYC 步骤机（分支·前置锁定·补件回流·硬阻塞）/ 对账内核（整数分·五类差异·合计校验·虚拟窗口） | `npx tsx 67-xx.ts` 直跑 |
| 68-01 ~ 68-03 | 第六十八部分配套：通道选型器（延迟预算·互动强度·成本退化·风险提示）/ 降级阶梯（快降慢升·单步调整·滞回窗口）/ 媒体成本估算（出口流量·转码固定成本·回放存储·边际成本） | `npx tsx 68-xx.ts` 直跑 |
| 69-01 ~ 69-03 | 第六十九部分配套：埋点 SDK 内核（批量·重试·event_id 去重·采样）/ 事件 schema 注册表与装载期校验 / SPA pageview 与停留时长心跳 | `npx tsx 69-xx.ts` 直跑 |
| 70-01 ~ 70-03 | 第七十部分配套：桌面端选型决策器 / 自动更新状态机（签名·灰度·回滚）/ IPC 命令桥（类型安全·allowlist 拦截） | `npx tsx 70-xx.ts` 直跑 |
| 71-01 ~ 71-03 | 第七十一部分配套：WASM 适用性评估器 / 加载器状态机三路径 / 基准方法学对照 | `npx tsx 71-xx.ts` 直跑 |
| 72-01 ~ 72-04 | 第七十二部分配套：组织树与可见范围推导 / 行级数据范围 DSL / 列级白名单与脱敏 / 权限变更失效一致性 | `npx tsx 72-xx.ts` 直跑 |
| 73-01 ~ 73-03 | 第七十三部分配套：端能力抽象层 / 跨端契约测试 / 构建矩阵与 core hash 校验 | `npx tsx 73-xx.ts` 直跑 |
| 74-01 ~ 74-03 | 第七十四部分配套：SM3 国标向量自校验 / 信创环境探测与降级建议 / 内网离线部署检查器 | `npx tsx 74-xx.ts` 直跑 |
| 75-01 ~ 75-03 | 第七十五部分配套：懒加载部门树+拼音搜索 / WebRTC 信令状态机 / RRULE 日程展开与冲突检测 | `npx tsx 75-xx.ts` 直跑 |
| 76-01 | 第七十六部分配套：JD 分析器（关键词提取·权重打分·缺口建议） | `npx tsx 76-01-jd-analyzer.ts` 直跑 |
| 77-01 ~ 77-04 | 第七十七部分配套：性能预算门禁（分档 p75·绝对预算 + 基线回归双闸门）/ 合成层显存预算与动画提升决策 / 卡顿归因（TBT·掉帧·INP 近似·优先级）/ 白屏多信号判定与分级恢复 | `npx tsx 77-xx.ts` 直跑 |
| 78-01 ~ 78-04 | 第七十八部分配套：选型矩阵（硬约束 + 加权 + 敏感性）/ npm 选库六维评估与硬门槛 / 许可证商用判定（分发形态·修改·链接·双许可）/ 许可证门禁（传递依赖传染·豁免到期·退出码） | `npx tsx 78-xx.ts` 直跑 |
| 79-01 | 第七十九部分配套：Agent 任务状态机（Thinking/Running/等待确认/失败/完成）+ 多步骤实时进度 + 指数退避重试 + 幂等键 + 等待确认链路 | `npx tsx 79-01-agent-task-state-machine.ts` 直跑 |
| 80-01 | 第八十部分配套：AI 结果状态机（draft→reviewing→confirmed→saved）+ 字段级 diff + 敏感字段二次确认 + 版本快照与回滚 | `npx tsx 80-01-ai-result-edit-confirm.ts` 直跑 |
| 81-01 | 第八十一部分配套：ICP 四维评分 + 多维筛选（eq/in/gte/lte/between/contains）+ 联系方式补全与合规校验 + CRM 阶段推进（准入条件） | `npx tsx 81-01-crm-customer-pipeline.ts` 直跑 |
| 82-01 | 第八十二部分配套：全局/租户/用户三层配置合并（features 深合并）+ 特性开关灰度分桶（稳定哈希+白名单）+ 配置发布订阅 + 版本回滚 | `npx tsx 82-01-config-center.ts` 直跑 |
| 83-01 | 第八十三部分配套：看板列迁移守卫 + 子任务进度聚合（自动/手动覆盖）+ 项目整体进度 + 成员工作负载与分配推荐 | `npx tsx 83-01-project-kanban.ts` 直跑 |
| 84-01 | 第八十四部分配套：shadcn/ui 设计令牌系统（CSS Variables 生成 + 深浅色翻转 + 品牌覆盖 + 完整性校验） | `npx tsx 84-01-design-tokens.ts` 直跑 |
| 85-01 | 第八十五部分配套：React Hook Form 表单模型（字段注册 + 必填校验 + touched 失焦机制 + Zod Schema 校验集成） | `npx tsx 85-01-form-field-model.ts` 直跑 |
| 86-01 | 第八十六部分配套：Recharts 数据管线（多系列时间序列对齐 + 缺失值四策略填充 null/zero/previous/linear + 按日/周/月聚合） | `npx tsx 86-01-chart-data-pipeline.ts` 直跑 |
| 87-01 | 第八十七部分配套：Design System 三层令牌（原始→语义→组件）+ 命名规范校验（小驼峰+点分隔）+ 主题切换只改语义层 | `npx tsx 87-01-design-system-tokens.ts` 直跑 |
| 88-01 | 第八十八部分配套：UniApp 条件编译（按平台剥离代码）+ 平台 API 抽象层 + 分包大小校验 | `npx tsx 88-01-uniapp-cross-platform.ts` 直跑 |
| 89-01 | 第八十九部分配套：RAG 检索增强（文档分块 + embedding 相似度 + 重排 + prompt 组装）+ 对话记忆窗口 | `npx tsx 89-01-rag-knowledge-base.ts` 直跑 |
| 90-01 | 第九十部分配套：可视化画布图模型（Node/Edge）+ DAG 环检测 + 连线合法性校验 + dagre 自动布局 + 视口缩放 | `npx tsx 90-01-node-editor-canvas.ts` 直跑 |
| 91-01 | 第九十一部分配套：Electron 三层架构（main/preload/renderer）+ IPC 通道权限校验 + 主进程事件推送 + 打包配置校验 | `npx tsx 91-01-electron-ipc-architecture.ts` 直跑 |
| 92-01 | 第九十二部分配套：3D 场景图（Scene/Mesh/Camera）+ Raycaster 射线拾取 + WGS84→局部坐标转换 + 数字孪生数据绑定 + Cesium 图层排序 | `npx tsx 92-01-3d-digital-twin.ts` 直跑 |
| 93-01 | 第九十三部分配套：obs-websocket 协议（场景切换/推流开关/静音）+ 直播流协议选型（RTMP/FLV/HLS/WebRTC）+ 数字人口型同步 + 音视频 QoS 健康分 | `npx tsx 93-01-obs-digital-human-av.ts` 直跑 |
| 94-01 | 第九十四部分配套：小程序双线程 setData diff + Page 生命周期顺序 + 自定义组件通信（properties/triggerEvent）+ 分包校验 + 登录流程（code→openid→token） | `npx tsx 94-01-wechat-miniprogram.ts` 直跑 |
| 95-01 | 第九十五部分配套：渲染策略选型（SSG/SSR/ISR/CSR）+ SEO Metadata 校验 + sitemap/robots 生成 + JSON-LD 结构化数据校验 + Core Web Vitals 评分 | `npx tsx 95-01-nextjs-google-seo.ts` 直跑 |
| 96-01 | 第九十六部分配套：Dockerfile 层缓存命中 + 多阶段构建瘦身 + Linux 文件权限（符号/数字互转 + 用户组校验）+ 进程信号（SIGTERM/SIGKILL）+ docker-compose 依赖环检测 | `npx tsx 96-01-docker-linux.ts` 直跑 |
| 97-01 | 第九十七部分配套：IoT 时序数据模型 + 平均聚合降采样 + LTTB 形状保持降采样 + 滚动窗口告警防抖 + 实时缓冲 flush + 多设备时间网格对齐 | `npx tsx 97-01-iot-time-series.ts` 直跑 |
| 98-01 | 第九十八部分配套：微前端应用注册与路由切换 + Proxy JS 沙箱隔离 + CSS 作用域前缀 + 方案选型（qiankun/MF/wujie）+ 全局事件总线 | `npx tsx 98-01-micro-frontend.ts` 直跑 |
| 99-01 | 第九十九部分配套：Web Vitals 三级评分（LCP/CLS/INP）+ 错误捕获分类 + 错误指纹聚合 + APM 上报（采样+批量+节流）+ 页面健康评分 | `npx tsx 99-01-web-performance-monitoring.ts` 直跑 |
| 100-01 | 第一百部分配套：XSS 转义 + 富文本白名单过滤 + CSRF token 校验 + CSP 策略审计 + 依赖漏洞扫描 + 安全响应头评分 | `npx tsx 100-01-frontend-security.ts` 直跑 |
| 126-01 ~ 126-06 | 第一百二十六部分配套：manifest 审计器（字段/图标矩阵/start_url 与 scope） / SW 生命周期与更新状态机模拟器 / 缓存路由矩阵与版本清理 / 安装引导控制器（A2HS·冷却·iOS 引导）/ 推送订阅流（VAPID·410 清理·权限拒绝降级）/ PWA 验收清单引擎 | `npx tsx 126-xx.ts` 直跑 |
| 127-01 ~ 127-08 | 第一百二十七部分配套：部署拓扑决策器（硬约束过滤 + 加权打分 + 敏感性）/ 静态托管配置审计（vercel.json · netlify.toml · `_headers`/`_redirects` · 缓存层级一致性）/ CDN 缓存规划（规则顺序匹配 · 发布批次 · purge/预热清单）/ Nginx 生产审计（TLS/安全头/压缩/代理/SPA/继承陷阱）/ 镜像审计（多阶段 · 非 root · HEALTHCHECK · 依赖缓存 · 密钥扫描）/ K8s 清单校验（三探针 · resources · 滚动 · 跨资源 selector）/ CI 流水线规划（DAG 环检测 · 生产审批 · 制品契约 · 关键路径）/ 灰度状态机（分桶 · 流量守恒 · 守卫 · 蓝绿切换 · Source Map 绑定） | `npx tsx 127-xx.ts` 直跑 |
| 128-01 ~ 128-04 | 第一百二十八部分配套：按键归一化与全修饰键匹配（key/code · mod 平台映射 · 输入框豁免 · 展示格式）/ 快捷键注册表（作用域栈 · priority · repeat · 重复注册检测）/ 命令系统（when 过滤 · 子序列模糊评分 · 平台化快捷键展示 · id/键位冲突）/ 序列键状态机（前缀 · 超时 · 非法后续键 · 单键共存） | `npx tsx 128-xx.ts` 直跑 |
| 129-01 ~ 129-04 | 第一百二十九部分配套：拖拽状态机（4px 阈值 · 轴锁 · 边界钳制 · pointerId 隔离 · 取消）/ 排序索引（arrayMove · 多选插入点 · 跨容器 · 越界）/ 分组规则（pull/put/clone · 禁用项 · 键盘排序 · 重复 id）/ 命中算法（closestCenter · pointerWithin · rectIntersection · 嵌套容器） | `npx tsx 129-xx.ts` 直跑 |
| 130-01 ~ 130-04 | 第一百三十部分配套：缓存键（稳定序列化 · key factory · 前缀失效）/ 请求去重与重试（共享 Promise · 取消 · 竞态守卫 · 超时 · 指数退避 · 4xx 不重试）/ SWR 缓存（stale 先返回 · 后台刷新 · 并发合并 · 失败回退 · GC）/ 乐观更新（快照回滚 · onSettled · 版本守卫） | `npx tsx 130-xx.ts` 直跑 |
| 131-01 ~ 131-04 | 第一百三十一部分配套：Schema 表单模型（zod 归一化 · z.input/z.output · 错误扁平化 · touched/dirty）/ 异步校验竞态（旧结果作废 · 同值合并 · 成败缓存 · 规则版本）/ 数组字段（稳定 id · move/remove · 行级错误路径）/ 提交编排（分步校验 · 向导回退 · 幂等键 · 422 映射 · 双击合并） | `npx tsx 131-xx.ts` 直跑（依赖 examples 内的 zod） |
| 132-01 ~ 132-06 | 第一百三十二部分配套：同步 KV vs 异步仓储基准（5000 条 · 不设绝对阈值）/ IDB 迁移计划（连续性 · 回滚 · 幂等）/ 游标分页（after-key · 删除键探测 · 反向翻页）/ 多标签页持久化（BroadcastChannel · 版本向量 · 乱序拒绝）；132-08 为交互式存储选型器 | `npx tsx 132-xx.ts` 直跑；`132-08-storage-selector.html` 浏览器打开 |
| 133-01 ~ 133-06 | 第一百三十三部分配套：SQLite WASM + OPFS SAH Pool / PGlite `idb://` 聚合 / DuckDB WASM 直查 Parquet / 数据库放 Worker 的消息协议 / `schema_migrations` 版本迁移 / IDB vs PGlite 基准 | 依赖第三方 WASM 包，走 StackBlitz 在线运行 |
| src/ + tests/ | 文档 9.2 的被测代码与 Vitest 测试 | `npx vitest run` |
| 03-01-modules/ | ESM/CJS 模块机制对照 | `npx tsx 03-01-modules/esm/main.ts` |
| 13-04-app-router-demo/ | Next.js App Router 示例页 | 需放入 Next.js 项目 |
| ai-interview/ | 第二十一部分配套：SSE 客户端与 Node/Python 服务端、打字机 Hook、MCP Schema 与重试熔断、WebSocket 重连、流式 Markdown | 浏览器示例；mjs 用 `node` 直跑；纯 TS `npx tsx`；Python 需 `pip install fastapi uvicorn` |

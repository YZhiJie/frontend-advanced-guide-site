# EP.60 密钥零泄漏防线

> 对应正文：[第四十七部分 · 企业级密钥管理与零泄漏方案](../47-secrets-management.md)

## 剧情回顾

- **第 1 格**：标签君觉得「打包压缩了就没人看」，把支付密钥 `sk_live_…` 直接写进代码 push 上去——结果提交 3 分钟就被安全机器人告警。压缩不是加密，前端产物是公开出版物，爬虫 24 小时扫公开仓库的新提交。
- **第 2 格**：码叔摆出密钥三级分类——publishable（Stripe pk_ / Sentry DSN / Maps key）可上船但要加 referrer 锁；restricted 带锁上船（IP / 域名 / 限额）；server-only（AWS AK/SK、支付 secret、数据库密码）永不下船，一律走 BFF 代理，前端只拿签名 URL 或短期 STS。
- **第 3 格**：像素酱这次学乖了——三道防线层层拦截：本地 gitleaks pre-commit 拦下提交、CI 扫描命中即 exit 1、GitHub Push Protection 平台级兜底。配上 `.env.local` 进 gitignore、`window.__ENV__` 运行时注入实现「build once, deploy many」。
- **第 4 格**：码叔结案——密钥进了 git 历史就等于已泄漏，应急四步：撤销旧密钥止血 → 双密钥并行轮换 → filter-repo 清洗历史 → 审计复盘。坑点提醒：日志与错误上报也是泄漏通道，异常 context 和 console 都要过脱敏器。

## 知识点拆解

### 第 1 格 · 压缩 ≠ 加密

```text
const PAY_KEY = 'sk_live_9f8e…'   // 写进源码
git push origin main              // 推送
→ 3 分钟后安全机器人告警
```

构建工具的「压缩混淆」只是缩短变量名、删除空白——字符串字面量原样保留，`sk_live` 这种特征前缀在产物里全文可搜。公开仓库还有专门的爬虫实时订阅新提交事件，特征密钥几分钟内就会被扫走并尝试调用。

**铁律：前端产物 = 公开出版物**，写进代码的每个字符串都要当作会出现在搜索引擎里。正文展开见 [47.1](../47-secrets-management.md#_47-1-密钥分级与前端无秘密全景)。

### 第 2 格 · 密钥三级分类

```text
publishable → 可上前端(必须加 referrer/IP/限额锁)
restricted  → 可上前端(限制策略是底线)
server-only → 永不下船,BFF 代理
```

分级判断标准只有一个问题：**这把钥匙泄漏后，攻击者能造成不可控损失吗？**

- 不能（只能刷配额、且有限制策略）→ publishable，可发前端；
- 能（调云 API、发起交易、读私有数据）→ server-only，永远留在服务端。

server-only 的场景前端用三种「替代凭证」完成任务：BFF 代理转发、后端签发的预签名 URL、STS 短期 token。完整决策表见正文 [47.1](../47-secrets-management.md#_47-1-密钥分级与前端无秘密全景) 与 [47.6](../47-secrets-management.md#_47-6-第三方-key-的前端防护)。

### 第 3 格 · 三道防线与注入隔离

```text
防线1 本地:gitleaks pre-commit 拦截
防线2 CI:扫描命中即 exit 1
防线3 平台:GitHub Push Protection
```

三道防线共用同一套原理——模式库（AKIA / sk- / ghp_ / JWT / 私钥块）+ 白名单（`process.env` 引用、文档占位符）+ 非零退出硬门禁。可运行的最小实现见 [47-01-secret-scanner.ts](../examples/47-01-secret-scanner.ts)（虚拟仓库扫出 4 处泄漏、白名单零误报）。

注入侧的隔离同样关键：

- `.env.local` 进 `.gitignore` 永不入库，`.env.example` 只留空壳模板；
- 多环境部署用**运行时注入**（`window.__ENV__` / config.json / envsubst），同一份产物跑三套环境；
- 应用入口加**启动门禁**：schema 校验必填/格式/枚举，缺失即拒启动，启动快照脱敏打印。见 [47-02-env-guard.ts](../examples/47-02-env-guard.ts)，正文展开见 [47.2](../47-secrets-management.md#_47-2-本地开发-env-体系与团队分发) 与 [47.3](../47-secrets-management.md#_47-3-注入方案-构建期-vs-运行时与启动门禁)。

### 第 4 格 · 应急四步与日志脱敏

```text
① 撤销旧密钥(止血)  → ② 双密钥并行轮换
③ filter-repo 清史(整容) → ④ 审计复盘
```

进了 git 历史就视为已泄漏——「删掉重新提交」毫无意义，历史里还在。**顺序铁律：先止血再整容**，否则清洗历史的几个小时里旧密钥仍在裸奔。轮换用双密钥并行期（old+new 同时有效 → 全部切新 → revoke 旧）避免线上 401 风暴。完整状态机见 [47-04-leak-response.ts](../examples/47-04-leak-response.ts)。

密钥还有第二条泄漏通道：**日志与监控上报**。异常堆栈的 context、fetch 拦截器、console 都可能带密钥——两道闸门脱敏（key 名单 + value 模式），留头尾打码（`sk_l…wX9`）既安全又能排查对账。见 [47-03-log-redactor.ts](../examples/47-03-log-redactor.ts)，正文展开见 [47.4](../47-secrets-management.md#_47-4-泄漏防控工具链-扫描、脱敏与应急响应)。

## 坑点清单

> 🔗 正文对照：[《47.8 本章避坑清单》](../47-secrets-management#_47-8-本章避坑清单)

1. **把 server-only secret 写进前端代码**：压缩混淆不藏字符串，打包后全网公开。secret 走 BFF 代理，前端只拿签名 URL / 短期凭证。
2. **`.env.local` 误提交**：git 历史永久留存。`.gitignore` 基线 + pre-commit 扫描双保险。
3. **扫描器无白名单**：误报刷屏后开发者免疫，真泄漏被噪音埋没。放行 `process.env` 引用与文档占位符。
4. **泄漏后先删文件再补提交**：历史里还在，等于没处理。按「撤销 → 轮换 → 清史 → 审计」四步走，先止血再整容。
5. **密钥硬切换**：直接 revoke 旧 key，没切完的调用方面积 401。必须经双密钥并行期过渡。
6. **异常 message 带密钥**：错误上报直接带走 secret。错误上下文只放 id，敏感字段过脱敏器。
7. **publishable key 裸奔**：「可公开」不等于「无限制」。referrer 限制 + 用量上限 + 告警是底线三件套。

## 自测 3 题

**1. 为什么说「压缩混淆」不能保护写在前端代码里的密钥？**

<details>
<summary>参考答案</summary>

压缩混淆只缩短标识符、删除空白与注释，**字符串字面量原样保留**——`sk_live_9f8e…` 在产物里全文可搜。而且密钥有特征前缀（AKIA / sk- / ghp_ / eyJ），扫描器用简单正则就能从整个 bundle 里把它捞出来。所以「打包了就没人看」是错觉：前端产物是公开出版物，写进去的每个字符串都应视为会出现在搜索引擎里。
</details>

**2. 密钥进了 git 历史后，为什么「撤销/轮换」必须排在「清洗历史」之前？**

<details>
<summary>参考答案</summary>

密钥进入 git 历史即视为已泄漏，攻击者随时可能已经在用。清洗历史（filter-repo/BFG + 协作者重克隆）通常需要数小时甚至跨天协调，如果先清洗再撤销，这段窗口期旧密钥仍然有效、仍在裸奔。正确顺序是先撤销旧密钥让攻击者手里的钥匙立即作废（止血），签发新密钥完成轮换（保服务），然后才从容清洗历史（整容），最后审计调用日志复盘。
</details>

**3. 同一份前端产物要同时部署到 dev / staging / prod 三套环境，配置注入该怎么做？**

<details>
<summary>参考答案</summary>

必须用**运行时注入**而不是构建期注入：构建期注入（`import.meta.env` 字符串替换）会把值固化进产物，切环境就得重新打包。运行时注入的常见方案：`window.__ENV__`（SSR 或容器启动时写入）、独立的 `config.js`（entrypoint 用 envsubst 替换占位符）、或前端启动时请求 BFF 的 `/api/config`。配合启动门禁做 schema 校验，缺配置直接拒启动并报出全部缺失项。
</details>

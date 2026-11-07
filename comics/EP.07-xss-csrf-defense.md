# EP.07 XSS 与 CSRF 攻防

> 对应正文：[07-security.md](../07-security.md)（7.1 XSS 跨站脚本攻击 / 7.2 CSRF 跨站请求伪造）· 示例：`examples/07-01-xss-defense.ts`、`examples/07-02-csrf-defense.ts`

## 剧情回顾

- **第 1 格**：标签君的评论区被人塞了脚本，其他用户一打开页面 Cookie 就被偷——存储型 XSS。
- **第 2 格**：码叔揭秘防御三件套：输出转义（textContent）、CSP 白名单、HttpOnly Cookie。
- **第 3 格**：像素酱实证 CSRF——钓鱼站偷偷向银行发请求，浏览器自动带上 Cookie 完成转账。
- **第 4 格**：码叔结案——黑名单过滤不可靠，防御靠"转义、白名单、最小权限"的纵深体系。

## 知识点拆解

### 第 1 格 · XSS 的本质

- **数据被当成代码执行**：用户输入未转义就插入 HTML；
- 三种类型：**存储型**（入库持久化，危害最大）、**反射型**（URL 参数携带，点击触发）、**DOM 型**（纯前端拼接 innerHTML）；
- 危害：偷 Cookie、伪造请求、键盘记录、页面篡改。

### 第 2 格 · XSS 防御三件套

```ts
el.textContent = userInput;          // ① 不解析 HTML，文本化输出
// Content-Security-Policy: 'self'   // ② CSP：限制脚本来源
// Set-Cookie: token=xx; HttpOnly    // ③ JS 读不到 Cookie
```

- **转义**是根本：React/Vue 默认转义插值，只有 `dangerouslySetInnerHTML`/`v-html` 是逃生舱；
- **CSP** 限制页面能加载哪些脚本，即使注入成功也难以执行外链脚本；
- **HttpOnly** 让 `document.cookie` 读不到会话 Cookie，偷了也没用。

### 第 3 格 · CSRF 的原理

- 用户在 A 站登录后，浏览器保存了 Cookie；
- 访问恶意站 B 时，B 偷偷向 A 发请求，**浏览器自动携带 A 站 Cookie**；
- 服务器无法区分"用户本人发的"和"钓鱼站借用户身份发的"。

### 第 4 格 · CSRF 防御

- **CSRF Token**：表单/请求头带服务端下发的随机 Token，钓鱼站拿不到；
- **SameSite Cookie**：`Lax`/`Strict` 阻止跨站请求自动携带 Cookie；
- **校验 Origin/Referer**：服务端核对请求来源，非白名单直接拒绝。

## 坑点清单

> 🔗 正文对照：[《7.7 本章避坑清单》](../07-security#_7-7-本章避坑清单)

1. 用 innerHTML + 黑名单过滤"富文本"：变体绕过层出不穷，要白名单（DOMPurify）；
2. Cookie 没设 HttpOnly + Secure：XSS 一旦得手会话直接沦陷；
3. 只依赖 Referer 防 CSRF：隐私设置会剥离 Referer，Token + SameSite 才是主力。

## 自测 3 题（含答案）

1. 存储型 XSS 和反射型 XSS 的区别？——**存储型入库持久化，所有访问者中招；反射型藏在 URL 参数里，需诱导点击**。
2. CSRF 能不能靠"检查请求头 X-Requested-With"完全防住？——**不能单独防，需 CSRF Token + SameSite + Origin 校验组合纵深防御**。
3. HttpOnly 防的是什么？防不了什么？——**防 JS 通过 document.cookie 读会话 Cookie；不能阻止 XSS 注入本身**。

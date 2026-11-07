# EP.74 前端的安全防线

> 对应正文：[100-frontend-security.md](../100-frontend-security.md)（100.1 XSS / 100.2 CSRF / 100.3 CSP / 100.4 依赖漏洞 / 100.5 安全头）· 示例：`examples/100-01-frontend-security.ts`

## 剧情回顾

- **第 1 格**：评论区 script 标签触发 alert——XSS 攻击。
- **第 2 格**：码叔揭秘 XSS（转义+白名单+HttpOnly）与 CSRF（Token+SameSite）防御。
- **第 3 格**：像素酱实证 CSP 限制脚本来源 + npm audit 扫描依赖漏洞。
- **第 4 格**：码叔结案——四个安全响应头（X-Frame-Options/nosniff/HSTS/CSP）。

## 知识点拆解

### 第 1 格 · XSS 攻击

- 用户输入被当作 HTML 执行；
- 永远不信任用户输入，输出必须转义。

### 第 2 格 · XSS + CSRF 防御

- XSS：escapeHtml 转义、DOMPurify 白名单、HttpOnly Cookie；
- CSRF：SameSite Cookie + CSRF Token + 二次确认。

### 第 3 格 · CSP 与依赖扫描

- CSP `script-src 'self'` 限制脚本来源，不用 `unsafe-inline`；
- `npm audit --audit-level=high` 作为 CI 门禁。

### 第 4 格 · 安全响应头

- X-Frame-Options: DENY（防点击劫持）
- X-Content-Type-Options: nosniff（防 MIME 嗅探）
- Strict-Transport-Security（强制 HTTPS）
- Content-Security-Policy（防 XSS）

## 坑点清单

> 🔗 正文对照：[《100.7 本章避坑清单》](../100-frontend-security#_100-7-本章避坑清单)

1. 用 dangerouslySetInnerHTML 插用户输入 → 用 textContent 或 DOMPurify；
2. token 存 localStorage → XSS 可读 → 存 HttpOnly Cookie；
3. CSP 加 unsafe-inline → 用 nonce/hash 替代。

## 自测 3 题（含答案）

1. XSS 防御的核心原则？——**输入过滤 + 输出转义，优先用框架自动转义，富文本用 DOMPurify**。
2. CSP 的 script-src 'unsafe-inline' 为什么危险？——**允许内联脚本执行，给 XSS 留口子，应用 nonce/hash 替代**。
3. 防点击劫持用什么响应头？——**X-Frame-Options: DENY 或 CSP frame-ancestors 'none'**。

// 文件: examples/07-02-csrf-defense.ts —— CSRF 三层防御
// ============ 防御一:Cookie 的 SameSite 属性(第一道防线,现代浏览器默认 Lax)============

// Set-Cookie: session=abc; HttpOnly; Secure; SameSite=Lax
// SameSite=Strict: 完全禁止第三方场景携带(最安全,但从外站点链接跳转也会丢登录态)
// SameSite=Lax:    顶级导航的 GET 请求可以带,POST/跨站 img/fetch 一律不带(体验与安全的平衡)
// 💡 Lax 直接让上文的 img 标签攻击失效 —— 这是它成为默认值的原因

// ============ 防御二:CSRF Token(经典方案)============

// 服务端渲染页面时下发一次性 token:<meta name="csrf-token" content="xxx">
function getCsrfToken(): string {
    return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ?? '';
}

async function submitForm(body: unknown) {
    await fetch('/api/transfer', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken(), // 攻击者的跨站页面拿不到这个值(受同源策略保护)
        },
        body: JSON.stringify(body),
    });
}
// 原理:CSRF 只能"借"浏览器自动带的 Cookie,无法读取目标域的页面内容;
// 而校验的正是"只有你自己的页面才能拿到的" token

// ============ 防御三:校验 Origin/Referer 头(服务端兜底)============
// 服务端:取请求头 Origin(或 Referer),必须与白名单域完全一致,否则 403
// 注意:直接修改 Cookie 中的会话标识校验(双重提交 Cookie)也可,但本质相同

export {};

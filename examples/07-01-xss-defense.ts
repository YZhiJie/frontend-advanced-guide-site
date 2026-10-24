// 文件: examples/07-01-xss-defense.ts —— [浏览器] XSS 攻防演示
// ============ 危险写法 vs 安全写法 ============

// 模拟恶意输入(存储型 XSS 的典型载荷)
const comment = `<img src=x onerror="alert('偷走你的 Cookie: ' + document.cookie)">`;

// ❌ 危险:innerHTML 会解析并执行其中的脚本/事件
// document.body.innerHTML = `<div>${comment}</div>`;

// ✅ 方案一:纯文本场景用 textContent(任何输入都只会被当作文字显示)
const el1 = document.createElement('div');
el1.textContent = comment; // 页面上原样显示这串字符,不会执行
document.body.appendChild(el1);

// ✅ 方案二:确实需要渲染富文本时,用 DOMPurify 白名单过滤
// npm i dompurify
// import DOMPurify from 'dompurify';
// const clean = DOMPurify.sanitize(comment); // 移除 onerror、javascript: 等一切危险内容
// document.body.innerHTML = `<div>${clean}</div>`;

// ✅ 方案三:URL 类输入,协议白名单校验(防 javascript: 伪协议)
function safeUrl(input: string): string {
    try {
        const url = new URL(input, location.origin);
        return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : '#';
    } catch {
        return '#';
    }
}
console.log(safeUrl('javascript:alert(1)')); // '#'
console.log(safeUrl('https://example.com'));  // 正常放行

// ---- 框架内的默认防线 ----
// React:  <div>{comment}</div>        → 默认转义,安全
// React:  <div dangerouslySetInnerHTML={{ __html: comment }} />  → ❌ 逃逸口,必须先 DOMPurify
// Vue:    <div>{{ comment }}</div>    → 默认转义,安全
// Vue:    <div v-html="comment" />    → ❌ 同样是逃逸口
export {};

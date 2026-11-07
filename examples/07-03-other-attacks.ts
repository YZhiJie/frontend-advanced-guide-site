// 文件: examples/07-03-other-attacks.ts —— 四类高频安全问题的攻与防
// ============ 1. 点击劫持(Clickjacking)============
// 攻击:把你的页面放进透明 iframe,叠在"抽奖"按钮上,用户点的是隐藏的"转账"按钮

// 防御 A:HTTP 响应头(服务端配置,二选一)
//   X-Frame-Options: DENY                     ← 不允许被任何页面嵌入
//   Content-Security-Policy: frame-ancestors 'none'  ← CSP 版本,能力更强
// 防御 B(兜底 JS,可被绕过,仅辅助):
if (window.self !== window.top) {
    document.body.style.display = 'none';
    window.top!.location = window.self.location; // 试图跳出 iframe
}

// ============ 2. 原型污染(Prototype Pollution)============
// 攻击:深合并用户可控 JSON 时,劫持 __proto__

// ❌ 危险的 merge 实现
function unsafeMerge(target: Record<string, unknown>, source: Record<string, unknown>) {
    for (const key in source) {
        if (typeof source[key] === 'object' && source[key] !== null) {
            target[key] = unsafeMerge((target[key] as object) ?? {}, source[key] as Record<string, unknown>);
        } else {
            target[key] = source[key]; // key 为 __proto__ 时 → 污染所有对象的原型!
        }
    }
    return target;
}

// 演示污染效果(勿在生产尝试):
const payload = JSON.parse('{"__proto__": {"isAdmin": true}}');
const merged = unsafeMerge({}, payload);
const victim: Record<string, unknown> = {};
console.log(victim.isAdmin); // true —— 一个全新的空对象都"中招"了

// ✅ 防御:过滤危险键 + 冻结原型
function safeMerge(target: Record<string, unknown>, source: Record<string, unknown>) {
    for (const key in source) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue; // 黑名单
        if (typeof source[key] === 'object' && source[key] !== null) {
            target[key] = safeMerge((target[key] as object) ?? {}, source[key] as Record<string, unknown>);
        } else {
            target[key] = source[key];
        }
    }
    return target;
}
console.log(Object.keys(safeMerge({}, payload))); // [] —— __proto__ 被忽略

// ============ 3. 中间人攻击(MITM)============
// 防御:全站 HTTPS + HSTS(强制浏览器后续都用 HTTPS)
// 严格传输安全响应头:
//   Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
// 敏感信息(手机号/身份证)前后端都应脱敏展示,日志中严禁明文

// ============ 4. 供应链攻击 ============
// 攻击:恶意版本包(如经典的 event-stream 事件)——你 npm install 的那一刻中招
// 防御:
//   1) 提交 lockfile,CI 用 --frozen-lockfile,杜绝"悄悄装了新版本";
//   2) 开启 npm audit / Renovate 的安全告警;
//   3) 锁定关键依赖的确切版本;新包引入前看维护活跃度与下载量;
//   4) Node 侧可用 --ignore-scripts 安装(阻止 install 钩子执行任意脚本)
export {};

// 文件: examples/11-02-monitor.ts —— [浏览器] 20 行起步的生产级监控 SDK 骨架

type ReportData = Record<string, unknown>;

/** 上报:优先 sendBeacon(页面卸载也不丢),退化为 fetch keepalive */
function report(data: ReportData) {
    const payload = JSON.stringify({
        ...data,
        page: location.href,
        ua: navigator.userAgent,
        ts: Date.now(),
        sessionId: sessionStorage.getItem('sid'),
    });
    const blob = new Blob([payload], { type: 'application/json' });
    if (navigator.sendBeacon?.('/api/monitor', blob)) return;
    fetch('/api/monitor', { method: 'POST', body: payload, keepalive: true }).catch(() => {});
}

// ---- 1. JS 错误 + 资源错误(第三个参数 true:捕获阶段才能拿到资源错误)----
window.addEventListener('error', (event) => {
    const target = event.target as HTMLElement | null;
    if (target && ['IMG', 'SCRIPT', 'LINK'].includes(target.tagName)) {
        report({ type: 'resource-error', url: (target as HTMLImageElement).src || (target as HTMLLinkElement).href });
    } else {
        report({ type: 'js-error', message: event.message, stack: event.error?.stack?.slice(0, 2000), file: event.filename, line: event.lineno });
    }
}, true);

// ---- 2. Promise 未捕获拒绝 ----
window.addEventListener('unhandledrejection', (event) => {
    report({ type: 'promise-error', message: String(event.reason) });
});

// ---- 3. 接口错误:在请求层(6.4)的拦截器里调用 report({ type: 'api-error', ... }) ----

// ---- 4. Web Vitals 性能上报 ----
// import { onLCP, onINP, onCLS } from 'web-vitals';
// onLCP((m) => report({ type: 'perf', metric: 'LCP', value: m.rating === 'good' ? m.value : m.value }));
// onINP((m) => report({ type: 'perf', metric: 'INP', value: m.value }));
// onCLS((m) => report({ type: 'perf', metric: 'CLS', value: m.value }));

// ---- 5. sourcemap 还原:构建时上传 .map 到监控平台,错误 stack 自动还原为源码位置 ----
// ⚠️ .map 文件绝不能部署到公网(会暴露源码)
export {};

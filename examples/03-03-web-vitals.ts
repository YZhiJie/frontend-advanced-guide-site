// 文件: examples/03-03-web-vitals.ts —— 性能度量:上报核心指标
// ============ 用 Performance API 手工采集 Core Web Vitals ============

// ---- LCP:最大内容绘制 ----
new PerformanceObserver((list) => {
    const entries = list.getEntries();
    const last = entries[entries.length - 1];
    report({ metric: 'LCP', value: last.startTime, element: (last as any).element?.tagName });
}).observe({ type: 'largest-contentful-paint', buffered: true });

// ---- CLS:累积布局偏移(只统计非用户输入导致的偏移)----
let clsValue = 0;
new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as PerformanceEntry[] & { hadRecentInput: boolean; value: number }[]) {
        if (!entry.hadRecentInput) clsValue += entry.value;
    }
    report({ metric: 'CLS', value: clsValue });
}).observe({ type: 'layout-shift', buffered: true });

// ---- 自定义埋点:某个关键操作的耗时 ----
performance.mark('list-render-start');
requestAnimationFrame(() => {
    performance.mark('list-render-end');
    performance.measure('list-render', 'list-render-start', 'list-render-end');
    const measure = performance.getEntriesByName('list-render').pop();
    report({ metric: 'list-render', value: measure?.duration });
});

// ---- 统一上报:sendBeacon 不阻塞页面卸载 ----
function report(data: Record<string, unknown>) {
    console.log('[上报]', data);
    navigator.sendBeacon?.('/api/metrics', new Blob([JSON.stringify(data)], { type: 'application/json' }));
}

// 💡 生产环境建议直接用 web-vitals 官方库:
// import { onLCP, onINP, onCLS } from 'web-vitals';
// onLCP(report); onINP(report); onCLS(report);

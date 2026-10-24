// 文件: examples/10-02-raf-scroll.ts —— [浏览器] 高频事件与动画的正确姿势

// ---- 1. 滚动/指针事件:用 rAF 节流,对齐渲染帧 ----
let ticking = false;
window.addEventListener('scroll', () => {
    if (ticking) return; // 一帧内合并多次触发
    ticking = true;
    requestAnimationFrame(() => {
        updateHeader(window.scrollY); // 真正的 DOM 操作放在下一帧
        ticking = false;
    });
});
function updateHeader(scrollY: number) {
    const header = document.querySelector('#header');
    if (header) header.style.transform = `translateY(${Math.min(scrollY, 64)}px)`;
}

// ---- 2. 长任务拆分:让出主线程,保持交互响应 ----
async function processHugeList(items: unknown[]) {
    const results: unknown[] = [];
    const CHUNK = 100;
    for (let i = 0; i < items.length; i += CHUNK) {
        results.push(...items.slice(i, i + CHUNK).map(expensiveTransform));
        if (i + CHUNK < items.length) {
            // scheduler.yield() 可用时优先(更语义化);否则退化为 setTimeout(0)
            const scheduler = (window as any).scheduler;
            if (scheduler && typeof scheduler.yield === 'function') {
                await scheduler.yield();
            } else {
                await new Promise((r) => setTimeout(r, 0)); // 让出主线程,插入输入事件处理
            }
        }
    }
    return results;
}
function expensiveTransform(x: unknown) { return x; }

// ---- 3. 合成层提示:will-change 用在"确实在动画"的元素上 ----
// .carousel-item { will-change: transform; }   ✅ 轮播正在动
// ⚠️ 全站乱加 will-change = 内存爆炸(每个提示都会创建合成层)
// 更优做法:动画开始前 JS 加 will-change,结束后移除

// ---- 4. 用 Performance 面板定位: Long Task(>50ms 红色三角)就是优化目标 ----
const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
        report({ type: 'longtask', duration: entry.duration, start: entry.startTime });
    }
});
observer.observe({ entryTypes: ['longtask'] });
function report(data) { console.log('[性能上报]', data); }
export {};

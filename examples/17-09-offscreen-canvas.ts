// 文件: examples/17-09-offscreen-canvas.ts —— [浏览器] OffscreenCanvas Worker 渲染
// ============ 主线程:把 canvas 控制权转交给 Worker ============

// 主线程
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
// transferControlToOffscreen 后,主线程不能再获取该 canvas 的 2d 上下文
const offscreen = canvas.transferControlToOffscreen();
const worker = new Worker(new URL('./17-09-canvas-worker.ts', import.meta.url), { type: 'module' });

// 把 OffscreenCanvas 转移给 Worker(Transferable,零拷贝)
worker.postMessage({ type: 'init', canvas: offscreen }, [offscreen]);

// 主线程只发指令,不碰渲染 —— UI 线程彻底解放
function startAnimation() {
    worker.postMessage({ type: 'start', particleCount: 5000 });
}
function stopAnimation() {
    worker.postMessage({ type: 'stop' });
}
function resize(width: number, height: number) {
    worker.postMessage({ type: 'resize', width, height });
}

// ⚠️ transferControlToOffscreen 是单向不可逆的 —— 主线程之后不能再操作该 canvas
// ⚠️ Worker 中没有 DOM API(没有 document/window),所有输入通过 postMessage 传入
// ⚠️ requestAnimationFrame 在 Worker 中可用(非 DOM 专属)

export {};

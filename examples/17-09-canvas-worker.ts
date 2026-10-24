// 文件: examples/17-09-canvas-worker.ts —— [浏览器] Worker 侧的渲染循环
// ============ Worker 线程:粒子动画的完整渲染循环 ============

let ctx: OffscreenCanvasRenderingContext2D;
let rafId: number;
let particles: { x: number; y: number; vx: number; vy: number }[] = [];

self.onmessage = (e: MessageEvent) => {
    const { type } = e.data;
    if (type === 'init') {
        const canvas = e.data.canvas as OffscreenCanvas;
        ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
        ctx.canvas.width = 600;
        ctx.canvas.height = 400;
    } else if (type === 'start') {
        // 初始化粒子
        const count = e.data.particleCount as number;
        particles = Array.from({ length: count }, () => ({
            x: Math.random() * 600,
            y: Math.random() * 400,
            vx: (Math.random() - 0.5) * 2,
            vy: (Math.random() - 0.5) * 2,
        }));
        loop();
    } else if (type === 'stop') {
        if (rafId) cancelAnimationFrame(rafId);
    } else if (type === 'resize') {
        if (ctx) {
            ctx.canvas.width = e.data.width;
            ctx.canvas.height = e.data.height;
        }
    }
};

function loop() {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.fillStyle = '#1890ff';
    for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > ctx.canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > ctx.canvas.height) p.vy *= -1;
        ctx.fillRect(p.x, p.y, 2, 2);
    }
    rafId = requestAnimationFrame(loop); // ✅ Worker 中 rAF 可用
}

export {}; // Worker 模块:导出空确保类型检查

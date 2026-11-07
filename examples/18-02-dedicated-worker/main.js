// 文件: examples/18-02-dedicated-worker/main.js
// 主线程：创建 Worker、接收进度/结果、演示 Transferable 与 terminate。

// ⚠️ Worker URL 相对"文档地址"解析；本示例目录固定，直接用相对路径即可。
//    工程中推荐 new Worker(new URL('./calc.worker.js', import.meta.url)) 写法。
let worker = createWorker();

const out = document.querySelector('#out');
const fill = document.querySelector('#fill');
function log(...args) {
    out.textContent += '\n' + args.join(' ');
}

function createWorker() {
    const w = new Worker('./calc.worker.js');
    w.onmessage = (e) => {
        const d = e.data;
        if (d.type === 'PROGRESS') {
            fill.style.width = `${(d.percent * 100).toFixed(1)}%`;
        } else if (d.type === 'DONE') {
            fill.style.width = '100%';
            log('✅ 累加结果(1~10亿) =', d.result, '(对照公式 n(n+1)/2 =', String((1e9 * (1e9 + 1)) / 2), ')');
        } else if (d.type === 'BUFFER_READY') {
            // 主线程拿到所有权：直接可读，无 64MB 拷贝
            const view = new Uint8Array(d.buffer);
            log(`✅ 收到 ${d.byteLength / 1024 / 1024}MB Buffer，首字节=${view[0]}`);
        } else if (d.type === 'WORKER_SIDE_DETACHED') {
            log(`ℹ️ 发送方 Worker 侧 byteLength 已变为 ${d.byteLength}（detached）`);
        } else if (d.type === 'ERROR') {
            log('❌ Worker 错误:', d.message);
        }
    };
    w.onerror = (e) => log('❌ error 事件:', e.message);
    return w;
}

document.querySelector('#sum').addEventListener('click', () => {
    fill.style.width = '0';
    log('→ 发送 SUM_RANGE，主线程保持可交互……');
    worker.postMessage({ type: 'SUM_RANGE', from: 1, to: 1_000_000_000 });
});

document.querySelector('#buffer').addEventListener('click', () => {
    log('→ 请求 Worker 生产 64MB ArrayBuffer（transfer）……');
    worker.postMessage({ type: 'MAKE_BUFFER' });
});

document.querySelector('#kill').addEventListener('click', () => {
    worker.terminate(); // 立即终止线程；仅置 null 不会释放
    log('⚠️ Worker 已 terminate，重新创建一个。');
    worker = createWorker();
});

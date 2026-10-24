// 文件: examples/18-02-dedicated-worker/calc.worker.js
// DedicatedWorker 线程脚本（classic worker，零构建，静态服务器直接运行）
// 全局对象是 self，无 DOM、无 window。

self.onmessage = (e) => {
    const { type } = e.data;

    if (type === 'SUM_RANGE') {
        const { from, to } = e.data;
        const total = to - from;
        const CHUNK = 10_000_000; // 分片计算，每片回报一次进度并让出事件循环
        let sum = 0;
        let done = 0;

        function step() {
            const end = Math.min(done + CHUNK, to);
            for (let i = (done === 0 ? from : done + 1); i <= end; i++) sum += i;
            done = end;
            self.postMessage({ type: 'PROGRESS', percent: (done - from) / total });
            if (done < to) {
                setTimeout(step, 0); // 让出事件循环：CANCEL 等消息有机会被处理
            } else {
                self.postMessage({ type: 'DONE', result: sum });
            }
        }
        step();
    }

    if (type === 'MAKE_BUFFER') {
        // 生产一块 64MB 内存并"转移"回主线程：Worker 侧发送后即失去所有权
        const buf = new ArrayBuffer(64 * 1024 * 1024);
        const view = new Uint8Array(buf);
        for (let i = 0; i < view.length; i += 1024) view[i] = 1; // 每 1KB 打一个标记
        self.postMessage({ type: 'BUFFER_READY', buffer: buf, byteLength: buf.byteLength }, [buf]);
        // 第二参数 transfer 列表：零拷贝；此后本线程访问 buf 会得到 detached（byteLength=0）
        self.postMessage({ type: 'WORKER_SIDE_DETACHED', byteLength: buf.byteLength });
    }
};

self.addEventListener('error', (e) => {
    self.postMessage({ type: 'ERROR', message: e.message });
});

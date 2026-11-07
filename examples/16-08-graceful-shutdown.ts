// 文件: examples/16-08-graceful-shutdown.ts —— 优雅退出:SIGTERM → 停止接新连接 → 处理完存量请求 → 退出
import http from 'node:http';

let inFlight = 0;          // 正在处理、尚未返回的请求数
let shuttingDown = false;  // 是否已收到 SIGTERM 进入退出流程

const server = http.createServer((req, res) => {
    inFlight++;
    // 模拟一个耗时 600ms 的业务处理(真实场景可能是查下游或写库)
    setTimeout(() => {
        res.end(`ok: ${req.url}`);
        inFlight--;
        finishIfDrained();
    }, 600);
});

function finishIfDrained() {
    if (shuttingDown && inFlight === 0) {
        console.log('存量请求已处理完 → 进程退出');
        process.exit(0);
    }
}

// ---- 优雅退出的完整流程:先停止接新请求,再等存量处理完,最后退出 ----
process.on('SIGTERM', () => {
    if (shuttingDown) return;      // 幂等:重复收到信号不重复执行
    shuttingDown = true;
    console.log('→ 收到 SIGTERM:停止接受新连接(server.close)');
    server.close();                // 停止接收新连接,回调在全部连接结束后触发
    server.closeIdleConnections(); // 主动断开空闲 keep-alive 连接,别让它们拖住退出
    finishIfDrained();             // 若此刻已无存量请求,立即退出
});

server.listen(0, () => {           // 端口 0 = 随机可用端口,避免固定端口冲突
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    console.log(`✓ 服务已启动,监听端口 ${port}`);

    // 制造两个"存量请求"(真实场景是正在被处理的用户请求)
    http.get(`http://127.0.0.1:${port}/a`, (res) => res.resume());
    http.get(`http://127.0.0.1:${port}/b`, (res) => res.resume());

    // 模拟 K8s/PM2 在滚动更新时发出 SIGTERM
    setTimeout(() => process.kill(process.pid, 'SIGTERM'), 100);
});
// 输出:✓ 服务已启动… → 收到 SIGTERM:停止接受新连接(server.close) → 存量请求已处理完 → 进程退出

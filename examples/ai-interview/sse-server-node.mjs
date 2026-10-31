// 文件: examples/ai-interview/sse-server-node.mjs —— [Node] 零依赖 SSE 服务端
// 运行方式: node examples/ai-interview/sse-server-node.mjs 然后 curl -N http://127.0.0.1:3000/stream
// 关联文档: 21-frontend-ai-interview.md 21.1.4（部署到 Nginx 后记得 proxy_buffering off）
import http from 'node:http';

const PORT = 3000;

http.createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/stream') {
        res.writeHead(404).end('not found');
        return;
    }

    // 关键三件套：事件流 MIME + 禁缓存 + 禁代理缓冲（no-transform 防中间件改写）
    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });

    let id = 100;
    const tokens = ['你好', '，', '我是', '流式', '助手'];
    const timer = setInterval(() => {
        const token = tokens.shift();
        if (token) {
            // 一帧 = id/event/data 行 + 一个空行（\n\n）
            res.write(`id: ${++id}\nevent: token\ndata: ${JSON.stringify({ delta: token })}\n\n`);
        } else {
            res.write('event: done\ndata: [DONE]\n\n');
            res.end();
            clearInterval(timer);
        }
    }, 300);

    // 心跳：每 15s 一行注释，防 NAT/代理因空闲掐连接
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);

    // 客户端断开必须清理：否则定时器空转、文件句柄/上游模型调用泄漏（生产里还要取消模型请求省钱）
    req.on('close', () => {
        clearInterval(timer);
        clearInterval(heartbeat);
    });
}).listen(PORT, () => {
    console.log(`SSE server: curl -N http://127.0.0.1:${PORT}/stream`);
});

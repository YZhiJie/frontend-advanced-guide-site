// 文件: examples/06-03-sse.ts —— SSE:AI 流式输出的标配方案
// ============ 客户端:三行核心代码 ============

function listenNotifications(onMessage: (data: unknown) => void) {
    // EventSource 自带:断线自动重连、last-event-id 续传
    const source = new EventSource('/api/notifications');

    source.onmessage = (event) => onMessage(JSON.parse(event.data));
    source.addEventListener('order-paid', (event) => onMessage(JSON.parse((event as MessageEvent).data))); // 自定义事件

    source.onerror = () => console.warn('连接中断,浏览器将自动重连');
    return () => source.close(); // 返回关闭函数,组件卸载时调用
}

// ---- 流式请求(POST 场景用 fetch 读流,SSE 不支持 POST)----
async function streamCompletion(prompt: string, onChunk: (text: string) => void) {
    const res = await fetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
        headers: { 'Content-Type': 'application/json' },
    });
    const reader = res.body!.getReader();       // ReadableStream 读取器
    const decoder = new TextDecoder();

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        onChunk(decoder.decode(value, { stream: true })); // stream:true 处理跨 chunk 的多字节字符
    }
}

// 演示(Node 端没有 EventSource/流,以下调用需浏览器环境):
// listenNotifications((data) => console.log('收到推送:', data));
// await streamCompletion('写一首诗', (chunk) => process.stdout.write(chunk));
export {};

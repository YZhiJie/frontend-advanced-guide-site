// 文件: examples/14-01-sse-parser.ts —— SSE 流解析器(纯函数,Node 可直接运行验证)
// ============ 处理"chunk 切断数据行"的经典难题 ============

export interface StreamEvent { event: string; data: string }

/**
 * 创建一个 SSE 解析器:喂给它任意切割的文本 chunk,吐出完整的事件
 * 关键:内部维护缓冲区,只有遇到空行(事件结束符)才产出
 */
export function createSseParser(onEvent: (e: StreamEvent) => void) {
    let buffer = '';

    return {
        push(chunk: string) {
            buffer += chunk; // 一次 chunk 可能是半行、三行半……先攒着
            let idx: number;
            // 循环取出完整的"事件块"(以 \n\n 分隔)
            while ((idx = buffer.indexOf('\n\n')) !== -1) {
                const block = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 2);
                const event = { event: 'message', data: '' };
                for (const line of block.split('\n')) {
                    if (line.startsWith('data:')) event.data += line.slice(5).trim();
                    if (line.startsWith('event:')) event.event = line.slice(6).trim();
                }
                if (event.data) onEvent(event);
            }
        },
    };
}

// ---- Node 端验证:模拟被切成碎块的流 ----
const received: string[] = [];
const parser = createSseParser((e) => {
    if (e.data === '[DONE]') return;
    received.push(JSON.parse(e.data).text);
});

parser.push('data: {"text":"你"}\n\nda');       // 注意:下一个事件被拦腰切断
parser.push('ta: {"text":"好"}\n\ndata: {"text":"，世"}\n\n');
parser.push('data: {"text":"界"}\n\ndata: [DONE]\n\n');

console.log('流式解析结果:', received.join('')); // 你好，世界 —— 碎块拼接无损

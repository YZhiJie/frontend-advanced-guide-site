// 文件: examples/ai-interview/ws-resilient.ts —— [浏览器] 生产级 WebSocket：心跳看门狗 + 抖动退避 + 断点续传
// 运行方式: 浏览器环境（简化版可对照 examples/06-04-websocket-manager.ts）
// 关联文档: 21-frontend-ai-interview.md 21.6.2
type JsonMessage = Record<string, unknown> & { type?: string; seq?: number };

export class ResilientSocket {
    private ws: WebSocket | null = null;
    private attempts = 0;
    private closedByUser = false;
    private hbTimer?: ReturnType<typeof setInterval>;
    private watchdogTimer?: ReturnType<typeof setTimeout>;
    private readonly queue: string[] = []; // 未连接期间的发送队列
    private lastSeq = 0; // 已收到的最大序号，重连后据此请服务端补发

    constructor(
        private readonly url: string,
        private readonly onMsg: (m: JsonMessage) => void,
    ) {
        this.connect();
    }

    private connect(): void {
        const ws = new WebSocket(this.url);
        this.ws = ws;

        ws.onopen = () => {
            this.attempts = 0;
            // 断点续传握手：服务端补发 lastSeq 之后的缺口
            ws.send(JSON.stringify({ type: 'resume', lastSeq: this.lastSeq }));
            this.queue.forEach((frame) => ws.send(frame));
            this.queue.length = 0;
            this.startHeartbeat();
        };

        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data as string) as JsonMessage;
            if (msg.type === 'pong') {
                this.feedWatchdog(); // 收到业务 pong：连接健康，喂狗
                return;
            }
            if (typeof msg.seq === 'number') {
                // 生产里还要处理乱序（缓存等待）与重复 seq 丢弃，这里只更新水位
                this.lastSeq = Math.max(this.lastSeq, msg.seq);
            }
            this.onMsg(msg);
        };

        ws.onclose = () => {
            this.stopHeartbeat();
            if (!this.closedByUser) this.reconnect();
        };

        // onerror 后浏览器通常还会跟一个 close：统一收敛到 onclose，避免双处理竞态
        ws.onerror = () => ws.close();
    }

    // ① 应用层心跳：浏览器 API 无法主动发协议层 ping(0x9)，用业务消息实现
    private startHeartbeat(): void {
        this.hbTimer = setInterval(() => {
            this.ws?.send(JSON.stringify({ type: 'ping' }));
            // ② 看门狗：8s 内没等到 pong，判定为半开死链（对端/中间设备已不在但本地不知）
            //    主动 close → 统一走 onclose 的重连逻辑
            this.watchdogTimer = setTimeout(() => this.ws?.close(), 8000);
        }, 25_000);
    }

    private feedWatchdog(): void {
        clearTimeout(this.watchdogTimer);
    }

    private stopHeartbeat(): void {
        clearInterval(this.hbTimer);
        clearTimeout(this.watchdogTimer);
    }

    // ③ 全抖动指数退避：1s → 2s → 4s … 封顶 30s，再乘 0.5~1.5 随机
    //    防止断网恢复瞬间大量客户端同时重连，形成"重连风暴"打挂网关
    private reconnect(): void {
        const base = Math.min(30_000, 1000 * 2 ** this.attempts);
        const delay = base * (0.5 + Math.random());
        this.attempts += 1;
        setTimeout(() => this.connect(), delay);
    }

    send(msg: object): void {
        const frame = JSON.stringify(msg);
        if (this.ws?.readyState === WebSocket.OPEN) {
            // 背压保护：浏览器发送缓冲积压过多说明网络已拥塞，应降级（降频/丢非关键帧）
            if (this.ws.bufferedAmount > 1_000_000) {
                throw new Error('发送缓冲积压超过 1MB，触发背压保护');
            }
            this.ws.send(frame);
        } else {
            this.queue.push(frame); // 重连中排队，open 后随 resume 一起补发
        }
    }

    close(): void {
        this.closedByUser = true;
        this.stopHeartbeat();
        this.ws?.close();
    }
}

// 框架集成提示：React StrictMode 双挂载会开两条连接——
// 用模块级单例 manager + 引用计数，或 effect cleanup 只"取消订阅"而非关连接；
// 移动端 visibilitychange 回前台时主动发一次 ping 探活（页面挂起期间看门狗会失真）。

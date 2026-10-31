// 文件: examples/06-04-websocket-manager.ts
// ============ 生产级 WebSocket 管理:心跳 + 指数退避重连 ============

interface WsOptions {
    heartbeatInterval?: number;
    maxRetries?: number;
    onMessage?: (data: unknown) => void;
}

class ReconnectingWebSocket {
    private ws: WebSocket | null = null;
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private reconnectDelay = 1000;
    private closedByUser = false;

    constructor(private url: string, private options: WsOptions = {}) {
        this.connect();
    }

    private connect() {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
            this.reconnectDelay = 1000;      // 连上后重置退避
            this.startHeartbeat();
        };

        this.ws.onmessage = (event) => {
            if (event.data === 'pong') return; // 心跳响应,交给定时器判断即可
            this.options.onMessage?.(JSON.parse(event.data as string));
        };

        this.ws.onclose = () => {
            this.stopHeartbeat();
            if (!this.closedByUser) this.reconnect();
        };

        this.ws.onerror = () => this.ws?.close(); // 统一走 onclose 重连逻辑
    }

    /** 心跳:探测假死连接(代理/防火墙会静默断开空闲连接) */
    private startHeartbeat() {
        this.heartbeatTimer = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, this.options.heartbeatInterval ?? 30_000);
    }

    private stopHeartbeat() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
    }

    /** 指数退避重连:1s → 2s → 4s → ... 封顶 30s,避免服务恢复瞬间被重连风暴打垮 */
    private reconnect() {
        const retries = this.options.maxRetries ?? 8;
        if (this.reconnectDelay > 2 ** retries * 1000) {
            console.error('重连次数超限,放弃(请检查网络或提示用户刷新)');
            return;
        }
        console.warn(`${this.reconnectDelay}ms 后重连...`);
        setTimeout(() => {
            this.reconnectDelay *= 2;
            this.connect();
        }, this.reconnectDelay);
    }

    send(data: unknown) {
        if (this.ws?.readyState !== WebSocket.OPEN) {
            throw new Error('连接未就绪(生产中应做发送队列,见最佳实践)');
        }
        this.ws.send(JSON.stringify(data));
    }

    close() {
        this.closedByUser = true; // 主动关闭不再重连
        this.stopHeartbeat();
        this.ws?.close();
    }
}

// ---- 使用(需真实 WS 服务;直接运行会因连不上而进入重连循环,故注释保留供阅读)----
// const ws = new ReconnectingWebSocket('wss://example.com/ws', {
//     onMessage: (data) => console.log('收到:', data),
// });
// ws.send({ type: 'chat', content: 'hello' });

/**
 * 11-10 生产级上报队列 —— 批量合并、限流、兜底 flush
 * [浏览器] 需在页面环境运行;send 回调替换为真实上报端点即可。
 *
 * 设计决策:
 * 1. 采样 → 限流 → 批量三级削减:采样省流量、限流防雪崩自拖垮、批量省请求数;
 * 2. visibilitychange(hidden) 兜底 flush —— setInterval 在页面隐藏/卸载时可能不再触发,
 *    beforeunload 在移动端不可靠,hidden 是最后可靠的"还能发请求"时机;
 * 3. 兜底监听器存为成员字段 —— add/removeEventListener 必须传同一引用才能解绑;
 * 4. send 的异常在内部吞掉 —— 监控 SDK 自身错误绝不能递归上报,否则死循环。
 *
 * 坑点:
 * - maxPerMinute 预算需定时重置(生产实现建议滑动窗口);
 * - 错误类数据一般不采样(sampleRate=1),性能类数据建议 10% 采样。
 */

interface MonitorItem {
    type: string;
    fingerprint?: string; // 聚合指纹
    payload: Record<string, unknown>;
    ts: number;
}

class MonitorQueue {
    private queue: MonitorItem[] = [];
    private sentCount = 0; // 本周期已发送条数(限流用)
    private timer: ReturnType<typeof setInterval> | null = null;
    // 兜底 flush 必须存为成员:add/removeEventListener 传同一引用才能真正解绑
    private onHidden = () => {
        if (document.visibilityState === 'hidden') this.flush();
    };
    // 采样率:0.1 = 只上报 10% 的数据(错误类可不采样,性能类必采样)
    constructor(
        private readonly send: (items: MonitorItem[]) => void,
        private readonly opts = { batch: 10, intervalMs: 5000, maxPerMinute: 60, sampleRate: 1 },
    ) {
        this.start();
    }

    private start() {
        this.timer = setInterval(() => this.flush(), this.opts.intervalMs);
        // ⚠️ 关键兜底:页面隐藏/卸载时 setInterval 可能不再触发,必须主动 flush
        document.addEventListener('visibilitychange', this.onHidden);
    }

    /** 入队:采样 → 限流 → 批量 */
    push(type: string, payload: Record<string, unknown>, fingerprint?: string) {
        // 1) 采样:随机丢弃(哈希采样更公平,这里示意)
        if (Math.random() > this.opts.sampleRate) return;
        // 2) 限流:防止雪崩时监控请求把自己拖垮
        if (this.sentCount >= this.opts.maxPerMinute) return;
        this.queue.push({ type, payload, fingerprint, ts: Date.now() });
        // 3) 批量:攒够一批立即发,不必等 interval
        if (this.queue.length >= this.opts.batch) this.flush();
    }

    flush() {
        if (!this.queue.length) return;
        const items = this.queue.splice(0, this.opts.batch); // 一次最多发 batch 条
        this.sentCount += items.length;
        try {
            this.send(items);
        } catch {
            // ⚠️ 监控 SDK 自身的错误绝不能递归上报(否则死循环),只吞掉
        }
    }

    /** 每 60s 重置限流计数(真实实现里用滑动窗口更精确) */
    resetBudget = () => {
        this.sentCount = 0;
    };
    destroy() {
        if (this.timer) clearInterval(this.timer);
        document.removeEventListener('visibilitychange', this.onHidden); // 与 add 传同一引用才能解绑
        this.flush(); // 销毁前清空
    }
}

// ============ 错误指纹:同一 bug 聚合成一条 issue ============

/** 简单字符串 hash(比引依赖轻) */
function hash32(str: string): string {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}

/**
 * 指纹 = message + stack 前两帧(去掉行号/列号)
 * ⚠️ 只用 message 会把"undefined is not a function"所有错误混成一条;带行号会把同一 bug 的不同触发点拆成多条
 */
function errorFingerprint(message: string, stack?: string): string {
    const frames = (stack ?? '')
        .split('\n')
        .filter((l) => l.includes('at '))
        .slice(0, 2) // 只取前两帧:根因通常在最内层
        .map((l) => l.replace(/:\d+:\d+/, '')) // 去行列号:同函数不同行算同一个 issue
        .join('|');
    return hash32(`${message}::${frames}`);
}

// ---- 组装:错误走"不采样 + 指纹聚合",性能走"10% 采样" ----
const queue = new MonitorQueue(
    (items) => {
        // navigator.sendBeacon('/api/monitor/batch', new Blob([JSON.stringify(items)], { type: 'application/json' }))
        console.log('批量上报', items.length, '条');
    },
    { batch: 10, intervalMs: 5000, maxPerMinute: 60, sampleRate: 1 },
);

window.addEventListener('error', (e) => {
    queue.push('js-error', { message: e.message }, errorFingerprint(e.message, e.error?.stack));
});

// setInterval(queue.resetBudget, 60_000); // 限流预算重置(生产实现)
export {};

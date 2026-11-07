// 文件: examples/19-07-tracking.ts
// ============ 埋点上报:批量队列 + 定时/阈值 flush + 页面关闭兜底 + 曝光监听 ============
// 每条事件一次请求会把连接数打爆;只靠定时 flush 又会在关页面时丢最后一批。
// 这里三件套齐发:攒够 N 条立即发、每隔 T 秒兜底发、pagehide 用 sendBeacon 强发。

export interface TrackEvent {
    name: string;
    data?: Record<string, unknown>;
    ts: number;
}

/** 发送器由业务注入(浏览器里接 fetch/sendBeacon,单测里接数组收集) */
export type TrackSender = (events: TrackEvent[]) => Promise<void> | void;

export interface ReporterOptions {
    /** 攒够多少条立即上报 */
    flushSize?: number;
    /** 定时上报间隔(ms) */
    flushInterval?: number;
    send: TrackSender;
}

export class Reporter {
    private queue: TrackEvent[] = [];
    private readonly flushSize: number;
    private readonly flushInterval: number;
    private readonly send: TrackSender;
    private timer: ReturnType<typeof setInterval> | null = null;
    private flushing = false;

    constructor(options: ReporterOptions) {
        this.flushSize = options.flushSize ?? 10;
        this.flushInterval = options.flushInterval ?? 5000;
        this.send = options.send;
    }

    /** 开启定时上报(SPA 整个生命周期一个实例即可) */
    start(): void {
        if (this.timer) return;
        this.timer = setInterval(() => void this.flush(), this.flushInterval);
    }

    /** 埋一条事件 */
    track(name: string, data?: Record<string, unknown>): void {
        this.queue.push({ name, data, ts: Date.now() });
        if (this.queue.length >= this.flushSize) void this.flush();
    }

    /** 把当前队列一次性发出去;发送中不重入,失败的事件重新塞回队首下次重试 */
    async flush(): Promise<void> {
        if (this.flushing || this.queue.length === 0) return;
        const batch = this.queue;
        this.queue = [];
        this.flushing = true;
        try {
            await this.send(batch);
        } catch (err) {
            // ⚠️ 不能丢:失败事件回插队首,下一轮优先重发
            this.queue = [...batch, ...this.queue];
            console.warn('[reporter] 上报失败,已回退到队列:', err instanceof Error ? err.message : err);
        } finally {
            this.flushing = false;
        }
    }

    /** 页面隐藏/关闭时调用:sendBeacon 异步不阻塞卸载,保证最后一批不丢 */
    flushOnHide(): void {
        if (this.queue.length === 0) return;
        const payload = JSON.stringify(this.queue);
        // sendBeacon 不可用或被拒时,退回带 keepalive 的 fetch(卸载阶段仍可能完成)
        if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
            const queued = navigator.sendBeacon('/api/track', payload);
            if (queued) this.queue = [];
        }
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }
}

/**
 * 浏览器接线:监听 pagehide(iOS Safari 上 unload/beforeunload 不可靠,见 10.3)。
 * 单独导出而不是构造函数里自动绑定:Node/SSR 环境没有 document,且便于单测。
 */
export function bindPageHide(reporter: Reporter): () => void {
    const handler = (): void => reporter.flushOnHide();
    document.addEventListener('pagehide', handler);
    return () => document.removeEventListener('pagehide', handler);
}

/**
 * 元素曝光监听(广告/卡片/推荐位):
 * 进入视口即回调,once=true 时每个元素只报一次;阈值用 intersectionRatio 兜底,
 * 避免 IntersectionObserver 阈值在某些浏览器对 0 的实现差异。
 */
export function observeExposure(
    elements: Element[],
    onExpose: (el: Element) => void,
    options: { threshold?: number; once?: boolean } = {},
): IntersectionObserver {
    const { threshold = 0.5, once = true } = options;
    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting && entry.intersectionRatio >= threshold) {
                    onExpose(entry.target);
                    if (once) observer.unobserve(entry.target);
                }
            }
        },
        { threshold },
    );
    for (const el of elements) observer.observe(el);
    return observer;
}

/**
 * 点击事件委托:容器内带 data-track 的元素被点即上报,
 * data-track-* 其余属性自动作为事件参数。列表里成百上千个卡片只绑一个监听。
 */
export function delegateClickTrack(container: Element, eventName = 'click'): () => void {
    const handler = (event: Event): void => {
        const target = (event.target as Element | null)?.closest('[data-track]');
        if (!target || !container.contains(target)) return;
        const name = target.getAttribute('data-track') as string;
        const data: Record<string, string> = {};
        for (const attr of Array.from(target.attributes)) {
            if (attr.name.startsWith('data-track-')) {
                data[attr.name.slice('data-track-'.length)] = attr.value;
            }
        }
        // 实际项目里从外面注入 reporter;此处直接派发自定义事件解耦
        container.dispatchEvent(new CustomEvent('track', { detail: { name, data } }));
    };
    container.addEventListener(eventName, handler);
    return () => container.removeEventListener(eventName, handler);
}

// ---------------- 验证(注入假发送器,不依赖浏览器) ----------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---- 阈值触发:连埋 3 条(flushSize=3)立即收到一批 ----
let receivedBatches: number = 0;
const reporter = new Reporter({
    flushSize: 3,
    flushInterval: 60_000, // 调大,排除定时干扰
    send: async (events) => {
        receivedBatches += 1;
        console.log(`第 ${receivedBatches} 批,${events.length} 条:`, events.map((e) => e.name));
    },
});
reporter.start();
reporter.track('page_view', { from: 'home' });
reporter.track('banner_click');
reporter.track('add_cart', { sku: 'SKU-1' });
await sleep(10); // 等 flush 的微任务链完成
console.log('批次数 =', receivedBatches); // 1

// ---- 失败重试:发送器第一次抛错,事件回队首,下一轮重发成功 ----
let attempt = 0;
const retryReporter = new Reporter({
    flushSize: 1,
    send: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('网络断了');
    },
});
retryReporter.track('pay_click');
await retryReporter.flush(); // 第 1 次失败,事件退回队列
console.log('第 1 次后队列长度 =', (retryReporter as unknown as { queue: unknown[] }).queue.length); // 1
await retryReporter.flush(); // 第 2 次成功
console.log('第 2 次后队列长度 =', (retryReporter as unknown as { queue: unknown[] }).queue.length); // 0

reporter.stop();
retryReporter.stop();

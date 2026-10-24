/**
 * 11-11 接口耗时埋点与行为轨迹 —— 错误发生时随报错一起上报最近 N 步操作
 * [浏览器] 需在页面环境运行,与 11-10 的队列配合使用。
 *
 * 设计决策:
 * 1. 拦截 globalThis.fetch 记录接口耗时 —— 请求层统一走 fetch 时一个包装点覆盖全部请求;
 * 2. 行为轨迹用环形缓冲区(shift 丢最旧),只保留最近 20 步 —— 内存可控且足够复现;
 * 3. 点击埋点用事件委托挂捕获阶段 —— 业务代码 stopPropagation 也不会丢轨迹;
 * 4. 错误发生时把轨迹快照一并上报 —— 有了"用户点了什么、接口返回了什么"才能离线复现。
 *
 * 坑点:
 * - fetch 拦截必须在所有业务代码之前执行(放入口最顶部),否则漏掉早期请求;
 * - 埋点元素用 data-track 声明式打标,禁止在业务代码里散落 pushTrace 调用。
 */

// ---- 1. 接口耗时:拦截 fetch(比拦截 XHR 简单,建议请求层统一用 fetch)----
type FetchLike = typeof fetch;
const rawFetch: FetchLike = globalThis.fetch;

// ---- 2. 行为轨迹:环形缓冲区,只保留最近 20 步(内存可控)----
interface TraceItem {
    kind: string;
    url?: string;
    ms?: number;
    status?: number | string;
    label?: string;
    ts: number;
}

const TRACE_LIMIT = 20;
const monitorTrace: TraceItem[] = [];

function pushTrace(item: Omit<TraceItem, 'ts'>) {
    monitorTrace.push({ ...item, ts: Date.now() });
    if (monitorTrace.length > TRACE_LIMIT) monitorTrace.shift(); // 满了丢最旧的
}

globalThis.fetch = async function tracedFetch(input, init) {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
    const start = performance.now();
    try {
        const res = await rawFetch.call(globalThis, input, init);
        pushTrace({ kind: 'api', url, ms: Math.round(performance.now() - start), status: res.status });
        return res;
    } catch (err) {
        pushTrace({ kind: 'api', url, ms: Math.round(performance.now() - start), status: 'network-error' });
        throw err;
    }
};

// 关键用户操作也入轨迹:点击用事件委托一次搞定
document.addEventListener(
    'click',
    (e) => {
        const el = (e.target as HTMLElement).closest<HTMLElement>('[data-track]');
        if (el) pushTrace({ kind: 'click', label: el.dataset.track! });
    },
    true, // 捕获阶段:防止业务 stopPropagation 后丢轨迹
);

// ---- 3. 错误发生时:报错 + 最近轨迹一起上报 ----
window.addEventListener('error', (e) => {
    // sendBeacon(JSON.stringify({ type: 'js-error', message: e.message, trace: [...monitorTrace] }))
    console.log('上报错误与轨迹:', e.message, monitorTrace.slice(-5));
});

pushTrace({ kind: 'click', label: '提交订单' });
export {};

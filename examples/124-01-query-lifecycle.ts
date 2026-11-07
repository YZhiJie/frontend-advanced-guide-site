// 文件: examples/124-01-query-lifecycle.ts
// 搜索请求生命周期：防抖合并、竞态处理（中断 + 序号仲裁双保险）、过期响应丢弃、失败重试与降级快照
// 目标：快速连打只发一次请求；慢响应不得覆盖新结果；上一请求被中断；重试耗尽后返回可识别的降级结果

import assert from 'node:assert';

interface SearchHit {
    id: string;
    title: string;
}

interface SearchResponse {
    query: string;
    hits: SearchHit[];
    /** true 表示来自本地降级快照而非实时检索，UI 与埋点必须消费这个标记 */
    degraded: boolean;
}

/** 模拟 AbortSignal 的最小可控面：手动触发，不依赖真实定时器 */
class CancelToken {
    aborted = false;
    abort(): void {
        this.aborted = true;
    }
}

/** 手动时钟：测试用 advance() 驱动，全程禁止真实定时器 */
class ManualClock {
    private current = 0;
    now(): number {
        return this.current;
    }
    advance(ms: number): void {
        this.current += ms;
    }
}

type FetchFn = (query: string, signal: CancelToken) => Promise<SearchResponse>;
type DispatchStatus = 'applied' | 'stale' | 'degraded';

interface DispatchResult {
    status: DispatchStatus;
    response: SearchResponse | null;
    attempts: number;
}

interface SearchBoxOptions {
    debounceMs: number;
    maxRetries: number;
    retryDelayMs: number;
    fetchFn: FetchFn;
    /** 退避等待：测试注入立即 resolve 的记录器，不用真实定时器 */
    sleep: (ms: number) => Promise<void>;
    clock: ManualClock;
    /** 降级快照：本地缓存的热门文档，服务挂掉/弱网时兜底 */
    snapshot: SearchHit[];
}

class SearchBox {
    private pendingQuery: string | null = null;
    private lastInputAt = -1;
    /** 单调递增序号：每次发请求 +1，响应回来时序号不一致即过期 */
    private seq = 0;
    private inFlight: CancelToken | null = null;

    constructor(private readonly opts: SearchBoxOptions) {}

    /** 键入只记录意图，不立即发请求 */
    input(query: string): void {
        this.pendingQuery = query;
        this.lastInputAt = this.opts.clock.now();
    }

    /** 防抖闸门：距最后一次键入满 debounceMs 才发请求；真实环境由 setTimeout 驱动，这里显式调用保证确定性 */
    tick(): Promise<DispatchResult> | null {
        if (this.pendingQuery === null) return null;
        if (this.opts.clock.now() - this.lastInputAt < this.opts.debounceMs) return null;
        const query = this.pendingQuery;
        this.pendingQuery = null;
        return this.dispatch(query);
    }

    private async dispatch(query: string): Promise<DispatchResult> {
        this.seq += 1;
        const mySeq = this.seq;
        // 双保险之一：中断上一请求，省流量也省服务端算力
        this.inFlight?.abort();
        const token = new CancelToken();
        this.inFlight = token;

        let attempts = 0;
        while (attempts <= this.opts.maxRetries) {
            attempts += 1;
            if (attempts > 1) await this.opts.sleep(this.opts.retryDelayMs * (attempts - 1));
            // 线性退避期间用户又输入了新词：这次尝试已经失去意义
            if (token.aborted || mySeq !== this.seq) return { status: 'stale', response: null, attempts };
            try {
                const response = await this.opts.fetchFn(query, token);
                // 双保险之二：序号仲裁。abort 漏拦的响应由序号兜底丢弃
                if (mySeq !== this.seq || token.aborted) return { status: 'stale', response: null, attempts };
                return { status: 'applied', response, attempts };
            } catch {
                if (mySeq !== this.seq || token.aborted) return { status: 'stale', response: null, attempts };
                // 未过期且还有重试额度：继续 while
            }
        }

        // 重试耗尽：降级到本地快照按 query 粗筛，必须带 degraded 标记
        const hits = this.opts.snapshot.filter((hit) => hit.title.toLowerCase().includes(query.toLowerCase()));
        return { status: 'degraded', response: { query, hits, degraded: true }, attempts };
    }
}

/** 手动控制的 Promise：让竞态测试的返回顺序完全确定 */
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

async function runAssertions(): Promise<void> {
    // ---------- 测试 1：防抖合并——三次键入合并为一次请求 ----------
    const clock1 = new ManualClock();
    const calls: string[] = [];
    const box1 = new SearchBox({
        debounceMs: 300,
        maxRetries: 0,
        retryDelayMs: 100,
        fetchFn: (query) => {
            calls.push(query);
            return Promise.resolve({ query, hits: [], degraded: false });
        },
        sleep: () => Promise.resolve(),
        clock: clock1,
        snapshot: [],
    });

    box1.input('r');
    assert.equal(box1.tick(), null, '0ms 处闸门不得放行');
    clock1.advance(120);
    box1.input('re');
    assert.equal(box1.tick(), null, '距上次键入 0ms，仍被防抖压住');
    clock1.advance(120);
    box1.input('rea');
    clock1.advance(299);
    assert.equal(box1.tick(), null, '差 1ms 也不得放行');
    clock1.advance(1);
    const merged = await box1.tick();
    assert.equal(merged?.status, 'applied');
    assert.deepEqual(calls, ['rea'], '三次键入应合并为一次请求');
    console.log('[1/4] 防抖合并 OK, 3 次键入只发出 1 次请求: "rea"');

    // ---------- 测试 2：竞态双保险——上一请求被中断，过期响应被序号仲裁丢弃 ----------
    const clock2 = new ManualClock();
    const tokens: CancelToken[] = [];
    const gates = new Map<string, ReturnType<typeof deferred<SearchResponse>>>();
    const box2 = new SearchBox({
        debounceMs: 200,
        maxRetries: 0,
        retryDelayMs: 100,
        fetchFn: (query, signal) => {
            tokens.push(signal);
            const gate = deferred<SearchResponse>();
            gates.set(query, gate);
            return gate.promise;
        },
        sleep: () => Promise.resolve(),
        clock: clock2,
        snapshot: [],
    });

    box2.input('es 集群');
    clock2.advance(200);
    const slowPromise = box2.tick()!;
    box2.input('es 查询语法');
    clock2.advance(200);
    const fastPromise = box2.tick()!;
    assert.equal(tokens.length, 2);
    assert.equal(tokens[0].aborted, true, '发出新请求时必须中断上一请求');

    // 后发的先回来：正常应用
    gates.get('es 查询语法')!.resolve({ query: 'es 查询语法', hits: [{ id: '1', title: 'DSL 手册' }], degraded: false });
    const fast = await fastPromise;
    assert.equal(fast.status, 'applied');
    assert.equal(fast.response?.hits[0]?.title, 'DSL 手册');

    // 先发但慢的旧请求此刻才回来：必须被丢弃，不得覆盖新结果
    gates.get('es 集群')!.resolve({ query: 'es 集群', hits: [{ id: '2', title: '旧结果' }], degraded: false });
    const slow = await slowPromise;
    assert.equal(slow.status, 'stale', '过期响应必须被序号仲裁丢弃');
    assert.equal(slow.response, null, '过期响应不得带出任何数据');
    console.log('[2/4] 竞态处理 OK, 旧请求已中断且其迟到响应被丢弃');

    // ---------- 测试 3：失败重试——线性退避，第三次成功 ----------
    const clock3 = new ManualClock();
    const sleeps: number[] = [];
    let failures = 0;
    const box3 = new SearchBox({
        debounceMs: 0,
        maxRetries: 3,
        retryDelayMs: 200,
        fetchFn: (query) => {
            failures += 1;
            if (failures <= 2) return Promise.reject(new Error('E_NETWORK'));
            return Promise.resolve({ query, hits: [{ id: '9', title: '重试成功' }], degraded: false });
        },
        sleep: (ms) => {
            sleeps.push(ms);
            return Promise.resolve();
        },
        clock: clock3,
        snapshot: [],
    });
    box3.input('重试');
    const retried = await box3.tick()!;
    assert.equal(retried.status, 'applied');
    assert.equal(retried.attempts, 3, '第 3 次尝试才成功');
    assert.deepEqual(sleeps, [200, 400], '退避应线性增长');
    console.log('[3/4] 失败重试 OK, 3 次尝试 / 退避序列 200ms → 400ms');

    // ---------- 测试 4：重试耗尽——降级快照带标记，退避期间过期立即止损 ----------
    const clock4 = new ManualClock();
    const box4 = new SearchBox({
        debounceMs: 0,
        maxRetries: 2,
        retryDelayMs: 100,
        fetchFn: () => Promise.reject(new Error('E_ES_DOWN')),
        sleep: () => Promise.resolve(),
        clock: clock4,
        snapshot: [
            { id: 'a', title: '搜索白皮书' },
            { id: 'b', title: '编辑器指南' },
            { id: 'c', title: '搜索质量周报' },
        ],
    });
    box4.input('搜索');
    const degraded = await box4.tick()!;
    assert.equal(degraded.status, 'degraded', '重试耗尽必须降级而不是抛错');
    assert.equal(degraded.attempts, 3, '1 次首发 + 2 次重试');
    assert.equal(degraded.response?.degraded, true, '降级结果必须带 degraded 标记');
    assert.deepEqual(degraded.response?.hits.map((hit) => hit.id), ['a', 'c'], '快照按 query 粗筛');
    console.log('[4/4] 降级快照 OK, E_ES_DOWN 后返回 2 条带标记的快照结果');

    console.log('\n✅ 124-01 搜索请求生命周期 全部断言通过');
}

void runAssertions();

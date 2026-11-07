// 文件: examples/124-04-suggest-cache.ts
// 搜索建议：前缀 LRU 缓存、在途请求合并（同 key 只发一次）、键盘导航索引环绕、零结果回退热词
// 目标：相同前缀只打一次后端；缓存有界可淘汰；↓↑ 在候选间环绕；零结果有体面退路

import assert from 'node:assert';

interface Suggestion {
    text: string;
    /** true 表示来自热词兜底而非前缀匹配，UI 应降低权重或加分隔线 */
    fallback: boolean;
}

type SuggestSource = 'network' | 'cache' | 'dedup';

interface SuggestResult {
    list: Suggestion[];
    source: SuggestSource;
}

/** 有界 LRU：Map 迭代序即插入序，get 命中后删除重插以刷新热度 */
class LruCache<V> {
    private readonly store = new Map<string, V>();

    constructor(private readonly capacity: number) {
        assert.ok(capacity > 0, '容量必须为正');
    }

    get size(): number {
        return this.store.size;
    }

    has(key: string): boolean {
        return this.store.has(key);
    }

    get(key: string): V | undefined {
        const value = this.store.get(key);
        if (value === undefined) return undefined;
        this.store.delete(key);
        this.store.set(key, value); // 命中即刷新为最新
        return value;
    }

    set(key: string, value: V): void {
        if (this.store.has(key)) this.store.delete(key);
        this.store.set(key, value);
        while (this.store.size > this.capacity) {
            const oldest = this.store.keys().next().value!;
            this.store.delete(oldest);
        }
    }
}

interface SuggestOptions {
    capacity: number;
    fetchFn: (prefix: string) => Promise<string[]>;
    /** 零结果时兜底的热词 */
    hotWords: string[];
}

class SuggestService {
    private readonly cache: LruCache<Suggestion[]>;
    /** 在途请求表：同 key 复用同一个 Promise，这才是「只发一次」的真正闸门 */
    private readonly inflight = new Map<string, Promise<Suggestion[]>>();

    constructor(private readonly opts: SuggestOptions) {
        this.cache = new LruCache(opts.capacity);
    }

    /** 归一 key：大小写与首尾空白不应制造新请求 */
    private normalizeKey(prefix: string): string {
        return prefix.trim().toLowerCase();
    }

    async request(prefix: string): Promise<SuggestResult> {
        const key = this.normalizeKey(prefix);

        const cached = this.cache.get(key);
        if (cached !== undefined) return { list: cached, source: 'cache' };

        const running = this.inflight.get(key);
        if (running !== undefined) return { list: await running, source: 'dedup' };

        const promise = this.opts
            .fetchFn(key)
            .then((words) => this.toSuggestions(words))
            .finally(() => this.inflight.delete(key));
        this.inflight.set(key, promise);

        const list = await promise;
        // 零结果的兜底同样进缓存：空结果不该反复打后端
        this.cache.set(key, list);
        return { list, source: 'network' };
    }

    private toSuggestions(words: string[]): Suggestion[] {
        if (words.length === 0) {
            return this.opts.hotWords.map((text) => ({ text, fallback: true }));
        }
        return words.map((text) => ({ text, fallback: false }));
    }
}

/**
 * 键盘导航：-1 表示「未选中，输入框保持原文」。
 * ↓ 越过末位回到 0，↑ 越过首位回到底部——环绕而不是夹住，是建议列表的共识交互。
 */
function moveCursor(current: number, delta: 1 | -1, length: number): number {
    if (length <= 0) return -1;
    const next = current + delta;
    if (next >= length) return 0;
    if (next < 0) return length - 1;
    return next;
}

/** 手动控制的 Promise：让并发合并测试的时序完全确定 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

async function runAssertions(): Promise<void> {
    // ---------- 测试 1：LRU——容量有界，命中刷新热度，淘汰最久未用 ----------
    const lru = new LruCache<number>(3);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.set('c', 3);
    assert.equal(lru.get('a'), 1, '命中 a 并刷新为最新');
    lru.set('d', 4); // 容量满，挤掉最久未用的 b
    assert.ok(!lru.has('b'), 'b 应被淘汰');
    assert.ok(lru.has('a') && lru.has('c') && lru.has('d'));
    lru.set('e', 5); // 挤掉 c
    assert.ok(!lru.has('c'), 'c 应被淘汰');
    assert.equal(lru.size, 3, '容量永远有界');
    console.log('[1/4] LRU 缓存 OK, 容量 3 / 命中刷新 / 淘汰最久未用');

    // ---------- 测试 2：在途合并 + 缓存——同 key 只发一次真实请求 ----------
    let fetchCount = 0;
    const gates = new Map<string, ReturnType<typeof deferred<string[]>>>();
    const svc = new SuggestService({
        capacity: 8,
        fetchFn: (prefix) => {
            fetchCount += 1;
            const gate = deferred<string[]>();
            gates.set(prefix, gate);
            return gate.promise;
        },
        hotWords: ['全员公告', '值班手册'],
    });

    const p1 = svc.request('Elastic');
    const p2 = svc.request('  elastic '); // 归一后与上一发同 key
    assert.equal(fetchCount, 1, '同 key 在途请求必须合并');
    gates.get('elastic')!.resolve(['elastic 入门', 'elastic 调优']);
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1.source, 'network');
    assert.equal(r2.source, 'dedup', '第二发复用在途 Promise');
    assert.deepEqual(
        r1.list.map((s) => s.text),
        r2.list.map((s) => s.text),
    );
    assert.ok(r1.list.every((s) => !s.fallback));

    const r3 = await svc.request('ELASTIC');
    assert.equal(r3.source, 'cache', '同 key 再次请求走缓存');
    assert.equal(fetchCount, 1, '缓存命中不再打后端');

    const p4 = svc.request('ela');
    assert.equal(fetchCount, 2, '不同前缀是不同 key');
    gates.get('ela')!.resolve(['ela 简介']);
    await p4;
    console.log('[2/4] 在途合并 OK, 3 次同 key 请求只发 1 次真实请求');

    // ---------- 测试 3：键盘导航环绕——↓↑ 越过边界环绕，空列表永不选中 ----------
    assert.equal(moveCursor(1, 1, 4), 2);
    assert.equal(moveCursor(3, 1, 4), 0, '↓ 越过末位回顶部');
    assert.equal(moveCursor(0, -1, 4), 3, '↑ 越过首位回底部');
    assert.equal(moveCursor(-1, 1, 4), 0, '未选中按 ↓ 选中第一项');
    assert.equal(moveCursor(-1, -1, 4), 3, '未选中按 ↑ 选中末项');
    assert.equal(moveCursor(2, 1, 0), -1, '空列表永不选中');
    console.log('[3/4] 键盘导航 OK, 边界环绕 / 空列表返回 -1');

    // ---------- 测试 4：零结果回退——热词兜底带标记，且空结果同样进缓存 ----------
    const pz = svc.request('zzz');
    gates.get('zzz')!.resolve([]); // 后端返回空
    const rz = await pz;
    assert.equal(rz.source, 'network');
    assert.ok(rz.list.length > 0, '零结果必须有兜底');
    assert.ok(rz.list.every((s) => s.fallback), '兜底项必须带 fallback 标记');
    assert.deepEqual(
        rz.list.map((s) => s.text),
        ['全员公告', '值班手册'],
    );

    const rz2 = await svc.request('ZZZ');
    assert.equal(rz2.source, 'cache', '空结果兜底同样进缓存');
    assert.equal(fetchCount, 3, '空结果不得反复打后端');
    console.log('[4/4] 零结果回退 OK, 热词兜底带标记且被缓存');

    console.log('\n✅ 124-04 搜索建议缓存 全部断言通过');
}

void runAssertions();

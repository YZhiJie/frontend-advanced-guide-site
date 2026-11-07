// 文件: examples/114-03-keepalive-cache-key.ts
// keep-alive 缓存键：include 白名单、参数/查询归一化、LRU 上限与定向失效
// 目标：同组件多实例不串页、无害参数不产生新缓存、超限淘汰最久未用、登出可定向清理

import assert from 'node:assert';

interface RouteLocation {
    name: string;
    component: string;
    params?: Record<string, string>;
    query?: Record<string, string | string[]>;
}

interface CachePolicy {
    include: string[]; // 只缓存白名单组件，对应 <keep-alive :include>
    maxEntries: number; // 对应 <keep-alive :max>，必须显式配置
    keyParams: Record<string, string[]>; // 路由 → 参与 key 的 params
    keyQuery: Record<string, string[]>; // 路由 → 参与 key 的 query
    volatileQueryKeys: string[]; // 渠道/时间戳等易变参数，永不进 key
}

interface CacheEntry {
    key: string;
    name: string;
    component: string;
    hits: number;
    lastUsed: number;
}

interface EnterResult {
    cached: boolean;
    key: string;
    evicted?: string;
}

function normalizeValue(value: string | string[]): string {
    // 数组查询排序后拼接：tags=a&tags=b 与 tags=b&tags=a 是同一份数据
    const list = Array.isArray(value) ? [...value].sort() : [value];
    return list.join(',');
}

/** 缓存键 = 路由名 + 参与缓存的 param + 参与缓存的 query（双向排序，与书写顺序无关） */
function buildCacheKey(location: RouteLocation, policy: CachePolicy): string {
    const paramKeys = [...(policy.keyParams[location.name] ?? Object.keys(location.params ?? {}))].sort();
    const params = paramKeys.map((key) => `${key}=${normalizeValue(location.params?.[key] ?? '')}`).join('&');

    const queryKeys = [...(policy.keyQuery[location.name] ?? [])].filter((key) => !policy.volatileQueryKeys.includes(key)).sort();
    const query = queryKeys
        .map((key) => {
            const value = location.query?.[key];
            return value === undefined ? '' : `${key}=${normalizeValue(value)}`;
        })
        .filter((pair) => pair !== '')
        .join('&');

    return `${location.name}?${params}|${query}`;
}

class KeepAliveCache {
    private entries = new Map<string, CacheEntry>();
    private clock = 0;
    readonly evictedKeys: string[] = [];

    constructor(private readonly policy: CachePolicy) {}

    get size(): number {
        return this.entries.size;
    }

    get(key: string): CacheEntry | undefined {
        return this.entries.get(key);
    }

    /** 页面进入：命中则续期，未命中则新建；超过上限先淘汰最久未用 */
    enter(location: RouteLocation): EnterResult {
        const key = buildCacheKey(location, this.policy);
        if (!this.policy.include.includes(location.component)) {
            return { cached: false, key };
        }
        const hit = this.entries.get(key);
        if (hit !== undefined) {
            hit.hits += 1;
            hit.lastUsed = ++this.clock;
            return { cached: true, key };
        }
        const limit = Math.max(1, this.policy.maxEntries);
        let evicted: string | undefined;
        if (this.entries.size >= limit) evicted = this.evictLru();
        this.entries.set(key, { key, name: location.name, component: location.component, hits: 0, lastUsed: ++this.clock });
        return { cached: false, key, evicted };
    }

    private evictLru(): string {
        let oldest: CacheEntry | undefined;
        for (const entry of this.entries.values()) {
            if (oldest === undefined || entry.lastUsed < oldest.lastUsed) oldest = entry;
        }
        assert.ok(oldest !== undefined, '缓存已满时必有可淘汰项');
        this.entries.delete(oldest.key);
        this.evictedKeys.push(oldest.key);
        return oldest.key;
    }

    /** 按页面批量失效：发布新版本 / 退出登录 / 权限变更后调用 */
    invalidateByName(name: string): number {
        let removed = 0;
        for (const [key, entry] of this.entries) {
            if (entry.name === name) {
                this.entries.delete(key);
                removed += 1;
            }
        }
        return removed;
    }

    invalidateByKey(key: string): boolean {
        return this.entries.delete(key);
    }

    clear(): number {
        const removed = this.entries.size;
        this.entries.clear();
        return removed;
    }
}

const POLICY: CachePolicy = {
    include: ['OrderDetailPage', 'ProductDetailPage', 'SearchPage'],
    maxEntries: 2,
    keyParams: {
        'order-detail': ['orderId'],
        'product-detail': ['productId', 'locale'],
        search: ['keyword'],
    },
    keyQuery: {
        'product-detail': ['variant'],
        search: ['page', 'filters'],
    },
    volatileQueryKeys: ['utm_source', 'utm_medium', 'from', '_t'],
};

const orderLocation = (orderId: string, query?: RouteLocation['query']): RouteLocation => ({
    name: 'order-detail',
    component: 'OrderDetailPage',
    params: { orderId },
    query,
});

const productLocation = (productId: string, locale: string, query?: RouteLocation['query']): RouteLocation => ({
    name: 'product-detail',
    component: 'ProductDetailPage',
    params: { productId, locale },
    query,
});

function searchLocation(keyword: string, page: string, filters: string[]): RouteLocation {
    return { name: 'search', component: 'SearchPage', params: { keyword }, query: { page, filters } };
}

function runAssertions() {
    // ---------- 测试 1：白名单与无害参数不产生新缓存 ----------
    const cache1 = new KeepAliveCache(POLICY);
    const checkout: RouteLocation = { name: 'checkout', component: 'CheckoutPage' };
    assert.equal(cache1.enter(checkout).cached, false, '结算页不应进 keep-alive');
    assert.equal(cache1.size, 0);

    const order1 = orderLocation('A100', { utm_source: 'mail', from: 'cart', _t: '1710000000' });
    const first = cache1.enter(order1);
    assert.equal(first.cached, false);
    const again = cache1.enter(orderLocation('A100', { from: 'search', utm_medium: 'cpc', _t: '1710000001' }));
    assert.equal(again.cached, true, '渠道参数变化不应换 key');
    assert.equal(again.key, first.key);
    assert.equal(cache1.size, 1);
    assert.equal(cache1.get(first.key)?.hits, 1);
    console.log('[1/4] 白名单与易变参数 OK, key:', first.key);

    // ---------- 测试 2：多实例隔离——粗 key 会串页 ----------
    const cache2 = new KeepAliveCache(POLICY);
    const keyA = cache2.enter(orderLocation('A100')).key;
    const keyB = cache2.enter(orderLocation('A101')).key;
    assert.notEqual(keyA, keyB, '不同订单必须有不同 key');
    assert.equal(cache2.size, 2, '订单详情以多实例缓存');
    assert.equal(
        buildCacheKey(productLocation('7', 'en', { utm_source: 'x' }), POLICY),
        buildCacheKey(productLocation('7', 'en', { utm_source: 'y' }), POLICY),
        '易变渠道参数不进 key',
    );
    assert.notEqual(buildCacheKey(productLocation('7', 'en', { variant: 'red' }), POLICY), buildCacheKey(productLocation('7', 'en', { variant: 'blue' }), POLICY), '规格不同不能共用缓存');

    // 反例：meta 里漏写 orderId 的粗 key 策略，两个订单会命中同一份缓存（串页）
    const coarsePolicy: CachePolicy = { ...POLICY, keyParams: { ...POLICY.keyParams, 'order-detail': [] } };
    assert.equal(buildCacheKey(orderLocation('A100'), coarsePolicy), buildCacheKey(orderLocation('A101'), coarsePolicy), '粗 key 必然串页');
    console.log('[2/4] 多实例隔离 OK:', keyA, '/', keyB);

    // ---------- 测试 3：LRU 上限——超限淘汰最久未用，而不是最新的 ----------
    const cache3 = new KeepAliveCache(POLICY);
    const a = cache3.enter(orderLocation('A100'));
    const b = cache3.enter(orderLocation('A101'));
    cache3.enter(orderLocation('A100')); // 触摸 A，A 变成最近使用
    const c = cache3.enter(orderLocation('A102'));
    assert.equal(c.evicted, b.key, '应淘汰 B 而不是刚用过的 A');
    assert.equal(cache3.size, 2);
    assert.ok(cache3.get(a.key));
    assert.ok(cache3.get(c.key));
    assert.equal(cache3.get(b.key), undefined);

    for (let i = 0; i < 40; i++) cache3.enter(searchLocation(`q${i}`, '1', ['in-stock']));
    assert.equal(cache3.size, 2, '无上限配置会撑爆内存，这里必须恒为 2');
    assert.equal(cache3.evictedKeys.length, 41, '每次超限淘汰一条');
    console.log('[3/4] LRU 上限 OK, 淘汰数:', cache3.evictedKeys.length);

    // ---------- 测试 4：定向失效——按页面/按 key/全清 ----------
    const cache4 = new KeepAliveCache({ ...POLICY, maxEntries: 5 });
    const o1 = cache4.enter(orderLocation('A100'));
    const o2 = cache4.enter(orderLocation('A101'));
    const p1 = cache4.enter(productLocation('7', 'en', { variant: 'red' }));
    assert.equal(cache4.size, 3);

    assert.equal(cache4.invalidateByName('order-detail'), 2, '权限变更后清掉该页全部实例');
    assert.equal(cache4.size, 1);
    assert.equal(cache4.invalidateByName('order-detail'), 0);

    assert.equal(cache4.invalidateByKey(p1.key), true);
    assert.equal(cache4.invalidateByKey(p1.key), false);
    assert.equal(cache4.size, 0);

    // 失效后重新进入是全新实例，hits 归零，不会带着旧页面状态
    const rebuilt = cache4.enter(orderLocation('A100'));
    assert.equal(rebuilt.cached, false);
    assert.equal(cache4.get(rebuilt.key)?.hits, 0);
    cache4.enter(orderLocation('A100'));
    assert.equal(cache4.get(rebuilt.key)?.hits, 1);
    assert.equal(cache4.clear(), 1);
    assert.equal(cache4.size, 0);
    console.log('[4/4] 定向失效 OK, 重建 key:', rebuilt.key);

    console.log('\n✅ 114-03 keep-alive 缓存键 全部断言通过');
}

runAssertions();

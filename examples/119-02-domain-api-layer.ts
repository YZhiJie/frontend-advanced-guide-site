// 文件: examples/119-02-domain-api-layer.ts
// 领域模型 + API 层：DTO→领域模型映射、错误归一、取消/重试，以及 TTL/合并/标签失效/陈旧兜底的缓存
// 目标：金额只用最小单位且按币种精度格式化；只有可重试错误才退避重试；取消能穿透到请求；缓存命中、过期与失效可断言

import assert from 'node:assert';

type Currency = 'USD' | 'EUR' | 'JPY' | 'KWD';

/** 各币种的小数位：JPY 零位、KWD 三位，写死 2 位是海外电商最常见的金额事故 */
const CURRENCY_DECIMALS: Record<Currency, number> = {
    USD: 2,
    EUR: 2,
    JPY: 0,
    KWD: 3,
};

const CURRENCY_SYMBOL: Record<Currency, string> = {
    USD: '$',
    EUR: '€',
    JPY: '¥',
    KWD: 'KD',
};

interface Money {
    amountMinor: number;
    currency: Currency;
}

/** 用整数分（最小单位）格式化，避免 0.1 + 0.2 与浮点四舍五入的经典误差 */
function formatAmount(amountMinor: number, currency: Currency): string {
    const decimals = CURRENCY_DECIMALS[currency];
    const sign = amountMinor < 0 ? '-' : '';
    const abs = Math.abs(amountMinor);
    const factor = 10 ** decimals;
    const integerPart = Math.floor(abs / factor);
    const fractionPart = decimals === 0 ? '' : String(abs % factor).padStart(decimals, '0');
    const grouped = String(integerPart).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${sign}${CURRENCY_SYMBOL[currency]}${grouped}${fractionPart ? `.${fractionPart}` : ''}`;
}

function formatMoney(money: Money): string {
    return formatAmount(money.amountMinor, money.currency);
}

interface ProductDTO {
    id: string;
    title: string;
    price: Money;
    compareAtPrice?: Money;
    stock: number;
    status: 'active' | 'draft' | 'archived';
    images: string[];
    tags?: string[];
}

interface Product {
    id: string;
    title: string;
    price: Money;
    originalPrice: Money | null;
    available: boolean;
    tags: string[];
}

/** 边界层只做转换与校验：页面拿到的永远是领域模型，不再关心 DTO 字段名与状态码 */
function mapProduct(dto: ProductDTO): Product {
    if (!Number.isInteger(dto.price.amountMinor) || dto.price.amountMinor < 0) {
        throw new Error(`商品 ${dto.id} 金额非法: ${dto.price.amountMinor}`);
    }
    if (CURRENCY_DECIMALS[dto.price.currency] === undefined) {
        throw new Error(`商品 ${dto.id} 币种未知: ${dto.price.currency}`);
    }
    const available = dto.status === 'active' && dto.stock > 0;
    const originalPrice =
        dto.compareAtPrice && dto.compareAtPrice.amountMinor > dto.price.amountMinor
            ? { ...dto.compareAtPrice }
            : null;
    return {
        id: dto.id,
        title: dto.title.trim(),
        price: { ...dto.price },
        originalPrice,
        available,
        tags: [...(dto.tags ?? [])],
    };
}

type Failure =
    | { kind: 'network'; message: string }
    | { kind: 'http'; status: number; message: string; requestId?: string }
    | { kind: 'business'; code: string; message: string; requestId?: string };

type ErrorKind = 'network' | 'auth' | 'validation' | 'conflict' | 'server' | 'unknown';

interface AppError {
    kind: ErrorKind;
    retryable: boolean;
    userMessage: string;
    requestId: string | null;
}

/** 错误归一：UI 只按 kind 决定交互，按 retryable 决定是否自动重试 */
function normalizeError(failure: Failure): AppError {
    if (failure.kind === 'network') {
        return {
            kind: 'network',
            retryable: true,
            userMessage: '网络异常，请检查连接后重试',
            requestId: null,
        };
    }
    if (failure.kind === 'business') {
        const requestId = failure.requestId ?? null;
        if (failure.code === 'OUT_OF_STOCK' || failure.code === 'PRICE_CHANGED') {
            return {
                kind: 'conflict',
                retryable: false,
                userMessage: '商品信息已变化，请刷新后重试',
                requestId,
            };
        }
        return {
            kind: 'unknown',
            retryable: false,
            userMessage: '操作失败，请稍后重试',
            requestId,
        };
    }
    const requestId = failure.requestId ?? null;
    if (failure.status === 401 || failure.status === 403) {
        return { kind: 'auth', retryable: false, userMessage: '登录状态已失效，请重新登录', requestId };
    }
    if (failure.status === 400 || failure.status === 422) {
        return { kind: 'validation', retryable: false, userMessage: '提交内容有误，请检查后重试', requestId };
    }
    if (failure.status === 404) {
        return { kind: 'unknown', retryable: false, userMessage: '内容不存在或已下架', requestId };
    }
    if (failure.status === 409) {
        return { kind: 'conflict', retryable: false, userMessage: '数据已更新，请刷新后重试', requestId };
    }
    if (failure.status >= 500 || failure.status === 429) {
        return { kind: 'server', retryable: true, userMessage: '服务繁忙，请稍后重试', requestId };
    }
    return { kind: 'unknown', retryable: false, userMessage: '请求失败，请稍后重试', requestId };
}

/** 取消与失败要分开：取消不是错误，不能触发重试，也不该进错误上报 */
class RequestAbortedError extends Error {
    constructor() {
        super('请求已取消');
        this.name = 'RequestAbortedError';
    }
}

interface RetryOptions {
    retries: number;
    baseDelayMs: number;
    signal?: AbortSignal;
}

const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

/**
 * 带取消与退避重试的请求包装：
 * 1) 只有 retryable 的错误才重试，401/409 重试再多次也不会成功；
 * 2) 外部 signal 取消时，内部 controller 同步 abort，并抛出 RequestAbortedError；
 * 3) 退避用 baseDelayMs × 2^attempt，避免故障时把网关打穿。
 */
async function requestWithRetry<T>(
    loader: (signal: AbortSignal) => Promise<T>,
    classify: (error: unknown) => AppError,
    options: RetryOptions,
): Promise<T> {
    const attempts = options.retries + 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (options.signal?.aborted) throw new RequestAbortedError();
        const controller = new AbortController();
        const onAbort = (): void => controller.abort();
        options.signal?.addEventListener('abort', onAbort, { once: true });
        try {
            return await loader(controller.signal);
        } catch (error) {
            if (options.signal?.aborted) throw new RequestAbortedError();
            const appError = classify(error);
            if (!appError.retryable || attempt === attempts - 1) throw appError;
            await sleep(options.baseDelayMs * 2 ** attempt);
        } finally {
            options.signal?.removeEventListener('abort', onAbort);
        }
    }
    throw new Error('unreachable');
}

interface CacheEntry<T> {
    value: T;
    storedAt: number;
    ttlMs: number;
    staleMs: number;
    tags: string[];
}

interface LoadResult<T> {
    value: T;
    source: 'cache' | 'network' | 'stale';
}

interface LoadOptions {
    ttlMs: number;
    staleMs: number;
    tags: string[];
}

/** 资源缓存：TTL 内直接命中；过期后回源；同一 key 并发只发一次；可按标签批量失效 */
class ResourceCache {
    private entries = new Map<string, CacheEntry<unknown>>();
    private inflight = new Map<string, Promise<LoadResult<unknown>>>();

    constructor(private readonly now: () => number) {}

    invalidate(key: string): void {
        this.entries.delete(key);
    }

    invalidateTag(tag: string): number {
        let removed = 0;
        for (const [key, entry] of this.entries) {
            if (entry.tags.includes(tag)) {
                this.entries.delete(key);
                removed += 1;
            }
        }
        return removed;
    }

    getOrLoad<T>(key: string, options: LoadOptions, loader: () => Promise<T>): Promise<LoadResult<T>> {
        const entry = this.entries.get(key) as CacheEntry<T> | undefined;
        const age = entry ? this.now() - entry.storedAt : Infinity;
        if (entry && age < entry.ttlMs) {
            return Promise.resolve({ value: entry.value, source: 'cache' });
        }

        // 单飞：同一资源的并发请求共享同一个 Promise，避免列表页重复打接口
        const pending = this.inflight.get(key);
        if (pending) return pending as Promise<LoadResult<T>>;

        const task = (async (): Promise<LoadResult<T>> => {
            try {
                const value = await loader();
                this.entries.set(key, {
                    value,
                    storedAt: this.now(),
                    ttlMs: options.ttlMs,
                    staleMs: options.staleMs,
                    tags: [...options.tags],
                });
                return { value, source: 'network' };
            } catch (error) {
                // 回源失败时，陈旧窗口内仍可读旧值，保证弱网/断网下页面不白屏
                if (entry && age < entry.ttlMs + entry.staleMs) {
                    return { value: entry.value, source: 'stale' };
                }
                throw error;
            } finally {
                this.inflight.delete(key);
            }
        })();

        this.inflight.set(key, task as Promise<LoadResult<unknown>>);
        return task;
    }
}

async function runAssertions() {
    // ---------- 测试 1：DTO → 领域模型，按币种精度格式化 ----------
    const desk = mapProduct({
        id: 'p-1',
        title: '  Oak Writing Desk  ',
        price: { amountMinor: 1999, currency: 'USD' },
        compareAtPrice: { amountMinor: 2499, currency: 'USD' },
        stock: 7,
        status: 'active',
        images: ['desk.jpg'],
    });
    assert.equal(desk.title, 'Oak Writing Desk');
    assert.equal(formatMoney(desk.price), '$19.99');
    assert.equal(formatMoney(desk.originalPrice!), '$24.99');
    assert.equal(desk.available, true);
    assert.deepEqual(desk.tags, [], 'tags 缺省应归一为空数组');

    const jpy = mapProduct({
        id: 'p-2',
        title: 'Wall Shelf',
        price: { amountMinor: 120000, currency: 'JPY' },
        stock: 3,
        status: 'active',
        images: [],
    });
    assert.equal(formatMoney(jpy.price), '¥120,000', 'JPY 不得出现小数');

    const kwd = mapProduct({
        id: 'p-3',
        title: 'Linen Throw',
        price: { amountMinor: 1500, currency: 'KWD' },
        stock: 5,
        status: 'active',
        images: [],
    });
    assert.equal(formatMoney(kwd.price), 'KD1.500', 'KWD 必须保留三位');

    const soldOut = mapProduct({
        id: 'p-4',
        title: 'Rattan Chair',
        price: { amountMinor: 29900, currency: 'EUR' },
        compareAtPrice: { amountMinor: 19900, currency: 'EUR' },
        stock: 0,
        status: 'active',
        images: [],
    });
    assert.equal(formatMoney(soldOut.price), '€299.00');
    assert.equal(soldOut.available, false, '库存为 0 即不可售');
    assert.equal(soldOut.originalPrice, null, '划线价必须高于现价');
    assert.throws(
        () => mapProduct({ ...soldOut, price: { amountMinor: 29.9, currency: 'EUR' } }),
        /金额非法/,
        '小数金额说明上游把元当成分',
    );
    console.log('[1/4] DTO→领域模型 OK, USD/JPY/KWD/EUR 均按最小单位格式化');

    // ---------- 测试 2：错误归一——能否重试由类型决定 ----------
    const networkError = normalizeError({ kind: 'network', message: 'timeout' });
    assert.equal(networkError.kind, 'network');
    assert.equal(networkError.retryable, true);

    const unauthorized = normalizeError({ kind: 'http', status: 401, message: 'token expired', requestId: 'req-9' });
    assert.equal(unauthorized.kind, 'auth');
    assert.equal(unauthorized.retryable, false, '401 重试一万次也不会成功');
    assert.equal(unauthorized.requestId, 'req-9');

    const overloaded = normalizeError({ kind: 'http', status: 503, message: 'maintenance' });
    assert.equal(overloaded.kind, 'server');
    assert.equal(overloaded.retryable, true);

    const missing = normalizeError({ kind: 'http', status: 404, message: 'gone' });
    assert.equal(missing.kind, 'unknown');
    assert.equal(missing.retryable, false);

    const outOfStock = normalizeError({ kind: 'business', code: 'OUT_OF_STOCK', message: 'sold out' });
    assert.equal(outOfStock.kind, 'conflict', '库存冲突应引导刷新而不是重试');
    assert.equal(outOfStock.retryable, false);

    // 503 重试两次后成功：只有可重试错误才会消耗重试次数
    let attempts = 0;
    const flaky = await requestWithRetry(
        async () => {
            attempts += 1;
            if (attempts < 3) throw { kind: 'http', status: 503, message: 'busy' } satisfies Failure;
            return 'ok';
        },
        (error) => normalizeError(error as Failure),
        { retries: 2, baseDelayMs: 10 },
    );
    assert.equal(flaky, 'ok');
    assert.equal(attempts, 3, '两次 503 后第三次成功');

    // 401 不可重试：只调用一次就抛出归一化错误
    let authCalls = 0;
    await assert.rejects(
        requestWithRetry(
            async () => {
                authCalls += 1;
                throw { kind: 'http', status: 401, message: 'expired' } satisfies Failure;
            },
            (error) => normalizeError(error as Failure),
            { retries: 3, baseDelayMs: 1 },
        ),
        (error: unknown) => (error as AppError).kind === 'auth',
    );
    assert.equal(authCalls, 1, '401 不得重试');

    // 外部取消能穿透到 loader 的 signal
    const controller = new AbortController();
    let observedSignal: AbortSignal | null = null;
    const pending = requestWithRetry(
        (signal) => {
            observedSignal = signal;
            return new Promise<string>((_, reject) => {
                signal.addEventListener('abort', () => reject(new RequestAbortedError()), { once: true });
            });
        },
        (error) => normalizeError({ kind: 'network', message: String(error) }),
        { retries: 0, baseDelayMs: 1, signal: controller.signal },
    );
    controller.abort();
    await assert.rejects(pending, /请求已取消/);
    assert.equal(observedSignal?.aborted, true, '内部 signal 必须同步取消');
    console.log('[2/4] 错误归一/重试/取消 OK: network/auth/server/unknown/conflict');

    // ---------- 测试 3：TTL 命中、过期回源与标签失效 ----------
    let clock = 0;
    let calls = 0;
    const cache = new ResourceCache(() => clock);
    const loadProduct = async () => {
        calls += 1;
        return { id: 'p-1', title: 'Oak Writing Desk' };
    };
    const options: LoadOptions = { ttlMs: 1000, staleMs: 2000, tags: ['product', 'pdp:p-1'] };

    const first = await cache.getOrLoad('pdp:p-1', options, loadProduct);
    assert.equal(first.source, 'network');
    assert.equal(calls, 1);

    clock = 50;
    const second = await cache.getOrLoad('pdp:p-1', options, loadProduct);
    assert.equal(second.source, 'cache', 'TTL 内必须直接命中');
    assert.equal(calls, 1, '命中缓存不得回源');

    clock = 1100;
    const third = await cache.getOrLoad('pdp:p-1', options, loadProduct);
    assert.equal(third.source, 'network', 'TTL 到期必须回源');
    assert.equal(calls, 2);

    clock = 1200;
    const invalidatedCount = cache.invalidateTag('product');
    assert.equal(invalidatedCount, 1);
    const fourth = await cache.getOrLoad('pdp:p-1', options, loadProduct);
    assert.equal(fourth.source, 'network', '标签失效后必须重新拉取');
    assert.equal(calls, 3);
    console.log('[3/4] TTL/失效 OK, 回源次数:', calls);

    // ---------- 测试 4：单飞请求 + 断网陈旧兜底 ----------
    clock = 5000;
    let gatewayCalls = 0;
    let release: ((value: { id: string }) => void) | null = null;
    const slowLoader = () =>
        new Promise<{ id: string }>((resolve) => {
            gatewayCalls += 1;
            release = resolve;
        });
    const feedOptions: LoadOptions = { ttlMs: 500, staleMs: 0, tags: ['feed'] };
    const requestA = cache.getOrLoad('home:feed', feedOptions, slowLoader);
    const requestB = cache.getOrLoad('home:feed', feedOptions, slowLoader);
    assert.equal(gatewayCalls, 1, '同一 key 并发只能发一次请求');
    assert.ok(release !== null);
    release({ id: 'feed-1' });
    const [resultA, resultB] = await Promise.all([requestA, requestB]);
    assert.deepEqual(resultA.value, { id: 'feed-1' });
    assert.deepEqual(resultB.value, { id: 'feed-1' });

    const warm = await cache.getOrLoad(
        'pdp:stale',
        { ttlMs: 100, staleMs: 5000, tags: ['product'] },
        async () => ({ id: 'old' }),
    );
    assert.equal(warm.source, 'network');
    clock = 5200;
    let offline = true;
    const stale = await cache.getOrLoad(
        'pdp:stale',
        { ttlMs: 100, staleMs: 5000, tags: ['product'] },
        async () => {
            if (offline) throw new Error('network down');
            return { id: 'fresh' };
        },
    );
    assert.equal(stale.source, 'stale', '回源失败且未超出陈旧窗口时读旧值');
    assert.deepEqual(stale.value, { id: 'old' });

    clock = 9000;
    offline = false;
    const fresh = await cache.getOrLoad(
        'pdp:stale',
        { ttlMs: 100, staleMs: 5000, tags: ['product'] },
        async () => ({ id: 'fresh' }),
    );
    assert.equal(fresh.source, 'network');
    assert.deepEqual(fresh.value, { id: 'fresh' });
    console.log('[4/4] 单飞与陈旧兜底 OK, 网关调用:', gatewayCalls, '次');

    console.log('\n✅ 119-02 领域模型与 API 层 全部断言通过');
}

void runAssertions().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});

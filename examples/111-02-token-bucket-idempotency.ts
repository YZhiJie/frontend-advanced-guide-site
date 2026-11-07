// 文件: examples/111-02-token-bucket-idempotency.ts
// 令牌桶限流 + 幂等键：突发流量削峰，同一次下单的重试只扣一次款
// 目标：重放不消耗令牌、限流拒绝不占用幂等键、在途重复请求不重复执行、失败必须释放键

import assert from 'node:assert';

interface ConsumeResult {
    readonly allowed: boolean;
    readonly remaining: number;
    readonly retryAfterMs: number;
}

/** 令牌桶：容量决定突发上限，速率决定长期平均吞吐 */
class TokenBucket {
    private tokens: number;
    private lastRefillMs: number;

    constructor(
        private readonly capacity: number,
        private readonly refillPerSec: number,
        startMs = 0,
    ) {
        this.tokens = capacity;
        this.lastRefillMs = startMs;
    }

    tryConsume(nowMs: number, cost = 1): ConsumeResult {
        const elapsed = Math.max(0, nowMs - this.lastRefillMs);
        this.tokens = Math.min(this.capacity, this.tokens + (elapsed / 1000) * this.refillPerSec);
        this.lastRefillMs = Math.max(nowMs, this.lastRefillMs); // 时钟回拨时不倒流
        if (this.tokens >= cost) {
            this.tokens -= cost;
            return { allowed: true, remaining: this.tokens, retryAfterMs: 0 };
        }
        const missing = cost - this.tokens;
        return {
            allowed: false,
            remaining: this.tokens,
            retryAfterMs: Math.ceil((missing / this.refillPerSec) * 1000),
        };
    }
}

type Lookup = 'missing' | 'in-flight' | 'replay';

interface IdempotencyEntry {
    state: 'in-flight' | 'done';
    fingerprint: string;
    result?: string;
    expiresAtMs: number;
}

/** 幂等键存储：三元状态 missing / in-flight / replay，失败必须 abort 释放 */
class IdempotencyStore {
    private readonly entries = new Map<string, IdempotencyEntry>();

    constructor(private readonly ttlMs = 24 * 3600 * 1000) {}

    lookup(key: string, nowMs: number): Lookup {
        const entry = this.entries.get(key);
        if (!entry || entry.expiresAtMs <= nowMs) return 'missing';
        return entry.state === 'done' ? 'replay' : 'in-flight';
    }

    begin(key: string, fingerprint: string, nowMs: number): void {
        assert.equal(this.lookup(key, nowMs), 'missing', `幂等键被重复占用: ${key}`);
        this.entries.set(key, {
            state: 'in-flight',
            fingerprint,
            expiresAtMs: nowMs + this.ttlMs,
        });
    }

    complete(key: string, result: string): void {
        const entry = this.entries.get(key);
        assert.ok(entry, `幂等键未占用: ${key}`);
        entry.state = 'done';
        entry.result = result;
    }

    abort(key: string): void {
        // 执行失败必须释放：否则重试永远拿到 in-flight，用户卡死
        this.entries.delete(key);
    }

    fingerprintOf(key: string): string | null {
        return this.entries.get(key)?.fingerprint ?? null;
    }

    resultOf(key: string): string {
        const entry = this.entries.get(key);
        assert.ok(entry?.result, `无已完成结果: ${key}`);
        return entry.result;
    }
}

type SubmitStatus =
    | 'executed'
    | 'replay'
    | 'in-flight'
    | 'rate-limited'
    | 'fingerprint-mismatch'
    | 'failed';

interface SubmitRequest {
    readonly key: string;
    readonly amountCents: number;
    readonly nowMs: number;
}

interface SubmitResponse {
    readonly status: SubmitStatus;
    readonly chargeId: string | null;
    readonly retryAfterMs: number;
}

type Gateway = (key: string, amountCents: number) => string;

/** 下单接口：严格按「查幂等 → 限流 → 占键 → 执行 → 完成」顺序编排 */
class OrderApi {
    private readonly bucket: TokenBucket;
    private readonly idem = new IdempotencyStore();
    readonly attempts: string[] = [];

    constructor(
        private readonly gateway: Gateway,
        limit: { capacity: number; refillPerSec: number },
        private readonly onExecuting?: (api: OrderApi) => void,
    ) {
        this.bucket = new TokenBucket(limit.capacity, limit.refillPerSec);
    }

    inspectKey(key: string, nowMs: number): Lookup {
        return this.idem.lookup(key, nowMs);
    }

    submit(req: SubmitRequest): SubmitResponse {
        const fingerprint = `${req.amountCents}`;
        const lookup = this.idem.lookup(req.key, req.nowMs);

        // 1. 幂等重放最先短路：不消耗令牌，也不重复调支付网关
        if (lookup === 'replay') {
            if (this.idem.fingerprintOf(req.key) !== fingerprint) {
                return { status: 'fingerprint-mismatch', chargeId: null, retryAfterMs: 0 };
            }
            return { status: 'replay', chargeId: this.idem.resultOf(req.key), retryAfterMs: 0 };
        }
        // 2. 在途请求直接告知客户端稍后取结果，避免第二个执行分支
        if (lookup === 'in-flight') {
            return { status: 'in-flight', chargeId: null, retryAfterMs: 200 };
        }
        // 3. 限流在占键之前：被限流的请求绝不能预先占用幂等键，否则合法重试也会被拒
        const consumed = this.bucket.tryConsume(req.nowMs);
        if (!consumed.allowed) {
            return { status: 'rate-limited', chargeId: null, retryAfterMs: consumed.retryAfterMs };
        }

        this.idem.begin(req.key, fingerprint, req.nowMs);
        this.attempts.push(req.key);
        this.onExecuting?.(this); // 模拟网关执行期间用户再次点击

        try {
            const chargeId = this.gateway(req.key, req.amountCents);
            this.idem.complete(req.key, chargeId);
            return { status: 'executed', chargeId, retryAfterMs: 0 };
        } catch {
            this.idem.abort(req.key);
            return { status: 'failed', chargeId: null, retryAfterMs: 0 };
        }
    }
}

function runAssertions(): void {
    // ---------- 测试 1：令牌桶——突发容量与按时间补充 ----------
    const bucket = new TokenBucket(5, 2, 0);
    const burst = Array.from({ length: 7 }, () => bucket.tryConsume(0));
    assert.deepEqual(
        burst.map((r) => r.allowed),
        [true, true, true, true, true, false, false],
        '容量 5：前 5 个放行，第 6、7 个拒绝',
    );
    assert.equal(burst[4].remaining, 0);
    assert.equal(burst[5].retryAfterMs, 500, '缺 1 个令牌，2/s 补充需 500ms');
    assert.equal(bucket.tryConsume(500).allowed, true, '500ms 后补足 1 个');
    const later = bucket.tryConsume(2000);
    assert.ok(Math.abs(later.remaining - 2) < 1e-9, '再等 1.5s 补 3 个，消耗 1 剩 2');
    console.log('[1/4] 令牌桶 OK, 剩余令牌:', later.remaining);

    // ---------- 测试 2：幂等重放——重复提交只扣一次款 ----------
    const charges: Array<{ key: string; amountCents: number }> = [];
    const gateway: Gateway = (key, amountCents) => {
        charges.push({ key, amountCents });
        return `ch_${charges.length}`;
    };
    // 容量 1 且不补充：证明重放路径不消耗令牌（否则第 2 次提交会被限流）
    const api = new OrderApi(gateway, { capacity: 1, refillPerSec: 0 });
    const first = api.submit({ key: 'order-1001', amountCents: 4999, nowMs: 0 });
    assert.equal(first.status, 'executed');
    assert.equal(first.chargeId, 'ch_1');
    const replays = Array.from({ length: 4 }, () =>
        api.submit({ key: 'order-1001', amountCents: 4999, nowMs: 0 }),
    );
    assert.deepEqual(replays.map((r) => r.status), ['replay', 'replay', 'replay', 'replay']);
    assert.ok(replays.every((r) => r.chargeId === 'ch_1'), '重放返回首次结果');
    assert.equal(charges.length, 1, '支付网关只被调用一次');
    const mismatch = api.submit({ key: 'order-1001', amountCents: 1, nowMs: 0 });
    assert.equal(mismatch.status, 'fingerprint-mismatch', '同键不同金额必须拒绝');
    assert.equal(charges.length, 1);
    console.log('[2/4] 幂等重放 OK, 网关扣款次数:', charges.length);

    // ---------- 测试 3：在途去重 + 失败释放键 ----------
    const nested: { value: SubmitResponse | null } = { value: null };
    let inflightCharges = 0;
    const api2 = new OrderApi(
        (key, amountCents) => {
            inflightCharges += 1;
            return `ch_inflight_${amountCents}`;
        },
        { capacity: 10, refillPerSec: 0 },
        (self) => {
            if (nested.value === null) {
                nested.value = self.submit({ key: 'order-2002', amountCents: 12900, nowMs: 0 });
            }
        },
    );
    const outer = api2.submit({ key: 'order-2002', amountCents: 12900, nowMs: 0 });
    assert.equal(outer.status, 'executed');
    assert.ok(nested.value, '执行期间应产生一次重复请求');
    assert.equal(nested.value.status, 'in-flight', '在途重复请求不进入第二个执行分支');
    assert.equal(inflightCharges, 1, '并发重复只扣一次');
    assert.deepEqual(api2.attempts, ['order-2002'], '执行器只被进入一次');
    const afterDone = api2.submit({ key: 'order-2002', amountCents: 12900, nowMs: 0 });
    assert.equal(afterDone.status, 'replay');

    let failOnce = true;
    let successCharges = 0;
    const api3 = new OrderApi(
        () => {
            if (failOnce) {
                failOnce = false;
                throw new Error('gateway timeout');
            }
            successCharges += 1;
            return 'ch_retry_1';
        },
        { capacity: 10, refillPerSec: 0 },
    );
    const failed = api3.submit({ key: 'order-3003', amountCents: 9900, nowMs: 0 });
    assert.equal(failed.status, 'failed');
    assert.equal(api3.inspectKey('order-3003', 0), 'missing', '失败必须释放幂等键');
    const retried = api3.submit({ key: 'order-3003', amountCents: 9900, nowMs: 0 });
    assert.equal(retried.status, 'executed', '释放后同一键可重试');
    assert.deepEqual(api3.attempts, ['order-3003', 'order-3003']);
    assert.equal(successCharges, 1);
    console.log('[3/4] 在途去重与失败重试 OK');

    // ---------- 测试 4：编排顺序——重放不吃令牌、拒绝不占键 ----------
    const charges4: string[] = [];
    const api4 = new OrderApi(
        (key) => {
            charges4.push(key);
            return `ch_${charges4.length}`;
        },
        { capacity: 1, refillPerSec: 0.5 },
    );
    const a = api4.submit({ key: 'order-A', amountCents: 100, nowMs: 0 });
    assert.equal(a.status, 'executed');
    const aReplay = api4.submit({ key: 'order-A', amountCents: 100, nowMs: 0 });
    assert.equal(aReplay.status, 'replay', '桶已空仍能重放，说明重放未走限流');
    assert.equal(charges4.length, 1);
    const bDenied = api4.submit({ key: 'order-B', amountCents: 100, nowMs: 0 });
    assert.equal(bDenied.status, 'rate-limited');
    assert.equal(bDenied.retryAfterMs, 2000, '0.5/s 补 1 个令牌需 2s');
    assert.equal(api4.inspectKey('order-B', 0), 'missing', '被限流的请求不得占用幂等键');
    const bRetry = api4.submit({ key: 'order-B', amountCents: 100, nowMs: 2000 });
    assert.equal(bRetry.status, 'executed', '2s 后重试应成功');
    assert.deepEqual(api4.attempts, ['order-A', 'order-B']);
    assert.equal(charges4.length, 2, '两个业务键各扣一次');
    console.log('[4/4] 限流与幂等编排顺序 OK, 扣款次数:', charges4.length);

    console.log('\n✅ 111-02 令牌桶限流与幂等键 全部断言通过');
}

runAssertions();

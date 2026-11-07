// 文件: examples/121-02-platform-adapter.ts
// 平台能力适配器：同一接口在 MP / H5 / App / Electron 四端差异化实现与降级
// 目标：业务只依赖契约；分享失败降级到复制、存储超限拒绝、桌面端不承载支付

import assert from 'node:assert';

type PlatformKind = 'mp' | 'h5' | 'app' | 'electron';
type ShareChannel = 'native' | 'copy' | 'external';

interface SharePayload {
    title: string;
    url: string;
}

interface ShareResult {
    channel: ShareChannel;
    ok: boolean;
    /** 是否走了降级路径，埋点与提示文案用 */
    degraded: boolean;
}

interface PaymentRequest {
    orderId: string;
    amountMinor: number; // 最小货币单位，避免浮点误差
    currency: string;
}

interface PaymentPlan {
    channel: 'requestPayment' | 'redirect' | 'sdk';
    url?: string;
}

interface StorageApi {
    readonly limitBytes: number;
    get(key: string): string | null;
    set(key: string, value: string): boolean;
    remove(key: string): void;
    size(): number;
}

interface PlatformEnv {
    /** 端原生分享通道；H5 对应 Web Share API，小程序对应 shareAppMessage */
    nativeShare?: (payload: SharePayload) => { ok: boolean };
    clipboardWrite: (text: string) => void;
    /** 桌面端用系统浏览器打开分享落地页 */
    openExternal?: (url: string) => boolean;
}

interface PlatformAdapter {
    readonly platform: PlatformKind;
    readonly storage: StorageApi;
    share(payload: SharePayload): ShareResult;
    pay(request: PaymentRequest): PaymentPlan;
}

/** UTF-8 字节数：不依赖 Buffer，H5/小程序运行时同样可用 */
function utf8Bytes(text: string): number {
    let bytes = 0;
    for (const char of text) {
        const code = char.codePointAt(0) ?? 0;
        if (code < 0x80) bytes += 1;
        else if (code < 0x800) bytes += 2;
        else if (code < 0x10000) bytes += 3;
        else bytes += 4;
    }
    return bytes;
}

/** 有配额上限的存储：超限时拒绝写入且不破坏旧值，而不是静默截断 */
class BoundedStorage implements StorageApi {
    readonly limitBytes: number;
    private map = new Map<string, string>();

    constructor(limitBytes: number) {
        this.limitBytes = limitBytes;
    }

    get(key: string): string | null {
        return this.map.get(key) ?? null;
    }

    set(key: string, value: string): boolean {
        const next = new Map(this.map);
        next.set(key, value);
        let used = 0;
        for (const [k, v] of next) used += utf8Bytes(k) + utf8Bytes(v);
        if (used > this.limitBytes) return false;
        this.map = next;
        return true;
    }

    remove(key: string): void {
        this.map.delete(key);
    }

    size(): number {
        return this.map.size;
    }
}

const DEFAULT_LIMITS: Record<PlatformKind, number> = {
    mp: 10240, // 小程序 Storage 单 key 限制约 10KB
    h5: 5 * 1024 * 1024,
    app: 20 * 1024 * 1024,
    electron: 20 * 1024 * 1024,
};

const SUPPORTED_CURRENCY = new Set(['USD', 'EUR', 'SGD']);

function createShare(kind: PlatformKind, env: PlatformEnv): (payload: SharePayload) => ShareResult {
    return (payload) => {
        if (env.nativeShare) {
            const result = env.nativeShare(payload);
            if (result.ok) return { channel: 'native', ok: true, degraded: false };
        }

        if (kind === 'electron' && env.openExternal) {
            const opened = env.openExternal(payload.url);
            if (opened) return { channel: 'external', ok: true, degraded: false };
        }

        // 统一降级：复制链接始终可用，且明确标记 degraded 让上游决定提示
        env.clipboardWrite(`${payload.title} ${payload.url}`);
        return { channel: 'copy', ok: true, degraded: true };
    };
}

function createPay(kind: PlatformKind): (request: PaymentRequest) => PaymentPlan {
    return (request) => {
        if (!SUPPORTED_CURRENCY.has(request.currency)) {
            throw new Error(`E_CURRENCY_UNSUPPORTED: ${request.currency}`);
        }
        switch (kind) {
            case 'mp':
                return { channel: 'requestPayment' };
            case 'h5':
                return { channel: 'redirect', url: `/checkout?order=${request.orderId}` };
            case 'app':
                return { channel: 'sdk' };
            case 'electron':
                throw new Error('E_PAYMENT_UNSUPPORTED: 桌面营运台不承载支付，转 H5 收银台');
        }
    };
}

function createAdapter(kind: PlatformKind, env: PlatformEnv, limitBytes = DEFAULT_LIMITS[kind]): PlatformAdapter {
    return {
        platform: kind,
        storage: new BoundedStorage(limitBytes),
        share: createShare(kind, env),
        pay: createPay(kind),
    };
}

function env(overrides: Partial<PlatformEnv> = {}): PlatformEnv {
    return { clipboardWrite: () => {}, ...overrides };
}

function runAssertions(): void {
    // ---------- 测试 1：四端同一契约，平台标识与默认配额正确 ----------
    const adapters = {
        mp: createAdapter('mp', env()),
        h5: createAdapter('h5', env()),
        app: createAdapter('app', env()),
        electron: createAdapter('electron', env()),
    };
    for (const [name, adapter] of Object.entries(adapters)) {
        assert.equal(adapter.platform, name);
        assert.equal(typeof adapter.share, 'function');
        assert.equal(typeof adapter.pay, 'function');
        assert.ok(adapter.storage.limitBytes > 0);
    }
    assert.equal(adapters.mp.storage.limitBytes, 10240);
    assert.equal(adapters.electron.storage.limitBytes, 20 * 1024 * 1024);
    console.log('[1/4] 统一契约 OK, 四端 platform 与配额就位');

    // ---------- 测试 2：分享路由与降级链 ----------
    let copied = '';
    const mpNative = createAdapter('mp', env({ nativeShare: () => ({ ok: true }) }));
    assert.deepEqual(mpNative.share({ title: 'Deal', url: 'https://shop.example.com/p/1' }), {
        channel: 'native',
        ok: true,
        degraded: false,
    });

    const mpFail = createAdapter(
        'mp',
        env({
            nativeShare: () => ({ ok: false }),
            clipboardWrite: (text) => {
                copied = text;
            },
        }),
    );
    const mpFallback = mpFail.share({ title: 'Deal', url: 'https://shop.example.com/p/1' });
    assert.deepEqual(mpFallback, { channel: 'copy', ok: true, degraded: true });
    assert.ok(copied.includes('https://shop.example.com/p/1'));

    const h5 = createAdapter('h5', env());
    assert.equal(h5.share({ title: 'Deal', url: 'https://shop.example.com/p/1' }).channel, 'copy');

    const electron = createAdapter('electron', env({ openExternal: () => true }));
    assert.deepEqual(electron.share({ title: 'Deal', url: 'https://shop.example.com/p/1' }), {
        channel: 'external',
        ok: true,
        degraded: false,
    });
    console.log('[2/4] 分享降级 OK, MP 失败转复制 / Electron 走系统浏览器');

    // ---------- 测试 3：存储配额——超限拒绝且旧值不变 ----------
    const storage = createAdapter('mp', env(), 8).storage;
    assert.equal(storage.set('a', 'b'), true);
    assert.equal(storage.get('a'), 'b');
    assert.equal(storage.set('a', '0123456789'), false, '超限写入应被拒绝');
    assert.equal(storage.get('a'), 'b', '失败的写入不得覆盖旧值');
    assert.equal(storage.size(), 1);
    storage.remove('a');
    assert.equal(storage.get('a'), null);
    assert.equal(storage.set('b', 'ok'), true);
    assert.equal(storage.set('big', 'x'.repeat(2000)), false, '大值同样拒绝');

    const h5Storage = createAdapter('h5', env()).storage;
    assert.equal(h5Storage.set('cart', 'x'.repeat(2000)), true, 'H5 配额应容纳 2KB');
    console.log('[3/4] 存储配额 OK, 超限拒绝且旧值不变');

    // ---------- 测试 4：支付路由与桌面端边界 ----------
    assert.equal(adapters.mp.pay({ orderId: 'A100', amountMinor: 1999, currency: 'USD' }).channel, 'requestPayment');
    const h5Plan = adapters.h5.pay({ orderId: 'A100', amountMinor: 1999, currency: 'EUR' });
    assert.equal(h5Plan.channel, 'redirect');
    assert.ok(h5Plan.url?.includes('A100'));
    assert.equal(adapters.app.pay({ orderId: 'A100', amountMinor: 1999, currency: 'SGD' }).channel, 'sdk');
    assert.throws(
        () => adapters.electron.pay({ orderId: 'A100', amountMinor: 1999, currency: 'USD' }),
        /E_PAYMENT_UNSUPPORTED/,
        '桌面端必须显式拒绝支付',
    );
    assert.throws(
        () => adapters.h5.pay({ orderId: 'A100', amountMinor: 1999, currency: 'JPY' }),
        /E_CURRENCY_UNSUPPORTED/,
    );
    console.log('[4/4] 支付路由 OK, 桌面端拒绝支付 / 非法币种拒绝');

    console.log('\n✅ 121-02 平台能力适配器 全部断言通过');
}

runAssertions();

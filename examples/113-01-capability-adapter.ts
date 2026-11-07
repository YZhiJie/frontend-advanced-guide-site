// 文件: examples/113-01-capability-adapter.ts
// 端能力适配器：storage / share / payment 三个接口，PC Web 与 H5 各一套实现
// 目标：业务层只依赖接口；端判断、降级链与失败兜底全部收敛在 adapter

import assert from 'node:assert';

type EndKind = 'pc' | 'h5';

interface RuntimeEnv {
    userAgent: string;
    viewportWidth: number;
    maxTouchPoints: number;
    hasNativeShare: boolean;
    hasAppScheme: boolean;
}

interface StorageCapability {
    readonly kind: string;
    get(key: string): string | null;
    set(key: string, value: string): boolean;
    remove(key: string): void;
}

interface SharePayload {
    title: string;
    url: string;
}

interface ShareResult {
    channel: 'native' | 'copy' | 'qrcode';
    ok: boolean;
}

interface PaymentRequest {
    orderId: string;
    amountMinor: number; // 最小货币单位，避免浮点误差
    currency: string;
}

interface PaymentPlan {
    channel: 'qr' | 'wallet' | 'redirect';
    url: string;
    fallbackUrl: string;
}

interface Capabilities {
    readonly end: EndKind;
    readonly storage: StorageCapability;
    share(payload: SharePayload): ShareResult;
    pay(req: PaymentRequest): PaymentPlan;
}

/**
 * 端判定：触摸 + 窄视口才算 H5。
 * 触摸笔记本、横屏平板仍归 PC，比解析 UA 更稳，也避免误伤 Windows 触屏设备。
 */
function detectEnd(env: RuntimeEnv): { end: EndKind; reasons: string[] } {
    const touch = env.maxTouchPoints > 0;
    const narrow = env.viewportWidth < 900;
    if (touch && narrow) return { end: 'h5', reasons: ['touch', 'narrow'] };
    return { end: 'pc', reasons: [touch ? 'wide-touch' : 'pointer'] };
}

/** 内存实现模拟 localStorage：PC 配额 5MB，H5 WebView 只给 64KB 且可能被系统清空 */
class QuotaStorage implements StorageCapability {
    private data = new Map<string, string>();

    constructor(
        readonly kind: string,
        private readonly quotaChars: number,
    ) {}

    get(key: string): string | null {
        return this.data.get(key) ?? null;
    }

    set(key: string, value: string): boolean {
        let used = 0;
        for (const [k, v] of this.data) if (k !== key) used += k.length + v.length;
        if (used + key.length + value.length > this.quotaChars) return false;
        this.data.set(key, value);
        return true;
    }

    remove(key: string): void {
        this.data.delete(key);
    }
}

function createShare(env: RuntimeEnv, end: EndKind, clipboardAllowed: boolean) {
    return (payload: SharePayload): ShareResult => {
        void payload;
        if (end === 'h5' && env.hasNativeShare) return { channel: 'native', ok: true };
        if (clipboardAllowed) return { channel: 'copy', ok: true };
        // 剪贴板被拒或不可用时，展示二维码让用户扫码继续，而不是弹「分享失败」
        return { channel: 'qrcode', ok: true };
    };
}

function createPay(end: EndKind, env: RuntimeEnv) {
    return (req: PaymentRequest): PaymentPlan => {
        const query = `order=${req.orderId}&amount=${req.amountMinor}&currency=${req.currency}`;
        const hosted = `https://pay.example.com/hosted?${query}`;
        if (end === 'pc') {
            return { channel: 'qr', url: `https://pay.example.com/qr?${query}`, fallbackUrl: hosted };
        }
        if (env.hasAppScheme) {
            return { channel: 'wallet', url: `shopapp://pay?${query}`, fallbackUrl: hosted };
        }
        return { channel: 'redirect', url: hosted, fallbackUrl: hosted };
    };
}

/** 组装点：业务入口只调用一次，之后拿到的都是接口 */
function createCapabilities(env: RuntimeEnv, clipboardAllowed: boolean): Capabilities {
    const { end } = detectEnd(env);
    const quota = end === 'pc' ? 5_000_000 : 64_000;
    return {
        end,
        storage: new QuotaStorage(end, quota),
        share: createShare(env, end, clipboardAllowed),
        pay: createPay(end, env),
    };
}

/** 业务层只依赖 Capabilities 接口，不知道当前是 PC 还是 H5 */
function shareProduct(caps: Capabilities, title: string, url: string): ShareResult {
    return caps.share({ title, url });
}

function runAssertions() {
    // ---------- 测试 1：端判定按能力而非 UA 猜 ----------
    const iphone: RuntimeEnv = {
        userAgent: 'Mozilla/5.0 (iPhone)',
        viewportWidth: 390,
        maxTouchPoints: 5,
        hasNativeShare: true,
        hasAppScheme: true,
    };
    const imac: RuntimeEnv = {
        userAgent: 'Mozilla/5.0 (Macintosh)',
        viewportWidth: 1440,
        maxTouchPoints: 0,
        hasNativeShare: false,
        hasAppScheme: false,
    };
    const touchLaptop: RuntimeEnv = {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
        viewportWidth: 1366,
        maxTouchPoints: 10,
        hasNativeShare: false,
        hasAppScheme: false,
    };
    assert.equal(detectEnd(iphone).end, 'h5');
    assert.deepEqual(detectEnd(iphone).reasons, ['touch', 'narrow']);
    assert.equal(detectEnd(imac).end, 'pc');
    assert.equal(detectEnd(touchLaptop).end, 'pc', '触摸笔记本不应误判为 H5');
    assert.deepEqual(detectEnd(touchLaptop).reasons, ['wide-touch']);
    console.log('[1/4] 端判定 OK');

    // ---------- 测试 2：同一 storage 接口，两端配额行为不同 ----------
    const pc = createCapabilities(imac, true);
    const h5 = createCapabilities(iphone, false);
    assert.equal(pc.storage.set('draft', 'x'.repeat(80_000)), true);
    assert.equal(h5.storage.set('draft', 'x'.repeat(80_000)), false, 'H5 配额不足应返回 false 而不是抛错');
    assert.equal(h5.storage.get('draft'), null);
    assert.equal(h5.storage.set('token', 'small'), true);
    assert.equal(h5.storage.get('token'), 'small');
    h5.storage.remove('token');
    assert.equal(h5.storage.get('token'), null);
    console.log('[2/4] storage 配额与兜底 OK');

    // ---------- 测试 3：分享降级链 native → copy → qrcode ----------
    const h5NoNative = createCapabilities({ ...iphone, hasNativeShare: false }, false);
    assert.equal(shareProduct(h5, '夏季新品', 'https://shop.example.com/p/7').channel, 'native');
    assert.equal(shareProduct(h5NoNative, '夏季新品', 'https://shop.example.com/p/7').channel, 'qrcode');
    assert.equal(shareProduct(pc, '夏季新品', 'https://shop.example.com/p/7').channel, 'copy');
    console.log('[3/4] 分享降级链 OK');

    // ---------- 测试 4：支付通道与接口一致性 ----------
    const order = { orderId: 'A100', amountMinor: 1999, currency: 'USD' };
    const pcPlan = pc.pay(order);
    assert.equal(pcPlan.channel, 'qr', 'PC 桌面支付应展示二维码');
    assert.match(pcPlan.fallbackUrl, /hosted/);
    assert.equal(h5.pay(order).channel, 'wallet');
    const h5NoScheme = createCapabilities({ ...iphone, hasAppScheme: false }, true);
    assert.equal(h5NoScheme.pay(order).channel, 'redirect');
    assert.deepEqual(Object.keys(pc).sort(), Object.keys(h5).sort(), '两端必须暴露同一组能力');
    console.log('[4/4] 支付通道与接口一致性 OK');

    console.log('\n✅ 113-01 端能力适配器 全部断言通过');
}

runAssertions();

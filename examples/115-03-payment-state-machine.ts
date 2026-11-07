// 文件: examples/115-03-payment-state-machine.ts
// 支付状态机：created → requires_action(3DS) → paid → refunded，webhook 幂等与对账
// 目标：重复 webhook 不重复入账；乱序事件不回退状态；退款/超额退款有账可查

import assert from 'node:assert';

type PaymentState = 'created' | 'requires_action' | 'paid' | 'partially_refunded' | 'refunded' | 'failed' | 'canceled';

type PaymentEvent = 'REQUIRE_3DS' | 'AUTHORIZE_OK' | 'AUTHORIZE_FAIL' | 'PARTIAL_REFUND' | 'FULL_REFUND' | 'CANCEL';

const TRANSITIONS: Record<PaymentState, Partial<Record<PaymentEvent, PaymentState>>> = {
    created: { REQUIRE_3DS: 'requires_action', AUTHORIZE_OK: 'paid', AUTHORIZE_FAIL: 'failed', CANCEL: 'canceled' },
    requires_action: { AUTHORIZE_OK: 'paid', AUTHORIZE_FAIL: 'failed', CANCEL: 'canceled' },
    paid: { PARTIAL_REFUND: 'partially_refunded', FULL_REFUND: 'refunded' },
    partially_refunded: { PARTIAL_REFUND: 'partially_refunded', FULL_REFUND: 'refunded' },
    refunded: {},
    failed: {},
    canceled: {},
};

interface LedgerEntry {
    kind: 'capture' | 'refund';
    amountMinor: number;
}

interface ProviderWebhook {
    id: string;
    type: 'payment.requires_action' | 'payment.succeeded' | 'charge.refunded';
    paymentId: string;
    currency: string;
    amountMinor?: number;
    refundId?: string;
}

class PaymentMachine {
    state: PaymentState = 'created';
    readonly history: string[] = [];
    private readonly ledger: LedgerEntry[] = [];
    private readonly processedEventIds = new Set<string>();
    private readonly processedRefundIds = new Set<string>();
    private credited = false;

    constructor(
        readonly paymentId: string,
        readonly currency: string,
        readonly amountMinor: number,
    ) {}

    get balanceMinor(): number {
        return this.ledger.reduce((sum, e) => sum + (e.kind === 'capture' ? e.amountMinor : -e.amountMinor), 0);
    }

    /** 前端/服务端主动迁移：非法迁移直接拒绝，不静默改状态 */
    apply(event: PaymentEvent, amountMinor = 0): boolean {
        const next = TRANSITIONS[this.state][event];
        if (next === undefined) {
            this.history.push(`REJECTED:${this.state}:${event}`);
            return false;
        }
        if (event === 'PARTIAL_REFUND' || event === 'FULL_REFUND') {
            if (!this.refund(amountMinor)) {
                this.history.push(`REJECTED:${this.state}:${event}:amount`);
                return false;
            }
        }
        if (event === 'AUTHORIZE_OK') this.capture();
        // 部分退款可能刚好退满，终态由账本余额决定，而不是事件名
        this.state = event === 'PARTIAL_REFUND' || event === 'FULL_REFUND'
            ? (this.refundedMinor === this.amountMinor ? 'refunded' : 'partially_refunded')
            : next;
        this.history.push(`${event}->${this.state}`);
        return true;
    }

    /** 用户确认下单时生成的幂等键：同一订单重试必须复用，支付网关据此只扣一次 */
    idempotencyKey(orderId: string): string {
        return `${this.paymentId}:${orderId}:${this.amountMinor}:${this.currency}`;
    }

    private capture(): boolean {
        if (this.credited) return false;
        this.credited = true;
        this.ledger.push({ kind: 'capture', amountMinor: this.amountMinor });
        return true;
    }

    private refund(amountMinor: number): boolean {
        if (amountMinor <= 0) return false;
        const refunded = this.refundedMinor;
        if (refunded + amountMinor > this.amountMinor) return false;
        this.ledger.push({ kind: 'refund', amountMinor });
        return true;
    }

    get refundedMinor(): number {
        return this.ledger.filter((e) => e.kind === 'refund').reduce((sum, e) => sum + e.amountMinor, 0);
    }

    /**
     * webhook 入口：事件 id 幂等；入账按 paymentId、退款按 refundId 二次幂等；
     * 乱序事件（如 succeeded 后才收到 requires_action）不得回退状态。
     */
    handleWebhook(event: ProviderWebhook): 'processed' | 'duplicate' | 'ignored' {
        if (this.processedEventIds.has(event.id)) {
            this.history.push(`WEBHOOK_DUPLICATE:${event.id}`);
            return 'duplicate';
        }
        this.processedEventIds.add(event.id);
        if (event.currency !== this.currency) {
            this.history.push(`WEBHOOK_CURRENCY_MISMATCH:${event.id}`);
            return 'ignored';
        }
        if (event.type === 'payment.requires_action') {
            if (this.state !== 'created') {
                this.history.push(`WEBHOOK_OUT_OF_ORDER:${event.id}`);
                return 'ignored';
            }
            this.state = 'requires_action';
            this.history.push(`WEBHOOK:${event.id}:requires_action`);
            return 'processed';
        }
        if (event.type === 'payment.succeeded') {
            this.capture();
            this.state = this.refundedMinor > 0 ? 'partially_refunded' : 'paid';
            this.history.push(`WEBHOOK:${event.id}:succeeded`);
            return 'processed';
        }
        // charge.refunded：没有 refundId 视为不可幂等的脏事件，拒绝入账
        if (!event.refundId || !event.amountMinor) {
            this.history.push(`WEBHOOK_BAD_REFUND:${event.id}`);
            return 'ignored';
        }
        if (this.processedRefundIds.has(event.refundId)) {
            this.history.push(`WEBHOOK_DUPLICATE_REFUND:${event.refundId}`);
            return 'duplicate';
        }
        if (!this.credited) {
            this.history.push(`WEBHOOK_REFUND_BEFORE_CAPTURE:${event.id}`);
            return 'ignored';
        }
        this.state = 'paid';
        const ok = this.refund(event.amountMinor);
        if (!ok) {
            this.history.push(`WEBHOOK_OVER_REFUND:${event.id}`);
            return 'ignored';
        }
        this.processedRefundIds.add(event.refundId);
        this.state = this.refundedMinor === this.amountMinor ? 'refunded' : 'partially_refunded';
        this.history.push(`WEBHOOK:${event.id}:refunded`);
        return 'processed';
    }

    /** 对账：本地账本净额必须等于网关侧余额，差额即漏单/重复入账 */
    reconcile(providerBalanceMinor: number): { ok: boolean; diffMinor: number } {
        const diff = this.balanceMinor - providerBalanceMinor;
        return { ok: diff === 0, diffMinor: diff };
    }
}

function runAssertions() {
    // ---------- 测试 1：3DS 正常路径——created → requires_action → paid，只入账一次 ----------
    const order = new PaymentMachine('pay_1', 'USD', 4999);
    assert.equal(order.state, 'created');
    assert.ok(order.apply('REQUIRE_3DS'));
    assert.equal(order.state, 'requires_action', '需要 3DS 挑战');
    assert.ok(order.apply('AUTHORIZE_OK'));
    assert.equal(order.state, 'paid');
    assert.equal(order.balanceMinor, 4999);
    assert.ok(order.idempotencyKey('order_1').includes('pay_1'));
    console.log('[1/4] 3DS 正常路径 OK, 状态:', order.history.join(' → '));

    // ---------- 测试 2：重复 webhook 不重复入账，乱序事件不回退 ----------
    const wh = new PaymentMachine('pay_2', 'USD', 4999);
    assert.equal(wh.handleWebhook({ id: 'evt_1', type: 'payment.succeeded', paymentId: 'pay_2', currency: 'USD' }), 'processed');
    assert.equal(wh.state, 'paid');
    assert.equal(wh.balanceMinor, 4999);
    assert.equal(wh.handleWebhook({ id: 'evt_1', type: 'payment.succeeded', paymentId: 'pay_2', currency: 'USD' }), 'duplicate');
    assert.equal(wh.balanceMinor, 4999, '同一事件重放不得重复入账');
    assert.equal(
        wh.handleWebhook({ id: 'evt_2', type: 'payment.requires_action', paymentId: 'pay_2', currency: 'USD' }),
        'ignored',
        'paid 之后到达的 requires_action 必须忽略',
    );
    assert.equal(wh.state, 'paid', '乱序事件不得让状态回退');
    console.log('[2/4] webhook 幂等/乱序 OK, 余额:', wh.balanceMinor);

    // ---------- 测试 3：重复退款（同 refundId 不同 eventId）+ 分次退款 ----------
    const rf = new PaymentMachine('pay_3', 'USD', 4999);
    rf.handleWebhook({ id: 'evt_10', type: 'payment.succeeded', paymentId: 'pay_3', currency: 'USD' });
    assert.equal(
        rf.handleWebhook({ id: 'evt_11', type: 'charge.refunded', paymentId: 'pay_3', currency: 'USD', amountMinor: 2000, refundId: 're_1' }),
        'processed',
    );
    assert.equal(rf.state, 'partially_refunded');
    assert.equal(rf.refundedMinor, 2000);
    assert.equal(
        rf.handleWebhook({ id: 'evt_11', type: 'charge.refunded', paymentId: 'pay_3', currency: 'USD', amountMinor: 2000, refundId: 're_1' }),
        'duplicate',
        '同事件 id',
    );
    assert.equal(
        rf.handleWebhook({ id: 'evt_12', type: 'charge.refunded', paymentId: 'pay_3', currency: 'USD', amountMinor: 2000, refundId: 're_1' }),
        'duplicate',
        '同 refundId 不同 eventId 也不得再退',
    );
    assert.equal(rf.refundedMinor, 2000, '重复退款不得重复出账');
    console.log('[3/4] 退款幂等 OK, 已退:', rf.refundedMinor);

    // ---------- 测试 4：超额退款拒绝 + 对账发现差额 ----------
    assert.equal(rf.apply('PARTIAL_REFUND', 2999), true);
    assert.equal(rf.state, 'refunded');
    assert.equal(rf.refundedMinor, 4999);
    assert.equal(rf.apply('FULL_REFUND', 100), false, '已退满后不能再退');
    assert.deepEqual(rf.reconcile(0), { ok: true, diffMinor: 0 }, '净额应为 0');
    const drift = rf.reconcile(100);
    assert.equal(drift.ok, false);
    assert.equal(drift.diffMinor, -100, '网关多出 100，本地少记');
    console.log('[4/4] 超额退款/对账 OK, 差额:', drift.diffMinor);

    console.log('\n✅ 115-03 支付状态机与 webhook 幂等 全部断言通过');
}

runAssertions();

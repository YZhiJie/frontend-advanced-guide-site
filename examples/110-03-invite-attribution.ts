// 文件: examples/110-03-invite-attribution.ts
// 邀请裂变：邀请码绑定 + 首次触达归因窗口 + 防自邀/同设备小号/互刷 + 奖励只结一次
// 目标：同设备多账号不能互推、互推被识别、超窗口不归因、一个被邀请人只归属一个邀请人

import assert from 'node:assert';

const BIND_WINDOW_DAYS = 7; // 首次访问后 7 天内可绑定邀请码
const SETTLE_WINDOW_DAYS = 30; // 绑定后 30 天内首购才结算
const REWARD_COINS = 100;

interface User {
    id: string;
    deviceId: string;
}

interface Binding {
    inviterId: string;
    inviteeId: string;
    bindAt: number; // 天序号
    settled: boolean;
}

type RejectReason =
    | 'UNKNOWN_CODE'
    | 'SELF_INVITE'
    | 'DEVICE_CONFLICT'
    | 'ALREADY_BOUND'
    | 'MUTUAL_FARMING'
    | 'EXPIRED';

interface BindResult {
    ok: boolean;
    reason?: RejectReason;
    inviterId?: string;
}

interface SettleResult {
    rewarded: boolean;
    inviterId?: string;
    reason?: 'NOT_BOUND' | 'EXPIRED' | 'DUPLICATE';
    coins: number;
}

class AttributionEngine {
    private codes = new Map<string, string>(); // 邀请码 → 邀请人
    private users = new Map<string, User>();
    private bindings = new Map<string, Binding>(); // inviteeId → 绑定（首次归因，唯一）
    private rewards = new Map<string, number>(); // inviterId → 累计奖励

    registerUser(user: User): void {
        this.users.set(user.id, user);
    }

    issueCode(inviterId: string, code: string): void {
        this.codes.set(code, inviterId);
    }

    getReward(inviterId: string): number {
        return this.rewards.get(inviterId) ?? 0;
    }

    bind(inviterId: string, inviteeId: string, code: string, firstVisitAt: number, bindAt: number): BindResult {
        const owner = this.codes.get(code);
        if (!owner || owner !== inviterId) return { ok: false, reason: 'UNKNOWN_CODE' };

        const invitee = this.users.get(inviteeId);
        const inviter = this.users.get(inviterId);
        assert.ok(invitee && inviter, '双方必须已注册');

        // 1. 自邀：同一账号，或同一台设备上开的小号
        if (inviterId === inviteeId) return { ok: false, reason: 'SELF_INVITE' };
        if (inviter.deviceId === invitee.deviceId) return { ok: false, reason: 'SELF_INVITE' };

        // 2. 一个被邀请人只认第一次有效绑定，后续更换邀请码一律拒绝
        if (this.bindings.has(inviteeId)) {
            return { ok: false, reason: 'ALREADY_BOUND', inviterId: this.bindings.get(inviteeId)!.inviterId };
        }

        // 3. 互刷：B 已归因给 A，A 再想归因给 B（或反之）直接拦
        const inverse = this.bindings.get(inviterId);
        if (inverse && inverse.inviterId === inviteeId) return { ok: false, reason: 'MUTUAL_FARMING' };

        // 4. 小号集中：该设备上已有别的账号完成绑定，则新账号不参与归因
        for (const b of this.bindings.values()) {
            const boundUser = this.users.get(b.inviteeId);
            if (boundUser && boundUser.deviceId === invitee.deviceId) {
                return { ok: false, reason: 'DEVICE_CONFLICT' };
            }
        }

        // 5. 归因窗口：从首次访问算起，超过 7 天不予归因（防止捡漏老用户）
        if (bindAt - firstVisitAt > BIND_WINDOW_DAYS) return { ok: false, reason: 'EXPIRED' };

        this.bindings.set(inviteeId, { inviterId, inviteeId, bindAt, settled: false });
        return { ok: true, inviterId };
    }

    /** 首购结算：绑定后 30 天内、每个被邀请人只结算一次 */
    settle(inviteeId: string, payAt: number): SettleResult {
        const binding = this.bindings.get(inviteeId);
        if (!binding) return { rewarded: false, reason: 'NOT_BOUND', coins: 0 };
        if (binding.settled) return { rewarded: false, inviterId: binding.inviterId, reason: 'DUPLICATE', coins: 0 };
        if (payAt - binding.bindAt > SETTLE_WINDOW_DAYS) {
            return { rewarded: false, inviterId: binding.inviterId, reason: 'EXPIRED', coins: 0 };
        }
        binding.settled = true;
        this.rewards.set(binding.inviterId, this.getReward(binding.inviterId) + REWARD_COINS);
        return { rewarded: true, inviterId: binding.inviterId, coins: REWARD_COINS };
    }
}

function setup(): AttributionEngine {
    const engine = new AttributionEngine();
    engine.registerUser({ id: 'alice', deviceId: 'dA' });
    engine.registerUser({ id: 'bob', deviceId: 'dB' });
    engine.registerUser({ id: 'carol', deviceId: 'dC' });
    engine.registerUser({ id: 'dave', deviceId: 'dD' });
    engine.registerUser({ id: 'erin', deviceId: 'dE' });
    engine.issueCode('alice', 'ALICE01');
    engine.issueCode('bob', 'BOB01');
    engine.issueCode('carol', 'CAROL1');
    engine.issueCode('dave', 'DAVE01');
    return engine;
}

function runAssertions() {
    // ---------- 测试 1：正常归因 + 首购结算 ----------
    const e1 = setup();
    const bind1 = e1.bind('alice', 'bob', 'ALICE01', 1, 1);
    assert.equal(bind1.ok, true);
    assert.equal(bind1.inviterId, 'alice');
    const pay1 = e1.settle('bob', 5);
    assert.equal(pay1.rewarded, true);
    assert.equal(pay1.coins, 100);
    assert.equal(e1.getReward('alice'), 100);
    console.log('[1/4] 正常归因与结算 OK, alice 奖励 = 100');

    // ---------- 测试 2：超过绑定窗口不归因 ----------
    const e2 = setup();
    const expired = e2.bind('carol', 'dave', 'CAROL1', 1, 10); // 首次访问后第 10 天
    assert.equal(expired.ok, false);
    assert.equal(expired.reason, 'EXPIRED');
    assert.equal(e2.settle('dave', 12).rewarded, false);
    console.log('[2/4] 超窗口拒绝归因 OK, reason=EXPIRED');

    // ---------- 测试 3：自邀与同设备小号 ----------
    const e3 = setup();
    const self = e3.bind('bob', 'bob', 'BOB01', 1, 1);
    assert.equal(self.reason, 'SELF_INVITE');
    // 先让 bob 正常归因给 alice，再用 bob 设备上的小号 frank 走 alice 的码
    e3.registerUser({ id: 'frank', deviceId: 'dB' });
    assert.equal(e3.bind('alice', 'bob', 'ALICE01', 1, 1).ok, true);
    const deviceConflict = e3.bind('alice', 'frank', 'ALICE01', 2, 2);
    assert.equal(deviceConflict.ok, false);
    assert.equal(deviceConflict.reason, 'DEVICE_CONFLICT');
    console.log('[3/4] 自邀与同设备小号拦截 OK');

    // ---------- 测试 4：互刷 + 唯一归因 + 结算只发一次 ----------
    const e4 = setup();
    assert.equal(e4.bind('alice', 'bob', 'ALICE01', 1, 1).ok, true);
    const mutual = e4.bind('bob', 'alice', 'BOB01', 1, 2);
    assert.equal(mutual.ok, false);
    assert.equal(mutual.reason, 'MUTUAL_FARMING', '反向邀请应被识别为互刷');
    const steal = e4.bind('carol', 'bob', 'CAROL1', 1, 2);
    assert.equal(steal.ok, false);
    assert.equal(steal.reason, 'ALREADY_BOUND', '首次归因后不可被其他邀请人抢走');

    assert.equal(e4.settle('bob', 5).rewarded, true);
    const dup = e4.settle('bob', 6); // 多笔订单重复触发结算
    assert.equal(dup.rewarded, false);
    assert.equal(dup.reason, 'DUPLICATE');
    assert.equal(e4.getReward('alice'), 100, '重复结算不得再次发奖');
    console.log('[4/4] 互刷与重复结算拦截 OK, alice 奖励 = 100');

    console.log('\n✅ 110-03 邀请归因与防自邀 全部断言通过');
}

runAssertions();

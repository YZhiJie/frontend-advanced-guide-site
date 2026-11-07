// 文件: examples/110-04-anti-fraud-rate-limit.ts
// 风控决策器：滑动窗口频控（账号 + 设备双维度）+ 多账号/多设备聚集识别 + 黑名单
// 目标：双维度独立限流、窗口真正滑动（非固定桶）、聚集行为分级为 challenge/deny

import assert from 'node:assert';

type Decision = 'allow' | 'challenge' | 'deny';

interface CheckResult {
    decision: Decision;
    reason: string;
    riskScore: number;
}

const WINDOW_MS = 60_000;

class RiskEngine {
    private accountHits = new Map<string, number[]>(); // userId → 请求时间戳
    private deviceHits = new Map<string, number[]>(); // deviceId → 请求时间戳
    private deviceAccounts = new Map<string, Map<string, number>>(); // 设备 → 账号 → 最后活跃
    private accountDevices = new Map<string, Map<string, number>>(); // 账号 → 设备 → 最后活跃
    private blacklist = new Set<string>();

    constructor(
        private accountLimit = 10,
        private deviceLimit = 12,
    ) {}

    blacklistDevice(deviceId: string): void {
        this.blacklist.add(deviceId);
    }

    private prune(list: number[], now: number): number[] {
        return list.filter((t) => now - t < WINDOW_MS);
    }

    /** 记录一次请求并返回窗口内次数（被拒绝的请求也计数，防止换账号猛刷） */
    private hit(store: Map<string, number[]>, key: string, now: number): number {
        const list = this.prune(store.get(key) ?? [], now);
        list.push(now);
        store.set(key, list);
        return list.length;
    }

    private touchRelation(
        store: Map<string, Map<string, number>>,
        owner: string,
        other: string,
        now: number,
    ): number {
        const rel = store.get(owner) ?? new Map<string, number>();
        rel.set(other, now);
        for (const [k, t] of rel) {
            if (now - t >= WINDOW_MS) rel.delete(k);
        }
        store.set(owner, rel);
        return rel.size;
    }

    check(userId: string, deviceId: string, now: number): CheckResult {
        if (this.blacklist.has(deviceId)) {
            return { decision: 'deny', reason: 'BLACKLIST_DEVICE', riskScore: 100 };
        }

        const accountCount = this.hit(this.accountHits, userId, now);
        const deviceCount = this.hit(this.deviceHits, deviceId, now);
        const accountsOnDevice = this.touchRelation(this.deviceAccounts, deviceId, userId, now);
        const devicesOnAccount = this.touchRelation(this.accountDevices, userId, deviceId, now);

        const riskScore = Math.min(
            100,
            (accountsOnDevice - 1) * 20 + (devicesOnAccount - 1) * 15 + Math.max(0, accountCount - 5) * 5,
        );

        // 1. 硬限流优先：任一维度超限直接拒绝
        if (deviceCount > this.deviceLimit) {
            return { decision: 'deny', reason: 'DEVICE_RATE_LIMIT', riskScore: Math.max(riskScore, 80) };
        }
        if (accountCount > this.accountLimit) {
            return { decision: 'deny', reason: 'ACCOUNT_RATE_LIMIT', riskScore: Math.max(riskScore, 70) };
        }

        // 2. 聚集行为：同一设备短时间登录大量账号，是批量小号的典型信号
        if (accountsOnDevice >= 5) {
            return { decision: 'deny', reason: 'MULTI_ACCOUNT_DEVICE', riskScore: 100 };
        }
        if (accountsOnDevice >= 3) {
            return { decision: 'challenge', reason: 'MULTI_ACCOUNT_DEVICE', riskScore: Math.max(riskScore, 60) };
        }

        // 3. 同一账号短时间切换大量设备，多为代刷/共享号
        if (devicesOnAccount >= 3) {
            return { decision: 'challenge', reason: 'MULTI_DEVICE_ACCOUNT', riskScore: Math.max(riskScore, 50) };
        }

        return { decision: 'allow', reason: 'OK', riskScore };
    }
}

function runAssertions() {
    // ---------- 测试 1：账号维度滑动窗口限流 ----------
    const e1 = new RiskEngine(10, 12);
    for (let i = 0; i < 10; i++) {
        assert.equal(e1.check('u1', 'd1', i * 1000).decision, 'allow');
    }
    const blocked = e1.check('u1', 'd1', 10_000);
    assert.equal(blocked.decision, 'deny');
    assert.equal(blocked.reason, 'ACCOUNT_RATE_LIMIT');
    console.log('[1/4] 账号维度频控 OK, 第 11 次被拒');

    // ---------- 测试 2：窗口真正滑动，旧请求滑出后恢复 ----------
    const e2 = new RiskEngine(10, 12);
    for (let i = 0; i < 10; i++) {
        e2.check('u2', 'd2', i * 5000); // 0,5,...,45 秒各一次
    }
    assert.equal(e2.check('u2', 'd2', 50_000).decision, 'deny', '50 秒时窗口内仍满 10 次');
    assert.equal(e2.check('u2', 'd2', 61_000).decision, 'deny', '0 秒那条已滑出，但 50/61 秒的拒绝记录也计数');
    const recovered = e2.check('u2', 'd2', 72_000);
    assert.equal(recovered.decision, 'allow', '72 秒时窗口仅剩 9 条历史 + 本次 = 10，应放行');
    console.log('[2/4] 滑动窗口恢复 OK, 72 秒放行');

    // ---------- 测试 3：设备维度独立限流，跨账号共享 ----------
    const e3 = new RiskEngine(10, 12);
    for (let i = 0; i < 6; i++) e3.check('a', 'deviceX', 1000 + i);
    for (let i = 0; i < 6; i++) e3.check('b', 'deviceX', 1000 + i);
    const deviceBlocked = e3.check('c', 'deviceX', 1000);
    assert.equal(deviceBlocked.reason, 'DEVICE_RATE_LIMIT', '账号 c 首次请求也因设备超限被拒');
    assert.equal(e3.check('c', 'deviceY', 1000).decision, 'allow', '换设备后账号维度只有 1 次，应放行');
    console.log('[3/4] 设备维度跨账号限流 OK');

    // ---------- 测试 4：聚集行为分级与黑名单 ----------
    const e4 = new RiskEngine(10, 12);
    const first = e4.check('u1', 'shared', 1000);
    assert.equal(first.decision, 'allow');
    assert.equal(e4.check('u2', 'shared', 1000).riskScore, 20);
    const third = e4.check('u3', 'shared', 1000);
    assert.equal(third.decision, 'challenge');
    assert.equal(third.reason, 'MULTI_ACCOUNT_DEVICE');
    assert.ok(third.riskScore > first.riskScore, '聚集度越高风险分越高');

    e4.blacklistDevice('evil');
    const black = e4.check('u4', 'evil', 1000);
    assert.equal(black.decision, 'deny');
    assert.equal(black.riskScore, 100);

    const multiDevice = e4.check('u5', 'm1', 1000);
    assert.equal(multiDevice.decision, 'allow');
    e4.check('u5', 'm2', 1000);
    assert.equal(e4.check('u5', 'm3', 1000).reason, 'MULTI_DEVICE_ACCOUNT');
    console.log('[4/4] 聚集分级与黑名单 OK, 风险分:', third.riskScore);

    console.log('\n✅ 110-04 频控与风控决策器 全部断言通过');
}

runAssertions();

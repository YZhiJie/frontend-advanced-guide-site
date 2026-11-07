// 文件: examples/118-03-bitrate-adapt.ts
// 码率自适应决策：基于丢包/延迟/RTT 调整目标码率，滞回 + 冷却避免来回抖动
// 目标：劣化快降、恢复慢升、死区不动作、刚降档后不得立刻回升

import assert from 'node:assert';

interface NetworkSample {
    lossRate: number; // 0~1，统计窗口内的丢包比例
    rttMs: number;
    jitterMs: number;
}

interface AdaptConfig {
    minKbps: number;
    maxKbps: number;
    startKbps: number;
    decreaseFactor: number;
    increaseStep: number;
    lossHigh: number;
    lossLow: number;
    rttHigh: number;
    goodTicksToRaise: number;
    cooldownTicks: number;
}

type AdaptAction = 'raise' | 'hold' | 'lower';

interface Decision {
    targetKbps: number;
    action: AdaptAction;
    reason: string;
}

const DEFAULT_CONFIG: AdaptConfig = {
    minKbps: 150,
    maxKbps: 1500,
    startKbps: 600,
    decreaseFactor: 0.7,
    increaseStep: 0.1,
    lossHigh: 0.10,
    lossLow: 0.02,
    rttHigh: 400,
    goodTicksToRaise: 3,
    cooldownTicks: 2,
};

/**
 * 目标码率控制器。
 * 三条规则互相约束：坏样本立刻降、灰区（死区）不动、只有连续多个干净样本才升；
 * 降档后进入冷却期，避免「降—升—再降」的画面呼吸效应。
 */
class BitrateController {
    private target: number;
    private goodStreak = 0;
    private cooldown = 0;
    readonly history: number[] = [];

    constructor(private readonly config: AdaptConfig = DEFAULT_CONFIG) {
        this.target = config.startKbps;
    }

    get targetKbps(): number {
        return this.target;
    }

    sample(input: NetworkSample): Decision {
        this.history.push(this.target);
        const cfg = this.config;
        const congested = input.lossRate >= cfg.lossHigh || input.rttMs >= cfg.rttHigh;

        if (congested) {
            const next = Math.max(cfg.minKbps, Math.round(this.target * cfg.decreaseFactor));
            this.goodStreak = 0;
            this.cooldown = cfg.cooldownTicks;
            return this.commit(next, 'lower', `congested loss=${input.lossRate.toFixed(2)} rtt=${input.rttMs}`);
        }

        if (this.cooldown > 0) {
            this.cooldown -= 1;
            this.goodStreak = 0;
            return this.commit(this.target, 'hold', 'cooldown');
        }

        if (input.lossRate >= cfg.lossLow) {
            // 死区：介于 lossLow 与 lossHigh 之间，既不够降也不够升，保持不动
            this.goodStreak = 0;
            return this.commit(this.target, 'hold', 'deadband');
        }

        this.goodStreak += 1;
        if (this.goodStreak >= cfg.goodTicksToRaise && this.target < cfg.maxKbps) {
            this.goodStreak = 0;
            const next = Math.min(cfg.maxKbps, Math.round(this.target * (1 + cfg.increaseStep)));
            return this.commit(next, 'raise', 'good-streak');
        }
        return this.commit(this.target, 'hold', this.target >= cfg.maxKbps ? 'at-max' : 'good-wait');
    }

    private commit(next: number, action: AdaptAction, reason: string): Decision {
        this.target = next;
        return { targetKbps: next, action, reason };
    }
}

function runAssertions() {
    // ---------- 测试 1：干净网络——连续 3 个样本才升一档，绝不一步到位 ----------
    const c1 = new BitrateController();
    assert.equal(c1.sample({ lossRate: 0, rttMs: 60, jitterMs: 5 }).action, 'hold');
    assert.equal(c1.sample({ lossRate: 0.005, rttMs: 70, jitterMs: 8 }).action, 'hold');
    const raised = c1.sample({ lossRate: 0.01, rttMs: 80, jitterMs: 6 });
    assert.equal(raised.action, 'raise');
    assert.equal(raised.targetKbps, 660, '600 × 1.1 应升到 660');
    assert.equal(c1.sample({ lossRate: 0, rttMs: 75, jitterMs: 4 }).action, 'hold', '升档后重新累计');
    console.log('[1/4] 干净网络慢升 OK, target:', c1.targetKbps);

    // ---------- 测试 2：丢包/RTT 超线——快降 30%，且永不击穿下限 ----------
    const c2 = new BitrateController({ ...DEFAULT_CONFIG, startKbps: 800, minKbps: 150 });
    assert.equal(c2.sample({ lossRate: 0.2, rttMs: 120, jitterMs: 10 }).targetKbps, 560);
    assert.equal(c2.sample({ lossRate: 0.2, rttMs: 120, jitterMs: 10 }).targetKbps, 392);
    const byRtt = c2.sample({ lossRate: 0, rttMs: 500, jitterMs: 10 });
    assert.equal(byRtt.action, 'lower');
    assert.equal(byRtt.targetKbps, 274, 'RTT 超线同样触发降档');
    for (let i = 0; i < 10; i++) c2.sample({ lossRate: 0.3, rttMs: 200, jitterMs: 50 });
    assert.equal(c2.targetKbps, 150, '连续劣化必须钳制在 minKbps');
    console.log('[2/4] 快速降档与下限钳制 OK, target:', c2.targetKbps);

    // ---------- 测试 3：冷却期——刚降档不许马上回升，之后要重新攒 3 个干净样本 ----------
    const c3 = new BitrateController({ ...DEFAULT_CONFIG, startKbps: 1000 });
    assert.equal(c3.sample({ lossRate: 0.2, rttMs: 100, jitterMs: 5 }).targetKbps, 700);
    assert.deepEqual(
        [
            c3.sample({ lossRate: 0, rttMs: 80, jitterMs: 5 }).reason,
            c3.sample({ lossRate: 0, rttMs: 80, jitterMs: 5 }).reason,
            c3.sample({ lossRate: 0, rttMs: 80, jitterMs: 5 }).reason,
        ],
        ['cooldown', 'cooldown', 'good-wait'],
        '冷却 2 拍后仍需从 streak=1 开始',
    );
    const d1 = c3.sample({ lossRate: 0, rttMs: 80, jitterMs: 5 });
    const d2 = c3.sample({ lossRate: 0, rttMs: 80, jitterMs: 5 });
    assert.equal(d1.action, 'hold');
    assert.equal(d2.action, 'raise');
    assert.equal(d2.targetKbps, 770);
    const deadband = c3.sample({ lossRate: 0.05, rttMs: 90, jitterMs: 6 });
    assert.equal(deadband.action, 'hold', '5% 丢包落在死区，不许降也不许升');
    assert.equal(deadband.targetKbps, 770);
    console.log('[3/4] 冷却与死区 OK, target:', c3.targetKbps);

    // ---------- 测试 4：反振荡——丢包在死区两侧来回跳，目标码率必须纹丝不动 ----------
    const c4 = new BitrateController({ ...DEFAULT_CONFIG, startKbps: 1000 });
    for (let i = 0; i < 12; i++) {
        const lossRate = i % 2 === 0 ? 0.03 : 0.01;
        const decision = c4.sample({ lossRate, rttMs: 90, jitterMs: 8 });
        assert.equal(decision.action, 'hold', `第 ${i} 拍不应动作`);
    }
    assert.equal(new Set(c4.history).size, 1, '历史目标码率必须只有一个值');
    assert.equal(c4.targetKbps, 1000);
    console.log('[4/4] 反振荡 OK, 12 拍目标稳定在:', c4.targetKbps);

    console.log('\n✅ 118-03 码率自适应决策 全部断言通过');
}

runAssertions();

// 文件: examples/110-02-lottery-weight.ts
// 奖池：权重归一化 + 保底计数器 + 概率公示校验 + 库存耗尽后的降级回退
// 目标：公示概率与配置权重严格一致、10 次内必出稀有奖、大样本频率收敛、奖品不超发

import assert from 'node:assert';

interface Prize {
    id: string;
    tier: 0 | 1 | 2; // 0 普通 / 1 稀有 / 2 大奖
    weight: number;
    stock: number; // Infinity 表示不限量
    publishedRate: number; // 公示概率（百分数），必须可由 weight 推导
}

/** mulberry32：可复现 PRNG，仅用于测试采样，不能用于生产概率 */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const TOTAL_WEIGHT = 10000;

class Lottery {
    private pity = new Map<string, number>(); // userId → 距上次稀有奖的抽数

    constructor(
        private prizes: Prize[],
        private pityLimit = 10,
    ) {
        const sum = prizes.reduce((acc, p) => acc + p.weight, 0);
        assert.equal(sum, TOTAL_WEIGHT, `权重总和必须为 ${TOTAL_WEIGHT}，实际 ${sum}`);
    }

    /** 校验公示概率：weight / 总权重 × 100 必须与公示值一致（容差 1e-9） */
    validatePublished(): void {
        for (const p of this.prizes) {
            const actual = (p.weight / TOTAL_WEIGHT) * 100;
            assert.ok(Math.abs(actual - p.publishedRate) < 1e-9, `${p.id} 公示 ${p.publishedRate}% 与配置 ${actual}% 不符`);
        }
    }

    /** 抽一次；roll 可注入用于测试。返回奖品 ID */
    draw(userId: string, roll: number = Math.random()): string {
        const available = this.prizes.filter((p) => p.stock > 0);
        assert.ok(available.length > 0, '奖池已空');

        const sinceRare = this.pity.get(userId) ?? 0;
        let picked: Prize;

        if (sinceRare + 1 >= this.pityLimit) {
            // 保底只发「最低满足档」的稀有奖：大奖留给自然命中，避免保底把大奖库存瞬间打穿
            const guaranteed = available.filter((p) => p.tier >= 1);
            assert.ok(guaranteed.length > 0, '保底档位已无库存');
            picked = guaranteed.reduce((a, b) => (b.tier < a.tier ? b : a));
        } else {
            const total = available.reduce((acc, p) => acc + p.weight, 0);
            let threshold = roll * total;
            picked = available[available.length - 1];
            for (const p of available) {
                if (threshold < p.weight) {
                    picked = p;
                    break;
                }
                threshold -= p.weight;
            }
        }

        if (Number.isFinite(picked.stock)) picked.stock -= 1;

        if (picked.tier >= 1) this.pity.set(userId, 0);
        else this.pity.set(userId, sinceRare + 1);

        return picked.id;
    }

    getPity(userId: string): number {
        return this.pity.get(userId) ?? 0;
    }
}

function basePrizes(grandStock = 1): Prize[] {
    return [
        { id: 'grand', tier: 2, weight: 6, stock: grandStock, publishedRate: 0.06 },
        { id: 'rare', tier: 1, weight: 94, stock: Infinity, publishedRate: 0.94 },
        { id: 'common', tier: 0, weight: 9900, stock: Infinity, publishedRate: 99.0 },
    ];
}

function runAssertions() {
    // ---------- 测试 1：公示概率与权重一致 ----------
    const lottery = new Lottery(basePrizes());
    lottery.validatePublished();
    const sum = basePrizes().reduce((acc, p) => acc + p.weight, 0);
    assert.equal(sum, 10000);
    assert.equal(Number(((6 / 10000) * 100).toFixed(2)), 0.06);
    console.log('[1/4] 概率公示校验 OK, 奖池权重和=10000');

    // ---------- 测试 2：保底计数器——10 次内必出稀有及以上 ----------
    const pities = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    const commons = pities.map(() => lottery.draw('u1', 0.5));
    assert.equal(commons.every((id) => id === 'common'), true, '0.5 落在普通奖区间');
    assert.equal(lottery.getPity('u1'), 9);
    const guaranteed = lottery.draw('u1', 0.5); // 第 10 抽，roll 再小也无效，保底接管
    assert.equal(guaranteed, 'rare', '第 10 抽必须出稀有及以上');
    assert.equal(lottery.getPity('u1'), 0, '出稀有后计数器归零');
    console.log('[2/4] 10 抽保底 OK, 第 10 抽 =', guaranteed);

    // ---------- 测试 3：大样本频率收敛到权重 ----------
    const sample = new Lottery(basePrizes(Infinity));
    const rand = mulberry32(2026);
    const trials = 40000;
    let grandCount = 0;
    for (let i = 0; i < trials; i++) {
        if (sample.draw(`u${i}`, rand()) === 'grand') grandCount++;
    }
    const rate = grandCount / trials;
    assert.ok(rate > 0.0002 && rate < 0.0012, `大奖实际频率 ${rate} 偏离 0.0006 过多`);
    console.log('[3/4] 大样本频率收敛 OK, 大奖占比:', rate.toFixed(4));

    // ---------- 测试 4：库存耗尽后降级回退，且绝不超发 ----------
    const stocked = new Lottery(basePrizes(1));
    assert.equal(stocked.draw('u2', 0.0001), 'grand', '首发命中大奖');
    let grandIssued = 1;
    for (let i = 0; i < 20; i++) {
        const id = stocked.draw(`u3_${i}`, 0.0001);
        assert.equal(id, 'rare', '大奖售罄后同区间必须回退到稀有奖');
        if (id === 'grand') grandIssued++;
    }
    assert.equal(grandIssued, 1, '大奖库存只有 1，实际发放数不得超过');
    assert.equal(stocked.draw('u4', 0.999999), 'common', '尾部仍落在普通奖');
    console.log('[4/4] 库存回退与不超发 OK, grand 发放 =', grandIssued);

    console.log('\n✅ 110-02 奖池权重与保底抽奖 全部断言通过');
}

runAssertions();

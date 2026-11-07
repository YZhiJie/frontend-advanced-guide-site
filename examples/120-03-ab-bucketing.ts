// 文件: examples/120-03-ab-bucketing.ts
// AB 分流：稳定哈希 + 流量分层 + 同层互斥 + 扩量单调
// 目标：同一用户永远落同一桶；实验扩量只增不减；同层实验绝不重叠

import assert from 'node:assert';

const BUCKET_COUNT = 10000; // 万分之一粒度，足够做 0.01% 级灰度

/** FNV-1a：确定性、分布均匀、无第三方依赖；同一输入跨端跨版本结果一致 */
function fnv1a(input: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

/** 用户桶位：salt 决定「哪一层/哪个实验」，绝不能把随机数或时间戳掺进来 */
function bucketOf(userId: string, salt: string): number {
    return fnv1a(`${salt}:${userId}`) % BUCKET_COUNT;
}

interface Experiment {
    id: string;
    /** 流量层：同层实验共享同一套桶位，因此可以做到互斥 */
    layer: string;
    /** 桶位区间 [start, end)，取值 0 ~ BUCKET_COUNT */
    start: number;
    end: number;
}

function validateExperiment(experiment: Experiment): void {
    assert.ok(experiment.start >= 0 && experiment.end <= BUCKET_COUNT, '桶位越界');
    assert.ok(experiment.start < experiment.end, '区间不能为空');
}

/** 用户是否进入实验；同一用户在同一实验里的判定结果永远稳定 */
function isAssigned(userId: string, experiment: Experiment): boolean {
    const bucket = bucketOf(userId, `layer:${experiment.layer}`);
    return bucket >= experiment.start && bucket < experiment.end;
}

/** 同层互斥校验：任意两个实验区间不得相交（扩量时用重新分配区间，不能重叠） */
function assertMutuallyExclusive(experiments: Experiment[]): void {
    const byLayer = new Map<string, Experiment[]>();
    for (const experiment of experiments) {
        const list = byLayer.get(experiment.layer) ?? [];
        list.push(experiment);
        byLayer.set(experiment.layer, list);
    }
    for (const [layer, list] of byLayer) {
        const sorted = [...list].sort((a, b) => a.start - b.start);
        for (let i = 1; i < sorted.length; i++) {
            assert.ok(sorted[i].start >= sorted[i - 1].end, `同层 ${layer} 实验区间重叠: ${sorted[i - 1].id} / ${sorted[i].id}`);
        }
    }
}

/** 扩量：只改 end，不换 salt、不重排已有桶位——老用户全集必须是新用户集的子集 */
function ramp(experiment: Experiment, percent: number): Experiment {
    assert.ok(percent >= 0 && percent <= 100, '扩量百分比越界');
    return { ...experiment, start: 0, end: Math.round((BUCKET_COUNT * percent) / 100) };
}

function sampleUsers(count: number): string[] {
    return Array.from({ length: count }, (_unused, index) => `u_${index}`);
}

function runAssertions() {
    const users = sampleUsers(10000);

    // ---------- 测试 1：稳定哈希——重复计算与跨实例结果一致 ----------
    const exp: Experiment = { id: 'exp_checkout', layer: 'checkout', start: 0, end: 5000 };
    const first = users.map((user) => bucketOf(user, 'layer:checkout'));
    const second = users.map((user) => bucketOf(user, 'layer:checkout'));
    assert.deepEqual(first, second, '同一用户桶位必须稳定');
    assert.ok(first.every((bucket) => bucket >= 0 && bucket < BUCKET_COUNT), '桶位须落在合法区间');
    const assignedOnce = users.filter((user) => isAssigned(user, exp));
    const assignedTwice = users.filter((user) => isAssigned(user, exp));
    assert.deepEqual(assignedOnce, assignedTwice, '分流结果必须可重复');
    console.log('[1/4] 稳定哈希 OK, 首个用户桶位:', first[0]);

    // ---------- 测试 2：分布均匀与同层互斥 ----------
    const expA: Experiment = { id: 'exp_a', layer: 'homepage', start: 0, end: 4000 };
    const expB: Experiment = { id: 'exp_b', layer: 'homepage', start: 4000, end: 7000 };
    assertMutuallyExclusive([expA, expB]);
    assert.throws(
        () => assertMutuallyExclusive([expA, { ...expB, start: 3500 }]),
        /重叠/,
        '重叠区间必须被拒绝',
    );
    const inA = users.filter((user) => isAssigned(user, expA));
    const ratio = inA.length / users.length;
    assert.ok(ratio > 0.38 && ratio < 0.42, `40% 实验实际占比偏离过大: ${ratio}`);
    let both = 0;
    for (const user of users) if (isAssigned(user, expA) && isAssigned(user, expB)) both++;
    assert.equal(both, 0, '同层实验不得同时命中');
    console.log('[2/4] 分布与互斥 OK, A 组占比:', (ratio * 100).toFixed(2) + '%');

    // ---------- 测试 3：跨层独立——两层 50% 的叠加应接近 25%，而非 0 或 50% ----------
    const layerX: Experiment = { id: 'exp_x', layer: 'checkout', start: 0, end: 5000 };
    const layerY: Experiment = { id: 'exp_y', layer: 'search', start: 0, end: 5000 };
    let overlap = 0;
    for (const user of users) if (isAssigned(user, layerX) && isAssigned(user, layerY)) overlap++;
    const overlapRatio = overlap / users.length;
    assert.ok(overlapRatio > 0.2 && overlapRatio < 0.3, `跨层叠加应接近 25%，实际 ${overlapRatio}`);
    console.log('[3/4] 跨层独立 OK, 叠加占比:', (overlapRatio * 100).toFixed(2) + '%');

    // ---------- 测试 4：扩量单调——10% ⊂ 30% ⊂ 50% ----------
    const base: Experiment = { id: 'exp_ramp', layer: 'feed', start: 0, end: 0 };
    const set10 = new Set(users.filter((user) => isAssigned(user, ramp(base, 10))));
    const set30 = new Set(users.filter((user) => isAssigned(user, ramp(base, 30))));
    const set50 = new Set(users.filter((user) => isAssigned(user, ramp(base, 50))));
    for (const user of set10) assert.ok(set30.has(user), `${user} 在 10% 组却丢了`);
    for (const user of set30) assert.ok(set50.has(user), `${user} 在 30% 组却丢了`);
    assert.ok(set30.size > set10.size && set50.size > set30.size, '扩量后人群必须增长');
    console.log('[4/4] 扩量单调 OK, 10/30/50 组人数:', set10.size, set30.size, set50.size);

    console.log('\n✅ 120-03 AB 分流 全部断言通过');
}

runAssertions();

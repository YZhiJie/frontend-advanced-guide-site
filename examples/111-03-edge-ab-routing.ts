// 文件: examples/111-03-edge-ab-routing.ts
// 边缘路由 + AB 分桶：区域就近 + 数据驻留约束，稳定哈希分桶 + 灰度比例单调扩量
// 目标：同用户永远同桶；扩量不翻转已有用户；EU 数据驻留不允许故障时跨区漂移

import assert from 'node:assert';

type Region = 'us-east' | 'eu-west' | 'ap-southeast';
type RouteStatus = 'ok' | 'degraded' | 'unavailable';

interface RouteDecision {
    readonly region: Region | null;
    readonly status: RouteStatus;
    readonly reason: string;
}

interface CountryRule {
    readonly primary: Region;
    readonly failover: readonly Region[];
    readonly dataResidency: boolean;
}

/** 国家 → 主区域 + 故障转移候选；dataResidency 为真时禁止离开本区域 */
const COUNTRY_RULES: Readonly<Record<string, CountryRule>> = {
    US: { primary: 'us-east', failover: ['ap-southeast'], dataResidency: false },
    CA: { primary: 'us-east', failover: ['ap-southeast'], dataResidency: false },
    GB: { primary: 'eu-west', failover: [], dataResidency: true },
    DE: { primary: 'eu-west', failover: [], dataResidency: true },
    FR: { primary: 'eu-west', failover: [], dataResidency: true },
    SG: { primary: 'ap-southeast', failover: ['us-east'], dataResidency: false },
    JP: { primary: 'ap-southeast', failover: ['us-east'], dataResidency: false },
    AU: { primary: 'ap-southeast', failover: ['us-east'], dataResidency: false },
};

const DEFAULT_RULE: CountryRule = {
    primary: 'us-east',
    failover: ['ap-southeast'],
    dataResidency: false,
};

function routeCountry(country: string, healthy: ReadonlySet<Region>): RouteDecision {
    const rule = COUNTRY_RULES[country.toUpperCase()] ?? DEFAULT_RULE;
    if (healthy.has(rule.primary)) {
        return { region: rule.primary, status: 'ok', reason: `就近命中 ${rule.primary}` };
    }
    const fallback = rule.failover.find((region) => healthy.has(region));
    if (fallback) {
        return { region: fallback, status: 'degraded', reason: `主区不可用，临时切 ${fallback}` };
    }
    if (rule.dataResidency) {
        return {
            region: null,
            status: 'unavailable',
            reason: '数据驻留禁止跨区故障转移，宁可拒绝也不漂移',
        };
    }
    return { region: null, status: 'unavailable', reason: '无可用区域' };
}

/** cyrb53：53 位字符串哈希，分桶分布均匀、跨进程稳定；不是加密哈希 */
function cyrb53(str: string, seed = 0): number {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const BUCKETS = 10000; // 万分位分桶，1 个桶 = 0.01%

function bucketOf(salt: string, userId: string): number {
    return cyrb53(`${salt}:${userId}`) % BUCKETS;
}

interface Variant {
    readonly id: string;
    readonly weight: number; // 百分比，实验内各变体之和应为 100
}

interface Experiment {
    readonly name: string;
    readonly salt: string;
    readonly rolloutPercent: number; // 0-100，进入实验的流量比例
    readonly variants: readonly Variant[];
}

interface Assignment {
    readonly variant: string | null;
    readonly bucket: number;
    readonly eligible: boolean;
}

/** 两层独立盐：扩量只改入场券，不改变变体；改权重只改变体区间 */
function assign(exp: Experiment, userId: string): Assignment {
    const rolloutBucket = bucketOf(`${exp.salt}:rollout`, userId);
    const eligible = rolloutBucket < exp.rolloutPercent * 100;
    if (!eligible) return { variant: null, bucket: rolloutBucket, eligible: false };

    const variantBucket = bucketOf(`${exp.salt}:variant`, userId);
    let cumulative = 0;
    for (const variant of exp.variants) {
        cumulative += variant.weight * 100;
        if (variantBucket < cumulative) {
            return { variant: variant.id, bucket: variantBucket, eligible: true };
        }
    }
    // 权重之和不足 100 时兜底到最后一个变体，避免空指针式分桶
    return {
        variant: exp.variants[exp.variants.length - 1].id,
        bucket: variantBucket,
        eligible: true,
    };
}

const CHECKOUT_EXP: Experiment = {
    name: 'new-checkout',
    salt: 'checkout-2026q4',
    rolloutPercent: 100,
    variants: [
        { id: 'control', weight: 50 },
        { id: 'treatment', weight: 50 },
    ],
};

function eligibleSet(exp: Experiment, users: readonly string[]): Set<string> {
    return new Set(users.filter((user) => assign(exp, user).eligible));
}

function ratio(part: number, total: number): number {
    return part / total;
}

function runAssertions(): void {
    const users = Array.from({ length: 20000 }, (_, i) => `u_${i}`);

    // ---------- 测试 1：稳定分桶——同用户同结果，且分布均匀 ----------
    const assignments = users.map((user) => assign(CHECKOUT_EXP, user));
    for (const user of users.slice(0, 1000)) {
        assert.deepEqual(assign(CHECKOUT_EXP, user), assign(CHECKOUT_EXP, user));
    }
    assert.ok(assignments.every((a) => a.eligible && a.bucket >= 0 && a.bucket < BUCKETS));
    const controlCount = assignments.filter((a) => a.variant === 'control').length;
    assert.ok(
        Math.abs(ratio(controlCount, users.length) - 0.5) < 0.015,
        `50/50 分桶偏差过大: ${ratio(controlCount, users.length)}`,
    );
    console.log('[1/4] 稳定分桶 OK, control 占比:', ratio(controlCount, users.length).toFixed(3));

    // ---------- 测试 2：权重调整——只发生单向迁移 ----------
    const exp30 = {
        ...CHECKOUT_EXP,
        variants: [
            { id: 'control', weight: 30 },
            { id: 'treatment', weight: 70 },
        ],
    };
    const oldTreatment = users.filter((user) => assign(CHECKOUT_EXP, user).variant === 'treatment');
    const stillTreatment = oldTreatment.filter((user) => assign(exp30, user).variant === 'treatment');
    assert.equal(stillTreatment.length, oldTreatment.length, '缩容对照组不能让已入场用户回退');
    const migrated = users.filter(
        (user) =>
            assign(CHECKOUT_EXP, user).variant === 'control' && assign(exp30, user).variant === 'treatment',
    );
    assert.ok(
        ratio(migrated.length, users.length) > 0.15 && ratio(migrated.length, users.length) < 0.25,
        `对照组→实验组迁移比例异常: ${ratio(migrated.length, users.length)}`,
    );
    const treatment30 = users.filter((user) => assign(exp30, user).variant === 'treatment').length;
    assert.ok(Math.abs(ratio(treatment30, users.length) - 0.7) < 0.015);
    console.log('[2/4] 权重调整单向迁移 OK, 迁移占比:', ratio(migrated.length, users.length).toFixed(3));

    // ---------- 测试 3：灰度扩量——1% ⊂ 10% ⊂ 50% ⊂ 100%，变体不翻转 ----------
    const levels = [1, 10, 50, 100];
    const sets = levels.map((percent) =>
        eligibleSet({ ...CHECKOUT_EXP, rolloutPercent: percent }, users),
    );
    for (let i = 1; i < sets.length; i++) {
        for (const user of sets[i - 1]) {
            assert.ok(sets[i].has(user), `扩量必须单调：${levels[i - 1]}% 用户丢失于 ${levels[i]}%`);
        }
    }
    assert.equal(sets[3].size, users.length, '100% 时全员入场');
    assert.ok(
        Math.abs(ratio(sets[0].size, users.length) - 0.01) < 0.005,
        `1% 档实际 ${ratio(sets[0].size, users.length)}`,
    );
    assert.ok(Math.abs(ratio(sets[1].size, users.length) - 0.1) < 0.015);
    assert.ok(Math.abs(ratio(sets[2].size, users.length) - 0.5) < 0.02);
    const earlyUser = [...sets[0]][0];
    assert.deepEqual(
        assign({ ...CHECKOUT_EXP, rolloutPercent: 1 }, earlyUser),
        assign({ ...CHECKOUT_EXP, rolloutPercent: 100 }, earlyUser),
        '扩量不得改变变体',
    );
    console.log('[3/4] 灰度扩量单调性 OK, 各档:', levels.map((p, i) => `${p}%=${sets[i].size}`).join(' '));

    // ---------- 测试 4：区域路由——就近、降级与数据驻留红线 ----------
    const allHealthy = new Set<Region>(['us-east', 'eu-west', 'ap-southeast']);
    assert.equal(routeCountry('SG', allHealthy).region, 'ap-southeast');
    assert.equal(routeCountry('DE', allHealthy).region, 'eu-west');
    assert.equal(routeCountry('de', allHealthy).region, 'eu-west', '国家码大小写不敏感');
    const unknown = routeCountry('BR', allHealthy);
    assert.equal(unknown.region, 'us-east', '未知国家落到默认区');
    assert.equal(unknown.status, 'ok');

    const euDown = new Set<Region>(['us-east', 'ap-southeast']);
    const euDecision = routeCountry('FR', euDown);
    assert.equal(euDecision.status, 'unavailable', 'EU 数据驻留：宁可拒绝也不跨区');
    assert.equal(euDecision.region, null);
    assert.ok(euDecision.reason.includes('数据驻留'));

    const usDown = new Set<Region>(['eu-west', 'ap-southeast']);
    const usDecision = routeCountry('US', usDown);
    assert.equal(usDecision.status, 'degraded', '非驻留国家允许临时跨区');
    assert.equal(usDecision.region, 'ap-southeast');
    assert.ok(routeCountry('JP', new Set<Region>(['ap-southeast'])).status === 'ok');
    assert.equal(routeCountry('JP', new Set<Region>(['eu-west'])).status, 'unavailable');

    const routedA = routeCountry('US', allHealthy);
    const routedB = routeCountry('DE', allHealthy);
    assert.notEqual(routedA.region, routedB.region, '不同区域命中不同 POP');
    assert.deepEqual(assign(CHECKOUT_EXP, 'u_42'), assign(CHECKOUT_EXP, 'u_42'));
    console.log('[4/4] 区域路由与驻留 OK, EU 故障决策:', euDecision.status);

    console.log('\n✅ 111-03 边缘路由与 AB 分桶 全部断言通过');
}

runAssertions();

// 文件: examples/111-01-cold-start-budget.ts
// 冷启动预算决策器：按 p95 目标拆解预算，判断直连 / 依赖瘦身 / 预热 / 保活池化 / 换形态
// 目标：冷请求占比 >5% 时 p95 必落在冷启动堆里；热路径已超预算时预热无效，只能换形态

import assert from 'node:assert';

type Form = 'faas' | 'edge' | 'managed-container';

interface PlatformProfile {
    readonly label: string;
    readonly form: Form;
    readonly warmExecutionMs: number; // 函数代码自身 p95（含序列化）
    readonly baseColdStartMs: number; // 运行时启动 p95（不含依赖加载）
    readonly perDependencyMbMs: number; // 每 MB 依赖带来的冷启动增量（实测均值）
    readonly concurrencyPerInstance: number;
    readonly supportsProvisioned: boolean;
    readonly idleTimeoutSec: number; // 无预热时实例回收前的空闲窗口
}

interface Workload {
    readonly bundleMb: number;
    readonly downstreamMs: number; // 下游 RPC/DB p95
    readonly networkMs: number; // 客户端到函数/POP 的往返
    readonly targetP95Ms: number;
    readonly coldRatio: number; // 线上实测冷请求占比
    readonly baselineRps: number;
    readonly peakRps: number;
    readonly avgDurationSec: number;
}

type Verdict = 'direct' | 'slim-deps' | 'provision' | 'pool' | 'switch-form';

interface Plan {
    readonly platform: string;
    readonly verdict: Verdict;
    readonly warmP95Ms: number;
    readonly coldP95Ms: number;
    readonly effectiveP95Ms: number;
    readonly provisionedConcurrency: number;
    readonly pingIntervalSec: number | null;
    readonly reasons: readonly string[];
}

const SLIM_TARGET_MB = 4; // 依赖瘦身目标：包体压进 4MB（常见 FaaS 经验值）
const COLD_TAIL_SHARE = 0.05; // 冷请求占 5% 以上，p95 分位点就落进冷请求群
const PROVISION_HEADROOM = 1.3; // 预热并发留 30% 余量吸收突发

function round(n: number, digits = 1): number {
    const p = 10 ** digits;
    return Math.round(n * p) / p;
}

function computePlan(platform: PlatformProfile, w: Workload): Plan {
    const warmP95Ms = round(platform.warmExecutionMs + w.downstreamMs + w.networkMs);
    const coldStartMs = platform.baseColdStartMs + w.bundleMb * platform.perDependencyMbMs;
    const coldP95Ms = round(warmP95Ms + coldStartMs);
    // p95 是尾部指标：冷请求占比不超过 5% 时，95% 分位点仍在热请求区间内
    const effectiveP95Ms = w.coldRatio > COLD_TAIL_SHARE ? coldP95Ms : warmP95Ms;
    const reasons: string[] = [];
    let verdict: Verdict = 'direct';
    let provisionedConcurrency = 0;
    let pingIntervalSec: number | null = null;

    if (effectiveP95Ms <= w.targetP95Ms) {
        reasons.push(`有效 p95 ${effectiveP95Ms}ms 低于目标 ${w.targetP95Ms}ms，无需预热`);
    } else if (warmP95Ms > w.targetP95Ms) {
        // 预热只消除冷启动，消不掉热路径；热路径超预算必须换形态或优化下游
        verdict = 'switch-form';
        reasons.push(`热路径 ${warmP95Ms}ms 已超预算，预热救不了热路径`);
    } else {
        const slimBundleMb = Math.min(w.bundleMb, SLIM_TARGET_MB);
        const slimColdP95Ms = round(
            warmP95Ms + platform.baseColdStartMs + slimBundleMb * platform.perDependencyMbMs,
        );
        if (w.bundleMb > SLIM_TARGET_MB && slimColdP95Ms <= w.targetP95Ms) {
            verdict = 'slim-deps';
            reasons.push(`依赖 ${w.bundleMb}MB → ${SLIM_TARGET_MB}MB 后冷 p95 ${slimColdP95Ms}ms，瘦身即可达标`);
        } else if (platform.supportsProvisioned) {
            verdict = 'provision';
            provisionedConcurrency = Math.ceil(w.baselineRps * w.avgDurationSec * PROVISION_HEADROOM);
            reasons.push(`冷 p95 ${coldP95Ms}ms 超标，预热 ${provisionedConcurrency} 并发覆盖基线流量`);
        } else if (platform.idleTimeoutSec >= 120) {
            verdict = 'pool';
            pingIntervalSec = Math.floor(platform.idleTimeoutSec / 2);
            reasons.push(`平台无预热能力，按空闲超时 ${platform.idleTimeoutSec}s 的一半节奏池化保活`);
        } else {
            verdict = 'switch-form';
            reasons.push(`无预热且空闲窗口仅 ${platform.idleTimeoutSec}s，保活过密，应换边缘函数或常驻容器`);
        }
    }

    return {
        platform: platform.label,
        verdict,
        warmP95Ms,
        coldP95Ms,
        effectiveP95Ms,
        provisionedConcurrency,
        pingIntervalSec,
        reasons,
    };
}

function runAssertions(): void {
    // ---------- 测试 1：冷启动占比决定 p95，12% 冷请求时必须预热 ----------
    const lambda: PlatformProfile = {
        label: 'Lambda Node20 1GB',
        form: 'faas',
        warmExecutionMs: 120,
        baseColdStartMs: 900,
        perDependencyMbMs: 25,
        concurrencyPerInstance: 10,
        supportsProvisioned: true,
        idleTimeoutSec: 900,
    };
    const campaign: Workload = {
        bundleMb: 12,
        downstreamMs: 180,
        networkMs: 60,
        targetP95Ms: 800,
        coldRatio: 0.12,
        baselineRps: 120,
        peakRps: 200,
        avgDurationSec: 0.3,
    };
    const p1 = computePlan(lambda, campaign);
    assert.equal(p1.warmP95Ms, 360, '热路径 = 120 + 180 + 60');
    assert.equal(p1.coldP95Ms, 1560, '冷路径 = 360 + 900 + 12MB × 25ms');
    assert.equal(p1.effectiveP95Ms, 1560, '12% 冷请求，p95 落在冷启动堆里');
    assert.equal(p1.verdict, 'provision');
    assert.equal(p1.provisionedConcurrency, 47, 'ceil(120 rps × 0.3s × 1.3)');
    const p2 = computePlan(lambda, { ...campaign, coldRatio: 0.04 });
    assert.equal(p2.effectiveP95Ms, 360, '4% 冷请求仍在 5% 尾部之外，p95 取热路径');
    assert.equal(p2.verdict, 'direct', '冷启动没有吃掉 p95 预算，无需预热');
    console.log('[1/4] 冷启动占比与 p95 OK, 预热并发:', p1.provisionedConcurrency);

    // ---------- 测试 2：依赖瘦身优先于预热（改包体比买并发便宜） ----------
    const fc: PlatformProfile = {
        label: '函数计算按量',
        form: 'faas',
        warmExecutionMs: 100,
        baseColdStartMs: 180,
        perDependencyMbMs: 30,
        concurrencyPerInstance: 20,
        supportsProvisioned: false,
        idleTimeoutSec: 900,
    };
    const w2: Workload = {
        bundleMb: 14,
        downstreamMs: 150,
        networkMs: 50,
        targetP95Ms: 700,
        coldRatio: 0.3,
        baselineRps: 80,
        peakRps: 160,
        avgDurationSec: 0.2,
    };
    const p3 = computePlan(fc, w2);
    assert.equal(p3.warmP95Ms, 300);
    assert.equal(p3.coldP95Ms, 900, '冷启动 = 180 + 14MB × 30ms');
    assert.equal(p3.verdict, 'slim-deps', '瘦身后 600ms 可达标，先改依赖');
    assert.ok(p3.reasons.some((r) => r.includes('600ms')), '理由要给出瘦身后的冷 p95');
    assert.equal(p3.provisionedConcurrency, 0, '未选择预热就不产生预热并发');
    console.log('[2/4] 依赖瘦身决策 OK, 冷路径:', p3.coldP95Ms);

    // ---------- 测试 3：热路径超预算 → 换形态；边缘函数直连可达标 ----------
    const hotTight: Workload = { ...campaign, targetP95Ms: 300 };
    const p4 = computePlan(lambda, hotTight);
    assert.equal(p4.verdict, 'switch-form');
    assert.equal(p4.provisionedConcurrency, 0, '热路径已超预算，预热属于无效投入');
    assert.ok(p4.reasons.some((r) => r.includes('热路径')), '必须指出根因在热路径');
    const edge: PlatformProfile = {
        label: 'Workers 边缘',
        form: 'edge',
        warmExecutionMs: 15,
        baseColdStartMs: 25,
        perDependencyMbMs: 5,
        concurrencyPerInstance: 1,
        supportsProvisioned: false,
        idleTimeoutSec: 0,
    };
    const edgeWorkload: Workload = {
        bundleMb: 2,
        downstreamMs: 120,
        networkMs: 25,
        targetP95Ms: 300,
        coldRatio: 0.02,
        baselineRps: 120,
        peakRps: 400,
        avgDurationSec: 0.05,
    };
    const p5 = computePlan(edge, edgeWorkload);
    assert.equal(p5.warmP95Ms, 160);
    assert.equal(p5.coldP95Ms, 195);
    assert.equal(p5.verdict, 'direct', '换形态后热路径与冷路径都进预算');
    console.log('[3/4] 换形态决策 OK, 边缘 p95:', p5.effectiveP95Ms);

    // ---------- 测试 4：无预热平台的池化节奏，空闲窗口过短则换形态 ----------
    const poolOnly: PlatformProfile = {
        label: '自建 FaaS 无预热',
        form: 'managed-container',
        warmExecutionMs: 100,
        baseColdStartMs: 450,
        perDependencyMbMs: 30,
        concurrencyPerInstance: 10,
        supportsProvisioned: false,
        idleTimeoutSec: 900,
    };
    const w4: Workload = {
        bundleMb: 14,
        downstreamMs: 150,
        networkMs: 50,
        targetP95Ms: 700,
        coldRatio: 0.3,
        baselineRps: 20,
        peakRps: 60,
        avgDurationSec: 0.2,
    };
    const p6 = computePlan(poolOnly, w4);
    assert.equal(p6.coldP95Ms, 1170, '瘦身到 4MB 仍 870ms，只能保活');
    assert.equal(p6.verdict, 'pool');
    assert.equal(p6.pingIntervalSec, 450, '保活间隔 = 空闲超时 900s / 2');
    const shortIdle: PlatformProfile = { ...poolOnly, label: '短空闲窗口 FaaS', idleTimeoutSec: 60 };
    const p7 = computePlan(shortIdle, w4);
    assert.equal(p7.verdict, 'switch-form', '60s 回收，30s 一次保活成本高于换形态');
    assert.equal(p7.pingIntervalSec, null);
    console.log('[4/4] 池化与换形态边界 OK, 保活间隔:', p6.pingIntervalSec);

    console.log('\n✅ 111-01 冷启动预算决策 全部断言通过');
}

runAssertions();

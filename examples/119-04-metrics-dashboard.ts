// 文件: examples/119-04-metrics-dashboard.ts
// 指标看板计算：转化漏斗（逐级取交集）、留存、性能 P75 聚合、阈值告警与环比异常检测
// 目标：漏斗不把“未到上一步却直接支付”的用户算进来；P75 用 nearest-rank；异常检测受最小样本量约束

import assert from 'node:assert';

type Step = 'view' | 'cart' | 'checkout' | 'pay';

const STEP_ORDER: readonly Step[] = ['view', 'cart', 'checkout', 'pay'];

interface FunnelEvent {
    userId: string;
    step: Step;
    atMs: number;
}

interface FunnelStage {
    step: Step;
    users: number;
    fromPrev: number;
    fromTop: number;
}

interface FunnelResult {
    stages: FunnelStage[];
    overall: number;
}

function ratio(numerator: number, denominator: number): number {
    return denominator === 0 ? 0 : numerator / denominator;
}

/** 漏斗必须逐级取交集：只有真正走完上一步的人，才算进入下一步 */
function computeFunnel(events: FunnelEvent[]): FunnelResult {
    const reached = new Map<Step, Set<string>>();
    for (const step of STEP_ORDER) reached.set(step, new Set());
    for (const event of events) reached.get(event.step)?.add(event.userId);

    const qualified = new Map<Step, Set<string>>();
    for (let index = 0; index < STEP_ORDER.length; index += 1) {
        const step = STEP_ORDER[index];
        const current = reached.get(step)!;
        if (index === 0) {
            qualified.set(step, new Set(current));
            continue;
        }
        const previous = qualified.get(STEP_ORDER[index - 1])!;
        const next = new Set<string>();
        for (const userId of current) {
            if (previous.has(userId)) next.add(userId);
        }
        qualified.set(step, next);
    }

    const topUsers = qualified.get('view')!.size;
    const stages: FunnelStage[] = STEP_ORDER.map((step, index) => {
        const users = qualified.get(step)!.size;
        return {
            step,
            users,
            fromPrev: index === 0 ? 1 : ratio(users, qualified.get(STEP_ORDER[index - 1])!.size),
            fromTop: ratio(users, topUsers),
        };
    });
    return { stages, overall: ratio(qualified.get('pay')!.size, topUsers) };
}

interface Signup {
    userId: string;
    day: number; // 0 = 注册当天
}

interface Activity {
    userId: string;
    day: number;
}

interface RetentionResult {
    cohort: number;
    retained: Record<number, number>;
    rates: Record<number, number>;
}

/** 留存只看注册当天入组的用户；第 1/7 天有任意活跃事件即算留存 */
function computeRetention(signups: Signup[], activities: Activity[], checkpoints: number[] = [1, 7]): RetentionResult {
    const cohort = signups.filter((signup) => signup.day === 0);
    const cohortIds = new Set(cohort.map((signup) => signup.userId));
    const retained: Record<number, number> = {};
    const rates: Record<number, number> = {};

    for (const day of checkpoints) {
        const active = new Set(
            activities
                .filter((activity) => activity.day === day && cohortIds.has(activity.userId))
                .map((activity) => activity.userId),
        );
        retained[day] = active.size;
        rates[day] = ratio(active.size, cohort.length);
    }
    return { cohort: cohort.length, retained, rates };
}

interface PerfSample {
    lcpMs: number;
    inpMs: number;
    route: string;
}

interface PerformanceSummary {
    lcpP75: number;
    inpP75: number;
    samples: number;
}

/** nearest-rank：P75 取排序后第 ceil(n × 0.75) 个，避免插值口径争议 */
function percentile(values: number[], p: number): number {
    assert.ok(values.length > 0, '性能样本不能为空');
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.max(0, Math.ceil(p * sorted.length) - 1);
    return sorted[index];
}

function summarizePerformance(samples: PerfSample[]): PerformanceSummary {
    return {
        lcpP75: percentile(samples.map((sample) => sample.lcpMs), 0.75),
        inpP75: percentile(samples.map((sample) => sample.inpMs), 0.75),
        samples: samples.length,
    };
}

interface Thresholds {
    conversion: number;
    retentionD7: number;
    lcpP75: number;
    inpP75: number;
}

const DEFAULT_THRESHOLDS: Thresholds = {
    conversion: 0.07,
    retentionD7: 0.15,
    lcpP75: 2500,
    inpP75: 200,
};

type MetricName = 'conversion' | 'retentionD7' | 'lcpP75' | 'inpP75';

interface Alert {
    metric: MetricName;
    level: 'warn' | 'critical';
    value: number;
    threshold: number;
    message: string;
}

interface AnomalyOptions {
    minSamples: number;
    dropRatio: number; // 相对跌幅阈值：0.2 表示环比下跌 20% 才判定异常
}

interface Anomaly {
    metric: MetricName;
    current: number;
    baseline: number;
    delta: number; // 相对变化，负数代表下跌
}

/**
 * 环比异常检测：先过最小样本量，再看相对跌幅。
 * 小样本（如凌晨 30 个访问）波动巨大，直接告警只会制造噪声；
 * 绝对跌幅也不可靠——转化率从 2% 掉到 1% 相对腰斩，从 30% 掉到 29% 却不值得半夜叫醒人。
 */
function detectAnomaly(
    metric: MetricName,
    current: number,
    baseline: number,
    samples: number,
    options: AnomalyOptions,
): Anomaly | null {
    if (samples < options.minSamples) return null;
    if (baseline <= 0) return null;
    const delta = (current - baseline) / baseline;
    if (delta <= -options.dropRatio) return { metric, current, baseline, delta };
    return null;
}

interface DashboardInput {
    events: FunnelEvent[];
    signups: Signup[];
    activities: Activity[];
    perf: PerfSample[];
}

interface Dashboard {
    funnel: FunnelResult;
    retention: RetentionResult;
    performance: PerformanceSummary;
    alerts: Alert[];
    status: 'healthy' | 'degraded';
}

function buildDashboard(input: DashboardInput, thresholds: Thresholds = DEFAULT_THRESHOLDS): Dashboard {
    const funnel = computeFunnel(input.events);
    const retention = computeRetention(input.signups, input.activities);
    const performance = summarizePerformance(input.perf);
    const alerts: Alert[] = [];

    if (funnel.overall < thresholds.conversion) {
        alerts.push({
            metric: 'conversion',
            level: 'warn',
            value: funnel.overall,
            threshold: thresholds.conversion,
            message: `支付转化 ${(funnel.overall * 100).toFixed(2)}% 低于目标 ${(thresholds.conversion * 100).toFixed(0)}%`,
        });
    }
    if (retention.rates[7] < thresholds.retentionD7) {
        alerts.push({
            metric: 'retentionD7',
            level: 'warn',
            value: retention.rates[7],
            threshold: thresholds.retentionD7,
            message: `D7 留存 ${(retention.rates[7] * 100).toFixed(1)}% 低于目标 ${(thresholds.retentionD7 * 100).toFixed(0)}%`,
        });
    }
    if (performance.lcpP75 > thresholds.lcpP75) {
        alerts.push({
            metric: 'lcpP75',
            level: 'critical',
            value: performance.lcpP75,
            threshold: thresholds.lcpP75,
            message: `LCP P75 ${performance.lcpP75}ms 超过 ${thresholds.lcpP75}ms`,
        });
    }
    if (performance.inpP75 > thresholds.inpP75) {
        alerts.push({
            metric: 'inpP75',
            level: 'critical',
            value: performance.inpP75,
            threshold: thresholds.inpP75,
            message: `INP P75 ${performance.inpP75}ms 超过 ${thresholds.inpP75}ms`,
        });
    }

    return {
        funnel,
        retention,
        performance,
        alerts,
        status: alerts.length > 0 ? 'degraded' : 'healthy',
    };
}

/** 同一批用户依次经过 view → cart → checkout → pay；extraPay 用于构造“跳步支付”的脏数据 */
function makeFunnelEvents(viewCount: number, cartCount: number, checkoutCount: number, payCount: number, extraPay = 0): FunnelEvent[] {
    const events: FunnelEvent[] = [];
    const push = (count: number, step: Step, prefix: string): void => {
        for (let index = 0; index < count; index += 1) {
            events.push({ userId: `${prefix}-${index}`, step, atMs: index * 1000 });
        }
    };
    push(viewCount, 'view', 'u');
    push(cartCount, 'cart', 'u');
    push(checkoutCount, 'checkout', 'u');
    push(payCount, 'pay', 'u');
    push(extraPay, 'pay', 'skip');
    return events;
}

function makeRetentionData(): { signups: Signup[]; activities: Activity[] } {
    const signups: Signup[] = [];
    const activities: Activity[] = [];
    for (let index = 0; index < 200; index += 1) signups.push({ userId: `c-${index}`, day: 0 });
    for (let index = 0; index < 20; index += 1) signups.push({ userId: `later-${index}`, day: 1 });
    for (let index = 0; index < 90; index += 1) activities.push({ userId: `c-${index}`, day: 1 });
    for (let index = 0; index < 40; index += 1) activities.push({ userId: `c-${index}`, day: 7 });
    for (let index = 0; index < 10; index += 1) activities.push({ userId: `later-${index}`, day: 1 });
    return { signups, activities };
}

const perfSamples: PerfSample[] = [
    { lcpMs: 1800, inpMs: 90, route: '/home' },
    { lcpMs: 2100, inpMs: 100, route: '/home' },
    { lcpMs: 2400, inpMs: 110, route: '/product/p-1' },
    { lcpMs: 2600, inpMs: 120, route: '/product/p-1' },
    { lcpMs: 3000, inpMs: 150, route: '/checkout' },
    { lcpMs: 3200, inpMs: 180, route: '/checkout' },
    { lcpMs: 3500, inpMs: 200, route: '/feed' },
    { lcpMs: 3900, inpMs: 220, route: '/feed' },
];

function runAssertions() {
    // ---------- 测试 1：漏斗逐级取交集，跳步支付不计入 ----------
    const funnel = computeFunnel(makeFunnelEvents(1000, 300, 120, 80, 2));
    assert.deepEqual(funnel.stages.map((stage) => stage.users), [1000, 300, 120, 80]);
    assert.equal(funnel.stages[0].fromPrev, 1);
    assert.equal(funnel.stages[1].fromPrev, 300 / 1000);
    assert.equal(funnel.stages[2].fromPrev, 120 / 300);
    assert.equal(funnel.stages[3].fromPrev, 80 / 120);
    assert.equal(funnel.overall, 0.08, '2 个跳步支付用户必须被排除');
    assert.equal(funnel.stages[3].fromTop, 0.08);
    console.log('[1/4] 转化漏斗 OK, view→pay:', `${(funnel.overall * 100).toFixed(1)}%`);

    // ---------- 测试 2：留存按注册当天入组，非同期注册不稀释 ----------
    const retentionData = makeRetentionData();
    const retention = computeRetention(retentionData.signups, retentionData.activities);
    assert.equal(retention.cohort, 200, '只有 day=0 的 200 人入组');
    assert.equal(retention.retained[1], 90, 'day1 的 later-* 用户不属于该 cohort');
    assert.equal(retention.retained[7], 40);
    assert.equal(retention.rates[1], 0.45);
    assert.equal(retention.rates[7], 0.2);
    console.log('[2/4] 留存 OK, D1/D7:', `${(retention.rates[1] * 100).toFixed(0)}% / ${(retention.rates[7] * 100).toFixed(0)}%`);

    // ---------- 测试 3：性能 P75 聚合 ----------
    const performance = summarizePerformance(perfSamples);
    assert.equal(performance.samples, 8);
    assert.equal(performance.lcpP75, 3200, '8 个样本的 P75 取第 6 个');
    assert.equal(performance.inpP75, 180, 'nearest-rank 不做插值');
    assert.equal(percentile([100], 0.75), 100, '单样本 P75 即自身');
    console.log('[3/4] 性能聚合 OK, LCP/INP P75:', performance.lcpP75, '/', performance.inpP75);

    // ---------- 测试 4：阈值告警与整体健康度 ----------
    const dashboard = buildDashboard({
        events: makeFunnelEvents(1000, 300, 120, 60, 0),
        signups: retentionData.signups,
        activities: retentionData.activities,
        perf: perfSamples,
    });
    assert.equal(dashboard.status, 'degraded');
    assert.equal(dashboard.alerts.length, 2, '转化 6% 偏低 + LCP P75 超标');
    assert.equal(dashboard.alerts[0].metric, 'conversion');
    assert.equal(dashboard.alerts[0].level, 'warn');
    assert.ok(Math.abs(dashboard.alerts[0].value - 0.06) < 1e-12);
    assert.equal(dashboard.alerts[1].metric, 'lcpP75');
    assert.equal(dashboard.alerts[1].level, 'critical');
    assert.ok(dashboard.alerts.some((alert) => alert.metric === 'lcpP75' && alert.value === 3200));
    assert.equal(dashboard.alerts.some((alert) => alert.metric === 'inpP75'), false, 'INP 180ms 未超阈值');
    assert.equal(dashboard.alerts.some((alert) => alert.metric === 'retentionD7'), false, 'D7 20% 达标');

    // 环比异常：样本达标 + 相对跌幅超阈值才成立
    const anomaly = detectAnomaly('conversion', 0.06, 0.08, 1200, { minSamples: 500, dropRatio: 0.2 });
    assert.ok(anomaly);
    assert.ok(Math.abs(anomaly!.delta + 0.25) < 1e-12, '0.08 → 0.06 应为 -25%');
    assert.equal(
        detectAnomaly('conversion', 0.06, 0.08, 120, { minSamples: 500, dropRatio: 0.2 }),
        null,
        '样本不足不告警',
    );
    assert.equal(
        detectAnomaly('conversion', 0.078, 0.08, 1200, { minSamples: 500, dropRatio: 0.2 }),
        null,
        '小幅波动不算异常',
    );
    console.log(
        '[4/4] 阈值告警/异常检测 OK:',
        `${dashboard.alerts.map((alert) => `${alert.metric}=${alert.level}`).join(', ')}, anomaly=${(anomaly!.delta * 100).toFixed(0)}%`,
    );

    console.log('\n✅ 119-04 指标看板计算 全部断言通过');
}

runAssertions();

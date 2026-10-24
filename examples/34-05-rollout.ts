// 灰度迁移计划：影子流量 → 按比例放量 → 全量 → 旧链路下线。
// 每步都有推进守卫（错误率 / p95 预算）与回滚出口——迁移没有回滚预案等于没有迁移方案。

interface Metrics {
    errorRate: number; // 出错请求占比
    p95Ms: number; // 95 分位时延
}

interface Phase {
    name: string;
    traffic: number; // 新链路承接的流量比例 0~1
    guard: { maxErrorRate: number; maxP95Ms: number };
}

const PLAN: Phase[] = [
    { name: "影子流量（只对比不生效）", traffic: 0, guard: { maxErrorRate: 0.001, maxP95Ms: 400 } },
    { name: "灰度 1%", traffic: 0.01, guard: { maxErrorRate: 0.005, maxP95Ms: 450 } },
    { name: "灰度 10%", traffic: 0.1, guard: { maxErrorRate: 0.005, maxP95Ms: 450 } },
    { name: "灰度 50%", traffic: 0.5, guard: { maxErrorRate: 0.003, maxP95Ms: 420 } },
    { name: "全量 100%", traffic: 1, guard: { maxErrorRate: 0.002, maxP95Ms: 400 } },
    { name: "旧链路下线", traffic: 1, guard: { maxErrorRate: 0.002, maxP95Ms: 400 } },
];

type Verdict = "advance" | "hold" | "rollback";

function judge(phase: Phase, metrics: Metrics): Verdict {
    const { maxErrorRate, maxP95Ms } = phase.guard;
    if (metrics.errorRate > maxErrorRate * 2 || metrics.p95Ms > maxP95Ms * 1.5)
        return "rollback"; // 显著恶化：立即回滚
    if (metrics.errorRate <= maxErrorRate && metrics.p95Ms <= maxP95Ms)
        return "advance"; // 全部达标：推进
    return "hold"; // 临界波动：原地观察一个观察窗
}

function rollout(label: string, metricsByPhase: Metrics[]): void {
    console.log(`\n=== ${label} ===`);
    for (const [i, phase] of PLAN.entries()) {
        const verdict = judge(phase, metricsByPhase[i]);
        const m = metricsByPhase[i];
        console.log(
            `${phase.name}  错误率 ${(m.errorRate * 100).toFixed(2)}% / p95 ${m.p95Ms}ms → ${verdict}`,
        );
        if (verdict === "rollback") {
            console.log(`↩ 已自动回滚至流量 0%，登记 RCA 后重新排期`);
            return;
        }
    }
    console.log("✓ 迁移完成");
}

// 场景一：健康迁移——每阶段指标达标，一路推进
rollout("健康迁移", PLAN.map((p) => ({ errorRate: p.guard.maxErrorRate * 0.6, p95Ms: p.guard.maxP95Ms * 0.8 })));

// 场景二：灰度 10% 时错误率飙到 1.2% → 守卫触发自动回滚
const spike = PLAN.map((p) => ({ errorRate: p.guard.maxErrorRate * 0.6, p95Ms: p.guard.maxP95Ms * 0.8 }));
spike[2] = { errorRate: 0.012, p95Ms: 380 };
rollout("异常迁移", spike);

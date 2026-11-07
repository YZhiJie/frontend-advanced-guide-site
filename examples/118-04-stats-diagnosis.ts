// 文件: examples/118-04-stats-diagnosis.ts
// getStats 指标诊断：区间增量、丢包率/抖动/RTT、帧丢弃与分辨率降级判定
// 目标：累计计数器必须做差分、计数器重置不误判、诊断结论与原因可逐条断言

import assert from 'node:assert';

type QualityLimit = 'none' | 'cpu' | 'bandwidth' | 'other';
type Verdict = 'healthy' | 'degraded' | 'critical';

/** 从 RTCStatsReport 里摘出来的 outbound-rtp / remote-inbound-rtp 关键字段 */
interface OutboundStats {
    timestampMs: number;
    packetsSent: number; // 累计值
    packetsLost: number; // 累计值（来自 remote-inbound-rtp）
    jitterMs: number;
    roundTripTimeMs: number;
    framesPerSecond: number; // 瞬时值
    framesDropped: number; // 累计值
    frameWidth: number;
    frameHeight: number;
    qualityLimitationReason: QualityLimit;
}

interface Baseline {
    width: number;
    height: number;
}

interface IntervalMetrics {
    sent: number;
    lost: number;
    lossRate: number;
    rttMs: number;
    jitterMs: number;
    fps: number;
    dropRate: number;
    width: number;
    height: number;
    resolutionDowngraded: boolean;
}

interface Diagnosis {
    verdict: Verdict;
    reasons: string[];
    metrics: IntervalMetrics;
}

/** 两个采样点的差分；计数器回退说明 stats 重置（如 ICE restart），返回 null 跳过本轮 */
function deriveMetrics(prev: OutboundStats, cur: OutboundStats, baseline: Baseline): IntervalMetrics | null {
    const dtSec = (cur.timestampMs - prev.timestampMs) / 1000;
    if (dtSec <= 0) return null;
    if (cur.packetsSent < prev.packetsSent || cur.packetsLost < prev.packetsLost) return null;
    if (cur.framesDropped < prev.framesDropped) return null;

    const sent = cur.packetsSent - prev.packetsSent;
    const lost = cur.packetsLost - prev.packetsLost;
    if (sent <= 0) return null;

    const total = sent + lost;
    const lostFrames = cur.framesDropped - prev.framesDropped;
    const expectedFrames = Math.round(cur.framesPerSecond * dtSec) + lostFrames;
    const areaRatio = (cur.frameWidth * cur.frameHeight) / (baseline.width * baseline.height);

    return {
        sent,
        lost,
        lossRate: lost / total,
        rttMs: cur.roundTripTimeMs,
        jitterMs: cur.jitterMs,
        fps: cur.framesPerSecond,
        dropRate: expectedFrames > 0 ? lostFrames / expectedFrames : 0,
        width: cur.frameWidth,
        height: cur.frameHeight,
        resolutionDegraded: areaRatio < 0.5 || cur.frameHeight < baseline.height * 0.6,
    };
}

/**
 * 诊断规则：任一指标进入红线即 critical；进入黄线或出现 CPU 限流/分辨率腰斩即 degraded。
 * 丢包率以 (sent + lost) 为分母，避免高丢包时低估。
 */
function diagnose(metrics: IntervalMetrics, limit: QualityLimit): Diagnosis {
    const reasons: string[] = [];
    let critical = false;
    let degraded = false;

    if (metrics.lossRate >= 0.15) {
        reasons.push('loss-critical');
        critical = true;
    } else if (metrics.lossRate >= 0.05) {
        reasons.push('loss');
        degraded = true;
    }

    if (metrics.rttMs >= 500) {
        reasons.push('rtt-critical');
        critical = true;
    } else if (metrics.rttMs >= 300) {
        reasons.push('rtt');
        degraded = true;
    }

    if (metrics.jitterMs >= 60) {
        reasons.push('jitter-critical');
        critical = true;
    } else if (metrics.jitterMs >= 30) {
        reasons.push('jitter');
        degraded = true;
    }

    if (limit === 'cpu') {
        reasons.push('cpu-limited');
        degraded = true;
    } else if (limit === 'bandwidth') {
        reasons.push('bandwidth-limited');
        degraded = true;
    }

    if (metrics.resolutionDegraded) {
        reasons.push('resolution-degraded');
        degraded = true;
    }

    if (metrics.dropRate >= 0.2) {
        reasons.push('frames-dropped');
        degraded = true;
    }

    const verdict: Verdict = critical ? 'critical' : degraded ? 'degraded' : 'healthy';
    return { verdict, reasons, metrics };
}

function makeStats(overrides: Partial<OutboundStats> = {}): OutboundStats {
    return {
        timestampMs: 0,
        packetsSent: 0,
        packetsLost: 0,
        jitterMs: 0,
        roundTripTimeMs: 0,
        framesPerSecond: 30,
        framesDropped: 0,
        frameWidth: 1280,
        frameHeight: 720,
        qualityLimitationReason: 'none',
        ...overrides,
    };
}

const BASELINE: Baseline = { width: 1280, height: 720 };

function metricsOf(prev: OutboundStats, cur: OutboundStats, baseline: Baseline = BASELINE): IntervalMetrics {
    const metrics = deriveMetrics(prev, cur, baseline);
    assert.ok(metrics, '区间样本应可差分');
    return metrics;
}

function runAssertions() {
    // ---------- 测试 1：健康区间——1.96% 丢包、低 RTT、720p 全帧 ----------
    const m1 = metricsOf(
        makeStats({ timestampMs: 1000 }),
        makeStats({ timestampMs: 3000, packetsSent: 1000, packetsLost: 20, jitterMs: 8, roundTripTimeMs: 80 }),
    );
    assert.equal(m1.sent, 1000);
    assert.equal(m1.lost, 20);
    assert.ok(Math.abs(m1.lossRate - 20 / 1020) < 1e-9, '丢包率分母必须是 sent+lost');
    const d1 = diagnose(m1, 'none');
    assert.equal(d1.verdict, 'healthy');
    assert.deepEqual(d1.reasons, []);
    console.log('[1/4] 健康区间 OK, loss:', (m1.lossRate * 100).toFixed(2) + '%');

    // ---------- 测试 2：丢包分级——5% 为 degraded，15% 为 critical ----------
    const m2 = metricsOf(
        makeStats({ timestampMs: 0 }),
        makeStats({ timestampMs: 2000, packetsSent: 900, packetsLost: 100, jitterMs: 10, roundTripTimeMs: 90 }),
    );
    assert.ok(Math.abs(m2.lossRate - 0.1) < 1e-9);
    const d2 = diagnose(m2, 'none');
    assert.equal(d2.verdict, 'degraded');
    assert.deepEqual(d2.reasons, ['loss']);

    const m3 = metricsOf(
        makeStats({ timestampMs: 0 }),
        makeStats({ timestampMs: 2000, packetsSent: 800, packetsLost: 200, jitterMs: 10, roundTripTimeMs: 90 }),
    );
    const d3 = diagnose(m3, 'none');
    assert.equal(d3.verdict, 'critical');
    assert.deepEqual(d3.reasons, ['loss-critical']);
    console.log('[2/4] 丢包分级 OK, 10% →', d2.verdict, '/ 20% →', d3.verdict);

    // ---------- 测试 3：RTT 与抖动——黄线与红线分别给出不同结论 ----------
    const m4 = metricsOf(
        makeStats({ timestampMs: 0 }),
        makeStats({ timestampMs: 2000, packetsSent: 1000, packetsLost: 10, jitterMs: 40, roundTripTimeMs: 350 }),
    );
    const d4 = diagnose(m4, 'none');
    assert.equal(d4.verdict, 'degraded');
    assert.deepEqual(d4.reasons, ['rtt', 'jitter']);

    const m5 = metricsOf(
        makeStats({ timestampMs: 0 }),
        makeStats({ timestampMs: 2000, packetsSent: 1000, packetsLost: 10, jitterMs: 70, roundTripTimeMs: 600 }),
    );
    const d5 = diagnose(m5, 'none');
    assert.equal(d5.verdict, 'critical');
    assert.deepEqual(d5.reasons, ['rtt-critical', 'jitter-critical']);
    console.log('[3/4] RTT/抖动分级 OK, 350ms →', d4.verdict, '/ 600ms →', d5.verdict);

    // ---------- 测试 4：CPU 限流 + 分辨率降级 + 计数器重置 ----------
    const m6 = metricsOf(
        makeStats({ timestampMs: 0 }),
        makeStats({
            timestampMs: 2000,
            packetsSent: 500,
            packetsLost: 5,
            jitterMs: 12,
            roundTripTimeMs: 120,
            framesPerSecond: 12,
            framesDropped: 300,
            frameWidth: 640,
            frameHeight: 360,
        }),
    );
    assert.equal(m6.resolutionDegraded, true, '640×360 只有 720p 面积的 1/4');
    assert.ok(m6.dropRate >= 0.2);
    const d6 = diagnose(m6, 'cpu');
    assert.equal(d6.verdict, 'degraded');
    assert.deepEqual(d6.reasons, ['cpu-limited', 'resolution-degraded', 'frames-dropped']);
    assert.equal(d6.metrics.width, 640);

    const reset = deriveMetrics(
        makeStats({ timestampMs: 0, packetsSent: 5000, framesDropped: 40 }),
        makeStats({ timestampMs: 2000, packetsSent: 100, framesDropped: 2 }),
        BASELINE,
    );
    assert.equal(reset, null, '计数器回退必须视为重置，跳过本轮诊断');
    console.log('[4/4] CPU/分辨率降级与重置 OK, dropRate:', (m6.dropRate * 100).toFixed(1) + '%');

    console.log('\n✅ 118-04 getStats 指标诊断 全部断言通过');
}

runAssertions();

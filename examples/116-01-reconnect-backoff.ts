// 文件: examples/116-01-reconnect-backoff.ts
// 重连退避状态机：指数退避 + 抖动 + 上限 + 前台/后台差异
// 目标：失败后延迟指数增长并被上限截断、抖动落在配置区间、状态迁移拒绝重复连接、后台更保守且回前台立即重试

import assert from 'node:assert';

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'backoff' | 'closed';
type Visibility = 'foreground' | 'background';

interface BackoffConfig {
    readonly baseMs: number;
    readonly factor: number;
    readonly maxMs: number;
    readonly jitterRatio: number; // 0.3 表示 ±30% 抖动
    readonly backgroundMultiplier: number; // 后台把间隔拉长，省电省流量
    readonly backgroundFloorMs: number; // 后台最小间隔，避免退避太激进
}

const DEFAULT_CONFIG: BackoffConfig = {
    baseMs: 1000,
    factor: 2,
    maxMs: 30000,
    jitterRatio: 0.3,
    backgroundMultiplier: 4,
    backgroundFloorMs: 5000,
};

/** 重连控制器：只负责「什么时候允许再连」，不碰真实 WebSocket */
class ReconnectController {
    state: ConnectionState = 'idle';
    attempt = 0;
    private nextRetryAtMs = 0;
    private visibility: Visibility = 'foreground';

    constructor(
        private readonly config: BackoffConfig = DEFAULT_CONFIG,
        private readonly rand: () => number = Math.random,
    ) {}

    /** 计算第 attempt 次失败后的等待时长；抖动后仍严格不超过上限 */
    computeDelay(attempt: number, visibility: Visibility = this.visibility): number {
        const cfg = this.config;
        let raw = Math.min(cfg.maxMs, cfg.baseMs * Math.pow(cfg.factor, attempt));
        if (visibility === 'background') {
            raw = Math.max(cfg.backgroundFloorMs, raw * cfg.backgroundMultiplier);
        }
        raw = Math.min(cfg.maxMs, raw);
        const spread = raw * cfg.jitterRatio;
        const jittered = raw - spread + this.rand() * spread * 2;
        return Math.max(0, Math.min(cfg.maxMs, Math.round(jittered)));
    }

    /** 空闲或冷却结束时才允许发起连接；连接中/已连接一律拒绝 */
    connect(nowMs: number): boolean {
        if (this.state === 'connecting' || this.state === 'connected' || this.state === 'closed') {
            return false;
        }
        if (this.state === 'backoff' && nowMs < this.nextRetryAtMs) {
            return false;
        }
        this.state = 'connecting';
        return true;
    }

    /** 握手成功：attempt 归零，退避历史清空 */
    onOpen(): boolean {
        if (this.state !== 'connecting') return false;
        this.state = 'connected';
        this.attempt = 0;
        this.nextRetryAtMs = 0;
        return true;
    }

    /** 连接失败或心跳超时：返回本次等待时长，供定时器使用 */
    onFailure(nowMs: number): number | null {
        if (this.state !== 'connecting' && this.state !== 'connected') return null;
        const delay = this.computeDelay(this.attempt);
        this.attempt += 1;
        this.state = 'backoff';
        this.nextRetryAtMs = nowMs + delay;
        return delay;
    }

    /** 关闭码分类：鉴权失败重连一万次也没用，必须重新登录 */
    onClose(code: number, nowMs: number): number | null {
        if (code === 4001 || code === 4003) {
            this.state = 'closed';
            this.nextRetryAtMs = 0;
            return null;
        }
        return this.onFailure(nowMs);
    }

    /** 前后台切换：后台拉长间隔；回前台立刻允许重试，用户不该等 30 秒 */
    setVisibility(visibility: Visibility, nowMs: number): void {
        const previous = this.visibility;
        this.visibility = visibility;
        if (visibility === 'foreground' && previous === 'background' && this.state === 'backoff') {
            this.nextRetryAtMs = nowMs;
        }
    }

    canConnect(nowMs: number): boolean {
        if (this.state === 'idle') return true;
        return this.state === 'backoff' && nowMs >= this.nextRetryAtMs;
    }
}

function runAssertions() {
    // ---------- 测试 1：指数增长与上限 ----------
    const noJitter: BackoffConfig = {
        baseMs: 1000,
        factor: 2,
        maxMs: 30000,
        jitterRatio: 0,
        backgroundMultiplier: 4,
        backgroundFloorMs: 5000,
    };
    const ctrl = new ReconnectController(noJitter, () => 0.5);
    const foregroundDelays = [0, 1, 2, 3, 4, 5, 10].map((n) => ctrl.computeDelay(n, 'foreground'));
    assert.deepEqual(foregroundDelays, [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    assert.equal(ctrl.computeDelay(0, 'background'), 5000, '后台有最小间隔');
    assert.equal(ctrl.computeDelay(10, 'background'), 30000, '后台同样受上限约束');
    console.log('[1/4] 指数增长与上限 OK:', foregroundDelays.join(' → '));

    // ---------- 测试 2：抖动区间与防重连风暴 ----------
    const jitterCfg: BackoffConfig = { ...noJitter, jitterRatio: 0.3 };
    const low = new ReconnectController(jitterCfg, () => 0).computeDelay(2);
    const high = new ReconnectController(jitterCfg, () => 0.999).computeDelay(2);
    assert.equal(low, 2800, '4000 × (1 - 0.3)');
    assert.ok(high > 5100 && high <= 5200, `高抖动应接近 5200，实际 ${high}`);
    assert.ok(low !== high, '不同随机数必须得到不同等待时长');
    const capped = new ReconnectController(jitterCfg, () => 0.999).computeDelay(20, 'background');
    assert.equal(capped, 30000, '抖动后也不能突破上限');
    console.log('[2/4] 抖动区间 OK:', `${low} ~ ${high}`);

    // ---------- 测试 3：状态迁移与重复连接拒绝 ----------
    const machine = new ReconnectController(noJitter, () => 0.5);
    assert.equal(machine.state, 'idle');
    assert.ok(machine.connect(0));
    assert.equal(machine.state, 'connecting');
    assert.equal(machine.connect(0), false, '连接中禁止重复发起');
    assert.ok(machine.onOpen());
    assert.equal(machine.state, 'connected');
    assert.equal(machine.attempt, 0);
    assert.equal(machine.onOpen(), false, '非 connecting 状态不得重复确认');
    const delay = machine.onFailure(100);
    assert.equal(delay, 1000, '首次失败等 1 秒');
    assert.equal(machine.state, 'backoff');
    assert.equal(machine.attempt, 1);
    assert.equal(machine.connect(150), false, '冷却期内禁止重连');
    assert.ok(machine.connect(1100), '冷却结束允许重连');
    assert.equal(machine.state, 'connecting');
    assert.ok(machine.onOpen());
    assert.equal(machine.attempt, 0, '成功后失败计数必须归零');
    console.log('[3/4] 状态迁移 OK, 首次退避:', delay, 'ms');

    // ---------- 测试 4：关闭码分类 + 前后台差异 ----------
    const auth = new ReconnectController(noJitter, () => 0.5);
    assert.ok(auth.connect(0));
    assert.equal(auth.onClose(4001, 0), null, '鉴权失败不安排重连');
    assert.equal(auth.state, 'closed');
    assert.equal(auth.connect(99999), false, 'closed 状态必须重新登录才能恢复');

    const abnormal = new ReconnectController(noJitter, () => 0.5);
    assert.ok(abnormal.connect(0));
    assert.equal(abnormal.onClose(1006, 0), 1000, '异常断开走退避');
    assert.equal(abnormal.state, 'backoff');

    const bg = new ReconnectController(noJitter, () => 0.5);
    bg.setVisibility('background', 0);
    assert.ok(bg.connect(0));
    const bgDelay = bg.onFailure(0);
    assert.equal(bgDelay, 5000, '后台最小间隔 5 秒，远大于前台 1 秒');
    bg.setVisibility('foreground', 0);
    assert.ok(bg.canConnect(0), '回前台立即允许重试');
    console.log('[4/4] 关闭码分类与前后台差异 OK, 后台退避:', bgDelay, 'ms');

    console.log('\n✅ 116-01 重连退避状态机 全部断言通过');
}

runAssertions();

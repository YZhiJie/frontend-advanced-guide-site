// 文件: examples/110-01-task-reward.ts
// 任务体系：事件上报聚合进度 + 事件幂等 + 达标后幂等领奖 + 按周期重置
// 目标：重复上报不重复加进度、重复领奖只发一次、跨周期进度独立而事件仍全局去重

import assert from 'node:assert';

type TaskState = 'in_progress' | 'claimable' | 'claimed';

interface TaskDef {
    id: string;
    target: number;
    rewardCoins: number;
}

interface ReportEvent {
    eventId: string; // 客户端生成的全局唯一 ID，服务端建唯一索引
    userId: string;
    taskId: string;
    amount: number;
    period: string; // 任务周期，如 '2026-11-03'；日任务跨天重置
}

interface ReportResult {
    accepted: boolean;
    duplicated: boolean;
    state: TaskState;
    progress: number;
}

interface ClaimResult {
    ok: boolean;
    duplicated: boolean;
    grantedCoins: number;
    state: TaskState;
}

class TaskEngine {
    private defs = new Map<string, TaskDef>();
    private progress = new Map<string, number>();
    private seenEvents = new Set<string>();
    private grants = new Map<string, number>(); // 发奖账本 grantKey → 已发币数
    private wallets = new Map<string, number>();

    register(def: TaskDef): void {
        this.defs.set(def.id, def);
    }

    /** 一条任务在一个周期内的唯一键：周期是状态的一部分，不是附属信息 */
    private key(userId: string, taskId: string, period: string): string {
        return `${userId}:${taskId}:${period}`;
    }

    getProgress(userId: string, taskId: string, period: string): number {
        return this.progress.get(this.key(userId, taskId, period)) ?? 0;
    }

    getState(userId: string, taskId: string, period: string): TaskState {
        const k = this.key(userId, taskId, period);
        if (this.grants.has(k)) return 'claimed';
        const def = this.defs.get(taskId);
        assert.ok(def, `未知任务 ${taskId}`);
        return (this.progress.get(k) ?? 0) >= def.target ? 'claimable' : 'in_progress';
    }

    getBalance(userId: string): number {
        return this.wallets.get(userId) ?? 0;
    }

    /** 上报进度：eventId 全局去重，进度向上封顶到 target */
    report(e: ReportEvent): ReportResult {
        const def = this.defs.get(e.taskId);
        assert.ok(def, `未知任务 ${e.taskId}`);
        assert.ok(e.amount > 0, '上报数量必须为正');

        const state = this.getState(e.userId, e.taskId, e.period);
        if (this.seenEvents.has(e.eventId)) {
            // 重试/网络重发：直接返回当前状态，绝不二次加进度
            return { accepted: false, duplicated: true, state, progress: this.getProgress(e.userId, e.taskId, e.period) };
        }
        this.seenEvents.add(e.eventId);

        if (state === 'claimed' || state === 'claimable') {
            // 任务已完成：进度封顶，多余上报丢弃但事件仍记录（用于审计）
            return { accepted: true, duplicated: false, state, progress: this.getProgress(e.userId, e.taskId, e.period) };
        }

        const k = this.key(e.userId, e.taskId, e.period);
        const next = Math.min(def.target, (this.progress.get(k) ?? 0) + e.amount);
        this.progress.set(k, next);
        return { accepted: true, duplicated: false, state: this.getState(e.userId, e.taskId, e.period), progress: next };
    }

    /** 领奖：账本先占位再发币，重复调用返回 0，天然幂等 */
    claim(userId: string, taskId: string, period: string): ClaimResult {
        const k = this.key(userId, taskId, period);
        const state = this.getState(userId, taskId, period);
        if (state !== 'claimable') {
            return { ok: false, duplicated: state === 'claimed', grantedCoins: 0, state };
        }
        const def = this.defs.get(taskId);
        assert.ok(def, `未知任务 ${taskId}`);
        if (this.grants.has(k)) {
            return { ok: false, duplicated: true, grantedCoins: 0, state: 'claimed' };
        }
        this.grants.set(k, def.rewardCoins);
        this.wallets.set(userId, this.getBalance(userId) + def.rewardCoins);
        return { ok: true, duplicated: false, grantedCoins: def.rewardCoins, state: 'claimed' };
    }
}

function runAssertions() {
    const engine = new TaskEngine();
    engine.register({ id: 'daily_checkin', target: 10, rewardCoins: 10 });
    engine.register({ id: 'share_once', target: 1, rewardCoins: 5 });

    // ---------- 测试 1：进度聚合与封顶 ----------
    engine.report({ eventId: 'e1', userId: 'u1', taskId: 'daily_checkin', amount: 3, period: 'day1' });
    engine.report({ eventId: 'e2', userId: 'u1', taskId: 'daily_checkin', amount: 4, period: 'day1' });
    engine.report({ eventId: 'e3', userId: 'u1', taskId: 'daily_checkin', amount: 5, period: 'day1' });
    assert.equal(engine.getProgress('u1', 'daily_checkin', 'day1'), 10, '12 应封顶到 target=10');
    assert.equal(engine.getState('u1', 'daily_checkin', 'day1'), 'claimable');
    assert.equal(engine.getBalance('u1'), 0, '达标但未领取时不能有钱');
    console.log('[1/4] 进度聚合与封顶 OK, progress=10, state=claimable');

    // ---------- 测试 2：重复领奖幂等 ----------
    const first = engine.claim('u1', 'daily_checkin', 'day1');
    assert.equal(first.grantedCoins, 10);
    assert.equal(engine.getBalance('u1'), 10);
    const retry = engine.claim('u1', 'daily_checkin', 'day1');
    assert.equal(retry.grantedCoins, 0, '重试领奖不得重复发币');
    assert.equal(retry.duplicated, true);
    assert.equal(engine.getBalance('u1'), 10, '余额只加一次');
    console.log('[2/4] 重复领奖幂等 OK, balance=10');

    // ---------- 测试 3：事件重放不重复加进度 ----------
    const replay = engine.report({ eventId: 'e1', userId: 'u1', taskId: 'daily_checkin', amount: 3, period: 'day1' });
    assert.equal(replay.duplicated, true);
    assert.equal(replay.progress, 10);
    const late = engine.report({ eventId: 'e4', userId: 'u1', taskId: 'daily_checkin', amount: 5, period: 'day1' });
    assert.equal(late.progress, 10, '已领奖后上报不再加进度');
    assert.equal(engine.getBalance('u1'), 10);
    console.log('[3/4] 事件重放不重复加进度 OK, duplicated=true');

    // ---------- 测试 4：跨周期重置，但历史事件仍全局去重 ----------
    const day2 = engine.report({ eventId: 'e5', userId: 'u1', taskId: 'daily_checkin', amount: 2, period: 'day2' });
    assert.equal(day2.progress, 2, '新周期进度从 0 重算');
    assert.equal(engine.getState('u1', 'daily_checkin', 'day2'), 'in_progress');
    const stale = engine.report({ eventId: 'e2', userId: 'u1', taskId: 'daily_checkin', amount: 4, period: 'day2' });
    assert.equal(stale.duplicated, true, '同 eventId 跨周期仍视为重放');
    assert.equal(engine.getProgress('u1', 'daily_checkin', 'day2'), 2);

    const single = engine.report({ eventId: 'e6', userId: 'u1', taskId: 'share_once', amount: 1, period: 'day2' });
    assert.equal(single.state, 'claimable');
    const shareClaim = engine.claim('u1', 'share_once', 'day2');
    assert.equal(shareClaim.grantedCoins, 5);
    assert.equal(engine.getBalance('u1'), 15);
    console.log('[4/4] 跨周期重置与事件全局去重 OK, balance=15');

    console.log('\n✅ 110-01 任务进度聚合与幂等发奖 全部断言通过');
}

runAssertions();

// 文件: examples/114-04-prefetch-scheduler.ts
// 路由级预取调度：优先级、并发上限、去重、失败重试降级与网络策略
// 目标：hover 先于 viewport 先于 idle、并发不超限、失败不阻塞队列且不无限重试

import assert from 'node:assert';

type Priority = 'hover' | 'viewport' | 'idle';
type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'skipped';

interface NetworkHint {
    saveData: boolean;
    effectiveType: 'slow-2g' | '2g' | '3g' | '4g';
}

/**
 * 预取开关：hover 是用户明确意图，任何网络都做；
 * Save-Data 或 2G 以下关掉 viewport/idle——省流量比「可能更快」更重要。
 */
function prefetchPolicy(hint: NetworkHint): Record<Priority, boolean> {
    const slow = hint.effectiveType === 'slow-2g' || hint.effectiveType === '2g';
    return {
        hover: true,
        viewport: !hint.saveData && !slow,
        idle: !hint.saveData && !slow,
    };
}

interface PrefetchJob {
    id: string;
    priority: Priority;
    loader: () => Promise<string>;
}

interface SchedulerOptions {
    maxConcurrent: number;
    maxAttempts: number;
    idleEnabled: boolean;
}

interface JobSnapshot {
    id: string;
    status: JobStatus;
    attempts: number;
}

const WEIGHT: Record<Priority, number> = { hover: 0, viewport: 1, idle: 2 };

class PrefetchScheduler {
    private queue: Array<{ job: PrefetchJob; seq: number }> = [];
    private seq = 0;
    private running = 0;
    private peakConcurrent = 0;
    private readonly states = new Map<string, JobSnapshot>();
    private readonly values = new Map<string, string>();
    private readonly waiters: Array<() => void> = [];
    readonly started: string[] = [];

    constructor(private readonly options: SchedulerOptions) {}

    /** 入队；已在队列/在飞/已完成则返回 false（重复 hover 不会打两次请求） */
    enqueue(job: PrefetchJob, allowed = true): boolean {
        const state = this.states.get(job.id);
        if (state !== undefined && state.status !== 'failed' && state.status !== 'skipped') return false;
        if (!allowed || (job.priority === 'idle' && !this.options.idleEnabled)) {
            this.states.set(job.id, { id: job.id, status: 'skipped', attempts: 0 });
            return false;
        }
        this.states.set(job.id, { id: job.id, status: 'queued', attempts: 0 });
        this.queue.push({ job, seq: this.seq++ });
        return true;
    }

    snapshot(id: string): JobSnapshot | undefined {
        return this.states.get(id);
    }

    value(id: string): string | undefined {
        return this.values.get(id);
    }

    get peak(): number {
        return this.peakConcurrent;
    }

    /** 启动并等待队列排空；空闲时立即 resolve */
    settle(): Promise<void> {
        this.pump();
        if (this.running === 0 && this.queue.length === 0) return Promise.resolve();
        return new Promise<void>((resolve) => this.waiters.push(resolve));
    }

    private pump(): void {
        while (this.running < this.options.maxConcurrent) {
            const job = this.pull();
            if (job === undefined) break;
            this.start(job);
        }
        if (this.running === 0 && this.queue.length === 0) {
            const pending = this.waiters.splice(0);
            for (const resolve of pending) resolve();
        }
    }

    private pull(): PrefetchJob | undefined {
        if (this.queue.length === 0) return undefined;
        let picked = 0;
        for (let i = 1; i < this.queue.length; i++) {
            const candidate = this.queue[i];
            const best = this.queue[picked];
            if (WEIGHT[candidate.job.priority] < WEIGHT[best.job.priority]) picked = i;
            else if (WEIGHT[candidate.job.priority] === WEIGHT[best.job.priority] && candidate.seq < best.seq) picked = i;
        }
        return this.queue.splice(picked, 1)[0].job;
    }

    private start(job: PrefetchJob): void {
        this.running += 1;
        this.peakConcurrent = Math.max(this.peakConcurrent, this.running);
        this.started.push(job.id);
        const state = this.states.get(job.id);
        assert.ok(state !== undefined, '队列中的任务必须有状态');
        state.status = 'running';
        state.attempts += 1;

        job.loader()
            .then((value) => {
                this.values.set(job.id, value);
                state.status = 'done';
            })
            .catch(() => {
                if (state.attempts < this.options.maxAttempts) {
                    state.status = 'queued';
                    this.queue.push({ job, seq: this.seq++ });
                } else {
                    state.status = 'failed'; // 降级：不再预取，等用户真正进入时由路由懒加载兜底
                }
            })
            .finally(() => {
                this.running -= 1;
                this.pump();
            });
    }
}

function deferred(): { promise: Promise<string>; resolve: (value: string) => void; reject: (error: Error) => void } {
    let resolve!: (value: string) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<string>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

async function runAssertions() {
    // ---------- 测试 1：优先级——hover > viewport > idle ----------
    const s1 = new PrefetchScheduler({ maxConcurrent: 2, maxAttempts: 2, idleEnabled: true });
    s1.enqueue({ id: 'idle-home', priority: 'idle', loader: async () => 'home' });
    s1.enqueue({ id: 'viewport-cart', priority: 'viewport', loader: async () => 'cart' });
    s1.enqueue({ id: 'hover-pdp', priority: 'hover', loader: async () => 'pdp' });
    await s1.settle();
    assert.deepEqual(s1.started, ['hover-pdp', 'viewport-cart', 'idle-home']);
    assert.deepEqual(
        ['hover-pdp', 'viewport-cart', 'idle-home'].map((id) => s1.snapshot(id)?.status),
        ['done', 'done', 'done'],
    );
    assert.equal(s1.value('hover-pdp'), 'pdp');
    console.log('[1/4] 优先级调度 OK:', s1.started.join(' → '));

    // ---------- 测试 2：并发上限与去重 ----------
    const s2 = new PrefetchScheduler({ maxConcurrent: 2, maxAttempts: 2, idleEnabled: true });
    const a = deferred();
    const b = deferred();
    const c = deferred();
    assert.equal(s2.enqueue({ id: 'a', priority: 'hover', loader: () => a.promise }), true);
    assert.equal(s2.enqueue({ id: 'a', priority: 'hover', loader: () => a.promise }), false, '同 id 在飞时应去重');
    s2.enqueue({ id: 'b', priority: 'viewport', loader: () => b.promise });
    s2.enqueue({ id: 'c', priority: 'viewport', loader: () => c.promise });
    const settled = s2.settle();
    assert.deepEqual(s2.started, ['a', 'b'], '并发 2 时第三个任务必须等待');
    assert.equal(s2.peak, 2);
    a.resolve('a');
    await tick();
    assert.deepEqual(s2.started, ['a', 'b', 'c']);
    b.resolve('b');
    c.resolve('c');
    await settled;
    assert.equal(s2.peak, 2, '峰值并发不得超过上限');
    assert.equal(s2.started.filter((id) => id === 'a').length, 1);
    assert.equal(s2.value('c'), 'c');
    console.log('[2/4] 并发与去重 OK, 峰值:', s2.peak);

    // ---------- 测试 3：失败重试后降级，队列继续 ----------
    const s3 = new PrefetchScheduler({ maxConcurrent: 3, maxAttempts: 2, idleEnabled: true });
    let flakyAttempts = 0;
    s3.enqueue({
        id: 'flaky',
        priority: 'hover',
        loader: async () => {
            flakyAttempts += 1;
            if (flakyAttempts === 1) throw new Error('网络抖动');
            return 'ok';
        },
    });
    s3.enqueue({
        id: 'broken',
        priority: 'hover',
        loader: async () => {
            throw new Error('404');
        },
    });
    s3.enqueue({ id: 'after', priority: 'viewport', loader: async () => 'after' });
    await s3.settle();
    assert.equal(s3.snapshot('flaky')?.status, 'done');
    assert.equal(s3.snapshot('flaky')?.attempts, 2, '抖动一次后重试成功');
    assert.equal(s3.snapshot('broken')?.status, 'failed');
    assert.equal(s3.snapshot('broken')?.attempts, 2, '失败达到上限后必须停手');
    assert.equal(s3.snapshot('after')?.status, 'done', '失败任务不得阻塞队列');
    assert.equal(s3.started.filter((id) => id === 'broken').length, 2);
    console.log('[3/4] 失败降级 OK, broken 尝试:', s3.snapshot('broken')?.attempts);

    // ---------- 测试 4：网络与省流策略 ----------
    assert.deepEqual(prefetchPolicy({ saveData: false, effectiveType: '4g' }), { hover: true, viewport: true, idle: true });
    assert.deepEqual(prefetchPolicy({ saveData: true, effectiveType: '4g' }), { hover: true, viewport: false, idle: false }, 'Save-Data 只保留 hover');
    assert.deepEqual(prefetchPolicy({ saveData: false, effectiveType: '2g' }), { hover: true, viewport: false, idle: false }, '2G 下不做非交互预取');

    const policy = prefetchPolicy({ saveData: true, effectiveType: '4g' });
    const s4 = new PrefetchScheduler({ maxConcurrent: 2, maxAttempts: 2, idleEnabled: false });
    assert.equal(s4.enqueue({ id: 'idle-1', priority: 'idle', loader: async () => 'idle' }), false);
    assert.equal(s4.snapshot('idle-1')?.status, 'skipped');
    assert.equal(s4.enqueue({ id: 'vp-1', priority: 'viewport', loader: async () => 'vp' }, policy.viewport), false);
    assert.equal(s4.snapshot('vp-1')?.status, 'skipped');
    assert.equal(s4.enqueue({ id: 'hover-1', priority: 'hover', loader: async () => 'hover' }, policy.hover), true);
    await s4.settle();
    assert.equal(s4.snapshot('hover-1')?.status, 'done');
    console.log('[4/4] 网络策略 OK, hover 仍预取');

    console.log('\n✅ 114-04 预取调度 全部断言通过');
}

runAssertions();

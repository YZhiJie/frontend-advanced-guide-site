// 文件: examples/116-03-offline-queue.ts
// 离线队列：断网入队 + 恢复后严格保序发送 + 瞬时/永久失败分级 + 重试上限与死信
// 目标：离线不发请求、同 ID 不重复入队、队头未成功前绝不越过、永久错误不重试、超过重试上限进死信

import assert from 'node:assert';

type FailureKind = 'transient' | 'permanent';

interface SendOutcome {
    readonly ok: boolean;
    readonly kind?: FailureKind; // 仅失败时有值
}

interface QueueItem {
    readonly id: string;
    readonly text: string;
    attempts: number;
    nextRetryAtMs: number;
}

/** 离线发件箱：用最小模型模拟「网络恢复后按序补发」的完整生命周期 */
class OfflineOutbox {
    private online = true;
    private queue: QueueItem[] = [];
    private sentIds: string[] = [];
    private failedIds: string[] = [];
    private deadIds: string[] = [];

    constructor(
        private readonly transport: (item: QueueItem) => SendOutcome,
        private readonly maxAttempts = 3,
        private readonly retryDelayMs = 1000,
    ) {}

    /** 入队幂等：同一条消息（同 id）只能存在一份，重试不得叠加 */
    enqueue(id: string, text: string): boolean {
        const known =
            this.queue.some((item) => item.id === id) ||
            this.sentIds.includes(id) ||
            this.failedIds.includes(id) ||
            this.deadIds.includes(id);
        if (known) return false;
        this.queue.push({ id, text, attempts: 0, nextRetryAtMs: 0 });
        return true;
    }

    setOnline(online: boolean): void {
        this.online = online;
    }

    /** 按 FIFO 消费；返回本轮真正打到传输层的次数，便于断言节流 */
    flush(nowMs: number): number {
        if (!this.online) return 0;
        let calls = 0;
        while (this.queue.length > 0) {
            const head = this.queue[0];
            if (head.nextRetryAtMs > nowMs) break;
            this.queue.shift();
            calls += 1;

            const outcome = this.transport(head);
            if (outcome.ok) {
                this.sentIds.push(head.id);
                continue;
            }
            if (outcome.kind === 'permanent') {
                // 4xx/权限/参数错误：重试不会变好，直接失败
                this.failedIds.push(head.id);
                continue;
            }

            head.attempts += 1;
            if (head.attempts >= this.maxAttempts) {
                this.deadIds.push(head.id);
                continue;
            }
            head.nextRetryAtMs = nowMs + this.retryDelayMs * head.attempts;
            this.queue.unshift(head);
            break; // 保序：队头没成功，后面的消息绝不先发
        }
        return calls;
    }

    get pendingCount(): number {
        return this.queue.length;
    }

    get sent(): string[] {
        return [...this.sentIds];
    }

    get failed(): string[] {
        return [...this.failedIds];
    }

    get dead(): string[] {
        return [...this.deadIds];
    }
}

function runAssertions() {
    // ---------- 测试 1：离线只入队、不发请求 ----------
    const calls: string[] = [];
    const q1 = new OfflineOutbox((item) => {
        calls.push(item.id);
        return { ok: true };
    });
    q1.setOnline(false);
    assert.ok(q1.enqueue('m1', '第一条'));
    assert.ok(q1.enqueue('m2', '第二条'));
    assert.equal(q1.enqueue('m1', '第一条'), false, '同一 ID 不得重复入队');
    assert.equal(q1.flush(0), 0, '离线时不得发起发送');
    assert.equal(calls.length, 0);
    assert.equal(q1.pendingCount, 2);
    console.log('[1/4] 离线入队 OK, 待发:', q1.pendingCount);

    // ---------- 测试 2：恢复在线后严格按入队顺序发送 ----------
    q1.setOnline(true);
    assert.equal(q1.flush(0), 2);
    assert.deepEqual(calls, ['m1', 'm2'], '恢复后必须按入队顺序补发');
    assert.deepEqual(q1.sent, ['m1', 'm2']);
    assert.equal(q1.pendingCount, 0);
    console.log('[2/4] 恢复后保序发送 OK:', calls.join(' → '));

    // ---------- 测试 3：瞬时失败退避，队头不成功不越过 ----------
    const script3: SendOutcome[] = [
        { ok: false, kind: 'transient' },
        { ok: true },
        { ok: true },
    ];
    let cursor3 = 0;
    let transport3Calls = 0;
    const q3 = new OfflineOutbox(() => {
        transport3Calls += 1;
        return script3[cursor3++];
    }, 3, 1000);
    q3.enqueue('m1', '第一条');
    q3.enqueue('m2', '第二条');
    assert.equal(q3.flush(0), 1, 'm1 失败后应立即停止');
    assert.equal(q3.pendingCount, 2, '两条都还在队列里');
    assert.equal(q3.flush(500), 0, '未到重试时间不得发送');
    assert.equal(transport3Calls, 1, '冷却期内不得重复打传输层');
    assert.equal(q3.flush(1000), 2, 'm1 成功后才轮到 m2');
    assert.deepEqual(q3.sent, ['m1', 'm2']);
    assert.equal(q3.pendingCount, 0);
    console.log('[3/4] 瞬时失败退避 OK, 重试时间点:', 1000);

    // ---------- 测试 4：永久失败直落 + 超过上限进死信 ----------
    const script4: SendOutcome[] = [
        { ok: false, kind: 'permanent' }, // a
        { ok: false, kind: 'transient' }, // b 第 1 次
        { ok: false, kind: 'transient' }, // b 第 2 次
        { ok: false, kind: 'transient' }, // b 第 3 次 → 死信
        { ok: true }, // c
    ];
    let cursor4 = 0;
    const q4 = new OfflineOutbox(() => script4[cursor4++], 3, 1000);
    q4.enqueue('a', '权限不足');
    q4.enqueue('b', '一直超时');
    q4.enqueue('c', '正常');
    assert.equal(q4.flush(0), 2, 'a 永久失败后继续，b 瞬时失败后停');
    assert.equal(q4.flush(1000), 1);
    assert.equal(q4.flush(3000), 2, 'b 第三次失败进死信后继续发 c');
    assert.deepEqual(q4.failed, ['a'], '永久失败只尝试一次');
    assert.deepEqual(q4.dead, ['b'], '瞬时失败达到上限进死信');
    assert.deepEqual(q4.sent, ['c']);
    assert.equal(q4.pendingCount, 0);
    console.log('[4/4] 失败分级与死信 OK, failed:', q4.failed.join(','), '| dead:', q4.dead.join(','));

    console.log('\n✅ 116-03 离线队列 全部断言通过');
}

runAssertions();

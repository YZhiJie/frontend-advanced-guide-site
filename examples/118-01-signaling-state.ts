// 文件: examples/118-01-signaling-state.ts
// 信令状态机：idle → calling → connected / failed，非法迁移拒绝 + 应答超时兜底
// 目标：超时后迟到的 answer 不得复活会话、旧定时器不误伤新会话、迁移轨迹可断言

import assert from 'node:assert';

type CallState = 'idle' | 'calling' | 'connected' | 'failed';
type CallEvent = 'dial' | 'answer' | 'remoteHangup' | 'iceFailed' | 'timeout' | 'reset';

/** 合法迁移表：当前状态 + 事件 → 目标状态；不在表内一律拒绝 */
const TRANSITIONS: Record<CallState, Partial<Record<CallEvent, CallState>>> = {
    idle: { dial: 'calling' },
    calling: { answer: 'connected', iceFailed: 'failed', timeout: 'failed', remoteHangup: 'idle' },
    connected: { remoteHangup: 'idle', iceFailed: 'failed' },
    failed: { reset: 'idle' },
};

/**
 * 一通呼叫的信令状态机。
 * generation 用来标记会话代号：超时回调、重连回调都必须带上发起时的代号，
 * 否则旧会话的定时器会在新会话里误触发。
 */
class CallSession {
    private _state: CallState = 'idle';
    private dialedAt: number | null = null;
    private generation = 0;
    readonly log: string[] = [];

    constructor(private readonly answerTimeoutMs: number = 8000) {}

    get state(): CallState {
        return this._state;
    }

    get sessionGeneration(): number {
        return this.generation;
    }

    transition(event: CallEvent, nowMs: number): boolean {
        const next = TRANSITIONS[this._state][event];
        if (next === undefined) {
            this.log.push(`reject ${this._state}+${event}`);
            return false;
        }
        this.log.push(`${this._state} --${event}--> ${next}`);
        this._state = next;
        if (event === 'dial') {
            this.dialedAt = nowMs;
            this.generation += 1;
        } else if (event === 'reset') {
            this.dialedAt = null;
            this.generation += 1;
        } else if (next === 'idle' || next === 'failed') {
            this.dialedAt = null;
        }
        return true;
    }

    /** 定时器到点；generation 不匹配说明是已作废会话的回调，必须忽略 */
    tick(nowMs: number, generation: number): void {
        if (generation !== this.generation) {
            this.log.push('ignore stale timer');
            return;
        }
        if (this._state !== 'calling' || this.dialedAt === null) return;
        if (nowMs - this.dialedAt >= this.answerTimeoutMs) {
            this.transition('timeout', nowMs);
        }
    }
}

function runAssertions() {
    // ---------- 测试 1：主流程与重复指令 ----------
    const s1 = new CallSession(8000);
    assert.equal(s1.state, 'idle');
    assert.equal(s1.transition('answer', 0), false, 'idle 收到 answer 必须拒绝');
    assert.equal(s1.transition('dial', 0), true);
    assert.equal(s1.state, 'calling');
    assert.equal(s1.transition('dial', 50), false, 'calling 中重复 dial 必须拒绝');
    assert.equal(s1.transition('answer', 1200), true);
    assert.equal(s1.state, 'connected');
    assert.equal(s1.transition('answer', 1300), false, 'connected 中重复 answer 必须拒绝');
    console.log('[1/4] 主流程 OK:', s1.log.join(' | '));

    // ---------- 测试 2：应答超时兜底，迟到的 answer 不得复活 ----------
    const s2 = new CallSession(8000);
    s2.transition('dial', 100);
    const gen2 = s2.sessionGeneration;
    s2.tick(5000, gen2);
    assert.equal(s2.state, 'calling', '5s 未到超时线应保持 calling');
    s2.tick(8100, gen2);
    assert.equal(s2.state, 'failed', '超过 8s 必须转入 failed');
    assert.equal(s2.transition('answer', 8200), false, '超时后迟到的 answer 必须拒绝');
    assert.equal(s2.transition('timeout', 8300), false, '重复超时事件必须拒绝');
    assert.ok(s2.log.some((line) => line.includes('calling --timeout--> failed')));
    console.log('[2/4] 应答超时兜底 OK, 最终:', s2.state);

    // ---------- 测试 3：旧定时器不误伤新会话，ICE 失败可 reset 重试 ----------
    const s3 = new CallSession(8000);
    s3.transition('dial', 0);
    const oldGen = s3.sessionGeneration;
    assert.equal(s3.transition('remoteHangup', 400), true);
    assert.equal(s3.state, 'idle');
    assert.equal(s3.transition('dial', 500), true, '挂断后必须能重新拨号');
    const newGen = s3.sessionGeneration;
    s3.tick(2000, oldGen); // 旧会话遗留的 setTimeout 此时到点
    assert.equal(s3.state, 'calling', '旧定时器不得终结新会话');
    assert.ok(s3.log.some((line) => line.includes('ignore stale timer')));
    s3.tick(3000, newGen);
    assert.equal(s3.state, 'calling');
    assert.equal(s3.transition('answer', 3100), true);
    assert.equal(s3.transition('iceFailed', 3200), true);
    assert.equal(s3.state, 'failed');
    assert.equal(s3.transition('reset', 3300), true);
    assert.equal(s3.state, 'idle');
    console.log('[3/4] 旧定时器隔离 OK, generation:', s3.sessionGeneration);

    // ---------- 测试 4：非法迁移矩阵——拒绝后状态不得改变 ----------
    const idle = new CallSession(8000);
    const idleBefore = idle.state;
    for (const ev of ['answer', 'iceFailed', 'timeout', 'reset', 'remoteHangup'] as CallEvent[]) {
        assert.equal(idle.transition(ev, 0), false, `idle 不应接受 ${ev}`);
    }
    assert.equal(idle.state, idleBefore);

    const calling = new CallSession(8000);
    calling.transition('dial', 0);
    assert.equal(calling.transition('reset', 10), false, 'calling 只能靠 timeout/iceFailed 失败');
    assert.equal(calling.state, 'calling');

    const connected = new CallSession(8000);
    connected.transition('dial', 0);
    connected.transition('answer', 100);
    assert.equal(connected.transition('dial', 200), false);
    assert.equal(connected.transition('timeout', 300), false, 'connected 不受应答超时影响');
    assert.equal(connected.state, 'connected');

    const failed = new CallSession(8000);
    failed.transition('dial', 0);
    failed.tick(9000, failed.sessionGeneration);
    assert.equal(failed.state, 'failed');
    for (const ev of ['dial', 'answer', 'iceFailed', 'timeout', 'remoteHangup'] as CallEvent[]) {
        assert.equal(failed.transition(ev, 9100), false, `failed 不应接受 ${ev}`);
    }
    assert.equal(failed.transition('reset', 9200), true, 'failed 只允许 reset');
    console.log('[4/4] 非法迁移矩阵 OK, rejected 计数:', idle.log.length + failed.log.filter((l) => l.startsWith('reject')).length);

    console.log('\n✅ 118-01 信令状态机 全部断言通过');
}

runAssertions();

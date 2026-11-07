// 文件: examples/122-01-message-state-machine.ts
// 消息五态状态机：received → streaming → done / error / aborted 全量守卫
// 目标：非法迁移全部被拒；客户端 msgId 幂等去重；abort 后迟到帧被丢弃；retry 派生新消息而不复用旧流

import assert from 'node:assert';

/** 消息生命周期五态：received(已受理) → streaming(生成中) → done | error | aborted */
type MsgStatus = 'received' | 'streaming' | 'done' | 'error' | 'aborted';

/** 合法迁移表是唯一事实源：三个终态没有任何出边，只能经 retry 派生新消息 */
const TRANSITIONS: Record<MsgStatus, readonly MsgStatus[]> = {
    received: ['streaming', 'error', 'aborted'],
    streaming: ['done', 'error', 'aborted'],
    done: [],
    error: [],
    aborted: [],
};

interface ChatMessage {
    /** 客户端生成的幂等键：发送、双击重发、断线重发、队列重放都靠它去重 */
    msgId: string;
    role: 'user' | 'assistant';
    status: MsgStatus;
    content: string;
    /** 已消费的 delta 序号，乱序/跳号直接拒绝 */
    lastSeq: number;
    errorCode?: string;
    /** retry 派生的新消息指向它的来源，供 UI 折叠与审计 */
    retryOf?: string;
}

class MessageStore {
    private readonly byId = new Map<string, ChatMessage>();
    /** 会话内消息的展示顺序，与 byId 分离以便重排 */
    readonly order: string[] = [];

    /** 发送即落库；同一 msgId 重复提交返回已存在的消息，绝不产生第二条 */
    send(msgId: string, role: 'user' | 'assistant', content = ''): ChatMessage {
        const existing = this.byId.get(msgId);
        if (existing !== undefined) return existing;
        const msg: ChatMessage = { msgId, role, status: 'received', content, lastSeq: 0 };
        this.byId.set(msgId, msg);
        this.order.push(msgId);
        return msg;
    }

    private mustGet(msgId: string): ChatMessage {
        const msg = this.byId.get(msgId);
        if (msg === undefined) throw new Error(`E_MSG_NOT_FOUND: ${msgId}`);
        return msg;
    }

    /** 所有状态变更的唯一入口；业务代码不允许直接赋值 msg.status */
    private transit(msg: ChatMessage, next: MsgStatus): void {
        const allowed = TRANSITIONS[msg.status];
        if (!allowed.includes(next)) {
            throw new Error(`E_ILLEGAL_TRANSITION: ${msg.status} -> ${next}`);
        }
        msg.status = next;
    }

    /** 首帧到达：received → streaming */
    beginStream(msgId: string): void {
        this.transit(this.mustGet(msgId), 'streaming');
    }

    /**
     * 追加增量。
     * 终态上的迟到帧静默丢弃（abort/fail 后服务端仍可能推送残余帧）；
     * 非 streaming 收到 delta 说明时序错乱，直接报错；序号必须严格 +1。
     */
    appendDelta(msgId: string, seq: number, delta: string): void {
        const msg = this.mustGet(msgId);
        if (msg.status === 'done' || msg.status === 'error' || msg.status === 'aborted') return;
        if (msg.status !== 'streaming') throw new Error(`E_NOT_STREAMING: ${msg.status}`);
        if (seq !== msg.lastSeq + 1) {
            throw new Error(`E_SEQ_GAP: expect ${msg.lastSeq + 1}, got ${seq}`);
        }
        msg.lastSeq = seq;
        msg.content += delta;
    }

    /** 正常收束：streaming → done */
    finish(msgId: string): void {
        this.transit(this.mustGet(msgId), 'done');
    }

    /** 失败收束：received/streaming → error，并记录可展示、可上报的错误码 */
    fail(msgId: string, code: string): void {
        const msg = this.mustGet(msgId);
        this.transit(msg, 'error');
        msg.errorCode = code;
    }

    /** 停止生成：received/streaming → aborted；对 aborted 重复调用是幂等空操作 */
    abort(msgId: string): void {
        const msg = this.mustGet(msgId);
        if (msg.status === 'aborted') return;
        this.transit(msg, 'aborted');
    }

    /**
     * 重新生成：只允许 error/aborted 作为来源；
     * 产出一条全新 msgId 的消息并记录 retryOf，绝不把旧流"续上"。
     */
    retry(msgId: string, newMsgId: string): ChatMessage {
        const old = this.mustGet(msgId);
        if (old.status !== 'error' && old.status !== 'aborted') {
            throw new Error(`E_NOT_RETRYABLE: ${old.status}`);
        }
        const fresh = this.send(newMsgId, old.role);
        fresh.retryOf = old.msgId;
        return fresh;
    }

    get(msgId: string): ChatMessage {
        return this.mustGet(msgId);
    }

    count(): number {
        return this.byId.size;
    }
}

function runAssertions(): void {
    // ---------- 测试 1：正常链路——发送幂等，五态走通，delta 按序拼接 ----------
    const store = new MessageStore();
    const user1 = store.send('u-1', 'user', '帮我总结这份财报');
    const user1Again = store.send('u-1', 'user', '帮我总结这份财报');
    assert.equal(user1Again, user1, '同一 msgId 重发必须返回同一条消息');
    assert.equal(store.count(), 1, '幂等去重后库里仍只有 1 条');
    assert.equal(store.order.length, 1, '展示顺序里也不能出现第二条');

    const ai1 = store.send('a-1', 'assistant');
    assert.equal(ai1.status, 'received');
    store.beginStream('a-1');
    store.appendDelta('a-1', 1, '营收 ');
    store.appendDelta('a-1', 2, '同比 ');
    store.appendDelta('a-1', 3, '+12%');
    store.finish('a-1');
    assert.equal(store.get('a-1').status, 'done');
    assert.equal(store.get('a-1').content, '营收 同比 +12%');
    assert.equal(store.get('a-1').lastSeq, 3);
    console.log('[1/4] 正常链路 OK, msgId 幂等 + 五态走通');

    // ---------- 测试 2：非法迁移——全部抛出业务错误码，状态机守住全部出边 ----------
    assert.throws(() => store.finish('u-1'), /E_ILLEGAL_TRANSITION/, 'received 不能直达 done');
    assert.throws(() => store.appendDelta('u-1', 1, 'x'), /E_NOT_STREAMING/, '未 streaming 拒收 delta');
    assert.throws(() => store.beginStream('a-1'), /E_ILLEGAL_TRANSITION/, 'done 是终态不能再开流');
    assert.throws(() => store.abort('a-1'), /E_ILLEGAL_TRANSITION/, 'done 不能 abort');
    assert.throws(() => store.get('ghost'), /E_MSG_NOT_FOUND/);

    const store2 = new MessageStore();
    store2.send('b-1', 'assistant');
    store2.beginStream('b-1');
    store2.appendDelta('b-1', 1, '第一帧');
    assert.throws(() => store2.appendDelta('b-1', 3, '跳号帧'), /E_SEQ_GAP/, '序号跳号必须拒绝');
    assert.equal(store2.get('b-1').content, '第一帧', '被拒帧不得污染内容');
    console.log('[2/4] 非法迁移 OK, 全部越界调用被拦截');

    // ---------- 测试 3：abort 语义——终态、幂等、迟到帧丢弃 ----------
    store2.appendDelta('b-1', 2, '第二帧');
    store2.abort('b-1');
    assert.equal(store2.get('b-1').status, 'aborted');
    store2.abort('b-1'); // 用户狂点"停止"：重复 abort 是幂等空操作
    assert.equal(store2.get('b-1').status, 'aborted');

    // abort 后服务端推送的残余帧静默丢弃，内容与序号都不变
    store2.appendDelta('b-1', 3, '迟到帧');
    assert.equal(store2.get('b-1').content, '第一帧第二帧');
    assert.equal(store2.get('b-1').lastSeq, 2);
    assert.throws(() => store2.finish('b-1'), /E_ILLEGAL_TRANSITION/, 'aborted 不能再 finish');
    console.log('[3/4] abort 语义 OK, 残余帧被丢弃');

    // ---------- 测试 4：error 与 retry——新 msgId、retryOf 溯源、来源状态校验 ----------
    const store3 = new MessageStore();
    store3.send('c-1', 'assistant');
    store3.beginStream('c-1');
    store3.appendDelta('c-1', 1, '半截答案');
    store3.fail('c-1', 'E_UPSTREAM_TIMEOUT');
    assert.equal(store3.get('c-1').status, 'error');
    assert.equal(store3.get('c-1').errorCode, 'E_UPSTREAM_TIMEOUT');
    assert.equal(store3.get('c-1').content, '半截答案', '失败时保留已生成内容供用户决定去留');

    const retried = store3.retry('c-1', 'c-2');
    assert.equal(retried.status, 'received');
    assert.equal(retried.retryOf, 'c-1', 'retry 必须可溯源');
    assert.equal(retried.content, '', 'retry 不复用旧流内容');
    assert.equal(store3.count(), 2, 'retry 是新消息而不是原地复活');

    // received 态也可 abort（提交后立刻反悔），abort 后同样允许 retry
    store3.send('c-3', 'assistant');
    store3.abort('c-3');
    assert.equal(store3.get('c-3').status, 'aborted');
    assert.equal(store3.retry('c-3', 'c-4').retryOf, 'c-3');

    // done 不允许走错误路径重试：要"再来一版"应显式开新轮次
    store3.send('c-5', 'assistant');
    store3.beginStream('c-5');
    store3.finish('c-5');
    assert.throws(() => store3.retry('c-5', 'c-6'), /E_NOT_RETRYABLE/, 'done 不是可重试来源');
    console.log('[4/4] error/retry OK, retryOf 溯源 + 来源状态校验');

    console.log('\n✅ 122-01 消息状态机 全部断言通过');
}

runAssertions();

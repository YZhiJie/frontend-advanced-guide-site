// 文件: examples/116-02-message-order-dedup.ts
// 消息时序与去重：服务端 seq 排序 + serverId/clientMsgId 幂等 + 乱序到达与空洞补齐
// 目标：重复投递不产生第二条、乱序到达按 seq 重排、空洞能被发现并给出补拉游标、本地回显被服务端消息原位替换

import assert from 'node:assert';

interface ServerMessage {
    readonly serverId: string;
    readonly clientMsgId: string;
    readonly seq: number; // 会话内单调递增，服务端分配
    readonly text: string;
    readonly sentAtMs: number; // 仅用于展示，绝不用于排序
}

interface TimelineItem {
    seq: number | null; // null 表示本地乐观消息，等待服务端确认
    serverId: string | null;
    readonly clientMsgId: string;
    readonly text: string;
    readonly sentAtMs: number;
}

interface ApplyResult {
    readonly appended: number;
    readonly duplicates: number;
    readonly gaps: Array<{ from: number; to: number }>;
}

/** 单个会话的时间线：排序只看 seq，去重看 serverId 与 clientMsgId */
class ConversationTimeline {
    lastSeq = 0;
    private items: TimelineItem[] = [];
    private seenServerIds = new Set<string>();
    private byClientId = new Map<string, TimelineItem>();

    constructor(readonly conversationId: string) {}

    /** 本地发送：同一 clientMsgId 的重试不产生第二条，保证幂等 */
    send(text: string, clientMsgId: string, nowMs: number): boolean {
        if (this.byClientId.has(clientMsgId)) return false;
        const item: TimelineItem = {
            seq: null,
            serverId: null,
            clientMsgId,
            text,
            sentAtMs: nowMs,
        };
        this.items.push(item);
        this.byClientId.set(clientMsgId, item);
        return true;
    }

    /** 服务端消息落地：去重 → 空洞检测 → 插入排序 → 更新游标 */
    applyServer(msg: ServerMessage): ApplyResult {
        if (this.seenServerIds.has(msg.serverId)) {
            return { appended: 0, duplicates: 1, gaps: [] };
        }
        const local = this.byClientId.get(msg.clientMsgId);
        if (local !== undefined && local.seq !== null) {
            // 同一 clientMsgId 已确认过：服务端重发或另一个设备的回执
            return { appended: 0, duplicates: 1, gaps: [] };
        }

        const gaps: Array<{ from: number; to: number }> = [];
        if (msg.seq > this.lastSeq + 1) {
            gaps.push({ from: this.lastSeq + 1, to: msg.seq - 1 });
        }

        if (local !== undefined) {
            // 本地乐观消息就地升级，位置不跳、不闪烁
            local.seq = msg.seq;
            local.serverId = msg.serverId;
        } else {
            const item: TimelineItem = {
                seq: msg.seq,
                serverId: msg.serverId,
                clientMsgId: msg.clientMsgId,
                text: msg.text,
                sentAtMs: msg.sentAtMs,
            };
            this.items.push(item);
            this.byClientId.set(msg.clientMsgId, item);
        }

        this.seenServerIds.add(msg.serverId);
        this.lastSeq = Math.max(this.lastSeq, msg.seq);
        this.sortBySeq();
        return { appended: 1, duplicates: 0, gaps };
    }

    /** 空洞区间：1..lastSeq 中尚未收到的 seq，用于触发增量补拉 */
    missingRanges(): Array<{ from: number; to: number }> {
        const present = new Set<number>();
        for (const item of this.items) {
            if (item.seq !== null) present.add(item.seq);
        }
        const ranges: Array<{ from: number; to: number }> = [];
        let start: number | null = null;
        for (let seq = 1; seq <= this.lastSeq; seq++) {
            if (!present.has(seq)) {
                if (start === null) start = seq;
            } else if (start !== null) {
                ranges.push({ from: start, to: seq - 1 });
                start = null;
            }
        }
        if (start !== null) ranges.push({ from: start, to: this.lastSeq });
        return ranges;
    }

    /** 补拉游标：最早的空洞位置，没有空洞则为 null */
    get syncFrom(): number | null {
        const ranges = this.missingRanges();
        return ranges.length > 0 ? ranges[0].from : null;
    }

    get pending(): number {
        return this.items.filter((item) => item.seq === null).length;
    }

    get messages(): TimelineItem[] {
        return [...this.items];
    }

    private sortBySeq(): void {
        this.items.sort((a, b) => {
            const left = a.seq ?? Number.MAX_SAFE_INTEGER; // 未确认消息永远排末尾
            const right = b.seq ?? Number.MAX_SAFE_INTEGER;
            return left - right;
        });
    }
}

function runAssertions() {
    // ---------- 测试 1：重复投递只落一条 ----------
    const t1 = new ConversationTimeline('conv-1');
    const m1: ServerMessage = { serverId: 's1', clientMsgId: 'c1', seq: 1, text: '你好', sentAtMs: 100 };
    assert.deepEqual(t1.applyServer(m1), { appended: 1, duplicates: 0, gaps: [] });
    assert.deepEqual(t1.applyServer(m1), { appended: 0, duplicates: 1, gaps: [] });
    assert.equal(t1.messages.length, 1, '重复投递不得新增气泡');
    assert.equal(t1.lastSeq, 1);
    console.log('[1/4] 重复投递去重 OK, 消息数:', t1.messages.length);

    // ---------- 测试 2：乱序到达按 seq 重排 ----------
    const t2 = new ConversationTimeline('conv-2');
    const third = t2.applyServer({ serverId: 's3', clientMsgId: 'c3', seq: 3, text: '第三句', sentAtMs: 300 });
    assert.deepEqual(third.gaps, [{ from: 1, to: 2 }], '先到 3 应发现 1、2 空洞');
    t2.applyServer({ serverId: 's1', clientMsgId: 'c1', seq: 1, text: '第一句', sentAtMs: 100 });
    t2.applyServer({ serverId: 's2', clientMsgId: 'c2', seq: 2, text: '第二句', sentAtMs: 200 });
    assert.deepEqual(
        t2.messages.map((m) => m.text),
        ['第一句', '第二句', '第三句'],
        '时间戳再乱也必须按 seq 排序',
    );
    assert.deepEqual(t2.missingRanges(), []);
    assert.equal(t2.lastSeq, 3);
    console.log('[2/4] 乱序重排 OK, 顺序:', t2.messages.map((m) => m.text).join(' / '));

    // ---------- 测试 3：空洞检测给出补拉游标 ----------
    const t3 = new ConversationTimeline('conv-3');
    t3.applyServer({ serverId: 's1', clientMsgId: 'c1', seq: 1, text: 'A', sentAtMs: 100 });
    const jump = t3.applyServer({ serverId: 's4', clientMsgId: 'c4', seq: 4, text: 'D', sentAtMs: 400 });
    assert.deepEqual(jump.gaps, [{ from: 2, to: 3 }]);
    assert.equal(t3.syncFrom, 2, '应从 2 开始增量补拉');
    assert.deepEqual(t3.missingRanges(), [{ from: 2, to: 3 }]);
    t3.applyServer({ serverId: 's2', clientMsgId: 'c2', seq: 2, text: 'B', sentAtMs: 200 });
    t3.applyServer({ serverId: 's3', clientMsgId: 'c3', seq: 3, text: 'C', sentAtMs: 300 });
    assert.equal(t3.syncFrom, null, '补拉完成后空洞关闭');
    console.log('[3/4] 空洞检测与补拉 OK, 游标曾为:', jump.gaps[0].from);

    // ---------- 测试 4：本地回显原位替换 + clientMsgId 幂等 ----------
    const t4 = new ConversationTimeline('conv-4');
    assert.ok(t4.send('在吗', 'client-1', 0));
    assert.equal(t4.send('在吗', 'client-1', 10), false, '重发沿用同一 msgId，不得新增');
    assert.equal(t4.pending, 1);
    const ack = t4.applyServer({
        serverId: 's9',
        clientMsgId: 'client-1',
        seq: 1,
        text: '在吗',
        sentAtMs: 20,
    });
    assert.equal(ack.appended, 1);
    assert.equal(t4.messages.length, 1, '服务端确认后仍只有一条气泡');
    assert.equal(t4.pending, 0);
    assert.equal(t4.messages[0].serverId, 's9');
    assert.equal(t4.messages[0].seq, 1);
    console.log('[4/4] 本地回显替换 OK, 待确认:', t4.pending);

    console.log('\n✅ 116-02 消息时序与去重 全部断言通过');
}

runAssertions();

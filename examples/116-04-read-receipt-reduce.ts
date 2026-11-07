// 文件: examples/116-04-read-receipt-reduce.ts
// 多端已读归约：游标合并 + 幂等回执 + 未读数计算
// 目标：多设备取最大游标、迟到/重复回执不回退未读、回执重放不重复生效、未读数不为负且会话间互不影响

import assert from 'node:assert';

interface ReadReceipt {
    readonly receiptId: string; // 客户端/服务端生成的幂等键
    readonly conversationId: string;
    readonly deviceId: string;
    readonly readSeq: number; // 该设备确认读到的最大 seq
}

interface ReadResult {
    readonly changed: boolean;
    readonly duplicated: boolean;
    readonly mergedReadSeq: number;
    readonly unread: number;
}

/** 已读状态：每个会话维护「各设备游标 + 全局最大游标」，未读数永远是派生值 */
class ReadStateStore {
    private lastSeqByConversation = new Map<string, number>();
    private cursorsByConversation = new Map<string, Map<string, number>>();
    private seenReceipts = new Set<string>();

    /** 会话最新 seq（消息总数/最大 seq），由同步接口下发 */
    setLastSeq(conversationId: string, lastSeq: number): void {
        const previous = this.lastSeqByConversation.get(conversationId) ?? 0;
        this.lastSeqByConversation.set(conversationId, Math.max(previous, lastSeq));
    }

    /** 合并回执：幂等键先判重，设备游标只增不减，未读由 lastSeq - merged 派生 */
    markRead(receipt: ReadReceipt): ReadResult {
        const conversationId = receipt.conversationId;
        const lastSeq = this.lastSeqByConversation.get(conversationId) ?? 0;
        const mergedBefore = this.mergedReadSeq(conversationId);

        if (this.seenReceipts.has(receipt.receiptId)) {
            return {
                changed: false,
                duplicated: true,
                mergedReadSeq: mergedBefore,
                unread: Math.max(0, lastSeq - mergedBefore),
            };
        }
        this.seenReceipts.add(receipt.receiptId);

        const cursors = this.deviceCursors(conversationId);
        const deviceBefore = cursors.get(receipt.deviceId) ?? 0;
        if (receipt.readSeq <= deviceBefore) {
            // 迟到回执或旧设备游标：接受事件，但绝不回退
            return {
                changed: false,
                duplicated: false,
                mergedReadSeq: mergedBefore,
                unread: Math.max(0, lastSeq - mergedBefore),
            };
        }
        cursors.set(receipt.deviceId, receipt.readSeq);

        const mergedAfter = this.mergedReadSeq(conversationId);
        return {
            changed: true,
            duplicated: false,
            mergedReadSeq: mergedAfter,
            unread: Math.max(0, lastSeq - mergedAfter),
        };
    }

    /** 多端已读取最大值：手机读到 80、平板读到 60，合并结果就是 80 */
    mergedReadSeq(conversationId: string): number {
        const cursors = this.cursorsByConversation.get(conversationId);
        if (cursors === undefined) return 0;
        let merged = 0;
        for (const seq of cursors.values()) merged = Math.max(merged, seq);
        return merged;
    }

    unread(conversationId: string): number {
        const lastSeq = this.lastSeqByConversation.get(conversationId) ?? 0;
        return Math.max(0, lastSeq - this.mergedReadSeq(conversationId));
    }

    private deviceCursors(conversationId: string): Map<string, number> {
        let cursors = this.cursorsByConversation.get(conversationId);
        if (cursors === undefined) {
            cursors = new Map<string, number>();
            this.cursorsByConversation.set(conversationId, cursors);
        }
        return cursors;
    }
}

function runAssertions() {
    const store = new ReadStateStore();
    store.setLastSeq('conv-1', 100);

    // ---------- 测试 1：多端游标取最大 ----------
    const phone = store.markRead({
        receiptId: 'r-phone-30',
        conversationId: 'conv-1',
        deviceId: 'phone',
        readSeq: 30,
    });
    assert.equal(phone.changed, true);
    assert.equal(phone.mergedReadSeq, 30);
    assert.equal(phone.unread, 70);

    const tablet = store.markRead({
        receiptId: 'r-tablet-60',
        conversationId: 'conv-1',
        deviceId: 'tablet',
        readSeq: 60,
    });
    assert.equal(tablet.mergedReadSeq, 60, '取两台设备的最大值');
    assert.equal(tablet.unread, 40);

    const phoneLater = store.markRead({
        receiptId: 'r-phone-80',
        conversationId: 'conv-1',
        deviceId: 'phone',
        readSeq: 80,
    });
    assert.equal(phoneLater.mergedReadSeq, 80);
    assert.equal(phoneLater.unread, 20);
    console.log('[1/4] 多端游标合并 OK, merged:', phoneLater.mergedReadSeq, 'unread:', phoneLater.unread);

    // ---------- 测试 2：迟到/旧游标不回退 ----------
    const stale = store.markRead({
        receiptId: 'r-phone-50',
        conversationId: 'conv-1',
        deviceId: 'phone',
        readSeq: 50,
    });
    assert.equal(stale.changed, false, '设备游标只增不减');
    assert.equal(stale.mergedReadSeq, 80, '旧回执不得把已读拉回去');
    assert.equal(stale.unread, 20, '未读数不得反弹');
    console.log('[2/4] 迟到回执不回退 OK, merged 仍为:', stale.mergedReadSeq);

    // ---------- 测试 3：同一条回执重放幂等 ----------
    const replay = store.markRead({
        receiptId: 'r-phone-80',
        conversationId: 'conv-1',
        deviceId: 'phone',
        readSeq: 80,
    });
    assert.equal(replay.duplicated, true, '幂等键命中');
    assert.equal(replay.changed, false);
    assert.equal(replay.unread, 20, '重放回执不得再次减少未读');
    assert.equal(store.unread('conv-1'), 20);
    console.log('[3/4] 回执重放幂等 OK, unread:', replay.unread);

    // ---------- 测试 4：未读不为负 + 会话隔离 ----------
    store.setLastSeq('conv-2', 5);
    const overflow = store.markRead({
        receiptId: 'r-conv2-9',
        conversationId: 'conv-2',
        deviceId: 'web',
        readSeq: 9,
    });
    assert.equal(overflow.unread, 0, '已读超过最新 seq 时未读钳到 0，不能为负');
    assert.equal(store.unread('conv-1'), 20, '另一个会话的未读不受影响');
    assert.equal(store.mergedReadSeq('conv-2'), 9);
    console.log('[4/4] 未读钳制与会话隔离 OK, conv-1:', store.unread('conv-1'), 'conv-2:', store.unread('conv-2'));

    console.log('\n✅ 116-04 多端已读归约 全部断言通过');
}

runAssertions();

// 文件: examples/123-04-undo-history.ts
// 撤销/重做栈：逆操作自包含生成、连续输入按时间窗合并、选区随栈回放、容量上限丢弃最旧
// 目标：undo/redo 往返文本一致；时间窗内连续输入一步撤销、超窗分步；insert 与 delete 不合并；
//       超过容量丢弃最旧条目后栈仍自洽；新编辑清空 redo 栈

import assert from 'node:assert';

interface DocState {
    text: string;
}

/** delete 记录被删文本，逆操作无需查文档——op 自包含，反转后仍是合法 op */
type Op =
    | { type: 'insert'; pos: number; text: string }
    | { type: 'delete'; pos: number; text: string };

interface Clock {
    now(): number;
}

function createClock(start = 0): { clock: Clock; advance: (ms: number) => void } {
    let now = start;
    return { clock: { now: () => now }, advance: (ms) => { now += ms; } };
}

function applyOp(doc: DocState, op: Op): void {
    if (op.type === 'insert') {
        doc.text = doc.text.slice(0, op.pos) + op.text + doc.text.slice(op.pos);
        return;
    }
    if (doc.text.slice(op.pos, op.pos + op.text.length) !== op.text) {
        throw new Error(`E_DELETE_MISMATCH: 位置 ${op.pos} 处的文本与 op 记录不符`);
    }
    doc.text = doc.text.slice(0, op.pos) + doc.text.slice(op.pos + op.text.length);
}

/** 逆操作生成：insert ↔ delete，位置不变，文本互换 */
function invertOp(op: Op): Op {
    return op.type === 'insert'
        ? { type: 'delete', pos: op.pos, text: op.text }
        : { type: 'insert', pos: op.pos, text: op.text };
}

/** 生成删除 op 时必须先捕获被删文本，否则 undo 无法还原 */
function makeDelete(doc: DocState, pos: number, length: number): Op {
    return { type: 'delete', pos, text: doc.text.slice(pos, pos + length) };
}

interface HistoryEntry {
    ops: Op[]; // 一次可撤销单元内的全部 op，顺序应用、逆序回滚
    before: number; // 应用前的选区（本示例用单光标 offset 简化）
    after: number; // 应用后的选区
    lastTime: number; // 最近一次追加时间，用于合并窗口判断
    kind: 'insert' | 'delete';
}

class UndoHistory {
    private undoStack: HistoryEntry[] = [];
    private redoStack: HistoryEntry[] = [];

    constructor(
        private readonly clock: Clock,
        private readonly mergeWindowMs = 800,
        private readonly limit = 100,
    ) {}

    /** 记录一次编辑；相邻同种输入在时间窗内合并为一步，否则开启新一步 */
    record(op: Op, before: number, after: number): void {
        this.redoStack = []; // 新分支出现，redo 立即作废
        const now = this.clock.now();
        const top = this.undoStack[this.undoStack.length - 1];
        if (top !== undefined && now - top.lastTime <= this.mergeWindowMs) {
            const lastOp = top.ops[top.ops.length - 1];
            const mergeInsert =
                top.kind === 'insert' && op.type === 'insert' && lastOp.type === 'insert'
                && op.pos === lastOp.pos + lastOp.text.length;
            const mergeBackspace =
                top.kind === 'delete' && op.type === 'delete' && lastOp.type === 'delete'
                && op.pos === lastOp.pos - 1; // 连续退格：删除位置逐次前移
            if (mergeInsert || mergeBackspace) {
                top.ops.push(op);
                top.after = after;
                top.lastTime = now;
                return;
            }
        }
        this.undoStack.push({ ops: [op], before, after, lastTime: now, kind: op.type });
        if (this.undoStack.length > this.limit) this.undoStack.shift(); // 超容量：丢弃最旧
    }

    /** 撤销：逆序应用逆操作，选区回到 before，条目转入 redo 栈 */
    undo(doc: DocState): number | null {
        const entry = this.undoStack.pop();
        if (entry === undefined) return null;
        for (let i = entry.ops.length - 1; i >= 0; i -= 1) applyOp(doc, invertOp(entry.ops[i]));
        this.redoStack.push(entry);
        return entry.before;
    }

    /** 重做：按原顺序重放 op，选区回到 after */
    redo(doc: DocState): number | null {
        const entry = this.redoStack.pop();
        if (entry === undefined) return null;
        for (const op of entry.ops) applyOp(doc, op);
        this.undoStack.push(entry);
        return entry.after;
    }

    get undoDepth(): number {
        return this.undoStack.length;
    }

    get redoDepth(): number {
        return this.redoStack.length;
    }
}

function runAssertions(): void {
    // ---------- 测试 1：逆操作自包含生成与精确还原 ----------
    const doc1: DocState = { text: '编辑器' };
    const del = makeDelete(doc1, 0, 2);
    assert.deepEqual(del, { type: 'delete', pos: 0, text: '编辑' }, '删除 op 必须捕获被删文本');
    applyOp(doc1, del);
    assert.equal(doc1.text, '器');
    applyOp(doc1, invertOp(del));
    assert.equal(doc1.text, '编辑器', 'delete 的逆操作必须精确还原文本');

    const ins: Op = { type: 'insert', pos: 3, text: '！' };
    applyOp(doc1, ins);
    assert.equal(doc1.text, '编辑器！');
    applyOp(doc1, invertOp(ins));
    assert.equal(doc1.text, '编辑器');
    assert.throws(() => applyOp(doc1, { type: 'delete', pos: 0, text: '不存在' }), /E_DELETE_MISMATCH/);
    console.log('[1/4] 逆操作生成与还原 OK, 文本不符的删除被拒绝');

    // ---------- 测试 2：连续输入合并窗口与 insert/delete 不合并 ----------
    const { clock, advance } = createClock();
    const history = new UndoHistory(clock, 800, 100);
    const doc2: DocState = { text: '' };
    const typeChar = (ch: string): void => {
        const op: Op = { type: 'insert', pos: doc2.text.length, text: ch };
        applyOp(doc2, op);
        history.record(op, doc2.text.length - 1, doc2.text.length);
    };
    typeChar('h');
    advance(100);
    typeChar('i'); // 100ms 内：与上一步合并
    assert.equal(history.undoDepth, 1, '时间窗内的连续输入合并为一步');
    advance(1000);
    typeChar('!'); // 超窗：新一步
    assert.equal(history.undoDepth, 2);
    assert.equal(doc2.text, 'hi!');

    const backspace = makeDelete(doc2, 2, 1);
    applyOp(doc2, backspace);
    history.record(backspace, 3, 2);
    assert.equal(history.undoDepth, 3, 'insert 与 delete 即使在时间窗内也不合并');
    assert.equal(doc2.text, 'hi');

    assert.equal(history.undo(doc2), 3);
    assert.equal(doc2.text, 'hi!', '撤销退格：文本还原');
    assert.equal(history.undo(doc2), 2);
    assert.equal(doc2.text, 'hi');
    assert.equal(history.undo(doc2), 0);
    assert.equal(doc2.text, '', '一步撤销整个合并输入 hi');
    assert.equal(history.redoDepth, 3);
    assert.equal(history.redo(doc2), 2);
    assert.equal(doc2.text, 'hi');
    console.log('[2/4] 合并窗口 OK, 超窗分步, undo/redo 往返一致');

    // ---------- 测试 3：选区随栈回放 ----------
    const { clock: clock3, advance: advance3 } = createClock();
    const history3 = new UndoHistory(clock3, 800, 100);
    const doc3: DocState = { text: '知识' };
    const insertAt = (pos: number, text: string): void => {
        const op: Op = { type: 'insert', pos, text };
        applyOp(doc3, op);
        history3.record(op, pos, pos + text.length);
    };
    insertAt(2, '平台');
    advance3(1000); // 超窗，强制分步
    insertAt(4, '文档');
    assert.equal(doc3.text, '知识平台文档');
    assert.equal(history3.undo(doc3), 4, 'undo 恢复操作前的选区');
    assert.equal(history3.undo(doc3), 2);
    assert.equal(doc3.text, '知识');
    assert.equal(history3.redo(doc3), 4, 'redo 恢复操作后的选区');
    assert.equal(history3.redo(doc3), 6);
    assert.equal(doc3.text, '知识平台文档');
    console.log('[3/4] 选区随 undo/redo 栈回放 OK');

    // ---------- 测试 4：容量上限丢弃最旧，新编辑清空 redo ----------
    const { clock: clock4, advance: advance4 } = createClock();
    const history4 = new UndoHistory(clock4, 800, 3);
    const doc4: DocState = { text: '' };
    for (let i = 0; i < 5; i += 1) {
        const op: Op = { type: 'insert', pos: i, text: String(i) };
        applyOp(doc4, op);
        history4.record(op, i, i + 1);
        advance4(1000); // 超窗，保证每步独立
    }
    assert.equal(doc4.text, '01234');
    assert.equal(history4.undoDepth, 3, '容量 3：最旧两条已被丢弃');

    assert.equal(history4.undo(doc4), 4);
    assert.equal(history4.undo(doc4), 3);
    assert.equal(history4.undo(doc4), 2);
    assert.equal(doc4.text, '01', '只能撤销到容量边界，最早的两步已不可达');
    assert.equal(history4.undo(doc4), null, '栈空后 undo 返回 null');
    assert.equal(history4.redoDepth, 3);

    history4.record({ type: 'insert', pos: 2, text: 'X' }, 2, 3);
    assert.equal(history4.redoDepth, 0, '新编辑必须清空 redo 栈');
    assert.equal(history4.undoDepth, 1, '三步已撤销后再记录，undo 栈只含新条目');
    console.log('[4/4] 容量上限与 redo 作废 OK');

    console.log('\n✅ 123-04 撤销/重做栈 全部断言通过');
}

runAssertions();

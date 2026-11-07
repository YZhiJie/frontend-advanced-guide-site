// 文件: examples/123-01-document-model.ts
// 富文本编辑器文档模型：扁平文本 + 标记区间（Δ 风格），insert / delete / format 三类操作
// 取舍：知识平台文档以段落内编辑为主，选扁平 Δ 而非节点树——op 变换、undo 反转、协同合并
//       都只需处理「位置与区间」，不必维护父子指针；块级结构交给分块渲染层，不进内核
// 目标：事务原子提交（任一 op 失败整批丢弃）、op 前后长度守恒校验、越界与空操作直接拒绝

import assert from 'node:assert';

/** 一段行内格式的作用区间，[start, end)，mark 为 'bold' | 'italic' | ... */
interface MarkRange {
    mark: string;
    start: number;
    end: number;
}

interface DocState {
    text: string;
    marks: MarkRange[];
}

type Op =
    | { type: 'insert'; pos: number; text: string }
    | { type: 'delete'; pos: number; length: number }
    | { type: 'format'; pos: number; length: number; mark: string; value: boolean };

/** op 对文本长度的影响，用于守恒校验 */
function lengthDelta(op: Op): number {
    if (op.type === 'insert') return op.text.length;
    if (op.type === 'delete') return -op.length;
    return 0;
}

/** 应用前后的一致性校验：文本长度必须恰好变化 lengthDelta，否则说明 apply 实现被破坏 */
function checkConservation(before: DocState, after: DocState, op: Op): void {
    const expected = before.text.length + lengthDelta(op);
    if (after.text.length !== expected) {
        throw new Error(`E_LENGTH_MISMATCH: ${op.type} 后期望 ${expected}，实际 ${after.text.length}`);
    }
}

/** 越界、空操作一律拒绝，绝不让非法 op 进入事务 */
function validateOp(state: DocState, op: Op): void {
    if (op.type === 'insert') {
        if (op.text.length === 0) throw new Error('E_EMPTY_INSERT');
        if (op.pos < 0 || op.pos > state.text.length) throw new Error(`E_OUT_OF_RANGE: insert@${op.pos}`);
        return;
    }
    if (op.length <= 0) throw new Error('E_EMPTY_RANGE');
    if (op.pos < 0 || op.pos + op.length > state.text.length) {
        throw new Error(`E_OUT_OF_RANGE: ${op.type}@${op.pos}+${op.length}`);
    }
}

function applyInsert(state: DocState, pos: number, text: string): void {
    state.text = state.text.slice(0, pos) + text + state.text.slice(pos);
    const len = text.length;
    state.marks = state.marks.map((m) => {
        if (m.end <= pos) return m;                                                  // 完全在插入点前：不动
        if (m.start >= pos) return { ...m, start: m.start + len, end: m.end + len }; // 之后：整体右移
        return { ...m, end: m.end + len };                                           // 插入点在区间内：扩张（新文字继承格式）
    });
}

function applyDelete(state: DocState, pos: number, length: number): void {
    const end = pos + length;
    state.text = state.text.slice(0, pos) + state.text.slice(end);
    const next: MarkRange[] = [];
    for (const m of state.marks) {
        const start = m.start < pos ? m.start : Math.max(pos, m.start - length);
        const stop = m.end <= pos ? m.end : m.end <= end ? pos : m.end - length;
        if (stop > start) next.push({ mark: m.mark, start, end: stop }); // 被删空的区间直接丢弃
    }
    state.marks = next;
}

/** 切换 [pos, pos+length) 上的格式：先切掉同 mark 的相交部分，再按需补回新区间 */
function applyFormat(state: DocState, pos: number, length: number, mark: string, value: boolean): void {
    const end = pos + length;
    const kept: MarkRange[] = [];
    for (const m of state.marks) {
        if (m.mark !== mark || m.end <= pos || m.start >= end) {
            kept.push(m);
            continue;
        }
        if (m.start < pos) kept.push({ mark, start: m.start, end: pos });
        if (m.end > end) kept.push({ mark, start: end, end: m.end });
    }
    if (value) kept.push({ mark, start: pos, end });
    // 排序后合并首尾相接的同 mark 区间，保证 marks 始终是规范形态
    kept.sort((a, b) => (a.mark === b.mark ? a.start - b.start : a.mark < b.mark ? -1 : 1));
    const merged: MarkRange[] = [];
    for (const m of kept) {
        const last = merged[merged.length - 1];
        if (last && last.mark === m.mark && last.end === m.start) last.end = m.end;
        else merged.push({ ...m });
    }
    state.marks = merged;
}

function applyOp(state: DocState, op: Op): void {
    if (op.type === 'insert') applyInsert(state, op.pos, op.text);
    else if (op.type === 'delete') applyDelete(state, op.pos, op.length);
    else applyFormat(state, op.pos, op.length, op.mark, op.value);
}

class RichDoc {
    private state: DocState;

    constructor(text: string) {
        this.state = { text, marks: [] };
    }

    get text(): string {
        return this.state.text;
    }

    get marks(): readonly MarkRange[] {
        return this.state.marks;
    }

    /**
     * 事务提交：在克隆上试跑全部 op，任何一步校验失败直接抛错，原文档保持不变。
     * 全部通过才一次性替换 state——渲染层只会看到「前」与「后」两个一致快照。
     */
    transact(ops: readonly Op[]): void {
        const draft: DocState = { text: this.state.text, marks: this.state.marks.map((m) => ({ ...m })) };
        for (const op of ops) {
            validateOp(draft, op);
            const before = { text: draft.text, marks: draft.marks };
            applyOp(draft, op);
            checkConservation(before, draft, op);
        }
        this.state = draft;
    }
}

function runAssertions(): void {
    // ---------- 测试 1：insert/delete 基本语义与长度守恒 ----------
    const doc = new RichDoc('hello');
    doc.transact([{ type: 'insert', pos: 5, text: ' world' }]);
    assert.equal(doc.text, 'hello world');
    assert.equal(doc.text.length, 11, 'insert 后长度必须 +6');
    doc.transact([{ type: 'delete', pos: 0, length: 6 }]);
    assert.equal(doc.text, 'world');
    assert.equal(doc.text.length, 5, 'delete 后长度必须 -6');

    const lenBefore = doc.text.length;
    assert.throws(() => doc.transact([{ type: 'insert', pos: 6, text: '!' }]), /E_OUT_OF_RANGE/);
    assert.throws(() => doc.transact([{ type: 'delete', pos: 3, length: 3 }]), /E_OUT_OF_RANGE/);
    assert.throws(() => doc.transact([{ type: 'insert', pos: 0, text: '' }]), /E_EMPTY_INSERT/);
    assert.equal(doc.text.length, lenBefore, '非法 op 不得改变文档');
    console.log('[1/4] insert/delete 与长度守恒 OK, 越界与空操作被拒绝');

    // ---------- 测试 2：format 标记的添加、切分与合并 ----------
    const fmt = new RichDoc('hello world');
    fmt.transact([{ type: 'format', pos: 0, length: 11, mark: 'bold', value: true }]);
    assert.deepEqual(fmt.marks, [{ mark: 'bold', start: 0, end: 11 }]);

    fmt.transact([{ type: 'format', pos: 4, length: 3, mark: 'bold', value: false }]);
    assert.deepEqual(fmt.marks, [
        { mark: 'bold', start: 0, end: 4 },
        { mark: 'bold', start: 7, end: 11 },
    ], '取消中段格式应把区间切成两段');

    fmt.transact([{ type: 'format', pos: 4, length: 3, mark: 'bold', value: true }]);
    assert.deepEqual(fmt.marks, [{ mark: 'bold', start: 0, end: 11 }], '相邻同 mark 区间必须合并');

    fmt.transact([{ type: 'format', pos: 0, length: 5, mark: 'italic', value: true }]);
    assert.equal(fmt.marks.filter((m) => m.mark === 'italic').length, 1);
    assert.equal(fmt.text, 'hello world', 'format 不得改变文本');
    console.log('[2/4] format 添加/切分/合并 OK, 区间保持规范形态');

    // ---------- 测试 3：insert/delete 后标记区间正确跟随 ----------
    const follow = new RichDoc('hello world');
    follow.transact([{ type: 'format', pos: 0, length: 11, mark: 'bold', value: true }]);
    follow.transact([{ type: 'insert', pos: 2, text: 'XY' }]);
    assert.deepEqual(follow.marks, [{ mark: 'bold', start: 0, end: 13 }], '插入点在区间内：区间扩张');
    follow.transact([{ type: 'insert', pos: 0, text: '#' }]);
    assert.deepEqual(follow.marks, [{ mark: 'bold', start: 1, end: 14 }], '起点前插入：整体右移，新字符不带格式');
    follow.transact([{ type: 'delete', pos: 0, length: 2 }]);
    assert.deepEqual(follow.marks, [{ mark: 'bold', start: 0, end: 12 }]);
    assert.equal(follow.text.length, 12);
    follow.transact([{ type: 'delete', pos: 0, length: 12 }]);
    assert.deepEqual(follow.marks, [], '文本删空后不得残留标记区间');
    console.log('[3/4] 标记区间跟随 OK, 扩张/右移/收缩/清空全正确');

    // ---------- 测试 4：事务原子性与一致性守卫 ----------
    const tx = new RichDoc('abc');
    tx.transact([
        { type: 'insert', pos: 1, text: 'X' },
        { type: 'delete', pos: 0, length: 1 },
        { type: 'format', pos: 0, length: 3, mark: 'bold', value: true },
    ]);
    assert.equal(tx.text, 'Xbc');
    assert.deepEqual(tx.marks, [{ mark: 'bold', start: 0, end: 3 }], '事务内多步 op 按序生效');

    const snapshot = JSON.stringify({ text: tx.text, marks: tx.marks });
    assert.throws(
        () =>
            tx.transact([
                { type: 'insert', pos: 3, text: 'Y' },
                { type: 'insert', pos: 99, text: 'Z' }, // 第二步越界：整批必须回滚
            ]),
        /E_OUT_OF_RANGE/,
    );
    assert.equal(JSON.stringify({ text: tx.text, marks: tx.marks }), snapshot, '失败事务不得留下半步');

    const before = { text: 'abc', marks: [] as MarkRange[] };
    const tampered = { text: 'abcdd', marks: [] as MarkRange[] }; // 插入 1 字符却多了 2 个字符
    assert.throws(
        () => checkConservation(before, tampered, { type: 'insert', pos: 3, text: 'd' }),
        /E_LENGTH_MISMATCH/,
        '长度不守恒必须被守卫拦截',
    );
    console.log('[4/4] 事务原子提交 OK, 失败事务整体回滚, 守恒守卫生效');

    console.log('\n✅ 123-01 文档模型与事务 全部断言通过');
}

runAssertions();

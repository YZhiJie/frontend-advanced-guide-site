// 文件: examples/123-02-selection-mapping.ts
// 选区映射：op 应用后 anchor/focus 跟随变换、跨段落选区归一化、中文 composition 期间冻结
// 目标：光标右侧亲和；被删除吞并的选区正确坍缩；反向选区归一但保留方向；输入期间拒绝 DOM 选区回写

import assert from 'node:assert';

interface Point {
    block: number;
    offset: number;
}

interface Selection {
    anchor: Point;
    focus: Point;
}

type TextOp =
    | { type: 'insert'; block: number; offset: number; text: string }
    | { type: 'delete'; block: number; offset: number; length: number };

type InsertOp = Extract<TextOp, { type: 'insert' }>;

/**
 * 单点变换：与 ProseMirror 的 pos.map 同语义。
 * insert：恰好落在插入点的光标跟随新文本右移（右侧亲和），保证连续打字光标不甩到文字前面。
 * delete：落在被删区间内的点夹取到删除起点，区间之后的前移 length。
 */
function transformOffset(offset: number, op: TextOp): number {
    if (op.type === 'insert') {
        return offset < op.offset ? offset : offset + op.text.length;
    }
    const delEnd = op.offset + op.length;
    if (offset <= op.offset) return offset;
    if (offset >= delEnd) return offset - op.length;
    return op.offset;
}

/** 同块内变换 offset；拆段/并段等跨块 op 由块级映射另行处理，本示例聚焦块内 */
function transformPoint(point: Point, op: TextOp): Point {
    if (point.block !== op.block) return point;
    return { block: point.block, offset: transformOffset(point.offset, op) };
}

function transformSelection(sel: Selection, op: TextOp): Selection {
    return { anchor: transformPoint(sel.anchor, op), focus: transformPoint(sel.focus, op) };
}

function comparePoints(a: Point, b: Point): number {
    return a.block !== b.block ? a.block - b.block : a.offset - b.offset;
}

interface NormalizedSelection {
    start: Point;
    end: Point;
    backward: boolean;
}

/** 先把点夹回文档范围，再统一为 start <= end；用户从右往左选时 backward = true，方向信息不丢 */
function normalizeSelection(blockLengths: readonly number[], sel: Selection): NormalizedSelection {
    const clamp = (p: Point): Point => {
        const block = Math.min(Math.max(p.block, 0), blockLengths.length - 1);
        const offset = Math.min(Math.max(p.offset, 0), blockLengths[block]);
        return { block, offset };
    };
    const anchor = clamp(sel.anchor);
    const focus = clamp(sel.focus);
    if (comparePoints(anchor, focus) > 0) return { start: focus, end: anchor, backward: true };
    return { start: anchor, end: focus, backward: false };
}

/**
 * 迷你编辑器：演示 composition 期间的选区冻结与 op 排队。
 * compositionstart 后 IME 直接改写 DOM，此时 DOM Selection 与模型必然脱节，
 * 正确做法是：输入 op 入队、拒绝外部选区回写、不重渲染，compositionend 统一结算。
 */
class CompositionEditor {
    text: string;
    cursor: number;
    composing = false;
    private pending: InsertOp[] = [];

    constructor(text: string, cursor: number) {
        this.text = text;
        this.cursor = cursor;
    }

    compositionStart(): void {
        this.composing = true;
    }

    /** 输入期间只演示 insert（退格等复杂情况真实内核同样入队，这里从简） */
    input(text: string): void {
        const offset = this.composing ? this.pendingOffset() : this.cursor;
        const op: InsertOp = { type: 'insert', block: 0, offset, text };
        if (this.composing) {
            this.pending.push(op);
            return;
        }
        this.applyLocal(op);
    }

    /** selectionchange 回写：composition 期间必须拒绝，否则光标跳到 IME 临时串中间 */
    setCursorFromDom(offset: number): boolean {
        if (this.composing) return false;
        this.cursor = offset;
        return true;
    }

    compositionEnd(): void {
        this.composing = false;
        const ops = this.pending.splice(0);
        for (const op of ops) this.applyLocal(op);
    }

    /** 排队中的 op 依次接在光标之后，候选串累加长度即下一个插入位置 */
    private pendingOffset(): number {
        return this.cursor + this.pending.reduce((sum, op) => sum + op.text.length, 0);
    }

    private applyLocal(op: InsertOp): void {
        this.text = this.text.slice(0, op.offset) + op.text + this.text.slice(op.offset);
        this.cursor = transformOffset(this.cursor, op); // 自己的输入：光标跟随到新文本之后
    }
}

function runAssertions(): void {
    // ---------- 测试 1：transformOffset 的右侧亲和与删除夹取 ----------
    const insertAt3: TextOp = { type: 'insert', block: 0, offset: 3, text: 'ab' };
    assert.equal(transformOffset(2, insertAt3), 2);
    assert.equal(transformOffset(3, insertAt3), 5, '落在插入点：右侧亲和');
    assert.equal(transformOffset(7, insertAt3), 9);

    const delete3to7: TextOp = { type: 'delete', block: 0, offset: 3, length: 4 }; // 删除 [3,7)
    assert.equal(transformOffset(2, delete3to7), 2);
    assert.equal(transformOffset(3, delete3to7), 3);
    assert.equal(transformOffset(5, delete3to7), 3, '落在被删区间内：夹取到删除起点');
    assert.equal(transformOffset(9, delete3to7), 5);
    console.log('[1/4] transformOffset 右侧亲和与删除夹取 OK');

    // ---------- 测试 2：选区整体变换与被吞并时的坍缩 ----------
    const sel: Selection = { anchor: { block: 0, offset: 2 }, focus: { block: 0, offset: 8 } };
    const moved = transformSelection(sel, { type: 'delete', block: 0, offset: 4, length: 2 });
    assert.deepEqual(moved, { anchor: { block: 0, offset: 2 }, focus: { block: 0, offset: 6 } });

    const swallowed = transformSelection(sel, { type: 'delete', block: 0, offset: 0, length: 10 });
    assert.deepEqual(swallowed.anchor, { block: 0, offset: 0 });
    assert.deepEqual(swallowed.focus, { block: 0, offset: 0 }, '选区被删除吞并：坍缩为光标');

    const otherBlock = transformPoint({ block: 2, offset: 5 }, { type: 'insert', block: 0, offset: 0, text: 'x' });
    assert.deepEqual(otherBlock, { block: 2, offset: 5 }, '不同块的点不受块内 op 影响');
    console.log('[2/4] 选区变换与吞并坍缩 OK');

    // ---------- 测试 3：跨段落选区归一化与越界夹取 ----------
    const blocks = [3, 4]; // '第一段' / '第二段落'
    const backward = normalizeSelection(blocks, { anchor: { block: 1, offset: 2 }, focus: { block: 0, offset: 1 } });
    assert.deepEqual(backward, { start: { block: 0, offset: 1 }, end: { block: 1, offset: 2 }, backward: true });

    const clamped = normalizeSelection(blocks, { anchor: { block: 0, offset: 99 }, focus: { block: 7, offset: 9 } });
    assert.deepEqual(clamped.start, { block: 0, offset: 3 }, 'offset 夹回块长');
    assert.deepEqual(clamped.end, { block: 1, offset: 4 }, 'block 索引夹回段落数');
    assert.equal(clamped.backward, false);
    console.log('[3/4] 跨段落归一化与越界夹取 OK');

    // ---------- 测试 4：composition 期间选区冻结、op 排队，end 后统一结算 ----------
    const editor = new CompositionEditor('你好', 2);
    assert.equal(editor.setCursorFromDom(0), true);
    assert.equal(editor.cursor, 0);
    assert.equal(editor.setCursorFromDom(2), true);

    editor.compositionStart();
    editor.input('，');
    editor.input('世界');
    assert.equal(editor.text, '你好', 'composition 期间文档不得被改写');
    assert.equal(editor.setCursorFromDom(0), false, 'composition 期间拒绝 DOM 选区回写');
    assert.equal(editor.cursor, 2);

    editor.compositionEnd();
    assert.equal(editor.text, '你好，世界', 'end 后按序结算排队 op');
    assert.equal(editor.cursor, 5, '光标跟随到合成文本之后');

    editor.input('！');
    assert.equal(editor.text, '你好，世界！');
    assert.equal(editor.cursor, 6, '非合成输入立即生效');
    console.log('[4/4] composition 冻结与结算 OK, 光标全程未跳变');

    console.log('\n✅ 123-02 选区映射与输入冻结 全部断言通过');
}

runAssertions();

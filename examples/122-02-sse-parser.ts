// 文件: examples/122-02-sse-parser.ts
// SSE 流式解析器：跨 chunk 事件边界、多行 data、event 分发、[DONE] 终止、断线序号缺口检测
// 目标：无论网络怎么切片都产出相同事件流；序号缺口可量化上报；[DONE] 之后的字节一律忽略

import assert from 'node:assert';

interface SseEvent {
    /** event 字段，缺省为 message */
    event: string;
    /** 多行 data 以 \n 拼接后的完整载荷 */
    data: string;
    /** 服务端分配的单调序号，断线重连时作为 Last-Event-ID 回传 */
    id?: string;
}

interface Gap {
    from: number;
    to: number;
    missing: number;
}

/**
 * 行协议状态机：buffer 攒字节，只处理完整的行；
 * data/event/id 逐字段累积，空行触发一次分发。
 */
class SseParser {
    private buffer = '';
    private dataLines: string[] = [];
    private eventName = 'message';
    private eventId: string | undefined;
    private lastId: number | undefined;
    private doneSeen = false;
    private readonly handlers = new Map<string, (ev: SseEvent) => void>();
    private gapHandler: ((gap: Gap) => void) | undefined;
    private doneHandler: (() => void) | undefined;

    on(event: string, handler: (ev: SseEvent) => void): this {
        this.handlers.set(event, handler);
        return this;
    }

    onGap(handler: (gap: Gap) => void): this {
        this.gapHandler = handler;
        return this;
    }

    onDone(handler: () => void): this {
        this.doneHandler = handler;
        return this;
    }

    get isDone(): boolean {
        return this.doneSeen;
    }

    /** 喂入任意大小的网络分片；不完整的一行留在缓冲区等待下一片 */
    push(chunk: string): void {
        if (this.doneSeen) return; // [DONE] 是流的终点，之后的字节直接忽略
        this.buffer += chunk;
        let idx = this.buffer.indexOf('\n');
        while (idx >= 0) {
            let line = this.buffer.slice(0, idx);
            this.buffer = this.buffer.slice(idx + 1);
            if (line.endsWith('\r')) line = line.slice(0, -1);
            this.handleLine(line);
            idx = this.buffer.indexOf('\n');
        }
    }

    private handleLine(line: string): void {
        if (line === '') {
            this.dispatch();
            return;
        }
        if (line.startsWith(':')) return; // 心跳/注释行，不产生事件
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        let value = colon < 0 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1); // 规范允许冒号后恰好一个空格
        if (field === 'data') this.dataLines.push(value);
        else if (field === 'event') this.eventName = value;
        else if (field === 'id') this.eventId = value;
        // retry 等字段交给重连策略，解析器本身不消费
    }

    private dispatch(): void {
        if (this.dataLines.length === 0) {
            this.resetFields();
            return; // 没有 data 的空块（纯心跳）不分发
        }
        const ev: SseEvent = {
            event: this.eventName,
            data: this.dataLines.join('\n'),
            id: this.eventId,
        };
        this.resetFields();
        if (ev.id !== undefined) this.checkGap(ev.id);
        if (ev.data === '[DONE]') {
            this.doneSeen = true;
            this.doneHandler?.();
            return; // [DONE] 哨兵不进业务分发
        }
        this.handlers.get(ev.event)?.(ev);
    }

    /** id 单调递增；跳号说明传输层之外真的丢了事件，量化上报 */
    private checkGap(id: string): void {
        const numeric = Number(id);
        if (!Number.isInteger(numeric)) return;
        if (this.lastId !== undefined && numeric > this.lastId + 1) {
            this.gapHandler?.({ from: this.lastId, to: numeric, missing: numeric - this.lastId - 1 });
        }
        this.lastId = numeric;
    }

    private resetFields(): void {
        this.dataLines = [];
        this.eventName = 'message';
        this.eventId = undefined;
    }
}

/** 一段确定性的模拟报文：心跳、多行 data、跳号 id、[DONE]、以及 DONE 之后的迟到帧 */
const WIRE = [
    ': heartbeat',
    '',
    'id: 1',
    'event: delta',
    'data: {"text":"你好"}',
    '',
    'id: 2',
    'event: delta',
    'data: {"text":"，世界"}',
    '',
    'id: 3',
    'event: chunk',
    'data: 第一段上',
    'data: 半句',
    '',
    'id: 5',
    'event: delta',
    'data: {"text":"!"}',
    '',
    'id: 6',
    'event: finish',
    'data: {"usage":{"prompt":10,"completion":20}}',
    '',
    'data: [DONE]',
    '',
    'event: delta',
    'data: {"text":"迟到帧"}',
    '',
].join('\n');

interface Collected {
    deltas: string[];
    chunks: string[];
    finishes: SseEvent[];
    gaps: Gap[];
    doneCount: number;
}

/** 搭一个收集器：把解析器输出全部落进数组，便于逐字段断言 */
function collect(): { parser: SseParser; out: Collected } {
    const out: Collected = { deltas: [], chunks: [], finishes: [], gaps: [], doneCount: 0 };
    const parser = new SseParser();
    parser.on('delta', (ev) => out.deltas.push(ev.data));
    parser.on('chunk', (ev) => out.chunks.push(ev.data));
    parser.on('finish', (ev) => out.finishes.push(ev));
    parser.onGap((gap) => out.gaps.push(gap));
    parser.onDone(() => out.doneCount++);
    return { parser, out };
}

function runAssertions(): void {
    // ---------- 测试 1：整段一次喂入——分发、多行拼接、终止各就各位 ----------
    const once = collect();
    once.parser.push(WIRE);
    assert.deepEqual(once.out.deltas, ['{"text":"你好"}', '{"text":"，世界"}', '{"text":"!"}']);
    assert.deepEqual(once.out.chunks, ['第一段上\n半句'], '多行 data 必须以 \\n 拼接');
    assert.equal(once.out.finishes.length, 1);
    assert.deepEqual(JSON.parse(once.out.finishes[0].data).usage, { prompt: 10, completion: 20 });
    assert.equal(once.out.doneCount, 1, '[DONE] 恰好触发一次');
    assert.ok(once.parser.isDone);
    once.parser.push('event: delta\ndata: {"text":"再来一帧"}\n\n');
    assert.equal(once.out.deltas.length, 3, '[DONE] 之后继续推送一律忽略');
    console.log('[1/4] 整段解析 OK, 3 delta / 1 多行 chunk / 1 finish / DONE 各就各位');

    // ---------- 测试 2：任意切片——逐字符与不規则分片都必须还原同一事件流 ----------
    const drip = collect();
    for (const ch of WIRE) drip.parser.push(ch);
    assert.deepEqual(drip.out.deltas, once.out.deltas, '逐字符切片不得改变 delta 序列');
    assert.deepEqual(drip.out.chunks, once.out.chunks);
    assert.deepEqual(drip.out.gaps, once.out.gaps);
    assert.equal(drip.out.doneCount, 1);
    assert.ok(drip.parser.isDone);

    // 模拟 MTU/代理缓冲造成的不规则切片：按确定性的 7/3/11/5 循环切
    const ragged = collect();
    const sizes = [7, 3, 11, 5];
    let offset = 0;
    let cursor = 0;
    while (offset < WIRE.length) {
        ragged.parser.push(WIRE.slice(offset, offset + sizes[cursor % sizes.length]));
        offset += sizes[cursor % sizes.length];
        cursor++;
    }
    assert.deepEqual(ragged.out.deltas, once.out.deltas, '任意切片边界都得还原同一事件流');
    assert.equal(ragged.out.finishes.length, 1);
    console.log('[2/4] 跨 chunk 边界 OK, 逐字符与不规则切片结果一致');

    // ---------- 测试 3：序号缺口——id 跳号被量化上报，心跳与未知字段不产生事件 ----------
    assert.deepEqual(once.out.gaps, [{ from: 3, to: 5, missing: 1 }], 'id 3 -> 5 必须报出缺口');
    assert.deepEqual(ragged.out.gaps, once.out.gaps, '缺口检测与切片方式无关');

    const quiet = collect();
    quiet.parser.push(': only-heartbeat\n\nretry: 3000\n\n');
    const quietEvents = quiet.out.deltas.length + quiet.out.chunks.length + quiet.out.finishes.length;
    assert.equal(quietEvents, 0, '心跳与裸 retry 字段不产生业务事件');
    assert.equal(quiet.out.doneCount, 0);
    console.log('[3/4] 缺口检测 OK, 上报 { from: 3, to: 5, missing: 1 }');

    // ---------- 测试 4：断线恢复——用 lastEventId 从服务端日志重放缺口 ----------
    const text = once.out.deltas.map((d) => (JSON.parse(d) as { text: string }).text).join('');
    assert.equal(text, '你好，世界!');

    // 服务端事件日志 id 单调递增；客户端断线前只确认到 2
    const serverLog: SseEvent[] = [
        { id: '1', event: 'delta', data: '{"text":"你好"}' },
        { id: '2', event: 'delta', data: '{"text":"，世界"}' },
        { id: '3', event: 'chunk', data: '第一段上\n半句' },
        { id: '4', event: 'delta', data: '{"text":"（被丢的一帧）"}' },
        { id: '5', event: 'delta', data: '{"text":"!"}' },
    ];
    const replay = (log: SseEvent[], lastEventId: number): SseEvent[] =>
        log.filter((ev) => Number(ev.id) > lastEventId);
    const missed = replay(serverLog, 2);
    assert.deepEqual(missed.map((ev) => ev.id), ['3', '4', '5'], '重连后从 lastEventId 之后全量重放');
    const healed = missed
        .filter((ev) => ev.event === 'delta')
        .map((ev) => (JSON.parse(ev.data) as { text: string }).text)
        .join('');
    assert.equal(healed, '（被丢的一帧）!', '缺口帧在重放中被找回');
    console.log('[4/4] 断线恢复 OK, lastEventId=2 重放出 3 帧');

    console.log('\n✅ 122-02 SSE 流式解析器 全部断言通过');
}

runAssertions();

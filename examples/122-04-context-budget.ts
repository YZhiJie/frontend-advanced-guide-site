// 文件: examples/122-04-context-budget.ts
// 多轮上下文裁剪：token 估算、滑动窗口、system/summary 钉住、超预算降级
// 目标：永远不超预算；最近轮次优先保留；system 钉在头部；装不下也要给出可发送的降级结果

import assert from 'node:assert';

type Role = 'system' | 'user' | 'assistant' | 'summary';

interface ChatMsg {
    role: Role;
    content: string;
}

interface BudgetOptions {
    maxTokens: number;
    /** 给模型回复预留的额度，先从预算里扣掉 */
    reserveForReply: number;
    /** 有轮次被裁时是否生成摘要钉住 */
    withSummary: boolean;
}

interface BudgetResult {
    /** 可直接发送的顺序：system → summary → 窗口内轮次 */
    messages: ChatMsg[];
    usedTokens: number;
    droppedTurns: number;
    degraded: boolean;
}

/** 每条消息的结构开销（角色标记、分隔符），与主流 tokenizer 的常数项对齐 */
const PER_MESSAGE_OVERHEAD = 4;

/** 确定性估算：CJK 一字符一 token，ASCII 约 4 字符一 token；宁多勿少 */
function estimateTokens(text: string): number {
    let tokens = 0;
    let asciiRun = 0;
    for (const ch of text) {
        if (ch.charCodeAt(0) > 0xff) {
            tokens += 1 + Math.ceil(asciiRun / 4);
            asciiRun = 0;
        } else {
            asciiRun++;
        }
    }
    return tokens + Math.ceil(asciiRun / 4);
}

function msgTokens(msg: ChatMsg): number {
    return estimateTokens(msg.content) + PER_MESSAGE_OVERHEAD;
}

/** 真实实现调用模型做摘要；这里用确定性截取模拟，断言摘要里找得到被裁内容 */
function summarize(dropped: ChatMsg[]): string {
    const heads = dropped.map((msg) => msg.content.slice(0, 10)).join('；');
    return `前情摘要：${heads}`;
}

const TRUNC_MARK = '…[已截断]';
const MARK_TOKENS = estimateTokens(TRUNC_MARK);

/** 截断到 token 上限：按估算成本逐字符走，预留标记位置，超出即停 */
function truncateToTokens(text: string, limit: number): string {
    const budget = Math.max(0, limit - MARK_TOKENS);
    let tokens = 0;
    let end = 0;
    for (const ch of text) {
        const cost = ch.charCodeAt(0) > 0xff ? 1 : 0.25;
        if (tokens + cost > budget) break;
        tokens += cost;
        end += ch.length;
    }
    return text.slice(0, end) + TRUNC_MARK;
}

function buildContext(all: ChatMsg[], opts: BudgetOptions): BudgetResult {
    const budget = opts.maxTokens - opts.reserveForReply;
    const system = all.filter((msg) => msg.role === 'system');
    const turns = all.filter((msg) => msg.role === 'user' || msg.role === 'assistant');

    const systemTokens = system.reduce((sum, msg) => sum + msgTokens(msg), 0);
    if (systemTokens > budget) {
        // system 超预算没有降级空间，只能让上层调整配置
        throw new Error(`E_SYSTEM_OVER_BUDGET: system ${systemTokens} > ${budget}`);
    }

    // 轮次配成对：user+assistant 要么一起进窗口，要么一起被裁，不留孤儿
    const pairs: ChatMsg[][] = [];
    for (let i = 0; i < turns.length; i++) {
        if (turns[i].role === 'user' && turns[i + 1]?.role === 'assistant') {
            pairs.push([turns[i], turns[i + 1]]);
            i++;
        } else {
            pairs.push([turns[i]]);
        }
    }
    const pairCost = (pair: ChatMsg[]): number => pair.reduce((sum, msg) => sum + msgTokens(msg), 0);

    // 从最新往最旧装窗口，装不下就停；dropped 是头部被裁掉的最旧若干对
    const fill = (allowance: number): { kept: ChatMsg[][]; dropped: ChatMsg[][] } => {
        const kept: ChatMsg[][] = [];
        let used = systemTokens;
        for (let i = pairs.length - 1; i >= 0; i--) {
            const cost = pairCost(pairs[i]);
            if (used + cost > allowance) return { kept, dropped: pairs.slice(0, i + 1) };
            used += cost;
            kept.unshift(pairs[i]);
        }
        return { kept, dropped: [] };
    };

    let allowance = budget;
    let result = fill(allowance);
    let summary: ChatMsg | undefined;
    if (result.dropped.length > 0 && opts.withSummary) {
        // 摘要也占预算：先预留摘要额度，再重装窗口（窗口会因此更小）
        summary = { role: 'summary', content: summarize(result.dropped.flat()) };
        allowance = budget - msgTokens(summary);
        result = fill(allowance);
    }

    let finalTurns = result.kept.flat();
    let droppedTurns = result.dropped.length;
    let degraded = false;
    if (result.kept.length === 0 && pairs.length > 0) {
        // 连最新一轮都装不下：降级为"截断最后一条"，保证请求仍能发出
        const last = pairs[pairs.length - 1];
        const tail = last[last.length - 1];
        const room = allowance - systemTokens - PER_MESSAGE_OVERHEAD;
        if (room <= MARK_TOKENS) throw new Error('E_CONTEXT_OVERFLOW: 连截断空间都不足');
        finalTurns = [{ role: tail.role, content: truncateToTokens(tail.content, room) }];
        droppedTurns = pairs.length - 1;
        degraded = true;
    }

    const messages = [...system, ...(summary !== undefined ? [summary] : []), ...finalTurns];
    const usedTokens = messages.reduce((sum, msg) => sum + msgTokens(msg), 0);
    return { messages, usedTokens, droppedTurns, degraded };
}

/** 构造确定性的多轮历史：system 8 字，user/assistant 各 6 个 CJK 字（每条 10 token，每对 20） */
function makeHistory(pairCount: number): ChatMsg[] {
    const numerals = '零一二三四五六七八九';
    const msgs: ChatMsg[] = [{ role: 'system', content: '你是企业财报助手' }];
    for (let i = 0; i < pairCount; i++) {
        msgs.push({ role: 'user', content: `第${numerals[i]}轮问题！` });
        msgs.push({ role: 'assistant', content: `答${numerals[i]}复内容。` });
    }
    return msgs;
}

function runAssertions(): void {
    // ---------- 测试 1：token 估算——确定性、单调、含结构开销 ----------
    assert.equal(estimateTokens('你好世界'), 4, 'CJK 一字符一 token');
    assert.equal(estimateTokens('abcd'), 1, 'ASCII 约 4 字符一 token');
    assert.equal(estimateTokens(''), 0);
    assert.equal(estimateTokens('你好ab'), 3, '2 个 CJK + 2 个 ASCII(ceil(2/4)=1)');
    assert.ok(estimateTokens('营收增长百分之十二') > estimateTokens('营收增长'), '估算必须单调');
    assert.equal(msgTokens({ role: 'user', content: '你好' }), 2 + PER_MESSAGE_OVERHEAD);
    console.log('[1/4] token 估算 OK, CJK=1 / ASCII≈1/4 / 每条 +4');

    // ---------- 测试 2：滑动窗口——最近轮次优先，system 钉住，成对去留 ----------
    const history = makeHistory(10); // 10 对 × 20 token = 200，system 12
    const win = buildContext(history, { maxTokens: 200, reserveForReply: 30, withSummary: false });
    // budget=170：12 + 7×20 = 152 装得下，再加一对 172 > 170 装不下
    assert.equal(win.droppedTurns, 3, '最旧 3 对被裁');
    assert.equal(win.messages.length, 15, 'system + 7 对 = 15 条');
    assert.equal(win.usedTokens, 152);
    assert.ok(win.usedTokens <= 170, '不得超过扣掉回复预留后的预算');
    assert.equal(win.messages[0].role, 'system', 'system 永远钉在头部');
    assert.equal(win.messages[1].content, '第三轮问题！', '窗口从最近往最旧保留');
    assert.equal(win.messages[1].role, 'user');
    assert.equal(win.messages[2].role, 'assistant', '轮次成对，不留孤儿 user/assistant');
    console.log('[2/4] 滑动窗口 OK, 保留最近 7 对 / 裁掉最旧 3 对');

    // ---------- 测试 3：摘要钉住——被裁轮次进摘要，摘要自身也占预算 ----------
    const withSum = buildContext(history, { maxTokens: 200, reserveForReply: 30, withSummary: true });
    assert.equal(withSum.messages[1].role, 'summary', '摘要钉在 system 之后');
    assert.ok(withSum.messages[1].content.includes('第零轮'), '摘要必须覆盖被裁掉的最旧轮次');
    assert.ok(withSum.usedTokens <= 170, `摘要计入预算：${withSum.usedTokens} <= 170`);
    // 摘要 50 token 挤占窗口：kept 从 7 对缩到 5 对（12+50+5×20=162）
    assert.equal(withSum.droppedTurns, 5, '摘要挤占预算后窗口更小');
    assert.ok(withSum.messages.length < win.messages.length, '摘要换取了更短的消息列表');
    console.log('[3/4] 摘要钉住 OK, 窗口 7 对 -> 5 对换取前文记忆');

    // ---------- 测试 4：超预算降级——截断最后一条保底可发；system 超配直接报错 ----------
    const huge: ChatMsg[] = [
        { role: 'system', content: '你是企业财报助手' },
        { role: 'user', content: '长'.repeat(500) },
    ];
    const deg = buildContext(huge, { maxTokens: 120, reserveForReply: 20, withSummary: false });
    assert.ok(deg.degraded, '连最新一轮都装不下时必须进入降级路径');
    assert.ok(deg.messages[1].content.endsWith('…[已截断]'), '截断必须对用户可见');
    assert.ok(deg.usedTokens <= 100, `截断后 ${deg.usedTokens} 必须 <= 120-20`);
    assert.equal(deg.messages[0].role, 'system', '降级也不丢 system');

    const fatSystem: ChatMsg[] = [{ role: 'system', content: '规'.repeat(300) }];
    assert.throws(
        () => buildContext(fatSystem, { maxTokens: 100, reserveForReply: 20, withSummary: false }),
        /E_SYSTEM_OVER_BUDGET/,
        'system 超预算没有降级空间，必须直接报错',
    );
    console.log('[4/4] 超预算降级 OK, 截断保底 + system 超配硬失败');

    console.log('\n✅ 122-04 多轮上下文裁剪 全部断言通过');
}

runAssertions();

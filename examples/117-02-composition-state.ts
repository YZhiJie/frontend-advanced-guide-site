// 文件: examples/117-02-composition-state.ts
// 中文输入 composition 状态机：拼音中间态只落值不请求，compositionend 后去抖再搜索
// 目标：拼音字母不触发搜索、连续输入合并为一次、compositionend 与 input 不重复发请求

import assert from 'node:assert';

interface SearchOptions {
    /** 搜索去抖窗口（毫秒） */
    debounceMs: number;
    /** 过短的关键词不请求 */
    minLength: number;
}

/**
 * 搜索输入控制器。
 * 只做三件事：维护 composition 状态、记录原始值、在合适的时机产出请求。
 */
class SearchController {
    readonly requests: string[] = [];
    private composing = false;
    private raw = '';
    private lastRequested = '';
    private deadline: number | null = null;
    private now = 0;

    constructor(private readonly options: SearchOptions) {}

    compositionStart(): void {
        this.composing = true;
        this.deadline = null; // 输入法开始组词，取消此前待发的请求
    }

    /** 组词中的候选串（拼音字母），只更新展示值，不进入请求队列 */
    compositionUpdate(value: string): void {
        this.raw = value;
    }

    /** 组词结束，拿到上屏后的最终文本 */
    compositionEnd(value: string): void {
        this.composing = false;
        this.raw = value;
        this.schedule();
    }

    /** 原生 input 事件：Safari 会在 compositionend 后再补一次 isComposing=false */
    input(value: string, isComposing: boolean): void {
        if (isComposing || this.composing) {
            this.raw = value;
            return; // 拼音中间态：绝不调度请求
        }
        this.raw = value;
        this.schedule();
    }

    /** 推进时钟；到期且状态合法才真正发请求 */
    tick(now: number): void {
        this.now = now;
        if (this.deadline === null || now < this.deadline) return;
        this.deadline = null;
        if (this.composing) return;

        const query = this.raw.trim();
        if (query.length < this.options.minLength) return;
        if (query === this.lastRequested) return; // 同一关键词不重复请求
        this.lastRequested = query;
        this.requests.push(query);
    }

    get interim(): string {
        return this.raw;
    }

    private schedule(): void {
        this.deadline = this.now + this.options.debounceMs;
    }
}

function runAssertions() {
    // ---------- 测试 1：拼音中间态（nihao）不触发请求，上屏「你好」后才搜 ----------
    const c1 = new SearchController({ debounceMs: 300, minLength: 2 });
    c1.compositionStart();
    c1.compositionUpdate('nihao');
    c1.tick(100);
    c1.tick(500);
    assert.equal(c1.requests.length, 0, '拼音字母不得触发搜索');
    c1.compositionEnd('你好');
    c1.tick(700);
    c1.tick(800); // 300ms 去抖到期
    assert.deepEqual(c1.requests, ['你好']);
    console.log('[1/4] 拼音中间态不请求 OK, 请求:', c1.requests);

    // ---------- 测试 2：连续输入在去抖窗口内合并，只搜最终值 ----------
    const c2 = new SearchController({ debounceMs: 300, minLength: 2 });
    c2.input('n', false);
    c2.tick(100);
    c2.input('ni', false);
    c2.tick(250);
    assert.equal(c2.requests.length, 0, '未到去抖窗口不应请求');
    c2.tick(550); // ni 在 100ms 输入，deadline = 400ms
    assert.deepEqual(c2.requests, ['ni'], '应只搜合并后的最终值');
    console.log('[2/4] 去抖合并 OK, 请求:', c2.requests);

    // ---------- 测试 3：compositionend + 后续 input 同值，不重复发请求 ----------
    const c3 = new SearchController({ debounceMs: 300, minLength: 2 });
    c3.compositionStart();
    c3.compositionUpdate('shangd');
    c3.compositionEnd('商店');
    c3.input('商店', false); // Safari 的补发事件
    c3.tick(1000);
    assert.deepEqual(c3.requests, ['商店']);
    c3.input('商店', false);
    c3.tick(1400);
    assert.deepEqual(c3.requests, ['商店'], '同关键词再次输入不应重复请求');
    console.log('[3/4] end 后补发去重 OK, 请求次数:', c3.requests.length);

    // ---------- 测试 4：空白/过短不请求；组词期间被取消的旧请求不再补发 ----------
    const c4 = new SearchController({ debounceMs: 300, minLength: 2 });
    c4.input('a', false); // 过短
    c4.tick(400);
    assert.equal(c4.requests.length, 0, '短于 minLength 不请求');
    c4.input('ab', false);
    c4.compositionStart(); // 用户马上切输入法，取消待发请求
    c4.tick(800);
    assert.equal(c4.requests.length, 0, '组词开始应取消待发请求');
    c4.compositionEnd(' 阿布 ');
    c4.tick(1200);
    assert.deepEqual(c4.requests, ['阿布'], '应请求 trim 后的最终值');
    console.log('[4/4] 短词与取消 OK, 请求:', c4.requests);

    console.log('\n✅ 117-02 composition 状态机 全部断言通过');
}

runAssertions();

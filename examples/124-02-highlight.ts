// 文件: examples/124-02-highlight.ts
// 关键词高亮：多词/短语解析、大小写与全半角归一、HTML 转义防 XSS、围绕命中词的 fragment 截取
// 目标：归一必须保持索引 1:1；先转义原文再拼 mark；重叠命中合并；fragment 只截原文、不截标签

import assert from 'node:assert';

/**
 * 单字符归一：全角 ASCII（U+FF01~U+FF5E）与全角空格（U+3000）折到半角，再小写。
 * 逐字符处理保证归一前后长度相等——高亮区间是在归一串上找到的，必须能 1:1 切回原文。
 */
function normalizeChar(ch: string): string {
    const code = ch.codePointAt(0)!;
    if (code === 0x3000) return ' ';
    const folded = code >= 0xff01 && code <= 0xff5e ? String.fromCodePoint(code - 0xfee0) : ch;
    const lowered = folded.toLowerCase();
    // 极个别字符小写后变长（如 İ），会破坏索引对齐，保持原样放弃匹配
    return lowered.length === 1 ? lowered : folded;
}

function normalizeText(input: string): string {
    let out = '';
    for (const ch of input) out += normalizeChar(ch);
    return out;
}

interface ParsedQuery {
    /** 双引号包裹的整体匹配，如 "搜索引擎" */
    phrases: string[];
    /** 空格分隔的单词 */
    terms: string[];
}

function parseQuery(raw: string): ParsedQuery {
    const phrases: string[] = [];
    const rest = raw.replace(/"([^"]*)"/g, (_all, inner: string) => {
        const phrase = normalizeText(inner.trim());
        if (phrase.length > 0) phrases.push(phrase);
        return ' ';
    });
    const terms = rest
        .split(/\s+/)
        .map(normalizeText)
        .filter((term) => term.length > 0);
    return { phrases, terms };
}

/** 半开区间 [start, end)，基于原串索引 */
interface Range {
    start: number;
    end: number;
}

/** 在归一化文本上找全部命中区间；归一保持索引 1:1，区间可直接回切原文 */
function findRanges(text: string, parsed: ParsedQuery): Range[] {
    const haystack = normalizeText(text);
    // 长词优先：短语先占位，单词的重复命中交给合并消除
    const needles = [...parsed.phrases, ...parsed.terms].sort((a, b) => b.length - a.length);
    const ranges: Range[] = [];
    for (const needle of needles) {
        let from = 0;
        while (from + needle.length <= haystack.length) {
            const hit = haystack.indexOf(needle, from);
            if (hit === -1) break;
            ranges.push({ start: hit, end: hit + needle.length });
            from = hit + needle.length; // 不自重叠：'aaa' 里 'aa' 只命中一次
        }
    }
    return mergeRanges(ranges);
}

/** 排序后扫描合并重叠/相邻重叠区间，避免 mark 嵌套 */
function mergeRanges(ranges: Range[]): Range[] {
    const sorted = [...ranges].sort((a, b) => a.start - b.start || b.end - a.end);
    const merged: Range[] = [];
    for (const range of sorted) {
        const last = merged[merged.length - 1];
        if (last !== undefined && range.start <= last.end) {
            last.end = Math.max(last.end, range.end);
        } else {
            merged.push({ ...range });
        }
    }
    return merged;
}

function escapeHtml(input: string): string {
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * 安全高亮：只转义原文片段，mark 标签由我们亲手拼接。
 * 顺序是防 XSS 的关键——原文里的 <script> 永远以文本形态进入 HTML。
 */
function highlight(text: string, rawQuery: string): string {
    const ranges = findRanges(text, parseQuery(rawQuery));
    let out = '';
    let cursor = 0;
    for (const range of ranges) {
        out += escapeHtml(text.slice(cursor, range.start));
        out += `<mark>${escapeHtml(text.slice(range.start, range.end))}</mark>`;
        cursor = range.end;
    }
    out += escapeHtml(text.slice(cursor));
    return out;
}

/**
 * 围绕首个命中截取上下文 fragment。
 * 先在原文上截、再对截出的片段高亮：绝不切断转义序列或标签。
 */
function fragment(text: string, rawQuery: string, contextChars = 20): string {
    const ranges = findRanges(text, parseQuery(rawQuery));
    if (ranges.length === 0) {
        const head = text.slice(0, contextChars * 2);
        return escapeHtml(head) + (text.length > contextChars * 2 ? '…' : '');
    }
    const first = ranges[0];
    const start = Math.max(0, first.start - contextChars);
    const end = Math.min(text.length, first.end + contextChars);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < text.length ? '…' : '';

    let body = '';
    let cursor = start;
    for (const range of ranges) {
        if (range.start >= end) break; // 窗口外的命中交给下一条结果
        body += escapeHtml(text.slice(cursor, range.start));
        body += `<mark>${escapeHtml(text.slice(range.start, range.end))}</mark>`;
        cursor = range.end;
    }
    body += escapeHtml(text.slice(cursor, end));
    return prefix + body + suffix;
}

async function runAssertions(): Promise<void> {
    // ---------- 测试 1：归一——全半角、大小写、全角空格，索引保持 1:1 ----------
    assert.equal(normalizeText('Ｅｌａｓｔｉｃ　Ｓｅａｒｃｈ'), 'elastic search');
    assert.equal(normalizeText('ＡＢＣ１２３！'), 'abc123!');
    const mixed = 'Ｅｌａｓｔｉｃ 搜索引擎 V2';
    assert.equal(normalizeText(mixed).length, mixed.length, '归一必须保持索引 1:1');

    const html1 = highlight('Ｅｌａｓｔｉｃ 搜索引擎实战', 'elastic');
    assert.equal(html1, '<mark>Ｅｌａｓｔｉｃ</mark> 搜索引擎实战', '全角输入应命中半角查询');

    const parsed = parseQuery('"搜索引擎"  分词');
    assert.deepEqual(parsed.phrases, ['搜索引擎']);
    assert.deepEqual(parsed.terms, ['分词']);
    console.log('[1/4] 归一与查询解析 OK, 全角/大小写命中且索引对齐');

    // ---------- 测试 2：XSS 安全——原文先转义，mark 是唯一裸标签 ----------
    const xss = highlight('警惕 <script>alert("x")</script> 注入', 'script');
    assert.ok(!xss.includes('<script>'), '原文中的脚本标签必须被转义');
    assert.ok(xss.includes('&lt;<mark>script</mark>&gt;'), '尖括号转义在外，mark 只包命中词');
    assert.ok(xss.includes('&quot;x&quot;'), '属性注入面也要堵死');

    const onlyMark = highlight('普通文本', '');
    assert.equal(onlyMark, '普通文本', '空查询不产生任何标签');
    console.log('[2/4] XSS 防护 OK, <script> 以转义文本形态进入结果');

    // ---------- 测试 3：多词/短语与区间合并——短语占位，重叠不嵌套 ----------
    const mergedHtml = highlight('搜索引擎与搜索框设计', '"搜索引擎" 搜索');
    assert.equal(
        mergedHtml,
        '<mark>搜索引擎</mark>与<mark>搜索</mark>框设计',
        '短语与单词的重叠命中必须合并为一个 mark',
    );

    const selfOverlap = highlight('aaa', 'aa');
    assert.equal(selfOverlap, '<mark>aa</mark>a', '同一词不允许自重叠命中');

    const ranges = findRanges('搜索引擎与搜索框设计', parseQuery('"搜索引擎" 搜索'));
    assert.deepEqual(ranges, [
        { start: 0, end: 4 },
        { start: 5, end: 7 },
    ]);
    console.log('[3/4] 多词/短语合并 OK, 重叠区间合并为 2 个 mark');

    // ---------- 测试 4：fragment 截取——围绕命中词取上下文，省略号只加在截断处 ----------
    const longText =
        '知识管理平台的检索链路始于前端搜索框，经过 BFF 查询改写后进入 Elasticsearch 集群，' +
        '召回结果按相关度排序返回，前端再负责高亮与分页渲染。';
    const snip = fragment(longText, 'Elasticsearch', 10);
    assert.ok(snip.startsWith('…'), '前文被截断必须有前省略号');
    assert.ok(snip.endsWith('…'), '后文被截断必须有后省略号');
    assert.ok(snip.includes('<mark>Elasticsearch</mark>'), '命中词完整保留在窗口内');

    const headHit = fragment('搜索框是状态机不是输入框，其余文字', '搜索框', 5);
    assert.ok(!headHit.startsWith('…'), '开头命中不加前省略号');

    const noHit = fragment('abcdefghijklmnopqrstuvwxyz0123456789', '找不到', 5);
    assert.equal(noHit, 'abcdefghij…', '零命中退化为开头截取');
    console.log('[4/4] fragment 截取 OK, 上下文窗口与省略号边界正确');

    console.log('\n✅ 124-02 关键词高亮 全部断言通过');
}

void runAssertions();

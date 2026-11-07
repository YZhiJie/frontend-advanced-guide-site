// 文件: examples/122-03-incremental-markdown.ts
// 增量 Markdown 渲染：按块拆分、稳定块只渲染一次、未闭合块容错、XSS 白名单转义
// 目标：流式期间只复算尾部脏块；未闭合代码块/表格不崩且可继续生长；任何原始 HTML 都进不了输出

import assert from 'node:assert';

type BlockKind = 'paragraph' | 'heading' | 'code' | 'table';

interface MdBlock {
    kind: BlockKind;
    raw: string;
    /** false = 这个块还可能被后续 delta 继续生长（通常只有尾部块） */
    closed: boolean;
}

/** 转义是一切渲染的第一步：宁可错杀标签，不可放行原始 HTML */
function escapeHtml(input: string): string {
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** 行内元素白名单：在转义后的文本上生成，永远不可能引入新标签 */
function renderInline(escaped: string): string {
    return escaped
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function parseRow(line: string): string[] {
    const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    return trimmed.split('|').map((cell) => cell.trim());
}

/** 把累计文本切成块：空行是段落边界；``` 围栏与连续的 | 行单独成块 */
function splitBlocks(text: string): MdBlock[] {
    const lines = text.split('\n');
    const blocks: MdBlock[] = [];
    let para: string[] = [];

    const flushPara = (closed: boolean): void => {
        if (para.length === 0) return;
        const raw = para.join('\n');
        para = [];
        const kind: BlockKind = /^#{1,6}\s/.test(raw) ? 'heading' : 'paragraph';
        blocks.push({ kind, raw, closed });
    };

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (line.startsWith('```')) {
            flushPara(true);
            const buf = [line];
            i++;
            let closed = false;
            while (i < lines.length) {
                buf.push(lines[i]);
                if (lines[i].startsWith('```')) {
                    closed = true;
                    i++;
                    break;
                }
                i++;
            }
            blocks.push({ kind: 'code', raw: buf.join('\n'), closed });
            continue;
        }
        if (line.trim().startsWith('|')) {
            flushPara(true);
            const buf: string[] = [];
            while (i < lines.length && lines[i].trim().startsWith('|')) {
                buf.push(lines[i]);
                i++;
            }
            const rows = buf.map(parseRow);
            // 结构完整 = 至少两行且第二行是分隔行；否则按未闭合容错
            const hasSep = rows.length >= 2 && rows[1].every((cell) => /^:?-+:?$/.test(cell));
            blocks.push({ kind: 'table', raw: buf.join('\n'), closed: hasSep });
            continue;
        }
        if (line.trim() === '') {
            flushPara(true);
            i++;
            continue;
        }
        para.push(line);
        i++;
    }
    flushPara(false); // 尾部段落：流可能还没写完
    return blocks;
}

function renderBlock(block: MdBlock): string {
    switch (block.kind) {
        case 'heading': {
            const level = block.raw.match(/^#+/)![0].length;
            const body = renderInline(escapeHtml(block.raw.replace(/^#+\s*/, '')));
            return `<h${level}>${body}</h${level}>`;
        }
        case 'code': {
            const lines = block.raw.split('\n');
            const lang = lines[0].slice(3).trim() || 'plain';
            // 未闭合围栏：把已收到的行当代码先渲染，闭合帧到达后整块复算
            const bodyLines = block.closed ? lines.slice(1, -1) : lines.slice(1);
            return `<pre data-closed="${block.closed}"><code class="lang-${lang}">${escapeHtml(bodyLines.join('\n'))}</code></pre>`;
        }
        case 'table': {
            if (!block.closed) {
                // 分隔行未收齐：按纯文本展示，绝不渲染半个 table
                return `<p class="table-pending">${escapeHtml(block.raw)}</p>`;
            }
            const rows = block.raw.split('\n').map(parseRow);
            const head = rows[0];
            const th = head.map((cell) => `<th>${renderInline(escapeHtml(cell))}</th>`).join('');
            const trs = rows
                .slice(2)
                .map((row) => {
                    // 流式期间行可能缺列：统一补齐/裁齐到表头宽度
                    const cells = Array.from({ length: head.length }, (_, c) => row[c] ?? '');
                    return `<tr>${cells.map((cell) => `<td>${renderInline(escapeHtml(cell))}</td>`).join('')}</tr>`;
                })
                .join('');
            return `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
        }
        case 'paragraph':
        default:
            return `<p>${renderInline(escapeHtml(block.raw))}</p>`;
    }
}

/** 增量渲染器：按块缓存，稳定块命中缓存零复算，只有尾部脏块真正重渲染 */
class IncrementalMarkdown {
    private text = '';
    private readonly cache = new Map<string, string>();
    /** 实际调用 renderBlock 的次数，用来证明"按块复算"而不是全文复算 */
    renderCount = 0;

    push(delta: string): string {
        this.text += delta;
        const blocks = splitBlocks(this.text);
        const html: string[] = [];
        for (const block of blocks) {
            const key = `${block.kind}|${block.closed}|${block.raw}`;
            const hit = this.cache.get(key);
            if (hit !== undefined) {
                html.push(hit);
                continue;
            }
            const rendered = renderBlock(block);
            this.cache.set(key, rendered);
            this.renderCount++;
            html.push(rendered);
        }
        return html.join('\n');
    }

    get blockCount(): number {
        return splitBlocks(this.text).length;
    }
}

function runAssertions(): void {
    // ---------- 测试 1：XSS 白名单——原始 HTML 一律转义，白名单行内格式生效 ----------
    const xss = new IncrementalMarkdown();
    const html1 = xss.push('<script>alert(1)</script> 与 **加粗** 和 `code`');
    assert.ok(!html1.includes('<script>'), '原始 <script> 绝不能进入输出');
    assert.ok(html1.includes('&lt;script&gt;'), '脚本标签必须被实体转义');
    assert.ok(html1.includes('<strong>加粗</strong>'));
    assert.ok(html1.includes('<code>code</code>'));
    const img = new IncrementalMarkdown().push('<img src=x onerror="alert(1)">');
    assert.ok(!img.includes('<img'), 'onerror 属性注入同样被转义封死');
    console.log('[1/4] XSS 白名单 OK, 原始 HTML 全部被转义');

    // ---------- 测试 2：未闭合代码块容错——先渲染已收部分，闭合帧到达后复算 ----------
    const code = new IncrementalMarkdown();
    const open = code.push('# 示例\n\n```ts\nconst a = 1;');
    assert.ok(open.includes('<h1>示例</h1>'));
    assert.ok(open.includes('data-closed="false"'), '未闭合围栏也必须可渲染');
    assert.ok(open.includes('const a = 1;'));
    const closedHtml = code.push('\nconsole.log(a);\n```\n\n收工');
    assert.ok(closedHtml.includes('data-closed="true"'));
    assert.ok(closedHtml.includes('console.log(a);'), '闭合后内容完整');
    assert.ok(closedHtml.includes('<p>收工</p>'));
    console.log('[2/4] 未闭合代码块 OK, 先渲染后复算不丢内容');

    // ---------- 测试 3：按块复算——稳定块零复算，只有尾部脏块重新渲染 ----------
    const inc = new IncrementalMarkdown();
    inc.push('第一段，先写完。'); // 1 块 → 渲染 1 次
    inc.push('\n\n第二段'); // 第一段 closed 翻转复算 + 新尾块 = 2 次
    const stableHtml = inc.push('的开头。'); // 仅尾块 = 1 次
    inc.push('继续生长。'); // 仅尾块 = 1 次
    const finalHtml = inc.push('\n\n第三段完。'); // 第二段 closed 翻转 + 新尾块 = 2 次
    assert.equal(inc.renderCount, 7, `按块复算应恰好渲染 7 次，实际 ${inc.renderCount} 次`);
    // 若每次 push 全文复算：1 + 2 + 2 + 2 + 3 = 10 次
    assert.ok(inc.renderCount < 10, '必须少于全文复算的 10 次');
    assert.equal(inc.blockCount, 3);
    assert.ok(stableHtml.startsWith('<p>第一段，先写完。</p>'));
    assert.ok(finalHtml.startsWith('<p>第一段，先写完。</p>'), '稳定块 HTML 在后续推送中原样保留');
    assert.ok(finalHtml.includes('继续生长。') && finalHtml.includes('<p>第三段完。</p>'));
    console.log('[3/4] 按块复算 OK, 渲染 7 次 < 全文复算 10 次');

    // ---------- 测试 4：表格容错——分隔行未到按文本展示，缺列行补齐 ----------
    const table = new IncrementalMarkdown();
    const headOnly = table.push('| 指标 | 数值 |');
    assert.ok(!headOnly.includes('<table>'), '只有表头不渲染 table');
    assert.ok(headOnly.includes('table-pending'), '未闭合表格降级为纯文本');
    const grown = table.push('\n| --- | --- |\n| 营收 | 12 |\n| 缺列行 |\n\n表格后的段落。');
    assert.ok(grown.includes('<table>'));
    assert.ok(grown.includes('<th>指标</th>') && grown.includes('<th>数值</th>'));
    const tdCount = (grown.match(/<td>/g) ?? []).length;
    assert.equal(tdCount, 4, '两行数据 × 两列 = 4 个单元格，缺列行必须补齐');
    assert.ok(grown.includes('<p>表格后的段落。</p>'));
    console.log('[4/4] 表格容错 OK, 缺列行补齐到表头宽度');

    console.log('\n✅ 122-03 增量 Markdown 渲染 全部断言通过');
}

runAssertions();

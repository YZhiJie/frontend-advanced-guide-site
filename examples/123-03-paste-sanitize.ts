// 文件: examples/123-03-paste-sanitize.ts
// 粘贴 HTML 清洗：迷你 tokenizer + 标签/属性双白名单 + style 黑名单 + 危险协议拦截 + Word 垃圾剥离
// 目标：script/style 连同内容去除；on* 事件属性与 javascript:/data: 协议拦截；mso-* 与条件注释剥离；
//       输出只含白名单结构，未闭合标签自动补齐，文本一律转义
// 说明：浏览器里应优先 DOMParser + 遍历，这里用纯 TS 手写 tokenizer 保证确定性、可单测

import assert from 'node:assert';

type Token =
    | { kind: 'text'; value: string }
    | { kind: 'open'; name: string; attrs: Record<string, string>; selfClose: boolean }
    | { kind: 'close'; name: string };

/** 迷你 HTML tokenizer：识别注释、开/闭标签与文本；残缺的 '<' 按文本处理 */
function tokenize(html: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    while (i < html.length) {
        if (html.startsWith('<!--', i)) {
            const end = html.indexOf('-->', i + 4);
            i = end === -1 ? html.length : end + 3; // 注释整体丢弃（含 Word 条件注释）
            continue;
        }
        if (html[i] === '<') {
            const gt = html.indexOf('>', i + 1);
            if (gt === -1) {
                tokens.push({ kind: 'text', value: html.slice(i) });
                break;
            }
            const raw = html.slice(i + 1, gt);
            const close = raw.match(/^\/\s*([a-zA-Z][a-zA-Z0-9:]*)\s*$/);
            if (close) {
                tokens.push({ kind: 'close', name: close[1].toLowerCase() });
                i = gt + 1;
                continue;
            }
            const open = raw.match(/^([a-zA-Z][a-zA-Z0-9:]*)([\s\S]*?)(\/?)$/);
            if (open) {
                tokens.push({ kind: 'open', name: open[1].toLowerCase(), attrs: parseAttrs(open[2]), selfClose: open[3] === '/' });
                i = gt + 1;
                continue;
            }
            tokens.push({ kind: 'text', value: '<' });
            i += 1;
            continue;
        }
        const lt = html.indexOf('<', i);
        const end = lt === -1 ? html.length : lt;
        tokens.push({ kind: 'text', value: html.slice(i, end) });
        i = end;
    }
    return tokens;
}

/** 解析属性串：支持双引号、单引号与无引号三种取值形式 */
function parseAttrs(raw: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const re = /([a-zA-Z-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
        attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
    }
    return attrs;
}

const ALLOWED_TAGS = new Set([
    'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'a', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'h1', 'h2', 'h3', 'img',
]);

/** 连同内容一起丢弃的标签：脚本、样式与 Word 私有容器 */
const DROP_WITH_CONTENT = new Set(['script', 'style', 'head', 'xml', 'title', 'o:p']);

const VOID_TAGS = new Set(['br', 'img']);

/** 属性白名单按标签声明，其余一律丢弃（class、on 开头的事件属性、colspan 等） */
const ATTR_ALLOW: Record<string, ReadonlySet<string>> = {
    a: new Set(['href']),
    img: new Set(['src', 'alt']),
};

/** style 黑名单：布局劫持与浏览器私有执行入口；mso-* 单独按前缀剥离 */
const STYLE_BLOCKLIST = new Set(['position', 'z-index', 'behavior', '-moz-binding']);

/** 相邻同标签隐式闭合：<li>一<li>二 中的第二个 li 先闭合前一个 */
const IMPLIED_END: Record<string, readonly string[]> = { li: ['li'], p: ['p'] };

function sanitizeStyle(raw: string): string | null {
    const kept: string[] = [];
    for (const decl of raw.split(';')) {
        const idx = decl.indexOf(':');
        if (idx === -1) continue;
        const prop = decl.slice(0, idx).trim().toLowerCase();
        const value = decl.slice(idx + 1).trim();
        if (prop === '' || prop.startsWith('mso-')) continue; // Word 私有属性
        if (STYLE_BLOCKLIST.has(prop)) continue; // 布局劫持类属性
        if (/expression\s*\(|javascript:|vbscript:/i.test(value)) continue; // 旧 IE 表达式与伪协议
        kept.push(`${prop}: ${value}`);
    }
    return kept.length > 0 ? kept.join('; ') : null;
}

/** 先剥离空白与控制符再判协议，防 'java\tscript:' 这类绕过 */
function sanitizeUrl(url: string): string | null {
    const compact = url.replace(/[\u0000-\u0020]+/g, '');
    if (/^(javascript|vbscript|data):/i.test(compact)) return null;
    return compact;
}

function escapeText(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(text: string): string {
    return escapeText(text).replace(/"/g, '&quot;');
}

function sanitizeAttrs(tag: string, attrs: Record<string, string>): string {
    const allow = ATTR_ALLOW[tag] ?? new Set<string>();
    const pairs: string[] = [];
    for (const [name, value] of Object.entries(attrs)) {
        if (name === 'style') {
            const cleaned = sanitizeStyle(value);
            if (cleaned !== null) pairs.push(`style="${escapeAttr(cleaned)}"`);
            continue;
        }
        if (!allow.has(name)) continue;
        if (name === 'href' || name === 'src') {
            const safe = sanitizeUrl(value);
            if (safe === null) continue; // 危险协议：属性整体丢弃，标签保留
            pairs.push(`${name}="${escapeAttr(safe)}"`);
            continue;
        }
        pairs.push(`${name}="${escapeAttr(value)}"`);
    }
    return pairs.length > 0 ? ' ' + pairs.join(' ') : '';
}

function sanitize(html: string): string {
    const out: string[] = [];
    const stack: string[] = [];
    let dropping = 0; // 位于「连内容丢弃」标签内的深度
    for (const token of tokenize(html)) {
        if (token.kind === 'text') {
            if (dropping === 0) out.push(escapeText(token.value));
            continue;
        }
        if (DROP_WITH_CONTENT.has(token.name)) {
            if (token.kind === 'open') dropping += 1;
            else if (dropping > 0) dropping -= 1;
            continue;
        }
        if (dropping > 0) continue;
        if (token.kind === 'open') {
            if (!ALLOWED_TAGS.has(token.name)) continue; // 不在白名单：剥壳，保留内部文本
            const top = stack[stack.length - 1];
            if (top !== undefined && (IMPLIED_END[token.name] ?? []).includes(top)) {
                out.push(`</${stack.pop()!}>`);
            }
            const attrs = sanitizeAttrs(token.name, token.attrs);
            if (VOID_TAGS.has(token.name) || token.selfClose) {
                out.push(`<${token.name}${attrs}/>`);
            } else {
                out.push(`<${token.name}${attrs}>`);
                stack.push(token.name);
            }
            continue;
        }
        // close：只闭合仍在栈内的同名标签，顺带闭合它之上的标签
        const idx = stack.lastIndexOf(token.name);
        if (idx === -1) continue;
        while (stack.length > idx) out.push(`</${stack.pop()!}>`);
    }
    while (stack.length > 0) out.push(`</${stack.pop()!}>`); // 未闭合标签自动补齐
    return out.join('');
}

function runAssertions(): void {
    // ---------- 测试 1：标签白名单与内容级丢弃 ----------
    assert.equal(sanitize('<p>正常<b>加粗</b></p>'), '<p>正常<b>加粗</b></p>');
    assert.equal(sanitize('<div><marquee>跑马灯</marquee></div>'), '跑马灯', '非白名单标签剥壳、保留文本');
    assert.equal(sanitize('<script>alert(1)</script><p>x</p>'), '<p>x</p>', 'script 连内容丢弃');
    assert.equal(sanitize('<style>.a{color:red}</style>正文'), '正文', 'style 连内容丢弃');
    assert.equal(sanitize('<b>bold'), '<b>bold</b>', '未闭合标签自动补齐');
    assert.equal(sanitize('<b><i>x</b>'), '<b><i>x</i></b>', '交叉标签按栈序修补');
    console.log('[1/4] 标签白名单 OK, script/style 内容级丢弃');

    // ---------- 测试 2：属性白名单与危险协议拦截 ----------
    assert.equal(
        sanitize('<a href="https://a.com" onclick="hack()" class="x">链接</a>'),
        '<a href="https://a.com">链接</a>',
        'onclick/class 一律丢弃',
    );
    assert.equal(sanitize('<a href="javascript:alert(1)">x</a>'), '<a>x</a>', 'javascript: 拦截');
    assert.equal(sanitize('<a href="java\tscript:alert(1)">x</a>'), '<a>x</a>', '控制符绕过的 javascript: 同样拦截');
    assert.equal(sanitize('<a href="mailto:a@b.com">m</a>'), '<a href="mailto:a@b.com">m</a>');
    assert.equal(
        sanitize('<img src="data:text/html;base64,PHN2Zz4=" alt="图"/>'),
        '<img alt="图"/>',
        'data: 协议拦截（图片应走占位上传）',
    );
    assert.equal(sanitize('<img src="https://a.com/x.png" alt="图"/>'), '<img src="https://a.com/x.png" alt="图"/>');
    console.log('[2/4] 属性白名单与协议拦截 OK');

    // ---------- 测试 3：style 黑名单与 Word 垃圾剥离 ----------
    const dirty = '<p style="color: red; position: fixed; left: expression(alert(1)); behavior: url(#x); background: url(javascript:x)">t</p>';
    assert.equal(sanitize(dirty), '<p style="color: red">t</p>', 'position/behavior 黑名单 + expression/javascript: 值拦截');

    const word = [
        '<!--[if gte mso 9]><xml><w:WordDocument></w:WordDocument></xml><![endif]-->',
        '<p class="MsoNormal" style="mso-margin-top-alt:auto;color:#1F2329"><span>季度</span><o:p>&nbsp;</o:p></p>',
    ].join('');
    assert.equal(
        sanitize(word),
        '<p style="color: #1F2329">季度</p>',
        '条件注释/Mso 类名/mso-* 属性/o:p 全部剥离',
    );
    console.log('[3/4] style 黑名单与 Word 垃圾剥离 OK');

    // ---------- 测试 4：文本转义、属性转义与结构修补 ----------
    assert.equal(sanitize('1 < 2 & 3 > 2'), '1 &lt; 2 &amp; 3 &gt; 2', '文本中的 < & > 必须转义');
    assert.equal(
        sanitize("<a href='https://a.com/?q=\"x\"'>y</a>"),
        '<a href="https://a.com/?q=&quot;x&quot;">y</a>',
        '属性值中的引号必须转义',
    );
    assert.equal(sanitize('<ul><li>一<li>二</ul>'), '<ul><li>一</li><li>二</li></ul>', '相邻 li 隐式闭合');
    assert.equal(sanitize('<script>alert(1)</script>'), '', '纯脚本粘贴清洗后为空');
    console.log('[4/4] 文本转义与结构修补 OK');

    console.log('\n✅ 123-03 粘贴清洗 全部断言通过');
}

runAssertions();

// 文件: examples/115-01-icu-plural-currency.ts
// ICU 复数消息 + 货币格式化：按 locale 选择复数形态、字符串精确换算最小货币单位
// 目标：复数不是 n===1 的二元判断；金额必须以最小单位整数流转，舍入策略显式化

import assert from 'node:assert';

type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

const PLURAL_RULES: Record<string, (n: number) => PluralCategory> = {
    en: (n) => (n === 1 ? 'one' : 'other'),
    // 法语 0 和 1 都算 one（CLDR 规则，和英语最大的差异之一）
    fr: (n) => (n === 0 || n === 1 ? 'one' : 'other'),
    // 俄语：1/21 → one；2-4/22-24 → few；5-20/11-14 → many
    ru: (n) => {
        const mod10 = n % 10;
        const mod100 = n % 100;
        if (mod10 === 1 && mod100 !== 11) return 'one';
        if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 'few';
        if (mod10 === 0 || (mod10 >= 5 && mod10 <= 9) || (mod100 >= 11 && mod100 <= 14)) return 'many';
        return 'other';
    },
    // 阿拉伯语有 six 个形态：0 / 1 / 2 / 3-10 / 11-99 / 100+
    ar: (n) => {
        if (n === 0) return 'zero';
        if (n === 1) return 'one';
        if (n === 2) return 'two';
        if (n >= 3 && n <= 10) return 'few';
        if (n >= 11 && n <= 99) return 'many';
        return 'other';
    },
    ja: () => 'other', // 中日韩无复数变化
    zh: () => 'other',
};

function selectPlural(locale: string, n: number): PluralCategory {
    const lang = locale.split('-')[0];
    return (PLURAL_RULES[lang] ?? PLURAL_RULES.en)(Math.abs(n));
}

/** 取 `{` 对应的 `}`，支持嵌套（plural 分支体里可能还有占位符） */
function findClosing(text: string, openIndex: number): number {
    let depth = 0;
    for (let i = openIndex; i < text.length; i++) {
        if (text[i] === '{') depth++;
        if (text[i] === '}') {
            depth--;
            if (depth === 0) return i;
        }
    }
    throw new Error(`未闭合的占位符: ${text}`);
}

/** 只实现 plural 子集：{count, plural, =0 {...} one {...} other {...}}，分支体支持 # 与 {name} */
function renderMessage(template: string, locale: string, vars: Record<string, string | number>): string {
    let out = '';
    let i = 0;
    while (i < template.length) {
        const ch = template[i];
        if (ch === '{') {
            const close = findClosing(template, i);
            const inner = template.slice(i + 1, close);
            const firstComma = inner.indexOf(',');
            const name = inner.slice(0, firstComma).trim();
            const rest = inner.slice(firstComma + 1).trim();
            const secondComma = rest.indexOf(',');
            const type = rest.slice(0, secondComma).trim();
            if (type === 'plural') {
                const n = Number(vars[name]);
                const options = rest.slice(secondComma + 1).trim();
                out += renderPlural(options, locale, n, vars);
            } else {
                out += String(vars[name]);
            }
            i = close + 1;
            continue;
        }
        out += ch;
        i++;
    }
    return out;
}

function renderPlural(options: string, locale: string, n: number, vars: Record<string, string | number>): string {
    const branches = new Map<string, string>();
    let i = 0;
    while (i < options.length) {
        while (i < options.length && /\s/.test(options[i])) i++;
        let key = '';
        while (i < options.length && !/\s/.test(options[i]) && options[i] !== '{') key += options[i++];
        while (i < options.length && /\s/.test(options[i])) i++;
        if (options[i] !== '{') throw new Error(`plural 分支缺少消息体: ${key}`);
        const close = findClosing(options, i);
        branches.set(key.trim(), options.slice(i + 1, close));
        i = close + 1;
    }
    const exact = branches.get(`=${n}`);
    const body = exact ?? branches.get(selectPlural(locale, n)) ?? branches.get('other');
    if (body === undefined) throw new Error(`复数消息缺少 other 分支`);
    return body.replace(/#/g, String(n)).replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key]));
}

/** 最小货币单位位数：JPY/KRW 为 0，KWD/BHD 为 3，其余主流货币为 2 */
const MINOR_EXPONENT: Record<string, number> = {
    JPY: 0, KRW: 0, VND: 0, CLP: 0,
    KWD: 3, BHD: 3, OMR: 3,
    USD: 2, EUR: 2, GBP: 2, CNY: 2,
};

type Rounding = 'half-up' | 'half-even';

/** 把十进制字符串精确转成最小单位整数；不经过浮点乘法，避免 19.99*100=1998.999… */
function toMinorUnits(amount: string, currency: string, rounding: Rounding = 'half-up'): number {
    const exponent = MINOR_EXPONENT[currency] ?? 2;
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(amount.trim());
    if (!match) throw new Error(`非法金额: ${amount}`);
    const sign = match[1] === '-' ? -1 : 1;
    const fraction = match[3] ?? '';
    const kept = fraction.slice(0, exponent).padEnd(exponent, '0');
    let value = Number(match[2] + kept);
    const dropped = fraction.slice(exponent);
    if (dropped.length > 0) {
        const first = dropped[0];
        const restNonZero = /[1-9]/.test(dropped.slice(1));
        let roundUp = false;
        if (first > '5' || (first === '5' && restNonZero)) roundUp = true;
        else if (first === '5') {
            // 恰好一半：half-up 远离零，half-even 向偶数舍入（银行家舍入）
            roundUp = rounding === 'half-up' || value % 2 === 1;
        }
        if (roundUp) value += 1;
    }
    const negative = sign === -1;
    return negative ? -value : value;
}

function fromMinorUnits(minor: number, currency: string): number {
    return minor / 10 ** (MINOR_EXPONENT[currency] ?? 2);
}

function formatCurrency(minor: number, locale: string, currency: string): string {
    return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: MINOR_EXPONENT[currency] ?? 2,
        maximumFractionDigits: MINOR_EXPONENT[currency] ?? 2,
    }).format(fromMinorUnits(minor, currency));
}

function runAssertions() {
    // ---------- 测试 1：复数形态按 locale 选择，俄语/阿拉伯语不能退化成 n===1 ----------
    assert.equal(selectPlural('en', 1), 'one');
    assert.equal(selectPlural('en-US', 2), 'other');
    assert.equal(selectPlural('ru', 1), 'one');
    assert.equal(selectPlural('ru', 2), 'few');
    assert.equal(selectPlural('ru', 5), 'many');
    assert.equal(selectPlural('ru', 11), 'many');
    assert.equal(selectPlural('ru', 21), 'one');
    assert.equal(selectPlural('ar', 0), 'zero');
    assert.equal(selectPlural('ar', 2), 'two');
    assert.equal(selectPlural('ar', 11), 'many');
    assert.equal(selectPlural('ja-JP', 5), 'other');
    console.log('[1/4] 复数形态 OK, ru 2=', selectPlural('ru', 2), 'ar 11=', selectPlural('ar', 11));

    // ---------- 测试 2：ICU 渲染——=0 精确分支优先，其余走复数规则，# 替换为数字 ----------
    const en = '{count, plural, =0 {No items} one {# item} other {# items}}';
    assert.equal(renderMessage(en, 'en', { count: 0 }), 'No items');
    assert.equal(renderMessage(en, 'en-US', { count: 1 }), '1 item');
    assert.equal(renderMessage(en, 'en-GB', { count: 5 }), '5 items');
    const ru = '{count, plural, one {# товар} few {# товара} many {# товаров} other {# товара}}';
    assert.equal(renderMessage(ru, 'ru', { count: 2 }), '2 товара');
    assert.equal(renderMessage(ru, 'ru', { count: 5 }), '5 товаров');
    const ar = '{count, plural, zero {لا عناصر} two {عنصران} other {# عنصر}}';
    assert.equal(renderMessage(ar, 'ar', { count: 0 }), 'لا عناصر');
    assert.equal(renderMessage(ar, 'ar', { count: 2 }), 'عنصران');
    console.log('[2/4] ICU 渲染 OK, ru 5 →', renderMessage(ru, 'ru', { count: 5 }));

    // ---------- 测试 3：十进制字符串 → 最小单位，两种舍入策略结果可区分 ----------
    assert.equal(toMinorUnits('19.99', 'USD'), 1999);
    assert.equal(toMinorUnits('1.005', 'USD', 'half-up'), 101);
    assert.equal(toMinorUnits('1.005', 'USD', 'half-even'), 100, '100 是偶数，5 应舍去');
    assert.equal(toMinorUnits('1000.5', 'JPY', 'half-up'), 1001);
    assert.equal(toMinorUnits('1000.5', 'JPY', 'half-even'), 1000);
    assert.equal(toMinorUnits('1.234', 'KWD'), 1234, '三位小数货币不能按两位截断');
    assert.equal(toMinorUnits('0.999', 'USD'), 100, '0.999 应进位到 1.00');
    assert.equal(toMinorUnits('-0.005', 'USD', 'half-up'), -1);
    console.log('[3/4] 最小单位换算 OK, 1.005 half-even =', toMinorUnits('1.005', 'USD', 'half-even'));

    // ---------- 测试 4：Intl 货币格式化——小数点/千分位/小数位随 locale 变化 ----------
    const usd = formatCurrency(123456, 'en-US', 'USD').replace(/\u00a0/g, ' ');
    assert.ok(usd.includes('1,234.56'), `en-US 输出异常: ${usd}`);
    const eurParts = new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: 'EUR',
    }).formatToParts(fromMinorUnits(123456, 'EUR'));
    assert.equal(eurParts.find((p) => p.type === 'group')?.value, '.', '德语千分位是点');
    assert.equal(eurParts.find((p) => p.type === 'decimal')?.value, ',', '德语小数点是逗号');
    assert.equal(eurParts.filter((p) => p.type === 'fraction').map((p) => p.value).join(''), '56');
    const jpyParts = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).formatToParts(1000);
    assert.equal(jpyParts.some((p) => p.type === 'fraction'), false, '日元没有小数位');
    console.log('[4/4] 货币格式化 OK, en-US:', usd);

    console.log('\n✅ 115-01 ICU 复数与货币格式化 全部断言通过');
}

runAssertions();

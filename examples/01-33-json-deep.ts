// 文件: examples/01-33-json-deep.ts
// ============ JSON 序列化深入:replacer / toJSON / reviver / 深拷贝局限 / ES2026 rawJSON ============
// 运行:npx tsx examples/01-33-json-deep.ts

export {};

const G = globalThis as any;
const log = (title: string) => console.log(`\n---- ${title} ----`);

const user = {
    id: 1,
    name: '阿黄',
    password: '不应出现在响应中的敏感字段',
    profile: { age: 28, city: '杭州' },
    say() {}, // 函数
    nothing: undefined, // undefined
    [Symbol('s')]: 'symbol 键',
};

// ============ 1. stringify 第二参数:replacer 白名单 ============
log('1. replacer:数组白名单(适合 API 响应字段裁剪)');

// 数组形式:只序列化列出的键;嵌套字段(如 profile.age)也要把字段名写进白名单
console.log(JSON.stringify(user, ['id', 'name', 'profile', 'age'], 2));

log('2. replacer:函数(可脱敏/可转换)');

// 函数形式:(key, value) => ... 返回 undefined 表示"丢弃这个键"
const safeJson = JSON.stringify(
    user,
    (key, value) => {
        if (key === 'password') return '***';
        if (typeof value === 'function' || typeof value === 'symbol') return undefined;
        return value;
    },
    2, // 第三参数 space:数字=空格缩进;也可传 '\t'
);
console.log(safeJson);
console.log('未缩进单行长度:', JSON.stringify(user).length, '| 缩进 2 格含换行:', safeJson.includes('\n'));

// 根对象在 replacer 里 key 是空字符串 '',判断时不要误伤
JSON.stringify({ a: 1 }, (key, value) => {
    console.log('  访问 key =', key === '' ? '(根对象)' : key);
    return value;
});

// ============ 3. toJSON:对象自定义"我该被如何序列化" ============
log('3. toJSON 的最高优先级');

const bankCard = {
    bank: 'ICBC',
    number: '6222021234567890123',
    // Date 就内置了 toJSON():输出 ISO 字符串;自定义对象可照此协议控制输出形态
    toJSON() {
        return { bank: this.bank, number: `****${this.number.slice(-4)}` };
    },
};
console.log(' ', JSON.stringify({ card: bankCard, at: new Date('2026-01-01T00:00:00Z') }));
// 优先级:toJSON() → replacer → 默认规则;调试时"为什么字段变了"先查有没有 toJSON

// ============ 4. parse 的 reviver:自内向外的复活函数 ============
log('4. reviver 解析复活(顺序:最深层 → 根)');

const parsed = JSON.parse(
    '{"profile":{"age":28},"birthday":"2000-01-01T00:00:00.000Z","tags":["a"]}',
    (key, value) => {
        console.log('  复活 key =', key === '' ? '(根)' : key);
        // 典型用途:把 ISO 日期字符串还原成 Date 实例(JSON 本身没有日期类型)
        if (key === 'birthday') return new Date(value as string);
        return value;
    },
);
console.log('  birthday 已还原为 Date:', parsed.birthday instanceof Date, parsed.birthday.getUTCFullYear());

// ============ 5. JSON 深拷贝的七宗罪 ============
log('5. JSON.parse(JSON.stringify()) 的能力边界');

class Point {
    constructor(
        public x: number,
        public y: number,
    ) {}
    distance() {
        return Math.hypot(this.x, this.y);
    }
}
const special: Record<string, unknown> = {
    date: new Date('2000-01-01T00:00:00.000Z'), // → 变字符串
    undef: undefined, // → 键直接消失
    fn: () => 'x', // → 键消失
    nan: NaN, // → null
    inf: Infinity, // → null
    map: new Map([['k', 'v']]), // → {}
    set: new Set([1, 2]), // → {}
    point: new Point(3, 4), // → 原型链丢失,变成普通对象
};
const clone = JSON.parse(JSON.stringify(special));
console.log('  date 类型:', typeof clone.date, '| 已是字符串:', clone.date);
console.log('  undefined/函数键消失:', 'undef' in clone, 'fn' in clone); // false false
console.log('  NaN/Infinity:', clone.nan, clone.inf); // null null
console.log('  Map/Set:', JSON.stringify(clone.map), JSON.stringify(clone.set)); // {} {}
console.log('  类实例方法丢失:', typeof clone.point.distance, Object.getPrototypeOf(clone.point) === Object.prototype);

// 循环引用直接抛错
const circular: Record<string, unknown> = { a: 1 };
circular.self = circular;
try {
    JSON.stringify(circular);
} catch (e) {
    console.log('  循环引用:', (e as Error).name, (e as Error).message.slice(0, 24) + '...');
}
// BigInt 也无法序列化(没有 JSON 数字精度概念)
try {
    JSON.stringify({ n: 123n });
} catch (e) {
    console.log('  BigInt:', (e as Error).name);
}
// 现代替代:structuredClone 支持 Date/Map/Set/循环引用/ArrayBuffer,
// 但仍不能克隆函数/Symbol/getter;真正的对象图深拷贝可考虑它或 01-21 的手写 deepClone
const sc = structuredClone({ d: new Date(0), m: new Map([['k', 1]]), loop: { v: 1 } as Record<string, unknown> });
sc.loop.self = sc.loop;
console.log('  structuredClone 保留类型:', sc.d instanceof Date, sc.m instanceof Map);

// ============ 6. 大整数精度丢失与 ES2026 rawJSON 无损往返 ============
log('6. 数字精度陷阱与 rawJSON(ES2026)');

const bigText = '{"id":9007199254000000001}'; // 超过 Number.MAX_SAFE_INTEGER
const lossy = JSON.parse(bigText);
console.log('  直接 parse 末位已失真:', String(lossy.id)); // 9007199254000000000

if (G.JSON?.rawJSON) {
    // 6.1 序列化方向:rawJSON 把"现成的合法 JSON 片段"原样嵌进字符串,不加引号不转义
    const out = JSON.stringify({ id: G.JSON.rawJSON('9007199254000000001'), name: '订单' });
    console.log('  rawJSON 序列化:', out);

    // 6.2 解析方向:reviver 第三参数 context.source 提供该值的"原始源码文本",自行转 BigInt
    const exact = JSON.parse(
        out,
        function (this: unknown, key: string, value: unknown, ctx?: { source: string }) {
            if (key === 'id') return BigInt(ctx!.source); // 用源码文本而不是已舍入的 value
            return value;
        } as never,
    );
    console.log('  无损还原:', typeof exact.id, exact.id.toString()); // bigint 9007199254000000001
    console.log('  JSON.isRawJSON 类型判断:', G.JSON.isRawJSON(G.JSON.rawJSON('1'))); // true
} else {
    console.log('  ○ JSON.rawJSON/isRawJSON 当前环境不支持(旧环境可用字符串传输 + 手动 BigInt 兜底)');
}

// ============ 7. 转义规则速记 ============
log('7. 字符串转义');

console.log(' ', JSON.stringify({ quote: '他说:"你好"', slash: 'C:\\temp', nl: 'a\nb' }));
// 输出:" → \\" 反斜杠 → \\\\ 换行 → \\n;parse 时全部还原,无需手工处理

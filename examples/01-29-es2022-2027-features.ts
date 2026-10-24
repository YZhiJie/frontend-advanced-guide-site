// 文件: examples/01-29-es2022-2027-features.ts
// ============ ES2022 → ES2027 现代特性演进实测 ============
// 事实依据:TC39 finished-proposals 官方清单(2026-10)。
// 兼容原则:新 API 一律 typeof / 特性检测后再调用,旧运行环境也能得到确定输出而不崩溃。
// 建议使用 Node 22+ / Node 26 体验完整输出;在 Node 24 上部分 ES2026/ES2027 API 显示"尚未支持"。
// 运行:npx tsx examples/01-29-es2022-2027-features.ts

export {};

const G = globalThis as any; // 集中在"特性检测边界"使用 any,业务代码不要这么写
const log = (title: string) => console.log(`\n---- ${title} ----`);
// ✓ 当前环境可用并演示;○ 当前环境尚不可用(代码已兼容降级)
const mark = (ok: boolean, name: string) => console.log(`  ${ok ? '✓' : '○'} ${name}`);

// ============ ES2022(ES13) ============
log('ES2022:类字段 / 私有方法 / 静态块 / .at / hasOwn / 正则索引 / TLA');

class BankAccount {
    // 公共实例字段(每个实例一份,在构造函数体执行前初始化)
    currency = 'CNY';
    // # 私有字段:语言级硬私有,类外无法访问(连子类也不行)
    #balance: number;
    static #instanceCount = 0; // 静态私有字段

    constructor(initial: number) {
        this.#balance = initial;
        BankAccount.#instanceCount++;
    }

    // 静态初始化块:类求值时执行一次,可访问静态私有字段
    static {
        console.log('  类加载时静态块执行一次, 当前实例数初始 =', BankAccount.#instanceCount);
    }

    deposit(amount: number) {
        this.#balance += amount;
        return this.#balance;
    }

    // 人体工程学 instanceof:用 #field in obj 安全判断"是不是我的实例"
    static isAccount(x: unknown): x is BankAccount {
        return typeof x === 'object' && x !== null && #balance in x;
    }
}
const acc = new BankAccount(100);
console.log('  私有字段只能经方法操作:', acc.deposit(50), '| 类型守卫:', BankAccount.isAccount(acc));
// console.log(acc.#balance); // 语法错误:私有标识符类外不可见

console.log('  .at(-1) 负索引:', ['a', 'b', 'c'].at(-1), 'hello'.at(-4)); // c e
console.log('  Object.hasOwn 替代 hasOwnProperty(不受原型污染影响):', (Object as any).hasOwn({ a: 1 }, 'a'));
const poisoned = Object.create({ hasOwnProperty: () => {
    throw new Error('原型被污染');
} });
poisoned.x = 1;
console.log('  hasOwn 对污染原型免疫:', (Object as any).hasOwn(poisoned, 'x')); // true

// 正则 /d 匹配索引:拿到每个分组在原文中的下标区间
const indexed: any = new RegExp('(\d+)-(\d+)', 'd').exec('订单 100-200');
if (indexed?.indices) {
    console.log('  /d 捕获组下标:', indexed.indices[1], indexed.indices[2]); // [3,6] [7,10]
}

// 顶层 await(Top-level await):ESM 模块中可直接 await,本文件就大量使用
const tla = await Promise.resolve('模块级 await 就绪');
console.log(' ', tla);

// ============ ES2023(ES14) ============
log('ES2023:数组非破坏性方法 / findLast / WeakMap 支持 Symbol 键');

const nums = [3, 1, 2];
// 所有 to* 方法返回"修改后的副本",原数组不动 —— 契合不可变数据与 React 状态更新
console.log('  toSorted 副本:', (nums as any).toSorted((a: number, b: number) => a - b), '原数组不变:', nums);
console.log('  toReversed:', (nums as any).toReversed());
console.log('  with(下标, 新值):', (nums as any).with(0, 99), nums);
console.log('  toSpliced:', (nums as any).toSpliced(1, 1, 8));
console.log('  findLast 从右往左:', (nums as any).findLast((x: number) => x < 3)); // 2

try {
    const weak = new WeakMap() as any;
    weak.set(Symbol('registered-ish'), 1); // ES2023:Symbol 可作为 WeakMap 键
    console.log('  ✓ Symbol 可作 WeakMap 键');
} catch {
    console.log('  ○ Symbol 作 WeakMap 键(当前环境不支持)');
}
// 另:#! hashbang 语法 —— 允许脚本首行写 #!/usr/bin/env node,无需注释

// ============ ES2024(ES15) ============
log('ES2024:groupBy / withResolvers / wellFormed / 正则 v 标志 / 可伸缩 ArrayBuffer');

type Inventory = { name: string; type: 'fruit' | 'veg' };
const inventory: Inventory[] = [
    { name: '苹果', type: 'fruit' },
    { name: '菠菜', type: 'veg' },
    { name: '香蕉', type: 'fruit' },
];
if (typeof (Object as any).groupBy === 'function') {
    // Object.groupBy 返回普通对象;Map.groupBy 返回 Map(键可为任意类型)
    const grouped = (Object as any).groupBy(inventory, (item: Inventory) => item.type);
    console.log('  Object.groupBy:', Object.keys(grouped), grouped.fruit.map((x: Inventory) => x.name));
} else {
    console.log('  ○ Object.groupBy(当前环境不支持)');
}

if (typeof (Promise as any).withResolvers === 'function') {
    // Promise.withResolvers:一次性拿出 { promise, resolve, reject }
    // 解决"先声明 resolve、回调里再触发"的笨拙写法,特别适配事件/队列场景
    const { promise, resolve } = (Promise as any).withResolvers();
    setTimeout(() => resolve('withResolvers 触发'), 0);
    console.log('  await 结果:', await promise);
}

// 字符串 Unicode 完备性:孤立代理项(lone surrogate)是"畸形字符串"
const lone = 'abc\uD800';
if (typeof (String.prototype as any).isWellFormed === 'function') {
    console.log('  isWellFormed:', ('abc' as any).isWellFormed(), (lone as any).isWellFormed()); // true false
    console.log('  toWellFormed 替换为 U+FFFD:', (lone as any).toWellFormed().endsWith('\uFFFD')); // true
}

try {
    // /v 标志:字符类集合运算(差集/交集)与字符串属性,/[a-z--aeiou]/v 表示辅音字母
    const consonant = new RegExp('[[a-z]&&[^aeiou]]', 'v');
    console.log('  /v 集合运算 b/aeiou:', consonant.test('b'), consonant.test('a')); // true false
} catch {
    console.log('  ○ 正则 /v 标志(当前环境不支持)');
}

if (typeof (ArrayBuffer as any).prototype?.resize === 'function') {
    const rab = new (ArrayBuffer as any)(4, { maxByteLength: 16 });
    rab.resize(8); // 按需伸缩,避免一次性分配大缓冲
    console.log('  可伸缩 ArrayBuffer:', rab.byteLength, '/', rab.maxByteLength); // 8 / 16
} else {
    console.log('  ○ 可伸缩 ArrayBuffer(当前环境不支持)');
}

// ============ ES2025(ES16) ============
log('ES2025:Iterator helpers / Promise.try / Float16 / RegExp.escape / Set 数学方法');

const It = G.Iterator;
if (It?.from?.prototype?.map || It?.from) {
    // 迭代器助手:惰性、零中间数组。数组要先 .values() 或用 Iterator.from 包一层
    const pipeline = It.from([1, 2, 3, 4, 5])
        .filter((x: number) => x % 2 === 1)
        .map((x: number) => x * 10)
        .take(2); // 到此为止还没真正计算
    console.log('  惰性管线 toArray:', pipeline.toArray()); // [10,30]
    console.log('  reduce/some/every 也可用:', It.from([1, 2, 3]).reduce((a: number, b: number) => a + b, 0));
} else {
    console.log('  ○ Iterator helpers(当前环境不支持)');
}

if (typeof (Promise as any).try === 'function') {
    // Promise.try:同步返回值与同步抛错都被统一成 Promise,链式 .catch 一处兜底
    console.log('  Promise.try 包同步值:', await (Promise as any).try(() => 42)); // 42
    await (Promise as any)
        .try(() => {
            throw new Error('同步错误');
        })
        .catch((e: Error) => console.log('  同步抛错也进 catch:', e.message));
} else {
    console.log('  ○ Promise.try(当前环境不支持)');
}

const F16 = G.Float16Array;
mark(!!F16, 'Float16Array / Math.f16round(ML/半精度存储,每元素 2 字节)');
if (F16) console.log('  BYTES_PER_ELEMENT:', new F16([1, 0.5]).BYTES_PER_ELEMENT, G.Math.f16round(0.1));

if (typeof (RegExp as any).escape === 'function') {
    // RegExp.escape:把用户输入安全嵌入 new RegExp,杜绝 +. * 等元字符注入
    const userInput = 'C++ vs. f(x)';
    console.log('  RegExp.escape:', (RegExp as any).escape(userInput));
} else {
    console.log('  ○ RegExp.escape(当前环境不支持)');
}

try {
    // 重复命名捕获组:同名分组可出现在多个分支中,只有参与匹配的那个有值
    const m = new RegExp('(?<n>\\d+)|(?<n>[a-z]+)').exec('abc');
    console.log('  重复命名捕获组:', m?.groups); // { n: 'abc' }
} catch {
    console.log('  ○ 重复命名捕获组(当前环境不支持)');
}
mark(typeof (Set.prototype as any).union === 'function', 'Set 数学方法 union/intersection/...(详见 01-28)');
mark(true, 'JSON Modules:import data from "./x.json" with { type: "json" }(需运行时支持,此处不引外部文件)');

// ============ ES2026(ES17) ============
log('ES2026:Array.fromAsync / Error.isError / sumPrecise / base64 / Iterator.concat / rawJSON / Upsert');

if (typeof (Array as any).fromAsync === 'function') {
    // Array.fromAsync:直接把"异步可迭代/类数组"收成数组,还支持异步映射函数
    async function* pageGen() {
        yield 1;
        yield 2;
        yield 3;
    }
    const collected = await (Array as any).fromAsync(pageGen(), async (x: number) => x * 2);
    console.log('  Array.fromAsync:', collected); // [2,4,6]
} else {
    console.log('  ○ Array.fromAsync(当前环境不支持)');
}

if (typeof (Error as any).isError === 'function') {
    // Error.isError:跨 iframe/realm 可靠(那里的 Error 构造器与本帧不是同一个)
    console.log('  Error.isError:', (Error as any).isError(new TypeError()), (Error as any).isError({})); // true false
} else {
    console.log('  ○ Error.isError(当前环境不支持)');
}

if (typeof G.Math?.sumPrecise === 'function') {
    // Math.sumPrecise:内部高精度求和后再做一次舍入,解决 0.1+0.2 型财务误差
    console.log('  Math.sumPrecise([0.1,0.2]):', G.Math.sumPrecise([0.1, 0.2])); // 0.3
} else {
    console.log('  ○ Math.sumPrecise(当前环境不支持)');
}

if (typeof (Uint8Array.prototype as any).toBase64 === 'function') {
    const bytes = new TextEncoder().encode('hello');
    // 二进制 ↔ base64/hex 标准互转,告别手写/第三方转换函数
    const b64 = (bytes as any).toBase64();
    const hex = (bytes as any).toHex();
    console.log('  Uint8Array 互转:', b64, hex, new TextDecoder().decode(G.Uint8Array.fromBase64(b64)));
} else {
    console.log('  ○ Uint8Array.toBase64/toHex/from*(当前环境不支持)');
}

if (It?.concat) {
    console.log('  Iterator.concat:', [...It.concat([1, 2], [3, 4])]);
} else {
    console.log('  ○ Iterator.concat(当前环境不支持)');
}

if (G.JSON?.rawJSON) {
    // rawJSON:序列化时把一段"原始 JSON 文本"原样嵌入;配合 reviver 第三参数 ctx.source 无损往返 BigInt
    const text = JSON.stringify({ big: G.JSON.rawJSON('98765432109876543210') });
    const reviver = (key: string, value: unknown, ctx?: { source: string }) =>
        key === 'big' ? BigInt(ctx!.source) : value;
    const back = JSON.parse(text, reviver as any);
    console.log('  rawJSON 无损大整数:', text, '=>', typeof back.big, back.big.toString());
    console.log('  JSON.isRawJSON:', G.JSON.isRawJSON(G.JSON.rawJSON('1'))); // true
} else {
    console.log('  ○ JSON.rawJSON/isRawJSON(当前环境不支持)');
}

if (typeof (Map.prototype as any).getOrInsert === 'function') {
    // Upsert(Map 与 WeakMap 同时支持):键不存在才插入,消灭冗长的 has/get/set 三连
    const counters = new Map<string, number>();
    (counters as any).getOrInsert('a', 0); // 不存在 → 插入 0
    (counters as any).getOrInsert('a', 999); // 已存在 → 原样返回 0
    let computed = 0;
    (counters as any).getOrInsertComputed('b', () => ++computed); // 惰性:仅插入时才计算
    console.log('  getOrInsert:', [...counters.entries()], '回调执行次数:', computed);
} else {
    console.log('  ○ Map.getOrInsert/getOrInsertComputed(当前环境不支持)');
}

// ============ ES2027 候选(已达 Stage 4,2027 年随规范发布) ============
log('ES2027 候选:using / DisposableStack / SuppressedError / Atomics.pause / Iterator.zip / Temporal');

if ((Symbol as any).dispose) {
    // 显式资源管理:using 声明的对象离开作用域时自动执行 [Symbol.dispose]
    {
        using resource = {
            [(Symbol as any).dispose]() {
                console.log('  using:离开作用域自动释放资源');
            },
        } as any;
        console.log('  using:资源使用中');
    } // <- 此处自动 dispose
    if ((Symbol as any).asyncDispose) {
        {
            await using asyncResource = {
                async [(Symbol as any).asyncDispose]() {
                    console.log('  await using:异步资源自动清理(如文件句柄/连接)');
                },
            } as any;
        }
    }
    const DS = G.DisposableStack;
    if (DS) {
        // DisposableStack:把多个清理动作压栈,dispose 时按 LIFO 统一执行
        const stack = new DS();
        stack.defer(() => console.log('  DisposableStack:清理动作 2(后注册先执行)'));
        stack.defer(() => console.log('  DisposableStack:清理动作 1'));
        stack.dispose();
    }
} else {
    console.log('  ○ using / DisposableStack(当前环境不支持)');
}

if (G.SuppressedError) {
    // 清理过程中又抛错时,主错误与抑制错误可同时保留,不会丢失现场
    const err = new G.SuppressedError(new Error('清理失败'), new Error('主错误'), 'dispose');
    console.log('  SuppressedError:', err.error.message, '/ suppressed:', err.suppressed.message);
} else {
    console.log('  ○ SuppressedError(当前环境不支持)');
}

if (typeof G.Atomics?.pause === 'function') {
    // Atomics.pause:自旋等待中向 CPU 发出"暂停"提示(hint),降低功耗、避免流水线惩罚
    G.Atomics.pause();
    console.log('  ✓ Atomics.pause(自旋锁场景的 CPU 提示)');
} else {
    console.log('  ○ Atomics.pause(当前环境不支持)');
}

if (It?.zip) {
    // Joint Iteration:多可迭代对象"联合迭代",mode 控制长度不一致时的行为
    console.log('  Iterator.zip shortest:', [...It.zip([1, 2], ['a', 'b', 'c'], { mode: 'shortest' })]);
} else {
    console.log('  ○ Iterator.zip / zipKeyed(当前环境不支持)');
}

mark(!!G.Temporal, 'Temporal(现代日期时间 API,取代 Date 的可变/时区缺陷;当前环境: ' + (G.Temporal ? '可用' : '尚未可用') + ')');

console.log('\n说明:○ 不是代码错误,而是你当前的 JS 引擎尚未实现该 API;特性检测保证了前向兼容。');

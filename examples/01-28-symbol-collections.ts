// 文件: examples/01-28-symbol-collections.ts
// ============ Symbol 与 Set/Map/WeakSet/WeakMap(含 ES2025 Set 数学方法) ============
// 学习目标:用 Symbol 造"绝不冲突"的键;按场景选对四种集合;了解弱引用与 FinalizationRegistry。
// 运行:npx tsx examples/01-28-symbol-collections.ts

export {};

const log = (title: string) => console.log(`\n---- ${title} ----`);

// ============ 1. Symbol:语言层面唯一的标识符 ============
log('1. Symbol 基础');

const s1 = Symbol('desc');
const s2 = Symbol('desc');
console.log('描述相同也不相等:', (s1 as symbol) === (s2 as symbol)); // false —— 每次调用都新建
console.log('typeof:', typeof s1); // symbol(基本类型,不能 new Symbol)
console.log('description 仅用于调试:', s1.description); // desc
console.log('隐式转字符串会报错,必须 String()/toString():', String(s1)); // Symbol(desc)

// Symbol 键不会被常规枚举发现,是"半私有"元数据的天然载体
const obj = {
    visible: 1,
    [Symbol('meta')]: '我对 for...in/Object.keys 不可见',
};
console.log('Object.keys:', Object.keys(obj)); // ['visible']
console.log('getOwnPropertySymbols 才能取到:', Object.getOwnPropertySymbols(obj).length); // 1
// JSON.stringify 也会静默丢弃 Symbol 键,适合放内部状态而非传输数据

// ============ 2. Symbol.for 全局注册表:跨文件/跨 realm 复用 ============
log('2. Symbol.for / keyFor');

const g1 = Symbol.for('app.theme'); // 注册表中没有 → 创建并登记
const g2 = Symbol.for('app.theme'); // 注册表中已有 → 直接取回同一个
console.log('for 登记的符号可复用:', (g1 as symbol) === (g2 as symbol)); // true
console.log('keyFor 反查登记名:', Symbol.keyFor(g1)); // app.theme
console.log('普通 Symbol 没有登记名:', Symbol.keyFor(s1)); // undefined
// 经验:库作者扩展第三方对象/协议钩子用普通 Symbol;需要跨模块共享协议用 Symbol.for

// ============ 3. 知名符号(Well-known Symbols):定制语言内部行为 ============
log('3. 知名符号');

// 3.1 Symbol.toPrimitive:定制对象转原始值(hint: 'number' | 'string' | 'default')
const money = {
    yuan: 100,
    [Symbol.toPrimitive](hint: string) {
        if (hint === 'string') return `¥${this.yuan}`;
        return this.yuan;
    },
};
console.log('字符串场景:', `${money}`); // ¥100
console.log('数字场景:', (money as unknown as number) + 1); // 101

// 3.2 Symbol.hasInstance:定制 instanceof 的判断逻辑
class NonEmptyArray {
    static [Symbol.hasInstance](instance: unknown) {
        return Array.isArray(instance) && instance.length > 0;
    }
}
console.log('自定义 instanceof:', [] instanceof NonEmptyArray, [1] instanceof NonEmptyArray); // false true

// 3.3 Symbol.toStringTag:定制 Object.prototype.toString 的标签
const myModule = {
    get [Symbol.toStringTag]() {
        return 'MyModule';
    },
};
console.log('自定义类型标签:', Object.prototype.toString.call(myModule)); // [object MyModule]

console.log(
    '其他知名符号:',
    [Symbol.iterator, Symbol.asyncIterator, Symbol.isConcatSpreadable].map((s) => s.toString()),
);

// ============ 4. Set:零重复值集合(ES2015) ============
log('4. Set');

const set = new Set<number>();
set.add(1).add(2).add(1); // add 返回集合本身,可链式
console.log('自动去重, size:', set.size, 'has(2):', set.has(2)); // 2 true
console.log('SameValueZero 算法:NaN 也只留一份:', new Set([NaN, NaN]).size); // 1
const literalSet = new Set([{ a: 1 }, { a: 1 }]);
console.log('对象按引用区分,结构相同也不算重复:', literalSet.size); // 2

// 典型用途:数组去重 / 并集(旧写法)
const arr = [1, 2, 2, 3, 3, 3];
console.log('一行数组去重:', [...new Set(arr)]); // [1,2,3]

// 4.1 ES2025:Set 数学方法(2025 年正式入规,Node 22+ 支持)
const evens = new Set([2, 4, 6]);
const primes = new Set([2, 3, 5]);
// 新 API 较新,统一在特性检测边界使用 any,旧环境自动走兜底
const proto = Set.prototype as any;
if (typeof proto.union === 'function') {
    // 所有方法都返回新集合,不改原集合(不可变风格);统一 any 调用以兼容旧 lib 类型
    const a = evens as any;
    const b = primes as any;
    console.log('并集 union:', [...a.union(b)].sort()); // [2,3,4,5,6]
    console.log('交集 intersection:', [...a.intersection(b)].sort()); // [2]
    console.log('差集 difference:', [...a.difference(b)].sort()); // [4,6]
    console.log('对称差 symmetricDifference:', [...a.symmetricDifference(b)].sort()); // [3,4,5,6]
    console.log('子集 isSubsetOf:', (new Set([2]) as any).isSubsetOf(a)); // true
    console.log('超集 isSupersetOf:', a.isSupersetOf(new Set([2]))); // true
    console.log('不相交 isDisjointFrom:', (new Set([1, 9]) as any).isDisjointFrom(a)); // true
} else {
    // 兜底:用迭代器手写并集,理解原理后新语法只是甜点
    const unionLegacy = new Set<number>([...evens, ...primes]);
    console.log('旧环境并集兜底:', [...unionLegacy].sort()); // [2,3,4,5,6]
}

// ============ 5. Map:任意类型键的有序字典 ============
log('5. Map');

const map = new Map<unknown, string>();
map.set('str', '字符串键').set(42, '数字键').set(NaN, 'NaN 键').set(obj, '对象键');
console.log('size:', map.size, '取对象键:', map.get(obj)); // 4 ...
console.log('遍历顺序 = 插入顺序(普通对象键顺序曾长期不保证):');
map.forEach((value, key) => console.log('  ', typeof key, '=>', value));

// ⚠️ 对比普通对象:键都会被 toString,1 和 '1' 会撞;Map 不会
const naive: Record<string, string> = {};
naive[[1, 2].toString()] = 'a'; // 数组键会被 toString 成 '1,2'
console.log('对象键陷阱:', Object.keys(naive)); // ['1,2']

// 典型用途:对象 → 附加数据 的映射(计数、缓存、关系表)
function frequency<T>(items: T[]) {
    const count = new Map<T, number>();
    for (const item of items) count.set(item, (count.get(item) ?? 0) + 1);
    return count;
}
console.log('词频统计:', [...frequency(['a', 'b', 'a', 'a', 'b'])]); // [['a',3],['b',2]]

// ============ 6. WeakMap / WeakSet:键为对象的"弱引用"集合 ============
log('6. WeakMap / WeakSet');

// 6.1 WeakMap 做"真正私有"的关联数据:对象被回收,条目自动消失,不阻止 GC
const secrets = new WeakMap<object, { token: string }>();
class Vault {
    constructor() {
        secrets.set(this, { token: 'jwt-xxxx' });
    }
    get token() {
        return secrets.get(this)!.token;
    }
}
const vault = new Vault();
console.log('私有数据只能通过实例间接访问:', vault.token); // jwt-xxxx
console.log('WeakMap 没有 size/keys/遍历:', 'size' in secrets, typeof (secrets as any).keys); // false undefined

// 6.2 WeakSet:给对象打"已处理"标记,不干扰回收
const visited = new WeakSet<object>();
function visitNode(node: object) {
    if (visited.has(node)) return '跳过已访问节点';
    visited.add(node);
    return '首次访问';
}
const node = {};
console.log(visitNode(node), '/', visitNode(node)); // 首次访问 / 跳过已访问节点

// 选型口诀:
// 键是对象且数据生命周期跟随对象 → WeakMap/WeakSet(自动 GC、防内存泄漏)
// 需要遍历/size/基本类型键/快照 → Map/Set

// 6.3 更底层的弱引用原语(了解即可,业务里极少直接用)
const WeakRefCtor = (globalThis as any).WeakRef;
const FinalizationRegistryCtor = (globalThis as any).FinalizationRegistry;
if (typeof WeakRefCtor === 'function' && typeof FinalizationRegistryCtor === 'function') {
    const registry = new FinalizationRegistryCtor((heldValue: string) => {
        // 回调时机由 GC 决定,只能用于"尽力而为"的外部资源清理,不能写关键逻辑
        console.log('  (对象被回收时的通知:', heldValue, ')');
    });
    let target: object | null = { id: 1 };
    const ref = new WeakRefCtor(target);
    registry.register(target, 'target 已回收');
    console.log('GC 前 deref 可取到:', ref.deref() !== undefined); // true
    target = null; // 解除强引用后,何时回收完全取决于引擎
    console.log('WeakRef/FinalizationRegistry 在本环境可用(不主动触发 GC)');
}

// ============ 7. 标签模板字符串(Tagged Templates) ============
log('7. 标签模板');

// 标签函数接收:(字符串片段数组, ...插值值),可自由决定如何组装
function emphasize(strings: TemplateStringsArray, ...values: unknown[]) {
    return strings.reduce(
        (acc, part, i) => acc + part + (i < values.length ? `【${String(values[i])}】` : ''),
        '',
    );
}
const userName = '阿黄';
console.log(emphasize`你好 ${userName},您有 ${3} 条通知`); // 你好 【阿黄】,您有 【3】 条通知

// String.raw:拿到转义之前的原始文本(教学/正则模板场景)
console.log('普通模板:', `a\tb`); // a<TAB>b
console.log('raw 保留反斜杠:', String.raw`a\tb`); // a\tb

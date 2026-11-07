// 文件: examples/01-34-classic-traps.ts
// ============ 提升陷阱 / this 边界 / 手写 call·apply / arguments ============
// 本文件为 1.1、1.4、1.8 小节的补充案例,运行:npx tsx examples/01-34-classic-traps.ts

export {};

const log = (title: string) => console.log(`\n---- ${title} ----`);
// ESM 恒为严格模式;演示"非严格脚本行为"时用间接 eval 在非严格全局作用域执行字符串
const sloppy = (code: string): unknown => (0, eval)(code);

// ============ 1. 提升三连问(对应 1.1) ============
log('1. 提升高频陷阱');

// 1.1 return 之后的 var 仍会提升(创建阶段扫描,与代码位置无关)
function afterReturn() {
    console.log('  return 后的 var 仍被提升:', x); // undefined(提升但未赋值)
    x = 2;
    return x; // 实际返回 2
    var x: number | undefined;
}
console.log('  函数返回值:', afterReturn()); // 2

// 1.2 隐式全局变量:非严格脚本中,未声明赋值沿作用域链找不到声明就挂到全局对象
sloppy("function leak(){ leaked = '我成了全局变量'; } leak();");
console.log('  非严格:全局对象上多了 leaked =', (globalThis as any).leaked);
try {
    sloppy('"use strict"; (function(){ willLeak = 1; })();');
} catch (e) {
    console.log('  严格模式:隐式全局直接抛', (e as Error).name); // ReferenceError
}

// 1.3 var a = b = 10:连续赋值只有第一个有声明符
sloppy('function chainAssign(){ var a = b = 10; } chainAssign();');
console.log('  非严格:a 是局部,b 泄漏为全局 =', (globalThis as any).b); // 10
console.log('  记忆:等号从右向左结合 —— 先执行 b = 10(b 无声明 → 全局),再 var a = 10');

// ============ 2. this 的边界情况(对应 1.4) ============
log('2. this 边界规则');

function whoAmI(this: unknown) {
    if (this === undefined || this === null) return `${String(this)}(严格模式原样保留)`;
    if (this === globalThis) return 'globalThis';
    return Object.prototype.toString.call(this);
}

// 2.1 显式绑定传 null/undefined:严格模式原样使用,非严格被替换为全局对象
console.log('  call(null):', whoAmI.call(null)); // undefined
console.log('  apply(undefined):', whoAmI.apply(undefined)); // undefined
console.log('  bind(null)():', whoAmI.bind(null)()); // undefined
console.log('  非严格 call(null) 替换为:', sloppy('(function(){ return this === globalThis; }).call(null)')); // true

// 2.2 间接函数引用:括号赋值表达式的结果是"裸函数引用",丢失成员调用前缀
sloppy(`
    "use strict";
    const a = { tag: 'A', f(){ return this === undefined ? 'undefined' : this.tag; } };
    const b = { tag: 'B' };
    console.log('  (b.f = a.f)() 的 this:', (b.f = a.f)()); // undefined
    console.log('  对比 b.f = a.f; b.f():', (b.f = a.f, b.f())); // B
`);

// 2.3 内置高阶函数的 thisArg 参数:不传则严格模式为 undefined
[7].forEach(function (this: { tag: string }, item) {
    console.log('  forEach 回调收到 thisArg:', this.tag, '当前项:', item);
}, { tag: '显式 thisArg' });
// 同类:map/filter/find/flatMap 第二参数;DOM 中 addEventListener 回调的 this 是绑定元素(箭头函数则不是)

// ============ 3. 手写 call / apply(对应 1.4 G12) ============
log('3. 手写 call / apply');

// 核心思想:把函数临时挂成 context 的方法,利用"成员调用隐式绑定"实现 this 指定
(Function.prototype as unknown as {
    myCall: (ctx: unknown, ...args: unknown[]) => unknown;
    myApply: (ctx: unknown, args?: unknown[]) => unknown;
}).myCall = function (this: (...args: unknown[]) => unknown, ctx: unknown, ...args: unknown[]) {
    // 严格模式 thisArg 应原样使用;此处对 null/undefined 与原始值做兼容处理(面试常见写法)
    const target = (ctx === null || ctx === undefined ? globalThis : Object(ctx)) as Record<symbol, unknown>;
    const key = Symbol('temp-fn'); // Symbol 临时键,避免覆盖 context 已有属性
    target[key] = this;
    try {
        return (target[key] as (...a: unknown[]) => unknown)(...args);
    } finally {
        delete target[key]; // 无论成功失败都清理,避免污染对象
    }
};

(Function.prototype as unknown as {
    myApply: (ctx: unknown, args?: unknown[]) => unknown;
}).myApply = function (
    this: (...args: unknown[]) => unknown,
    ctx: unknown,
    args: unknown[] = [],
) {
    const target = (ctx === null || ctx === undefined ? globalThis : Object(ctx)) as Record<symbol, unknown>;
    const key = Symbol('temp-fn');
    target[key] = this;
    try {
        return (target[key] as (...a: unknown[]) => unknown)(...args); // 与 call 只差参数是数组
    } finally {
        delete target[key];
    }
};

function introduce(this: { name: string; age: number }, role: string) {
    return `${role}:${this.name},${this.age} 岁`;
}
const person = { name: '阿黄', age: 28 };
// 把原型临时当 any 调用,保持与原生 call/apply 完全一致的调用形态
const proto = Function.prototype as any;
console.log('  myCall:', proto.myCall.call(introduce, person, '工程师'));
console.log('  myApply:', proto.myApply.apply(introduce, [person, ['架构师']]));

// ============ 4. arguments:类数组、callee 与现代替代(对应 1.8) ============
log('4. arguments 机制');

function variadic(this: unknown, ..._args: unknown[]) {
    // arguments 是"类数组":有 length/索引,但没有数组方法;箭头函数没有自己的 arguments
    console.log('  length:', arguments.length, '| 按下标取:', arguments[0], arguments[2]);
    console.log('  是数组吗?', Array.isArray(arguments), '| 有 map 吗?', typeof (arguments as any).map);
    // 三种类数组 → 真数组
    const a1 = Array.prototype.slice.call(arguments);
    const a2 = Array.from(arguments);
    const a3 = [...arguments];
    console.log('  转换结果一致:', JSON.stringify(a1) === JSON.stringify(a2), JSON.stringify(a2) === JSON.stringify(a3));
    // arguments.callee 指向"当前正在执行的函数",可用于匿名递归;严格模式读取即抛 TypeError
    try {
        console.log('  callee 等于函数自身?', arguments.callee === variadic);
    } catch (e) {
        console.log('  严格模式访问 arguments.callee 抛:', (e as Error).name);
    }
}
variadic('a', 'b', 'c');

// callee 的经典用途(仅非严格可用):匿名函数递归,不必依赖函数名
console.log(
    '  匿名递归(非严格):',
    sloppy(`
        (function (n) { return n <= 1 ? 1 : n * arguments.callee(n - 1); })(5);
    `),
);
console.log('  现代替代:具名函数表达式 / 剩余参数 ...args(干净、可优化、严格模式安全)');

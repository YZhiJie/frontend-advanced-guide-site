// 文件: examples/01-31-iterator-generator.ts
// ============ 可迭代协议 / 迭代器协议 / Generator / 自动执行器 / 异步迭代 ============
// 学习目标:理解 for...of/spread/解构背后的统一接口,能用生成器写惰性数据流。
// 运行:npx tsx examples/01-31-iterator-generator.ts

export {};

const log = (title: string) => console.log(`\n---- ${title} ----`);

// ============ 1. 两个协议(面试高频:可迭代对象 ≠ 迭代器) ============
log('1. 协议概念');

// 可迭代协议(Iterable):对象实现 [Symbol.iterator]() 方法,返回一个迭代器
// 迭代器协议(Iterator):拥有 next() 方法,next() 返回 { value, done }
const arr = [10, 20, 30];
const iter = arr[Symbol.iterator](); // 数组是"可迭代对象",这里取出它的"迭代器"
console.log('  手动 next:', iter.next(), iter.next()); // { value: 10, done: false } ...
console.log('  迭代器是一次性的,已消费的不会回退:', [...iter], '再消费一次:', [...iter]); // [30] []

// ============ 2. 手写可迭代对象(含 return 清理钩子) ============
log('2. 自定义可迭代:逐行读取器模型');

const lineReader = {
    [Symbol.iterator]() {
        let cursor = 0;
        const lines = ['第一行', '第二行', '第三行'];
        return {
            next() {
                if (cursor < lines.length) return { value: lines[cursor++], done: false };
                return { value: undefined, done: true };
            },
            // 可选方法 return():消费方 break/return/异常退出时被调用,用于释放文件句柄等资源
            return() {
                console.log('  return() 被触发:提前关闭读取器');
                return { value: undefined, done: true };
            },
        };
    },
};

for (const line of lineReader) {
    console.log('  读取 ->', line);
    if (line === '第二行') break; // 触发 return()
}

// ============ 3. 内置可迭代与消费方式 ============
log('3. 谁实现了 Symbol.iterator');

console.log('  Array/Set/Map/字符串/arguments/NodeList/生成器 全部可迭代');
const map = new Map([
    ['a', 1],
    ['b', 2],
]);
// 同一协议支撑四种消费语法,记住"协议优先于具体容器"
console.log('  for...of Map 项:', [...map]);
console.log('  展开运算:', ...new Set([1, 1, 2]));
const [first, ...rest] = 'xyz';
console.log('  解构消费字符串:', first, rest);
console.log('  Array.from:', Array.from(new Map([['k', 'v']]).entries()));
// ⚠️ for...in 遍历的是"可枚举键(原型链上的也算)",for...of 遍历的是"迭代器给的值",别混用

// ============ 4. class + 生成器实现可迭代 ============
log('4. class 形式:Range 数字区间(惰性,不生成中间数组)');

class Range {
    constructor(
        private from: number,
        private to: number,
    ) {}

    // 生成器对象天然满足迭代器协议,所以 Symbol.iterator 直接用 function* 最省事
    *[Symbol.iterator]() {
        for (let i = this.from; i <= this.to; i++) yield i;
    }
}

console.log('  1~5 求和:', [...new Range(1, 5)].reduce((a, b) => a + b, 0)); // 15
console.log('  百万级区间也不占数组内存,因为值是现用现算的');

// ============ 5. Generator:yield 的暂停/恢复与双向传参 ============
log('5. Generator 核心机制');

function* twoWayGen(): Generator<string, string, string> {
    console.log('  [生成器] 第一次 next 才开始执行');
    const received1 = yield '第一个产出'; // 右边先产出;左边等"下一次 next 的参数"赋值
    console.log('  [生成器] 收到第二次 next 传入:', received1);
    const received2 = yield '第二个产出';
    console.log('  [生成器] 收到第三次 next 传入:', received2);
    return '终结返回值'; // done:true 时的 value,for...of 不会读到它
}

const g = twoWayGen();
console.log('  next1:', g.next());
console.log('  next2:', g.next('你好'));
console.log('  next3:', g.next('世界')); // { value: '终结返回值', done: true }

// return() 与 throw():从外部强制结束 / 向生成器内部注入异常
function* interruptible(): Generator<number> { // TReturn 默认 any,外部可 return 任意值
    try {
        yield 1;
        yield 2;
        yield 3;
    } finally {
        console.log('  [生成器] finally:无论正常结束还是外部中断都执行');
    }
}
const gi = interruptible();
console.log('  取一个:', gi.next().value);
console.log('  外部 return 提前结束:', gi.return('stop')); // finally 执行,{ value:'stop', done:true }

const ge = interruptible();
ge.next();
try {
    ge.throw(new Error('外部注入')); // 异常在 yield 点抛出,可被生成器内部 try/catch
} catch (e) {
    console.log('  throw() 未被内部捕获时冒泡出来:', (e as Error).message);
}

// ============ 6. yield* 委托:组合生成器 ============
log('6. yield* 委托');

function* innerSeq() {
    yield 'a';
    yield 'b';
    return '内部终结值'; // 委托方可以拿到这个返回值
}
function* outerSeq() {
    yield 'start';
    const innerReturn = yield* innerSeq(); // 逐个转发内层产出,并接收其 return 值
    yield innerReturn;
    yield 'end';
}
console.log('  组合产出:', [...outerSeq()]); // ['start','a','b','内部终结值','end']

// ============ 7. 生成器自动执行器:async/await 普及前的"co 范式" ============
log('7. 手写 co 自动执行器(理解 async/await 的前身)');

type PromiseGen = () => Generator<Promise<unknown>, unknown, unknown>;
function run(genFn: PromiseGen): Promise<unknown> {
    const it = genFn();
    const step = (method: 'next' | 'throw', arg?: unknown): unknown => {
        const result = (it as unknown as {
            next(v?: unknown): IteratorResult<unknown>;
            throw(e: unknown): IteratorResult<unknown>;
        })[method](arg);
        if (result.done) return result.value; // 没有 Promise 了,结束
        // Promise 成功就把值塞回 yield 处;失败就把异常抛进 yield 处
        return Promise.resolve(result.value).then(
            (v) => step('next', v),
            (e) => step('throw', e),
        );
    };
    return Promise.resolve(step('next'));
}

const mockFetch = (label: string, ms: number) =>
    new Promise<string>((resolve) => setTimeout(() => resolve(`数据(${label})`), ms));

await run(function* () {
    const a: string = (yield mockFetch('A', 10)) as string;
    const b: string = (yield mockFetch('B', 5)) as string;
    console.log('  以同步写法拿到异步结果:', a, b); // 数据(A) 数据(B)
});
console.log('  async/await 本质上就是这套机制的语法级内置');

// ============ 8. 异步迭代:Symbol.asyncIterator + for await...of ============
log('8. 异步生成器与 for await...of');

async function* asyncPoller(times: number) {
    for (let i = 1; i <= times; i++) {
        await new Promise((resolve) => setTimeout(resolve, 5)); // 模拟轮询间隔
        yield { page: i, payload: `第${i}页` };
    }
}

const pages: string[] = [];
// next() 返回 Promise<{value,done}>;消费用 for await...of
for await (const chunk of asyncPoller(3)) {
    pages.push(chunk.payload);
    console.log('  到达:', chunk);
}
console.log('  汇总:', pages);

// ============ 9. ES2025+ 迭代器助手(前瞻,完整清单见 01-29) ============
log('9. 迭代器助手与标准化管线');

const It = (globalThis as any).Iterator;
if (It?.from) {
    // 与数组方法的区别:不产生中间数组,且能直接消费无限/异步序列
    console.log(
        '  Iterator.from 惰性链:',
        It
            .from(function* () {
                yield* [1, 2, 3, 4, 5, 6];
            }())
            .filter((x: number) => x % 2 === 0)
            .drop(1)
            .take(1)
            .toArray(),
    ); // [4]
    console.log('  ES2026 Iterator.concat / ES2027 Iterator.zip 请运行 01-29 查看支持情况');
} else {
    console.log('  ○ 当前环境不支持 Iterator helpers(用生成器手写同样的链式逻辑也能工作)');
}

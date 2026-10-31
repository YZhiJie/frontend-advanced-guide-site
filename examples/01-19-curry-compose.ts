// 文件: examples/01-19-curry-compose.ts
// ============ 柯里化、组合与管道 ============

// ---- 手写柯里化:参数凑够才执行,否则返回收集参数的新函数 ----
function curry<T extends (...args: never[]) => unknown>(fn: T): (...args: never[]) => unknown {
    const arity = fn.length;
    return function curried(...args: never[]): unknown {
        if (args.length >= arity) return fn(...args);
        return (...rest: never[]) => curried(...(args.concat(rest) as never[]));
    };
}

const add3 = (a: number, b: number, c: number) => a + b + c;
const curriedAdd = curry(add3) as any;
console.log(curriedAdd(1)(2)(3)); // 6
console.log(curriedAdd(1, 2)(3)); // 6
console.log(curriedAdd(1)(2, 3)); // 6

// 柯里化的实战价值:参数复用(偏函数)
const log = (level: string, module: string, message: string) => `[${level}] ${module}: ${message}`;
const curriedLog = curry(log) as any;
const errorLog = curriedLog('ERROR');       // 固定日志级别
const userError = errorLog('UserService');  // 再固定模块
console.log(userError('登录失败'));          // [ERROR] UserService: 登录失败

// ---- 组合(从右往左)与管道(从左往右)----
const compose = <T,>(...fns: Array<(x: T) => T>) => (x: T): T => fns.reduceRight((acc, fn) => fn(acc), x);
const pipe = <T,>(...fns: Array<(x: T) => T>) => (x: T): T => fns.reduce((acc, fn) => fn(acc), x);

const trim = (s: string) => s.trim();
const toLowerCase = (s: string) => s.toLowerCase();
const wrap = (s: string) => `<b>${s}</b>`;

const normalize = pipe(trim, toLowerCase, wrap);
console.log(normalize('  Hello World  ')); // <b>hello world</b>

// ---- 记忆化:缓存纯函数结果 ----
function memoize<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    const cache = new Map<string, R>();
    return (...args: A): R => {
        const key = JSON.stringify(args);
        if (cache.has(key)) return cache.get(key)!;
        const result = fn(...args);
        cache.set(key, result);
        return result;
    };
}

let callCount = 0;
const slowSquare = memoize((n: number) => {
    callCount++;
    return n * n; // 假设这是昂贵计算
});
slowSquare(9);
slowSquare(9);
slowSquare(9);
console.log('计算了', callCount, '次'); // 1 —— 后两次命中缓存

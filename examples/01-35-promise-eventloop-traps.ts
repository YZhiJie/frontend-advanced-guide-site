// 文件: examples/01-35-promise-eventloop-traps.ts
// ============ Promise 解包规则 / thenable 微任务倍增 / finally / Node 阶段细节 ============
// 本文件为 1.5 小节的补充案例,运行:npx tsx examples/01-35-promise-eventloop-traps.ts

export {};

const log = (title: string) => console.log(`\n---- ${title} ----`);

// ============ 1. resolve 的三种入参(同一套 Promise Resolve 过程) ============
log('1. Promise.resolve / resolve 的三种值');

// ① 普通值:本轮微任务即可落定;② thenable:递归调用其 then,至少多一个微任务;
// ③ 真正的 Promise:状态与值完全"跟随"(传入已完成的 promise 也会有至少一个 tick 延迟)
const order: string[] = [];

Promise.resolve(1).then((v) => order.push(`普通值 ${v}`));

Promise.resolve({
    then(resolve: (v: number) => void) {
        order.push('thenable 的 then 被执行');
        resolve(2);
    },
}).then((v) => order.push(`thenable 解包为 ${v}`));

const late = new Promise<string>((r) => setTimeout(() => r('late'), 10));
Promise.resolve(late).then((v) => order.push(`跟随的 promise:${v}`));

await late.then(() => new Promise((r) => setTimeout(r, 15)));
console.log('  执行序列:');
order.forEach((line) => console.log('   ', line));

// ============ 2. then/catch 回调"返回值"的四种情况 ============
log('2. then 回调返回值决定下一环');

// 普通值 → 下一环成功值
console.log('  普通值:', await Promise.resolve('x').then(() => 42)); // 42

// 返回 thenable → 下一环等待并解包(不是把对象传下去!)
const viaThenable = await Promise.resolve('x').then(
    () =>
        new Promise((r) =>
            setTimeout(() => r({ then(resolve: (s: string) => void) {
                resolve('thenable 结果');
            } }), 5),
        ),
);
console.log('  thenable 被解包:', viaThenable);

// 返回 Promise → 链式等待它落定
console.log(
    '  返回 Promise:',
    await Promise.resolve('x').then(() => new Promise((r) => setTimeout(() => r('异步结果'), 5))),
);

// 抛异常(同步 throw 或返回 rejected promise)→ 进入最近的失败分支
const recovered = await Promise.resolve('x')
    .then(() => {
        throw new Error('回调内同步抛出');
    })
    .catch((e) => `被 catch 接住:${(e as Error).message}`);
console.log(' ', recovered);

// ============ 3. thenable 微任务倍增:输出顺序题 ============
log('3. 微任务时序题(thenable 为什么"慢两拍")');

const seq: number[] = [];
Promise.resolve().then(() => seq.push(1));
Promise.resolve({
    then(resolve: () => void) {
        seq.push(2); // thenable.then 执行
        resolve();
    },
}).then(() => seq.push(3)); // resolve 后还要"再跨一个微任务"才轮到这个回调
queueMicrotask(() => seq.push(4));

await new Promise((r) => setTimeout(r, 0));
console.log('  顺序:', seq.join(' → ')); // 1 → 2 → 4 → 3
console.log('  解析:thenable 先占一个微任务执行 .then,resolve 回调再占一个微任务落定,');
console.log('       期间入队的 queueMicrotask(4) 插到了 then 回调(3) 前面');

// ============ 4. finally:透传但不改变结果,除非自己抛错 ============
log('4. finally 语义');

const v1 = await Promise.resolve('原值').finally(() => '我不是返回值');
console.log('  成功链 finally 的返回值被忽略:', v1); // 原值

const v2 = await Promise.reject(new Error('原始错误'))
    .finally(() => {
        /* 不写 return/throw 时,原原因透传 */
    })
    .catch((e) => (e as Error).message);
console.log('  失败原因透传:', v2);

try {
    await Promise.resolve().finally(() => {
        throw new Error('清理时出错'); // finally 抛错会替换掉链上原有的成功/失败
    });
} catch (e) {
    console.log('  finally 抛错成为新结果:', (e as Error).message);
}

// ============ 5. Node 事件循环六阶段与 nextTick 优先级 ============
log('5. Node 特有:六阶段 + process.nextTick');

const proc = (globalThis as any).process;
if (proc && typeof proc.nextTick === 'function' && proc.versions?.node) {
    // Node 每轮循环的六个阶段(按顺序):
    //   timers → pending callbacks → idle/prepare(内部) → poll(I/O) → check(setImmediate) → close callbacks
    // 经典规则(在"阶段回调"内部):阶段回调执行完后先清空 nextTick 队列,再清空 V8 微任务队列;
    //   nextTick 中再注册 nextTick 会持续插队,可"饿死"后续 I/O,务必慎用。
    // ⚠️ 顶层模块作用域是特例:脚本执行栈清空时 V8 先跑一次微任务检查点,
    //   此时会看到 Promise/queueMicrotask 先于 nextTick —— 所以顺序题要放到阶段回调里验证。
    await new Promise<void>((resolve) => {
        setImmediate(() => {
            const ticks: string[] = [];
            proc.nextTick(() => {
                ticks.push('nextTick1');
                proc.nextTick(() => ticks.push('nextTick2(嵌套,仍然插队)'));
            });
            Promise.resolve().then(() => ticks.push('promise1'));
            queueMicrotask(() => ticks.push('microtask'));
            proc.nextTick(() => ticks.push('nextTick3'));
            // 下一轮 check 时本轮回调后的两个队列都已清空完毕
            setImmediate(() => {
                console.log('  阶段回调内的清空顺序:', ticks.join(' → '));
                // nextTick1 → nextTick3 → nextTick2 → promise1 → microtask
                resolve();
            });
        });
    });
    console.log('  另一个坑:setTimeout(fn,0) 与 setImmediate 在主模块顶层顺序不确定,');
    console.log('  只有在 I/O/poll 之后才稳定为 timers(下一轮)与 check 的既定相对顺序;');
} else {
    console.log('  非 Node 环境,跳过(Bun/Deno/浏览器没有完全相同的六阶段模型)');
}

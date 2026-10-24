// 文件: examples/01-05-closure-once.ts
// ============ 示例 3:once —— 只执行一次的函数 ============
// 应用:幂等的初始化逻辑、支付按钮防重复提交

function once<T extends (...args: never[]) => unknown>(fn: T): T {
    let called = false;
    let result: unknown;
    return function (this: unknown, ...args: never[]) {
        if (called) return result;          // 第二次起直接返回缓存结果
        called = true;
        result = fn.apply(this, args);      // 只有第一次真正执行
        return result;
    } as T;
}

const initApp = once(() => {
    console.log('应用初始化(昂贵的操作,只应执行一次)');
    return { ready: true };
});

initApp(); // 打印"应用初始化"
initApp(); // 不打印,直接返回上次结果
initApp(); // 同上

// 文件: examples/23-01-promise-all.ts
// ============ 手写 Promise.all / Promise.allSettled / Promise.race / Promise.any ============

/**
 * Promise.all：全部成功才成功，任一失败立即整体失败，结果按原下标保序
 * 要点：1) Promise.resolve 包一层，兼容非 Promise 入参；2) 按下标存结果保证顺序；
 *       3) done 计数而非判断数组长度，避免稀疏数组坑；4) 空数组直接 resolve([])
 */
export function promiseAll<T>(promises: Iterable<T | PromiseLike<T>>): Promise<T[]> {
    return new Promise((resolve, reject) => {
        const arr = Array.from(promises);
        const results = new Array<T>(arr.length);
        let done = 0;
        if (arr.length === 0) return resolve(results);
        arr.forEach((p, i) => {
            Promise.resolve(p).then(
                (val) => {
                    results[i] = val;                // 按下标存，保序
                    if (++done === arr.length) resolve(results);
                },
                reject,                            // 任一失败 → 整体失败
            );
        });
    });
}

/**
 * Promise.allSettled：全部落定后才返回，每个结果带状态（fulfilled/rejected）
 */
export function promiseAllSettled<T>(
    promises: Iterable<T | PromiseLike<T>>,
): Promise<Array<PromiseSettledResult<T>>> {
    return new Promise((resolve) => {
        const arr = Array.from(promises);
        const results = new Array<PromiseSettledResult<T>>(arr.length);
        let done = 0;
        if (arr.length === 0) return resolve(results);
        arr.forEach((p, i) => {
            Promise.resolve(p).then(
                (value) => { results[i] = { status: 'fulfilled', value }; },
                (reason) => { results[i] = { status: 'rejected', reason }; },
            ).finally(() => {
                if (++done === arr.length) resolve(results);
            });
        });
    });
}

/**
 * Promise.race：第一个落定的（无论成败）决定整体状态
 */
export function promiseRace<T>(promises: Iterable<T | PromiseLike<T>>): Promise<T> {
    return new Promise((resolve, reject) => {
        for (const p of promises) {
            Promise.resolve(p).then(resolve, reject);
        }
    });
}

/**
 * Promise.any：第一个成功的决定整体成功；全部失败才整体失败（AggregateError）
 * AggregateError 是 ES2021 API，旧环境降级为带 errors 属性的普通 Error
 */
export function promiseAny<T>(promises: Iterable<T | PromiseLike<T>>): Promise<T> {
    // 特性检测：ES2021+ 才有全局 AggregateError
    const AggregateErrorCtor: new (errors: unknown[], message?: string) => Error & { errors: unknown[] } =
        typeof (globalThis as any).AggregateError !== 'undefined'
            ? (globalThis as any).AggregateError
            : class extends Error {
                  public errors: unknown[];
                  constructor(errors: unknown[], message?: string) {
                      super(message);
                      this.name = 'AggregateError';
                      this.errors = errors;
                  }
              };
    return new Promise((resolve, reject) => {
        const arr = Array.from(promises);
        const errors: unknown[] = [];
        let done = 0;
        if (arr.length === 0) return reject(new AggregateErrorCtor([], 'All promises were rejected'));
        arr.forEach((p, i) => {
            Promise.resolve(p).then(resolve, (err) => {
                errors[i] = err;
                if (++done === arr.length) reject(new AggregateErrorCtor(errors, 'All promises were rejected'));
            });
        });
    });
}

// ============ 自测 ============
(async () => {
    const r1 = await promiseAll([1, Promise.resolve(2), 3]);
    console.log('all 成功:', r1);                          // [1, 2, 3]

    try {
        await promiseAll([1, Promise.reject('boom'), 3]);
    } catch (e) {
        console.log('all 失败:', e);                        // boom
    }

    const r2 = await promiseAllSettled([1, Promise.reject('x'), 3]);
    console.log('allSettled:', r2.map((r) => r.status));    // ['fulfilled','rejected','fulfilled']

    const r3 = await promiseRace([
        new Promise((r) => setTimeout(() => r('慢'), 100)),
        new Promise((r) => setTimeout(() => r('快'), 10)),
    ]);
    console.log('race:', r3);                               // 快

    const r4 = await promiseAny([
        Promise.reject('a'),
        Promise.resolve('b'),
        Promise.reject('c'),
    ]);
    console.log('any:', r4);                                // b
})();

export {};

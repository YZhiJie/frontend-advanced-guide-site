// 文件: examples/01-13-promise-patterns.ts
// ============ Promise 组合 API:日常最常用的编排手段 ============

const p = (value: number, ms: number, shouldReject = false) =>
    new Promise<number>((resolve, reject) =>
        setTimeout(() => (shouldReject ? reject(new Error(`fail ${value}`)) : resolve(value)), ms),
    );

// ---- Promise.all:全部成功才成功,一个失败立即失败(短路)----
// 适用:多个请求缺一不可,如首屏聚合
const [a, b] = await Promise.all([p(1, 100), p(2, 200)]);
console.log('all:', a, b); // 1 2

// ---- Promise.allSettled:全部完成,永远不短路 ----
// 适用:多个独立请求,失败也要展示已成功的部分(如仪表盘多卡片)
const results = await Promise.allSettled([p(1, 100), p(2, 50, true), p(3, 150)]);
const fulfilled = results.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<number>).value);
const failed = results.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason.message);
console.log('allSettled 成功:', fulfilled, '失败:', failed); // [1, 3] ['fail 2']

// ---- Promise.race:第一个"出结果"的(无论成败)----
// 适用:超时控制(见 1.8 的 withTimeout)
const first = await Promise.race([p(9, 300), p(0, 50)]);
console.log('race:', first); // 0 —— 50ms 的先完成

// ---- Promise.any:第一个成功的;全失败才抛 AggregateError ----
// 适用:多 CDN 择优、多镜像源容灾
const fastest = await Promise.any([p(1, 300, true), p(2, 100), p(3, 200, true)]);
console.log('any:', fastest); // 2

// ---- 串行 vs 并行:链式 await 是串行(慢),先收集再 all 是并行(快)----
console.time('串行');
const s1 = await p(1, 100);
const s2 = await p(2, 100);
console.timeEnd('串行');   // ≈200ms
console.time('并行');
const [j1, j2] = await Promise.all([p(1, 100), p(2, 100)]);
console.timeEnd('并行');   // ≈100ms

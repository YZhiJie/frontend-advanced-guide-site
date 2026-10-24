// 文件: examples/01-15-async-pool.ts
// ============ 并发控制:asyncPool —— 最多同时 N 个任务 ============
// 场景:批量上传分片、批量请求接口,防止瞬间打爆服务端

async function asyncPool<T, R>(limit: number, items: readonly T[], task: (item: T, index: number) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let cursor = 0; // 共享游标:每个 worker 从这里领任务

    async function worker() {
        while (cursor < items.length) {
            const index = cursor++;
            results[index] = await task(items[index], index);
        }
    }

    // 启动 min(limit, 任务数) 个 worker,谁空闲谁领下一个任务
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
    return results;
}

// ---- 演示:8 个任务,并发上限 3 ----
const tasks = Array.from({ length: 8 }, (_, i) => i);
let running = 0;
let peak = 0;

const start = Date.now();
await asyncPool(3, tasks, async (i) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 100)); // 模拟 100ms 的 IO
    running--;
    console.log(`任务 ${i} 完成 @ ${Date.now() - start}ms`);
});
console.log(`全部完成,峰值并发 = ${peak}(应为 3),总耗时 ≈ ${Math.ceil(8 / 3) * 100}ms`);

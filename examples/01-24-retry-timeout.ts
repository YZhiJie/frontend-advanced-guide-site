// 文件: examples/01-24-retry-timeout.ts
// ============ sleep / 重试 / 超时:请求层的三件套 ============

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---- 指数退避重试 ----
async function retry<T>(fn: () => Promise<T>, times = 3, baseDelay = 500): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < times; attempt++) {
        try {
            return await fn();
        } catch (e) {
            lastError = e;
            const delay = baseDelay * 2 ** attempt; // 500ms → 1s → 2s,指数退避
            console.log(`第 ${attempt + 1} 次失败,${delay}ms 后重试`);
            await sleep(delay);
        }
    }
    throw lastError;
}

// ---- 超时控制:race 一竞到底 ----
// ⚠️ 注意:超时只是"不再等待结果",原请求并没有真正取消;要真正取消请用 AbortController(见 6.5)
function withTimeout<T>(promise: Promise<T>, ms: number, label = '操作'): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label}超时(${ms}ms)`)), ms)),
    ]);
}

// ---- 验证 ----
let attempts = 0;
await retry(async () => {
    attempts++;
    if (attempts < 3) throw new Error('网络抖动');
    return '终于成功';
}).then(console.log); // 第 3 次成功

try {
    await withTimeout(sleep(5000).then(() => 'done'), 1000);
} catch (e) {
    console.log((e as Error).message); // 操作超时(1000ms)
}

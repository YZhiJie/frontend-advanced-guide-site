// 文件: examples/133-04-db.worker.ts
// [StackBlitz / Worker 内运行] 依赖：@electric-sql/pglite@0.3.x
// 由 133-04-db-in-worker.ts 以 module worker 方式加载。
import { PGlite } from "@electric-sql/pglite";

type Request = { id: number; sql: string; params?: unknown[] };
type Response = { id: number; rows?: unknown[]; error?: string };

const db = new PGlite("idb://fag-worker-pg");
await db.waitReady;

self.onmessage = async (event: MessageEvent<Request>) => {
    const { id, sql, params } = event.data;
    try {
        const result = await db.query(sql, params);
        (self as unknown as Worker).postMessage({ id, rows: result.rows } satisfies Response);
    } catch (error) {
        (self as unknown as Worker).postMessage({
            id,
            error: error instanceof Error ? error.message : String(error),
        } satisfies Response);
    }
};

// 边界：
// 1) Worker 里只暴露 SQL 通道，不要把 db 实例 postMessage 出去（不可结构化克隆）；
// 2) 单条消息对应单次查询，长事务要单独设计 begin/commit 协议；
// 3) Worker 内部异常必须回传 error，否则主线程的 Promise 永远 pending。

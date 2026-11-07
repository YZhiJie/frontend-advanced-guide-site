// 文件: examples/133-04-db-in-worker.ts
// [StackBlitz / 浏览器运行] 依赖：@electric-sql/pglite@0.3.x
// 不参与 npx tsx 实跑；跨文件 import 由 StackBlitz 一并加载。
// 把数据库放 Worker：主线程只发消息，查询不阻塞输入与动画。
const worker = new Worker(new URL("./133-04-db.worker.ts", import.meta.url), { type: "module" });

type Request = { id: number; sql: string; params?: unknown[] };
type Response = { id: number; rows?: unknown[]; error?: string };

function query(sql: string, params?: unknown[]): Promise<unknown[]> {
    const id = Math.floor(Math.random() * 1e9);
    return new Promise((resolve, reject) => {
        const onMessage = (event: MessageEvent<Response>) => {
            if (event.data.id !== id) return;
            worker.removeEventListener("message", onMessage);
            event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.rows ?? []);
        };
        worker.addEventListener("message", onMessage);
        worker.postMessage({ id, sql, params } satisfies Request);
    });
}

await query(`
  CREATE TABLE IF NOT EXISTS events (
    id bigserial PRIMARY KEY,
    name text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz DEFAULT now()
  )
`);
await query("INSERT INTO events (name, payload) VALUES ($1, $2::jsonb)", ["app_open", JSON.stringify({ v: 1 })]);
const rows = await query("SELECT name, count(*)::int AS n FROM events GROUP BY name");
console.log(rows);

// 边界：
// 1) 所有 SQL 走消息协议，别把 PGlite 实例暴露给主线程；
// 2) 消息要带 request id，否则并发查询会串结果；
// 3) Worker 崩溃要有重启与重连策略，队列里的请求要重放。

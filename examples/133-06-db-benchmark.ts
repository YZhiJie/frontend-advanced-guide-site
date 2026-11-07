// 文件: examples/133-06-db-benchmark.ts
// [StackBlitz / 浏览器运行] 依赖：@electric-sql/pglite@0.3.x
// 不参与 npx tsx 实跑（WASM + 浏览器存储）。
// 同一份数据分别走 IndexedDB 与 PGlite，测「批量写 + 条件查询」的真实耗时。
import { PGlite } from "@electric-sql/pglite";

const N = 2_000;

function openIDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("fag-bench", 1);
        request.onupgradeneeded = () => {
            const store = request.result.createObjectStore("events", { keyPath: "id" });
            store.createIndex("by-created", "createdAt");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function benchIDB(): Promise<{ write: number; read: number }> {
    const db = await openIDB();
    const writeStart = performance.now();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("events", "readwrite");
        const store = tx.objectStore("events");
        for (let i = 0; i < N; i++) {
            store.put({ id: `e-${i}`, createdAt: Date.now() + i, payload: { i } });
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
    const write = performance.now() - writeStart;

    const readStart = performance.now();
    await new Promise<void>((resolve) => {
        const tx = db.transaction("events", "readonly");
        const index = tx.objectStore("events").index("by-created");
        const request = index.getAll(IDBKeyRange.lowerBound(Date.now() + N - 100));
        request.onsuccess = () => resolve();
    });
    return { write, read: performance.now() - readStart };
}

async function benchPGlite(): Promise<{ write: number; read: number }> {
    const db = new PGlite("idb://fag-bench-pg");
    await db.waitReady;
    await db.exec(`
        DROP TABLE IF EXISTS events;
        CREATE TABLE events (id text PRIMARY KEY, created_at bigint NOT NULL, payload jsonb);
        CREATE INDEX idx_events_created ON events(created_at);
    `);

    const writeStart = performance.now();
    await db.transaction(async (tx) => {
        for (let i = 0; i < N; i++) {
            await tx.query("INSERT INTO events VALUES ($1, $2, $3)", [
                `e-${i}`,
                Date.now() + i,
                { i },
            ]);
        }
    });
    const write = performance.now() - writeStart;

    const readStart = performance.now();
    await db.query("SELECT count(*) FROM events WHERE created_at >= $1", [Date.now() + N - 100]);
    return { write, read: performance.now() - readStart };
}

const idb = await benchIDB();
const pg = await benchPGlite();
console.table({
    IndexedDB: { writeMs: Math.round(idb.write), readMs: Math.round(idb.read) },
    PGlite: { writeMs: Math.round(pg.write), readMs: Math.round(pg.read) },
});

// 边界：
// 1) 这是浏览器实机数字，受设备/存储压力影响，只做同机对比不做绝对阈值；
// 2) PGlite 逐条 INSERT 比 IDB 单事务批量慢，真实场景应拼多值 INSERT；
// 3) 测前清空数据、测后删除测试库，别把基准数据混进用户数据。

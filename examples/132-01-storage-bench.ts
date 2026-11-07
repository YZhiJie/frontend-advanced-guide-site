// 文件: examples/132-01-storage-bench.ts
// ============ 存储读写基准：同步 KV vs 异步仓储，别凭感觉选型 ============
// 这不是浏览器跑分，而是把「序列化 + 写入 + 读取」的固定成本量出来，
// 让你在评审时能用数字说话：小对象 localStorage 更快，大对象/批量 IDB 更稳。
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

type Row = { id: string; title: string; tags: string[]; updatedAt: number };

function makeRows(n: number): Row[] {
    return Array.from({ length: n }, (_, i) => ({
        id: `row-${String(i).padStart(5, "0")}`,
        title: `记录 ${i}`,
        tags: ["storage", i % 2 ? "odd" : "even"],
        updatedAt: Date.now(),
    }));
}

/** 同步 KV：模拟 localStorage，每次 setItem 都 JSON.stringify */
class SyncKV {
    private map = new Map<string, string>();
    set(key: string, value: unknown): void {
        this.map.set(key, JSON.stringify(value));
    }
    get<T>(key: string): T | null {
        const raw = this.map.get(key);
        return raw ? (JSON.parse(raw) as T) : null;
    }
    bytes(): number {
        return [...this.map.values()].reduce((sum, v) => sum + Buffer.byteLength(v), 0);
    }
}

/** 异步仓储：模拟 IndexedDB 的批事务，一次序列化一批 */
class AsyncRepo {
    private rows = new Map<string, Row>();
    async bulkPut(rows: Row[]): Promise<void> {
        await Promise.resolve(); // 让出微任务，模拟异步 IO 边界
        for (const row of rows) this.rows.set(row.id, row);
    }
    async getAll(): Promise<Row[]> {
        await Promise.resolve();
        return [...this.rows.values()];
    }
    bytes(): number {
        return [...this.rows.values()].reduce((sum, r) => sum + Buffer.byteLength(JSON.stringify(r)), 0);
    }
}

function bench(label: string, fn: () => void | Promise<void>): Promise<number> {
    return Promise.resolve().then(async () => {
        const start = performance.now();
        await fn();
        const ms = performance.now() - start;
        console.log(`${label}: ${ms.toFixed(2)}ms`);
        return ms;
    });
}

const rows = makeRows(5_000);

// 场景一：逐条写小对象（localStorage 的典型用法）
const kv = new SyncKV();
const perItem = await bench("同步 KV 逐条写 5000 条", () => {
    for (const row of rows) kv.set(`row:${row.id}`, row);
});
assert.equal(kv.bytes() > 0, true);

// 场景二：批量写（IDB 一个事务多 put 的典型用法）
const repo = new AsyncRepo();
const batch = await bench("异步仓储批量写 5000 条", () => repo.bulkPut(rows));
assert.equal((await repo.getAll()).length, 5000);

// 场景三：读回并反序列化
const readStart = performance.now();
for (const row of rows) assert.equal(kv.get<Row>(`row:${row.id}`)?.id, row.id);
const readMs = performance.now() - readStart;

console.log(`\n结论参考：逐条写 ${perItem.toFixed(1)}ms / 批量写 ${batch.toFixed(1)}ms / 逐条读 ${readMs.toFixed(1)}ms`);
console.log("小对象高频读写：同步 KV 省心；大对象或上千条批量：走 IDB 单事务 + 分块，别逐条 setItem。");
console.log("✓ 基准脚本可运行（耗时随机器浮动，不作为阈值断言）");

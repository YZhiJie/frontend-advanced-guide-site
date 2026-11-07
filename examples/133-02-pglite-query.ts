// 文件: examples/133-02-pglite-query.ts
// [StackBlitz / 浏览器运行] 依赖：@electric-sql/pglite@0.3.x
// 不参与 npx tsx 实跑（WASM + 浏览器存储）。
// PGlite：把 PostgreSQL 编译到 WASM，数据可持久化到 IndexedDB。
import { PGlite } from "@electric-sql/pglite";

// idb:// 前缀表示落 IndexedDB；也可以传 "opfs://" 或内存模式
const db = new PGlite("idb://fag-pg");

await db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id uuid PRIMARY KEY,
    user_id text NOT NULL,
    amount numeric(12,2) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
`);

await db.query(
    "INSERT INTO orders (id, user_id, amount) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
    [crypto.randomUUID(), "u-42", 128.5],
);

const { rows } = await db.query<{ user_id: string; total: string }>(
    "SELECT user_id, sum(amount)::text AS total FROM orders GROUP BY user_id",
);
console.log(rows);

// 边界：
// 1) 首次加载要下载数 MB WASM，首屏别同步初始化；
// 2) 复杂扩展（pgvector 等）需额外包，不是所有 Postgres 能力都可用；
// 3) 多标签页并发写同一 idb:// 库没有服务端锁，建议只让一个页签持有写连接。

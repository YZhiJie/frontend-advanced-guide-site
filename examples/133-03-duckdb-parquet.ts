// 文件: examples/133-03-duckdb-parquet.ts
// [StackBlitz / 浏览器运行] 依赖：@duckdb/duckdb-wasm@1.29.x、apache-arrow
// 不参与 npx tsx 实跑（WASM + Worker + 列式内存）。
// DuckDB WASM：列式分析引擎，适合在浏览器里直接查 Parquet/CSV、做聚合。
import * as duckdb from "@duckdb/duckdb-wasm";

const bundles = duckdb.getJsDelivrBundles();
const bundle = await duckdb.selectBundle(bundles);
const worker = new Worker(bundle.mainWorker!);
const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
const db = new duckdb.AsyncDuckDB(logger, worker);
await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

const conn = await db.connect();

// 注册远程 Parquet（也可用 registerFileBuffer 塞本地文件）
await db.registerFileURL(
    "orders.parquet",
    "https://example.com/data/orders.parquet",
    duckdb.DuckDBDataProtocol.HTTP,
    false,
);

const result = await conn.query(`
  SELECT region, count(*) AS orders, sum(amount) AS gmv
  FROM read_parquet('orders.parquet')
  WHERE created_at >= DATE '2026-01-01'
  GROUP BY region
  ORDER BY gmv DESC
  LIMIT 20
`);
console.log(result.toArray());

await conn.close();
await db.terminate();
worker.terminate();

// 边界：
// 1) 首次加载 JS/WASM 包体较大，按需动态 import；
// 2) 列式引擎吃内存，移动端要限制扫描文件大小；
// 3) CORS：远程 Parquet 必须允许跨域，否则 registerFileURL 读取失败。

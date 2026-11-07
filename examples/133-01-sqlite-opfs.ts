// 文件: examples/133-01-sqlite-opfs.ts
// [StackBlitz / 浏览器运行] 依赖：@sqlite.org/sqlite-wasm@3.49.1-build4
// 不参与 npx tsx 实跑（需要 WASM + OPFS + Worker）。
// SQLite WASM 官方包：init 后在 OPFS 上安装 SAH Pool VFS，得到可持久化的数据库文件。
import { sqlite3InitModule } from "@sqlite.org/sqlite-wasm";

const sqlite3 = await sqlite3InitModule({
    print: (msg) => console.log("[sqlite]", msg),
    printErr: (msg) => console.error("[sqlite:err]", msg),
});

// OPFS 上的连接池 VFS：database 文件落在源私有文件系统里，刷新页面仍在
const pool = await sqlite3.installOpfsSAHPoolVfs({ name: "fag-sqlite-pool" });
const db = new pool.OpfsSAHPoolDb("/fag.sqlite3");

db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);
`);

const insert = db.prepare("INSERT INTO notes (title, body, updated_at) VALUES (?, ?, ?)");
insert.bind(["第一条", "离线也能写", Date.now()]).stepReset();
insert.finalize();

const rows = db.exec("SELECT id, title FROM notes ORDER BY updated_at DESC LIMIT 5");
console.log(rows[0]?.values ?? []);

// 边界：
// 1) OPFS 需要 secure context（localhost 或 HTTPS）；
// 2) 同一时刻只有一个标签页能持有 SAH pool 的写锁；
// 3) 用户“清除站点数据”会连库一起删，关键数据仍要同步服务端。

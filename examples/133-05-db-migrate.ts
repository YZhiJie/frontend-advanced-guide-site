// 文件: examples/133-05-db-migrate.ts
// [StackBlitz / 浏览器运行] 依赖：@electric-sql/pglite@0.3.x
// 不参与 npx tsx 实跑（WASM + 浏览器存储）。
// 浏览器内数据库的迁移：用 schema_migrations 表记录已执行版本，按序执行、失败即停。
import { PGlite } from "@electric-sql/pglite";

type Migration = { version: number; name: string; up: string };

const migrations: Migration[] = [
    {
        version: 1,
        name: "create-notes",
        up: `
            CREATE TABLE notes (
                id bigserial PRIMARY KEY,
                title text NOT NULL,
                body text NOT NULL DEFAULT '',
                updated_at timestamptz NOT NULL DEFAULT now()
            );
        `,
    },
    {
        version: 2,
        name: "add-note-tags",
        up: `
            ALTER TABLE notes ADD COLUMN tags text[] NOT NULL DEFAULT '{}';
            CREATE INDEX idx_notes_tags ON notes USING gin(tags);
        `,
    },
    {
        version: 3,
        name: "backfill-archive-flag",
        up: `
            ALTER TABLE notes ADD COLUMN archived boolean NOT NULL DEFAULT false;
            UPDATE notes SET archived = true WHERE updated_at < now() - interval '180 days';
        `,
    },
];

export async function migrate(db: PGlite, list: Migration[]): Promise<number[]> {
    await db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version integer PRIMARY KEY,
            name text NOT NULL,
            applied_at timestamptz NOT NULL DEFAULT now()
        );
    `);

    const { rows } = await db.query<{ version: number }>(
        "SELECT version FROM schema_migrations ORDER BY version",
    );
    const applied = new Set(rows.map((r) => r.version));
    const ran: number[] = [];

    for (const migration of [...list].sort((a, b) => a.version - b.version)) {
        if (applied.has(migration.version)) continue;
        // 一个版本一个事务：失败整条回滚，不会留下半张表
        await db.transaction(async (tx) => {
            await tx.exec(migration.up);
            await tx.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [
                migration.version,
                migration.name,
            ]);
        });
        ran.push(migration.version);
    }
    return ran;
}

const db = new PGlite("idb://fag-migrate");
await db.waitReady;

console.log("本次执行:", await migrate(db, migrations));
console.log("再次执行为空:", await migrate(db, migrations)); // 幂等：已应用的跳过

// 边界：
// 1) 迁移只前进不回退，回滚靠备份或导出快照，别在生产库上写 down；
// 2) 每个版本单独事务，DDL 与数据回填放在同一个事务里；
// 3) 多标签页同时打开会重复迁移，应用 navigator.locks 串行化。

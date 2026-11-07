// 文件: examples/132-02-idb-migrate-plan.ts
// ============ schema 迁移计划：把「跨版本升级」变成可测试的纯函数 ============
// IndexedDB 的 onupgradeneeded 难单测，但「从 vN 升到 vM 要跑哪些步骤」是纯逻辑。
// 先把计划算出来并断言，再在 onupgradeneeded 里按计划执行，能避免漏版本、重复建索引。
import assert from "node:assert/strict";

type Migration = {
    version: number; // 目标版本，必须从 1 连续递增
    up: (db: FakeDB) => void;
};

class FakeDB {
    stores = new Map<string, { keyPath: string; indexes: Set<string> }>();
    createStore(name: string, keyPath: string) {
        if (this.stores.has(name)) throw new Error(`store exists: ${name}`);
        this.stores.set(name, { keyPath, indexes: new Set() });
    }
    createIndex(store: string, index: string) {
        const s = this.stores.get(store);
        if (!s) throw new Error(`store missing: ${store}`);
        s.indexes.add(index);
    }
    snapshot() {
        return [...this.stores.entries()].map(([name, s]) => `${name}(${[...s.indexes].sort().join(",")})`);
    }
}

const migrations: Migration[] = [
    { version: 1, up: (db) => db.createStore("books", "id") },
    { version: 2, up: (db) => db.createIndex("books", "by-title") },
    { version: 3, up: (db) => db.createIndex("books", "by-author") },
    { version: 4, up: (db) => db.createIndex("books", "by-updated") },
];

/** 只跑 oldVersion < step.version <= newVersion 的步骤；未来版本直接拒绝 */
function plan(from: number, to: number): Migration[] {
    if (to < from) throw new Error(`不允许降级：${from} → ${to}`);
    const steps = migrations.filter((m) => m.version > from && m.version <= to);
    // 连续性校验：不能从 v1 直接跳到 v4 却漏了 v2/v3 的定义
    for (let v = from + 1; v <= to; v++) {
        if (!migrations.some((m) => m.version === v)) throw new Error(`缺少 v${v} 的迁移`);
    }
    return steps;
}

function apply(from: number, to: number): FakeDB {
    const db = new FakeDB();
    for (const step of plan(from, to)) step.up(db);
    return db;
}

// 全新安装：v0 → v4，建 store + 三个索引
assert.deepEqual(apply(0, 4).snapshot(), ["books(by-author,by-title,by-updated)"]);

// 老用户：v1 → v4，只补索引，不重复建 store
const upgraded = new FakeDB();
upgraded.createStore("books", "id"); // 模拟 v1 已存在
for (const step of plan(1, 4)) step.up(upgraded);
assert.deepEqual(upgraded.snapshot(), ["books(by-author,by-title,by-updated)"]);

// 已经是 v4：零步骤
assert.equal(plan(4, 4).length, 0);

// 降级/缺版本必须报错，而不是静默跳过
assert.throws(() => plan(4, 3), /不允许降级/);
const broken: Migration[] = [{ version: 1, up: () => {} }, { version: 3, up: () => {} }];
const oldMigrations = migrations.splice(0, migrations.length, ...broken);
assert.throws(() => plan(0, 3), /缺少 v2/);
migrations.splice(0, migrations.length, ...oldMigrations);

// 幂等性：同一版本跑两次结果一致（迁移函数本身应可重复执行）
const a = apply(0, 4).snapshot();
const b = apply(0, 4).snapshot();
assert.deepEqual(a, b);

console.log("✓ 迁移计划：全新建库 / 老库补索引 / 零步骤 / 降级拒绝 / 缺版本拒绝 / 幂等 六类断言通过");

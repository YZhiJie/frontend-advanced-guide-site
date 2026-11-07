// 文件: examples/132-03-idb-pagination.ts
// ============ 游标分页：after-key 而不是 offset，避免重复/跳条 ============
// 对应 IndexedDB 的 openCursor(IDBKeyRange.lowerBound(after, true))；
// 这里用有序数组模拟游标，断言「翻页不重不漏、删除后仍稳定」。
import assert from "node:assert/strict";

type Row = { id: string; createdAt: number };

function page(rows: Row[], afterId: string | null, size: number): { items: Row[]; next: string | null } {
    const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const start = afterId === null ? 0 : sorted.findIndex((r) => r.id > afterId);
    if (start === -1) return { items: [], next: null };
    const items = sorted.slice(start, start + size);
    return { items, next: items.length === size ? items.at(-1)!.id : null };
}

function collectAll(rows: Row[], size: number): string[] {
    const ids: string[] = [];
    let after: string | null = null;
    for (let guard = 0; guard < 100; guard++) {
        const { items, next } = page(rows, after, size);
        ids.push(...items.map((r) => r.id));
        if (!next) break;
        after = next;
    }
    return ids;
}

const rows: Row[] = Array.from({ length: 47 }, (_, i) => ({ id: `r-${String(i).padStart(3, "0")}`, createdAt: i }));

// 1) 全量翻页：47 条不重不漏
const ids = collectAll(rows, 10);
assert.equal(ids.length, 47);
assert.equal(new Set(ids).size, 47);
assert.deepEqual(ids, [...ids].sort());

// 2) 页大小边界：最后一页不足 size，next 为 null
assert.deepEqual(page(rows, null, 50).items.length, 47);
assert.equal(page(rows, null, 50).next, null);

// 3) 翻页过程中删除已读数据，后续页不会跳条
const mutable = [...rows];
const first = page(mutable, null, 10);
mutable.splice(0, 5); // 用户删掉了前 5 条
const second = page(mutable, first.items.at(-1)!.id, 10);
assert.equal(second.items[0].id, "r-010");
assert.equal(second.items.length, 10);

// 4) after 指向已删除的 key：仍能从下一个更大 key 继续
const afterDeleted = page(mutable, "r-002", 5);
assert.equal(afterDeleted.items[0].id, "r-005");

// 5) 空结果
assert.deepEqual(page([], null, 10), { items: [], next: null });

// 6) 反向分页（从新到旧）：用 upperBound(key, true) 的等价逻辑
function pageBackward(rows: Row[], beforeId: string | null, size: number): Row[] {
    const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
    const end = beforeId === null ? sorted.length : sorted.findIndex((r) => r.id >= beforeId);
    return sorted.slice(Math.max(0, end - size), end);
}
assert.deepEqual(pageBackward(rows, null, 5).map((r) => r.id), ["r-042", "r-043", "r-044", "r-045", "r-046"]);
assert.deepEqual(pageBackward(rows, "r-042", 5).map((r) => r.id), ["r-037", "r-038", "r-039", "r-040", "r-041"]);

console.log("✓ 游标分页：全量不重不漏 / 最后一页 / 删除后稳定 / 已删 key / 空集 / 反向 六类断言通过");

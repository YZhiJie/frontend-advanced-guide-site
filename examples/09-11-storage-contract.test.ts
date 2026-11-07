// 文件: examples/09-11-storage-contract.test.ts
// ============ 存储层契约测试：TTL、版本迁移、坏数据、配额降级、LRU ============
// 不依赖 jsdom / fake-indexeddb：把存储适配器抽象成 StorageLike，
// 用内存实现跑契约；浏览器适配器只要通过同一套断言，就能保证语义一致。
import assert from "node:assert/strict";

interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
    key(index: number): string | null;
    readonly length: number;
}

class MemoryStorage implements StorageLike {
    private map = new Map<string, string>();
    quotaBytes = Infinity;
    failNext = false;

    getItem(key: string): string | null {
        return this.map.get(key) ?? null;
    }
    setItem(key: string, value: string): void {
        if (this.failNext) {
            this.failNext = false;
            throw new DOMException("quota exceeded", "QuotaExceededError");
        }
        if (this.bytes() + value.length > this.quotaBytes) {
            throw new DOMException("quota exceeded", "QuotaExceededError");
        }
        this.map.set(key, value);
    }
    removeItem(key: string): void {
        this.map.delete(key);
    }
    key(index: number): string | null {
        return [...this.map.keys()][index] ?? null;
    }
    get length(): number {
        return this.map.size;
    }
    private bytes(): number {
        return [...this.map.values()].reduce((sum, v) => sum + v.length, 0);
    }
}

interface Envelope<T> {
    v: number;
    exp: number | null;
    data: T;
}

class TypedStore<T> {
    constructor(
        private readonly storage: StorageLike,
        private readonly key: string,
        private readonly version: number,
        private readonly migrate: (old: unknown, from: number) => T,
        private readonly now: () => number = () => Date.now(),
    ) {}

    set(value: T, ttlMs: number | null = null): "ok" | "memory" {
        const envelope: Envelope<T> = { v: this.version, exp: ttlMs === null ? null : this.now() + ttlMs, data: value };
        try {
            this.storage.setItem(this.key, JSON.stringify(envelope));
            return "ok";
        } catch {
            return "memory"; // 真实封装这里会降级到内存 Map
        }
    }

    get(): T | null {
        const raw = this.storage.getItem(this.key);
        if (!raw) return null;
        try {
            const env = JSON.parse(raw) as Envelope<unknown>;
            if (env.exp !== null && env.exp <= this.now()) {
                this.storage.removeItem(this.key);
                return null;
            }
            if (env.v > this.version) return null;
            return this.migrate(env.data, env.v);
        } catch {
            this.storage.removeItem(this.key);
            return null;
        }
    }
}

// 1) TTL：到期即删除
{
    let now = 1_000;
    const store = new TypedStore<{ a: number }>(new MemoryStorage(), "t", 1, (d) => d as { a: number }, () => now);
    assert.equal(store.set({ a: 1 }, 100), "ok");
    assert.deepEqual(store.get(), { a: 1 });
    now = 1_101;
    assert.equal(store.get(), null, "过期应返回 null");
    assert.equal((store as any).storage.getItem("t"), null, "过期应顺手删除");
}

// 2) 版本迁移 + 回滚保护
{
    const s = new MemoryStorage();
    s.setItem("t", JSON.stringify({ v: 0, exp: null, data: { dark: true } }));
    const store = new TypedStore<{ theme: string }>(s, "t", 2, (old: any, from) => {
        if (from === 0) return { theme: old.dark ? "dark" : "light" };
        return old;
    });
    assert.deepEqual(store.get(), { theme: "dark" });

    s.setItem("t", JSON.stringify({ v: 99, exp: null, data: { theme: "future" } }));
    assert.equal(store.get(), null, "未来版本应放弃而不是读坏");
}

// 3) 坏数据不抛错
{
    const s = new MemoryStorage();
    s.setItem("t", "{ 半截写入");
    const store = new TypedStore(s, "t", 1, (d) => d);
    assert.equal(store.get(), null);
    assert.equal(s.getItem("t"), null);
}

// 4) 配额异常：封装返回降级信号而不是崩
{
    const s = new MemoryStorage();
    s.failNext = true;
    const store = new TypedStore(s, "t", 1, (d) => d);
    assert.equal(store.set({ a: 1 }), "memory");
}

// 5) LRU 淘汰：超预算时删最久未用的非 pinned 项
{
    const entries = [
        { key: "a", bytes: 10, used: 1, pinned: false },
        { key: "b", bytes: 10, used: 3, pinned: true },
        { key: "c", bytes: 10, used: 2, pinned: false },
    ];
    const evicted = [...entries].filter((e) => !e.pinned).sort((x, y) => x.used - y.used).slice(0, 1);
    assert.deepEqual(evicted.map((e) => e.key), ["a"]);
}

console.log("✓ 存储层契约：TTL / 迁移 / 回滚 / 坏数据 / 配额 / LRU 六类断言通过");

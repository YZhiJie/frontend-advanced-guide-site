// 文件: examples/05-03-framework-persist.ts
// ============ 三大状态库的持久化配置契约（不依赖框架，可实跑） ============
// 说明：Pinia / zustand / redux-persist 的真实 import 写法在 05.7.1 正文里，
// 需要在对应框架工程内运行。本示例把三者的持久化配置抽象成同一份 StorageLike，
// 断言「版本迁移、字段白名单、跨账号 key 前缀」三件事的语义一致，避免照抄配置却漏边界。
import assert from "node:assert/strict";

interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

class MemoryStorage implements StorageLike {
    readonly map = new Map<string, string>();
    failNextWrite = false;

    getItem(key: string): string | null {
        return this.map.get(key) ?? null;
    }

    setItem(key: string, value: string): void {
        if (this.failNextWrite) {
            this.failNextWrite = false;
            throw new DOMException("quota exceeded", "QuotaExceededError");
        }
        this.map.set(key, value);
    }

    removeItem(key: string): void {
        this.map.delete(key);
    }

    keys(): string[] {
        return [...this.map.keys()];
    }
}

type Envelope<T> = { version: number; data: T };

/** 三框架共用的信封：版本 + 白名单后的数据 */
function writeEnvelope<T>(storage: StorageLike, key: string, version: number, data: T): void {
    storage.setItem(key, JSON.stringify({ version, data } satisfies Envelope<T>));
}

function readEnvelope<T>(storage: StorageLike, key: string, current: number, migrate: (v: number, d: unknown) => T): T | null {
    const raw = storage.getItem(key);
    if (!raw) return null;
    try {
        const env = JSON.parse(raw) as Envelope<unknown>;
        if (env.version > current) return null; // 回滚保护：旧代码读不懂新数据
        return migrate(env.version, env.data);
    } catch {
        return null;
    }
}

// ---- Pinia: pinia-plugin-persistedstate 的等价配置 ----
const piniaConfig = {
    key: (userId: string) => `fag:pinia:cart:${userId}`,
    version: 2,
    pick: ["items", "couponId"] as const,
    migrate: (old: any, version: number) => {
        if (version === 0) return { items: old.cart.map((id: string) => ({ id, qty: 1 })), couponId: null };
        return old;
    },
};

// ---- zustand: persist 中间件的等价配置 ----
const zustandConfig = {
    name: "fag:zustand:cart",
    key: (userId: string) => `fag:zustand:cart:${userId}`,
    version: 2,
    partialize: (state: any) => ({ items: state.items, couponId: state.couponId }),
    migrate: (persisted: any, version: number) => {
        if (version === 0) return { items: persisted.cart.map((id: string) => ({ id, qty: 1 })), couponId: null };
        return persisted;
    },
};

// ---- redux-persist: persistReducer 的等价配置 ----
const reduxConfig = {
    key: (userId: string) => `fag:redux:cart:${userId}`,
    version: 2,
    whitelist: ["cart"],
    migrate: (state: any, version: number) => {
        if (version === 0) return { cart: { items: state.cart.map((id: string) => ({ id, qty: 1 })), couponId: null } };
        return state;
    },
};

const storage = new MemoryStorage();
const uid = "u-42";

// v0 老数据：cart 是 string[]
storage.setItem(piniaConfig.key(uid), JSON.stringify({ version: 0, data: { cart: ["s-1", "s-2"], loading: true } }));
const piniaState = readEnvelope(storage, piniaConfig.key(uid), piniaConfig.version, (v, d) => piniaConfig.migrate(d, v));
assert.deepEqual(piniaState, { items: [{ id: "s-1", qty: 1 }, { id: "s-2", qty: 1 }], couponId: null });
assert.equal("loading" in (piniaState as object), false, "白名单不应持久化 loading");

writeEnvelope(storage, zustandConfig.key(uid), zustandConfig.version, zustandConfig.partialize({ items: [{ id: "s-3", qty: 2 }], couponId: "c-1", loading: true }));
const zustandState = readEnvelope(storage, zustandConfig.key(uid), zustandConfig.version, (_, d) => d);
assert.deepEqual(zustandState, { items: [{ id: "s-3", qty: 2 }], couponId: "c-1" });
assert.equal("loading" in (zustandState as object), false);

storage.setItem(reduxConfig.key(uid), JSON.stringify({ version: 0, data: { cart: ["s-9"] } }));
const reduxState = readEnvelope(storage, reduxConfig.key(uid), reduxConfig.version, (v, d) => reduxConfig.migrate(d, v));
assert.deepEqual(reduxState, { cart: { items: [{ id: "s-9", qty: 1 }], couponId: null } });

// ---- 边界一：账号隔离，不同 userId 不互相覆盖 ----
writeEnvelope(storage, piniaConfig.key("u-43"), 2, { items: [], couponId: null });
assert.notDeepEqual(storage.getItem(piniaConfig.key(uid)), storage.getItem(piniaConfig.key("u-43")));
assert.equal(storage.keys().filter((k) => k.startsWith("fag:pinia:cart:")).length, 2);

// ---- 边界二：未来版本回滚，返回 null 而不是把新数据读坏 ----
storage.setItem(zustandConfig.key(uid), JSON.stringify({ version: 99, data: { items: "future" } }));
assert.equal(readEnvelope(storage, zustandConfig.key(uid), 2, (_, d) => d), null);

// ---- 边界三：配额异常要让上层可降级，而不是崩在 setItem ----
storage.failNextWrite = true;
assert.throws(() => writeEnvelope(storage, piniaConfig.key(uid), 2, { items: [] }), /quota/i);
console.log("✓ 三框架持久化契约：迁移 / 白名单 / 账号隔离 / 回滚 / 配额异常五类断言通过");

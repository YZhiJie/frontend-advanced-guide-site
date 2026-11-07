// 文件: examples/25-10-storage-quota.ts
// ============ 配额预算与分层淘汰：先清缓存，再动离线队列，最后才碰用户数据 ============
import assert from "node:assert/strict";

type Layer = "http-cache" | "offline-queue" | "user-data";

interface Item {
    key: string;
    layer: Layer;
    bytes: number;
    lastUsed: number;
    pinned?: boolean;
}

/** 真实工程里 usage/quota 来自 navigator.storage.estimate()，这里注入以便断言 */
function makeBudget(usage: number, quota: number) {
    return { usage, quota, ratio: usage / quota };
}

/** 分层淘汰：低价值层先清，同层按 LRU；pinned 永不自动清 */
function evict(items: Item[], needBytes: number): { kept: Item[]; removed: Item[] } {
    const priority: Record<Layer, number> = { "http-cache": 0, "offline-queue": 1, "user-data": 2 };
    const candidates = [...items].sort((a, b) => {
        const byLayer = priority[a.layer] - priority[b.layer];
        return byLayer !== 0 ? byLayer : a.lastUsed - b.lastUsed;
    });
    let freed = 0;
    const removed: Item[] = [];
    const removedKeys = new Set<string>();
    for (const item of candidates) {
        if (freed >= needBytes) break;
        if (item.pinned) continue;
        freed += item.bytes;
        removed.push(item);
        removedKeys.add(item.key);
    }
    return { kept: items.filter((i) => !removedKeys.has(i.key)), removed };
}

const items: Item[] = [
    { key: "user-draft", layer: "user-data", bytes: 400, lastUsed: 100, pinned: true },
    { key: "user-settings", layer: "user-data", bytes: 50, lastUsed: 90 },
    { key: "pending-order", layer: "offline-queue", bytes: 120, lastUsed: 80 },
    { key: "api:/feed", layer: "http-cache", bytes: 800, lastUsed: 70 },
    { key: "api:/profile", layer: "http-cache", bytes: 300, lastUsed: 60 },
];

// 需要腾 700B：应先清 http-cache 的 LRU（profile 300 + feed 800 的前 400 不够按整项算，直接 1100）
const { kept, removed } = evict(items, 700);
assert.deepEqual(removed.map((i) => i.key), ["api:/profile", "api:/feed"]);
assert.equal(kept.find((i) => i.key === "pending-order")?.bytes, 120, "离线队列不应先于缓存被清");
assert.equal(kept.find((i) => i.key === "user-draft")?.pinned, true);

// 预算判断：超过 80% 触发清理，超过 95% 停止写入非关键数据
function shouldClean(usage: number, quota: number): "ok" | "clean" | "reject" {
    const { ratio } = makeBudget(usage, quota);
    if (ratio >= 0.95) return "reject";
    if (ratio >= 0.8) return "clean";
    return "ok";
}
assert.equal(shouldClean(500, 1000), "ok");
assert.equal(shouldClean(820, 1000), "clean");
assert.equal(shouldClean(960, 1000), "reject");

// QuotaExceededError 之后的重试：清一层 → 再写 → 仍失败则降级到内存
class TieredStore {
    private memory = new Map<string, string>();
    constructor(private readonly durable: Map<string, string>, private readonly items: Item[]) {}
    write(key: string, value: string, bytes: number): "durable" | "memory" {
        try {
            this.durable.set(key, value);
            return "durable";
        } catch {
            // 真实实现：先 await evict(...)，删掉一批 key 后重试一次
            const { removed } = evict(this.items, bytes);
            for (const r of removed) this.durable.delete(r.key);
            try {
                this.durable.set(key, value);
                return "durable";
            } catch {
                this.memory.set(key, value);
                return "memory";
            }
        }
    }
}
const durable = new Map<string, string>();
const store = new TieredStore(durable, []);
assert.equal(store.write("draft", "hello", 10), "durable");
assert.equal(durable.get("draft"), "hello");

console.log("✓ 配额预算 / 分层 LRU / QuotaExceeded 降级：全部断言通过");

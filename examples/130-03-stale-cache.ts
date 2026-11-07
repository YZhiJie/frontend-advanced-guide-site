// 文件: examples/130-03-stale-cache.ts
// 130.4 SWR 内核：先返回旧数据，再后台重验证；TTL、GC、错误回退
// 对照 SWR / TanStack Query 的 staleTime、gcTime、revalidateOnFocus 语义。
import assert from "node:assert/strict";

export interface CacheEntry<T> {
  data: T;
  updatedAt: number;
  error?: unknown;
  promise?: Promise<T>; // 在途重验证
}

export interface CacheOptions {
  staleTime?: number; // 多久后视为 stale（仍可用，触发后台刷新）
  gcTime?: number;    // 多久没有访问后删除
}

export class StaleWhileRevalidateCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private lastAccess = new Map<string, number>();
  private options: Required<CacheOptions>;

  constructor(options: CacheOptions = {}) {
    this.options = { staleTime: options.staleTime ?? 30_000, gcTime: options.gcTime ?? 300_000 };
  }

  /** 纯读：返回当前值（可能 stale），不触发请求、不刷新访问时间 */
  peek<T>(key: string): T | undefined {
    return this.cache.get(key)?.data as T | undefined;
  }

  /** 读 + 按需重验证：命中且新鲜直接返回；stale 先返回旧值并后台刷新 */
  async get<T>(
    key: string,
    fetcher: () => Promise<T>,
    now = Date.now(),
  ): Promise<{ data: T; fromCache: boolean; revalidating: boolean }> {
    this.lastAccess.set(key, now);
    const hit = this.cache.get(key) as CacheEntry<T> | undefined;
    if (hit && !hit.error) {
      const fresh = now - hit.updatedAt < this.options.staleTime;
      if (fresh && !hit.promise) return { data: hit.data, fromCache: true, revalidating: false };
      if (!hit.promise) {
        hit.promise = fetcher()
          .then((data) => {
            this.cache.set(key, { data, updatedAt: Date.now() });
            return data;
          })
          .catch((error) => {
            // 后台失败不覆盖旧数据，只记录错误，UI 可提示「更新失败」
            this.cache.set(key, { ...hit, error });
            throw error;
          })
          .finally(() => {
            const latest = this.cache.get(key) as CacheEntry<T> | undefined;
            if (latest) delete latest.promise;
          });
        hit.promise.catch(() => {}); // 防止未处理 rejection
      }
      return { data: hit.data, fromCache: true, revalidating: true };
    }
    // 未命中：阻塞请求
    const data = await fetcher();
    this.cache.set(key, { data, updatedAt: now });
    return { data, fromCache: false, revalidating: false };
  }

  /** 主动写入（乐观更新） */
  set<T>(key: string, data: T, now = Date.now()): void {
    this.cache.set(key, { data, updatedAt: now });
    this.lastAccess.set(key, now);
  }

  /** 标记失效：下次 get 触发后台刷新 */
  invalidate(key: string): void {
    const hit = this.cache.get(key);
    if (hit) this.cache.set(key, { ...hit, updatedAt: 0 });
  }

  /** GC：清理超过 gcTime 未访问的条目 */
  gc(now = Date.now()): number {
    let removed = 0;
    for (const key of this.cache.keys()) {
      const at = this.lastAccess.get(key) ?? 0;
      if (now - at > this.options.gcTime) {
        this.cache.delete(key);
        this.lastAccess.delete(key);
        removed++;
      }
    }
    return removed;
  }

  size(): number {
    return this.cache.size;
  }
}

// ---------------- 断言 ----------------
const cache = new StaleWhileRevalidateCache({ staleTime: 1000, gcTime: 10_000 });
let fetches = 0;
const fetcher = async () => { fetches++; return { name: "Ada" }; };

// 1) 首次：阻塞请求
let r = await cache.get("user:1", fetcher, 0);
assert.equal(r.fromCache, false);
assert.equal(fetches, 1);

// 2) 新鲜期内：直接命中，不再请求
r = await cache.get("user:1", fetcher, 500);
assert.equal(r.fromCache, true);
assert.equal(r.revalidating, false);
assert.equal(fetches, 1);

// 3) stale：先返回旧值，同时后台刷新
r = await cache.get("user:1", fetcher, 2000);
assert.equal(r.fromCache, true);
assert.equal(r.revalidating, true);
assert.equal(r.data.name, "Ada");
await Promise.resolve();
await Promise.resolve();
assert.equal(fetches, 2, "后台确实发起了刷新");

// 4) 并发 stale 读：只触发一次重验证
fetches = 0;
cache.set("user:2", { name: "old" }, 0);
const [a, b] = await Promise.all([
  cache.get("user:2", async () => { fetches++; return { name: "new" }; }, 5000),
  cache.get("user:2", async () => { fetches++; return { name: "new" }; }, 5000),
]);
assert.equal(a.data.name, "old");
assert.equal(b.data.name, "old");
await Promise.resolve();
assert.equal(fetches, 1, "并发重验证必须合并");

// 5) 后台失败不覆盖旧数据
cache.set("user:3", { name: "keep" }, 0);
const fail = await cache.get("user:3", async () => { throw new Error("network"); }, 5000);
assert.equal(fail.data.name, "keep");
await new Promise((r2) => setTimeout(r2, 0));
assert.equal(cache.peek<{ name: string }>("user:3")?.name, "keep");

// 6) invalidate 强制刷新
cache.invalidate("user:1");
r = await cache.get("user:1", fetcher, 3000);
assert.equal(r.revalidating, true);

// 7) GC
const beforeGc = cache.size();
assert.equal(cache.gc(1_000_000), beforeGc, "全部过期被清理");
assert.equal(cache.size(), 0);

console.log("✓ 130-03 SWR 命中、后台刷新、并发合并、失败回退与 GC 断言全部通过");

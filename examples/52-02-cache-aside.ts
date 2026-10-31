// 文件: examples/52-02-cache-aside.ts
// ============ Cache-Aside + 单飞(SingleFlight):缓存穿透、击穿与并发回源 ============
// 设计要点:
// 1) Cache-Aside:读缓存 → 未命中查库 → 回填;写库后删缓存,而不是改缓存;
// 2) 击穿:热点 key 过期瞬间大量请求同时回源 —— 用单飞把并发压成 1 次;
// 3) 穿透:查询不存在的数据 —— 缓存空值 + 短 TTL,避免每次都打库;
// 4) TTL 要加抖动,避免同一批 key 同时过期。

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class SingleFlight {
  private inflight = new Map<string, Promise<unknown>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;
    const p = task().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  get size(): number {
    return this.inflight.size;
  }
}

class CacheAside<T> {
  private store = new Map<string, CacheEntry<T>>();
  hits = 0;
  misses = 0;
  loadCount = 0;
  private flight = new SingleFlight();

  constructor(
    private loader: (key: string) => Promise<T>,
    private ttlMs = 1000,
    private nullTtlMs = 200,
  ) {}

  private jitter(ttl: number): number {
    // ±20% 抖动:避免缓存雪崩式的「同一秒全部过期」
    return Math.round(ttl * (0.8 + Math.random() * 0.4));
  }

  async get(key: string): Promise<T> {
    const hit = this.store.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      this.hits++;
      return hit.value;
    }
    this.misses++;

    // 单飞:同一 key 的并发未命中只回源一次
    return this.flight.run(key, async () => {
      this.loadCount++;
      const value = await this.loader(key);
      const ttl = value == null ? this.nullTtlMs : this.ttlMs;
      this.store.set(key, { value, expiresAt: Date.now() + this.jitter(ttl) });
      return value;
    });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

// ---------------- 场景 1:并发击穿被单飞收敛 ----------------
let dbCalls = 0;
const cache = new CacheAside<string>(async (key) => {
  dbCalls++;
  await delay(20);
  return `value:${key}`;
}, 60);

const concurrent = await Promise.all(
  Array.from({ length: 10 }, () => cache.get("hot:1")),
);
console.log(`10 个并发请求 → 回源 ${dbCalls} 次,结果一致: ${new Set(concurrent).size === 1}`);
assert(dbCalls === 1, "并发未命中应被单飞收敛为 1 次回源");
assert(new Set(concurrent).size === 1, "所有请求应拿到同一结果");

// ---------------- 场景 2:命中缓存,不再回源 ----------------
await cache.get("hot:1");
assert(dbCalls === 1 && cache.hits === 1, "TTL 内应命中缓存");

// ---------------- 场景 3:TTL 过期后重新回源 ----------------
await delay(80);
await cache.get("hot:1");
console.log(`TTL 过期后回源总次数: ${dbCalls}`);
assert(dbCalls === 2, "过期后应重新加载一次");

// ---------------- 场景 4:穿透数据缓存空值 ----------------
let nullCalls = 0;
const nullCache = new CacheAside<string | null>(async () => {
  nullCalls++;
  await delay(5);
  return null; // 模拟查不到
}, 1000);
const r1 = await nullCache.get("missing");
const r2 = await nullCache.get("missing");
console.log(`不存在的 key 查询 2 次 → 回源 ${nullCalls} 次,结果: ${r1}, ${r2}`);
assert(nullCalls === 1 && r1 === null && r2 === null, "空值应短 TTL 缓存,防止穿透");

// ---------------- 场景 5:写后失效 ----------------
const writeCache = new CacheAside<number>(async () => ++dbCalls, 1000);
const before = await writeCache.get("k");
writeCache.invalidate("k");
const after = await writeCache.get("k");
console.log(`写后失效:${before} → ${after}`);
assert(before !== after, "invalidate 后应重新加载");

console.log("\n缓存层通过:单飞、TTL、空值缓存、写后失效均有确定行为。");

// 标记为模块,避免与其它示例的顶层变量重名
export {};

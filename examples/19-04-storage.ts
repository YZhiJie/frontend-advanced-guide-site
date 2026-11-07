// 文件: examples/19-04-storage.ts
// ============ 类型安全 + 过期时间 + 统一前缀的存储封装 ============
// 裸用 localStorage 的三个痛点:到处 JSON.parse 且不处理损坏数据、
// 没有过期机制(缓存与长期配置混在一起)、多项目同域 key 互相污染。

/** 存储适配器:localStorage / sessionStorage / 内存 mock 都满足这个形状 */
export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/** 序列化结构:e 为过期时间戳(ms),不存在表示永不过期 */
interface Envelope<T> {
    v: T;
    e?: number;
}

/** 测试/SSR 用的内存适配器(浏览器里直接传 localStorage 即可) */
export class MemoryStorage implements StorageLike {
    private map = new Map<string, string>();

    get length(): number {
        return this.map.size;
    }

    key(index: number): string | null {
        return Array.from(this.map.keys())[index] ?? null;
    }

    getItem(key: string): string | null {
        return this.map.has(key) ? (this.map.get(key) as string) : null;
    }

    setItem(key: string, value: string): void {
        this.map.set(key, value);
    }

    removeItem(key: string): void {
        this.map.delete(key);
    }
}

export interface StorageOptions {
    /** 适配器,默认内存实现;浏览器环境传 localStorage */
    adapter?: StorageLike;
    /** key 前缀,多项目同域部署时隔离命名空间 */
    prefix?: string;
}

export class TypedStorage {
    private readonly adapter: StorageLike;
    private readonly prefix: string;

    constructor(options: StorageOptions = {}) {
        this.adapter = options.adapter ?? new MemoryStorage();
        this.prefix = options.prefix ?? 'app:';
    }

    private fullKey(key: string): string {
        return this.prefix + key;
    }

    /**
     * 写入。ttlMs 不传=永不过期;传了=到期后 get 返回 null 并自动清理。
     * value 为 undefined 时等价于删除(方便 reset 场景)。
     */
    set<T>(key: string, value: T, ttlMs?: number): void {
        if (value === undefined) {
            this.remove(key);
            return;
        }
        const envelope: Envelope<T> = { v: value, ...(ttlMs ? { e: Date.now() + ttlMs } : {}) };
        this.adapter.setItem(this.fullKey(key), JSON.stringify(envelope));
    }

    /** 读取。不存在、已过期、数据损坏一律返回 null(损坏数据顺手清掉) */
    get<T>(key: string): T | null {
        const raw = this.adapter.getItem(this.fullKey(key));
        if (raw === null) return null;
        try {
            const envelope = JSON.parse(raw) as Envelope<T>;
            if (envelope.e !== undefined && envelope.e < Date.now()) {
                this.remove(key); // 惰性过期:第一次访问才清理
                return null;
            }
            return envelope.v;
        } catch {
            // ⚠️ 历史版本写入过非 JSON 或数据被截断时,不能让整个应用白屏
            this.remove(key);
            return null;
        }
    }

    remove(key: string): void {
        this.adapter.removeItem(this.fullKey(key));
    }

    /** 只清空本前缀命名空间,绝不能用 localStorage.clear() 误伤第三方脚本 */
    clear(): void {
        const keys = this.allRawKeys().filter((k) => k.startsWith(this.prefix));
        for (const k of keys) this.adapter.removeItem(k);
    }

    /** 适配器没有 keys() 标准方法,localStorage 只能按下标遍历 */
    private allRawKeys(): string[] {
        const adapter = this.adapter as StorageLike & { length: number; key(i: number): string | null };
        return Array.from({ length: adapter.length }, (_, i) => adapter.key(i)).filter(
            (k): k is string => k !== null,
        );
    }
}

// ---------------- 验证(用内存适配器,浏览器中换成 localStorage 行为一致) ----------------

const store = new TypedStorage({ prefix: 'demo:' });

// ---- 永久配置:刷新后仍在 ----
store.set('theme', 'dark');
console.log(store.get<string>('theme')); // 'dark'

// ---- 带 TTL 的缓存:100ms 后过期 ----
store.set('user:profile', { id: 1, name: '阿强' }, 100);
console.log(store.get<{ id: number; name: string }>('user:profile')?.name); // '阿强'
await new Promise((r) => setTimeout(r, 120));
console.log(store.get('user:profile')); // null(已过期并被自动删除)

// ---- 损坏数据兜底 + 命名空间隔离:模拟老版本/手工写坏的内容 ----
const memoryAdapter = new MemoryStorage();
const robustStore = new TypedStorage({ adapter: memoryAdapter, prefix: 'demo:' });
const otherStore = new TypedStorage({ adapter: memoryAdapter, prefix: 'other:' });
memoryAdapter.setItem('demo:broken', '{not-json');
console.log(robustStore.get('broken')); // null,不抛异常
otherStore.set('keep', 1);
robustStore.set('a', 1);
robustStore.clear();
console.log(robustStore.get('a')); // null(本命名空间已清空)
console.log(otherStore.get('keep')); // 1(其他命名空间不受影响)

// ---- undefined 即删除 ----
store.set('temp', 1);
store.set('temp', undefined);
console.log(store.get('temp')); // null

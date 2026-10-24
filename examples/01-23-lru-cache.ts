// 文件: examples/01-23-lru-cache.ts
// ============ LRU 缓存:利用 Map 的插入顺序 ============

class LRUCache<K, V> {
    private map = new Map<K, V>();

    constructor(private capacity: number) {}

    get(key: K): V | undefined {
        if (!this.map.has(key)) return undefined;
        const value = this.map.get(key)!;
        this.map.delete(key);  // 删除后重新插入 → 该 key 移到"最近使用"的位置(末尾)
        this.map.set(key, value);
        return value;
    }

    set(key: K, value: V): this {
        if (this.map.has(key)) this.map.delete(key);
        else if (this.map.size >= this.capacity) {
            // 淘汰最久未使用的条目 = Map 的第一个 key(迭代器按插入顺序)
            const oldest = this.map.keys().next().value as K;
            this.map.delete(oldest);
        }
        this.map.set(key, value);
        return this;
    }

    get size() {
        return this.map.size;
    }
}

// ---- 验证 ----
const cache = new LRUCache<string, number>(2);
cache.set('a', 1).set('b', 2);
cache.get('a');        // 访问 a → b 变成"最久未使用"
cache.set('c', 3);     // 容量已满,淘汰 b
console.log(cache.get('b')); // undefined
console.log(cache.get('a'), cache.get('c')); // 1 3

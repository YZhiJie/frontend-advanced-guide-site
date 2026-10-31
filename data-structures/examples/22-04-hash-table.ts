/**
 * 22-04-hash-table.ts —— 哈希表（Hash Table）
 * 对应主文档：第二十二部分 22.4 哈希表
 *
 * 内容清单：
 *   1. isPrime / nextPrime 质数工具
 *   2. HashTable<T> 链地址法：多项式滚动哈希（h = h*31 + code）、质数容量、
 *      put / get / remove、负载因子 > 0.75 扩容 ×2 取质数、< 0.25 缩容并重新哈希
 *   3. 应用：基于 Map 的 LRUCache（get / put 均 O(1)，利用 Map 的插入序特性）
 *
 * 运行方式：npx tsx data-structures/examples/22-04-hash-table.ts
 */

// ============================================================
// 一、质数工具
// ============================================================

/** 试除法判质数：只需验到 √n，因为大于 √n 的因子必然成对出现 */
function isPrime(n: number): boolean {
  if (n < 2) return false;
  for (let i = 2; i * i <= n; i++) {
    if (n % i === 0) return false;
  }
  return true;
}

/** 从 n 起找下一个质数（含 n 本身） */
function nextPrime(n: number): number {
  let candidate = Math.max(2, n);
  while (!isPrime(candidate)) candidate++;
  return candidate;
}

// ============================================================
// 二、链地址法哈希表
// ============================================================

/** 桶内元素：键值对元组。key 固定为 string——本实现聚焦「字符串键」这一最常见场景 */
type Entry<T> = [string, T];

/**
 * 链地址法（Separate Chaining）：
 * 每个桶（bucket）是一个数组，哈希冲突的键值对依次放进同一个桶。
 *
 * 两个核心设计决策：
 * 1. 容量取质数——哈希值对质数取模分布更均匀。
 *    若容量是 2 的幂，取模等价于取低位比特，规律性输入（如连续偶数哈希）会扎堆。
 * 2. 负载因子（count / capacity）驱动扩缩容——
 *    太高则桶链过长、查询退化为 O(n)；太低则浪费内存。
 */
class HashTable<T> {
  private storage: Entry<T>[][];
  private capacity: number;
  private count = 0;
  private readonly LOAD_FACTOR_HIGH = 0.75; // 超过则扩容
  private readonly LOAD_FACTOR_LOW = 0.25; // 低于则缩容
  private readonly MIN_CAPACITY = 7; // 缩容下限，避免反复震荡

  constructor(capacity = 7) {
    this.capacity = nextPrime(capacity); // 传入值不一定是质数，统一向上取质
    this.storage = new Array(this.capacity);
    for (let i = 0; i < this.capacity; i++) {
      this.storage[i] = [];
    }
  }

  /**
   * 多项式滚动哈希：h = h * 31 + charCode
   * 为什么乘 31：
   *   · 奇质数，乘积分布比偶数更散（偶数乘积会让低位快速归零）；
   *   · 31 * h === (h << 5) - h，JVM/V8 可优化为移位+减法，速度极快；
   *   · Java 的 String.hashCode 同款选择，久经考验。
   */
  private hash(key: string): number {
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      // | 0 强制转 32 位有符号整数，模拟 Java 的 int 溢出回绕，防止浮点精度丢失
      h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
    }
    // Math.abs 后取模得到桶下标
    return Math.abs(h) % this.capacity;
  }

  put(key: string, value: T): void {
    const index = this.hash(key);
    const bucket = this.storage[index];
    // 键已存在则覆盖更新，不重复计数
    for (const entry of bucket) {
      if (entry[0] === key) {
        entry[1] = value;
        return;
      }
    }
    bucket.push([key, value]);
    this.count++;
    // 负载因子超阈值：容量 ×2 再取质数
    if (this.count / this.capacity > this.LOAD_FACTOR_HIGH) {
      this.resize(nextPrime(this.capacity * 2));
    }
  }

  get(key: string): T | undefined {
    const bucket = this.storage[this.hash(key)];
    for (const entry of bucket) {
      if (entry[0] === key) return entry[1];
    }
    return undefined;
  }

  remove(key: string): boolean {
    const bucket = this.storage[this.hash(key)];
    for (let i = 0; i < bucket.length; i++) {
      if (bucket[i][0] === key) {
        // 用「末位交换」代替 splice：O(1) 移除，桶内顺序不重要
        bucket[i] = bucket[bucket.length - 1];
        bucket.pop();
        this.count--;
        // 负载因子过低且未到下限：容量 ÷2 取质数
        if (
          this.capacity > this.MIN_CAPACITY &&
          this.count / this.capacity < this.LOAD_FACTOR_LOW
        ) {
          this.resize(nextPrime(Math.floor(this.capacity / 2)));
        }
        return true;
      }
    }
    return false;
  }

  /**
   * 扩/缩容后所有旧键必须重新哈希——
   * 因为桶下标 = hash % capacity，容量一变，旧下标全部失效。
   */
  private resize(newCapacity: number): void {
    const oldStorage = this.storage;
    this.capacity = newCapacity;
    this.storage = new Array(newCapacity);
    for (let i = 0; i < newCapacity; i++) {
      this.storage[i] = [];
    }
    this.count = 0;
    for (const bucket of oldStorage) {
      for (const [key, value] of bucket) {
        this.put(key, value); // 复用 put 完成重新哈希（put 内部不会再触发异常扩容，因子远未达标）
      }
    }
  }

  size(): number {
    return this.count;
  }

  isEmpty(): boolean {
    return this.count === 0;
  }

  /** 观测用：当前桶容量 */
  getCapacity(): number {
    return this.capacity;
  }
}

// ============================================================
// 三、应用：基于 Map 的 LRU 缓存（LeetCode 146）
// ============================================================

/**
 * JS Map 的隐藏特性：内部用哈希表 + 双向链表维护「插入顺序」，迭代顺序即插入顺序；
 * 对已存在的 key 先 delete 再 set，会把它移到「最新」位置。
 * 于是 Map 天然就是一个「有序哈希表」，LRU 用它实现只要两个动作：
 *   · get/put 命中后：delete + set 提到最新（队尾）
 *   · 超容量时：迭代器的第一个 key 即最久未用（队头），删掉
 * get / put 均摊 O(1)。
 */
class LRUCache<K, V> {
  private readonly capacity: number;
  private cache = new Map<K, V>();

  constructor(capacity: number) {
    if (capacity <= 0) throw new Error("LRU 容量必须为正数");
    this.capacity = capacity;
  }

  get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key)!;
    // 刷新热度：删掉重插，移到 Map 的末尾（最新位置）
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  put(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key); // 已存在先删，等下重插即提热
    } else if (this.cache.size >= this.capacity) {
      // 淘汰最久未使用：Map 迭代器第一个 key 就是最老的
      const oldestKey = this.cache.keys().next().value as K;
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, value);
  }

  size(): number {
    return this.cache.size;
  }

  /** 观测用：从最旧到最新的 key 列表 */
  keysFromOldest(): K[] {
    return [...this.cache.keys()];
  }
}

// ============================================================
// 四、自测断言
// ============================================================

// --- 质数工具 ---
console.assert(isPrime(0) === false && isPrime(1) === false, "0 和 1 不是质数");
console.assert(
  isPrime(2) && isPrime(3) && isPrime(7) && isPrime(97),
  "2/3/7/97 应为质数",
);
console.assert(
  isPrime(4) === false && isPrime(100) === false && isPrime(91) === false,
  "4/100/91(=7×13) 应为合数",
);
console.assert(nextPrime(7) === 7, "质数本身应原样返回");
console.assert(nextPrime(8) === 11, "8 的下一质数应为 11");
console.assert(nextPrime(14) === 17, "14 的下一质数应为 17");

// --- HashTable 基础 CRUD ---
const table = new HashTable<number>();
console.assert(table.isEmpty() && table.size() === 0, "新哈希表应为空");
console.assert(table.get("不存在") === undefined, "查不存在的键应为 undefined");
console.assert(table.remove("不存在") === false, "删不存在的键应返回 false");
table.put("apple", 1);
table.put("banana", 2);
table.put("apple", 10); // 覆盖同键
console.assert(table.get("apple") === 10, "同键 put 应覆盖旧值");
console.assert(table.size() === 2, "覆盖同键不应增加 size");
console.assert(table.get("banana") === 2, "banana 应为 2");
console.assert(table.remove("apple") === true, "删除存在的键应返回 true");
console.assert(
  table.get("apple") === undefined && table.size() === 1,
  "删除后应查不到且 size 减一",
);

// --- 扩容验证：连续插入 100 个键，容量应增长且全部可查 ---
const big = new HashTable<number>();
const initialCap = big.getCapacity();
for (let i = 0; i < 100; i++) {
  big.put(`key${i}`, i);
}
console.assert(big.size() === 100, "插入 100 个键后 size 应为 100");
console.assert(big.getCapacity() > initialCap, "负载因子超 0.75 应触发扩容");
console.assert(isPrime(big.getCapacity()), "扩容后容量应保持质数");
let allFound = true;
for (let i = 0; i < 100; i++) {
  if (big.get(`key${i}`) !== i) allFound = false;
}
console.assert(allFound, "扩容重新哈希后 100 个键应全部可查");

// --- 缩容验证：删到负载因子 < 0.25，容量应回落且数据完好 ---
const shrink = new HashTable<number>();
for (let i = 0; i < 50; i++) shrink.put(`k${i}`, i);
const capAfterInsert = shrink.getCapacity();
for (let i = 0; i < 48; i++) shrink.remove(`k${i}`); // 只剩 2 个
console.assert(shrink.size() === 2, "删除后应剩 2 个");
console.assert(
  shrink.getCapacity() < capAfterInsert,
  "负载因子低于 0.25 应触发缩容",
);
console.assert(
  shrink.get("k48") === 48 && shrink.get("k49") === 49,
  "缩容重新哈希后剩余键应完好",
);

// --- LRUCache ---
const lru = new LRUCache<string, number>(3);
lru.put("a", 1);
lru.put("b", 2);
lru.put("c", 3);
console.assert(lru.get("a") === 1, "get 命中应返回 1");
// get("a") 后热度顺序：b(最旧) -> c -> a(最新)
lru.put("d", 4); // 超容量，淘汰最旧的 b
console.assert(lru.get("b") === undefined, "b 应被淘汰");
console.assert(
  lru.get("a") === 1 && lru.get("c") === 3 && lru.get("d") === 4,
  "a/c/d 应仍在缓存中",
);
console.assert(lru.size() === 3, "容量恒定应为 3");
lru.put("c", 30); // 更新已存在键：值更新 + 提热
console.assert(lru.get("c") === 30, "重复 put 应更新值");
// 注意：上面的连续 get 也参与提热——get a、get c、get d 依次把热度刷成 a->c->d，
// put c 再把 c 提到最新，因此当前从最旧到最新应为 a->d->c
console.assert(
  JSON.stringify(lru.keysFromOldest()) === '["a","d","c"]',
  "热度顺序应为 a->d->c",
);
console.assert(lru.get("未命中") === undefined, "未命中应返回 undefined");
// 边界：容量为 1
const tiny = new LRUCache<number, string>(1);
tiny.put(1, "一");
tiny.put(2, "二");
console.assert(
  tiny.get(1) === undefined && tiny.get(2) === "二",
  "容量 1 时新写入应挤掉旧值",
);

console.log("✅ 22-04 hash-table 全部断言通过");

export {};

/**
 * 22-07-heap.ts —— 堆（Heap）与优先级队列
 * 对应主文档：第二十二部分 22.6 堆与优先级队列
 *
 * 内容清单：
 *   1. MaxHeap<T> / MinHeap<T>：数组表示完全二叉树
 *      父节点下标 (i-1)>>1，左右子 2i+1 / 2i+2；siftUp / siftDown / heapify / extract / peek
 *   2. PriorityQueue<T>：基于小顶堆，元素带 priority
 *   3. 应用一：TopK——K 个最大元素用 K 容量小顶堆
 *   4. 应用二：任务调度 demo
 *
 * 运行方式：npx tsx data-structures/examples/22-07-heap.ts
 */

// ============================================================
// 一、堆的数组表示
// ============================================================

/**
 * 堆是一棵「用数组存的完全二叉树」：
 *   - 结构性质：除最后一层外全满，最后一层靠左排列 → 数组紧凑无空洞；
 *   - 堆序性质：大顶堆每个父节点 ≥ 两个子节点（小顶堆相反）。
 * 下标换算（0 起）：
 *   parent(i) = (i - 1) >> 1   —— 位运算右移等价于 Math.floor((i-1)/2)，更快
 *   left(i)   = 2i + 1
 *   right(i)  = 2i + 2
 */

/** 通用堆基类：compare 返回 > 0 表示 a 应该比 b 更靠近堆顶 */
abstract class Heap<T> {
  protected data: T[] = [];
  protected abstract compare(a: T, b: T): number;

  insert(value: T): void {
    this.data.push(value); // 先放数组末尾（完全二叉树的下一个位置）
    this.siftUp(this.data.length - 1); // 再上浮到正确位置
  }

  /** 上浮：与父节点比较，违反堆序就交换，直到根或满足堆序。O(log n) */
  private siftUp(index: number): void {
    let i = index;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.compare(this.data[i], this.data[parent]) <= 0) break;
      [this.data[i], this.data[parent]] = [this.data[parent], this.data[i]];
      i = parent;
    }
  }

  /** 弹出堆顶：末位元素补到堆顶再下沉，避免数组头部删除的 O(n) */
  extract(): T | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  /** 下沉：与「更该在上面的那个子节点」比较交换，直到叶子或满足堆序。O(log n) */
  private siftDown(index: number): void {
    let i = index;
    const n = this.data.length;
    while (true) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let best = i;
      if (left < n && this.compare(this.data[left], this.data[best]) > 0) best = left;
      if (right < n && this.compare(this.data[right], this.data[best]) > 0) best = right;
      if (best === i) break; // 已是三者中最优，下沉结束
      [this.data[i], this.data[best]] = [this.data[best], this.data[i]];
      i = best;
    }
  }

  peek(): T | undefined {
    return this.data[0];
  }

  size(): number {
    return this.data.length;
  }

  isEmpty(): boolean {
    return this.data.length === 0;
  }

  /**
   * heapify：把无序数组原地整理成堆，O(n)。
   * 为什么比逐个 insert 的 O(n log n) 快：
   * 从最后一个非叶子节点开始自底向上 siftDown，
   * 越靠近叶子需要下沉的距离越短，而叶子占了近一半节点——
   * 数学上求和收敛到 O(n)。
   */
  protected heapify(arr: T[]): void {
    this.data = [...arr];
    // (n-2)>>1 是最后一个非叶子节点的下标（最后一个节点的父）
    for (let i = (this.data.length - 2) >> 1; i >= 0; i--) {
      this.siftDown(i);
    }
  }
}

/** 大顶堆：值大者近顶 */
class MaxHeap<T> extends Heap<T> {
  protected compareFn: (a: T, b: T) => number;
  constructor(compareFn?: (a: T, b: T) => number) {
    super();
    this.compareFn = compareFn ?? ((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }
  protected compare(a: T, b: T): number {
    return this.compareFn(a, b);
  }
  /** 静态工厂：从数组直接 heapify 建堆 */
  static from<U>(arr: U[], compareFn?: (a: U, b: U) => number): MaxHeap<U> {
    const heap = new MaxHeap<U>(compareFn);
    heap.heapify(arr);
    return heap;
  }
}

/** 小顶堆：值小者近顶（compare 取反即可复用全部逻辑） */
class MinHeap<T> extends Heap<T> {
  protected compareFn: (a: T, b: T) => number;
  constructor(compareFn?: (a: T, b: T) => number) {
    super();
    this.compareFn = compareFn ?? ((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }
  protected compare(a: T, b: T): number {
    return -this.compareFn(a, b); // 取反：小者更靠近堆顶
  }
  static from<U>(arr: U[], compareFn?: (a: U, b: U) => number): MinHeap<U> {
    const heap = new MinHeap<U>(compareFn);
    heap.heapify(arr);
    return heap;
  }
}

// ============================================================
// 二、优先级队列（基于小顶堆：priority 越小优先级越高）
// ============================================================

interface PriorityItem<T> {
  value: T;
  priority: number;
}

/**
 * 为什么用堆而不是排序数组：
 * 排序数组插入要 O(n) 找位+搬移；堆插入/弹出都是 O(log n)，
 * 且只关心「最优先的一个」，不关心全局有序——堆的偏序恰好够用。
 */
class PriorityQueue<T> {
  private heap: MinHeap<PriorityItem<T>>;

  constructor() {
    this.heap = new MinHeap<PriorityItem<T>>((a, b) => a.priority - b.priority);
  }

  enqueue(value: T, priority: number): void {
    this.heap.insert({ value, priority });
  }

  dequeue(): T | undefined {
    return this.heap.extract()?.value;
  }

  peek(): T | undefined {
    return this.heap.peek()?.value;
  }

  size(): number {
    return this.heap.size();
  }

  isEmpty(): boolean {
    return this.heap.isEmpty();
  }
}

// ============================================================
// 三、应用一：TopK——找数组中最大的 K 个数
// ============================================================

/**
 * 思路：维护一个容量为 K 的小顶堆。
 * 遍历数组：堆未满直接入；满了之后，新元素若大于堆顶（当前第 K 大）则替换堆顶。
 * 堆顶始终是「当前最大的 K 个里最小的那个」，是比对新元素的门槛。
 * 复杂度：O(n log k)——远优于全量排序的 O(n log n)，k 很小时优势巨大。
 * 为什么用小顶堆而不是大顶堆：要能 O(1) 拿到「当前 TopK 里的最小值」来淘汰。
 */
function topK(nums: number[], k: number): number[] {
  if (k <= 0) return [];
  const heap = new MinHeap<number>();
  for (const num of nums) {
    if (heap.size() < k) {
      heap.insert(num);
    } else if (num > heap.peek()!) {
      heap.extract(); // 淘汰当前第 K 大
      heap.insert(num);
    }
  }
  // 依次弹出即升序的 TopK
  const result: number[] = [];
  while (!heap.isEmpty()) {
    result.push(heap.extract()!);
  }
  return result;
}

// ============================================================
// 四、应用二：任务调度 demo
// ============================================================

interface Task {
  name: string;
  priority: number; // 数值越小越紧急
}

/** 按优先级依次取出任务执行 */
function schedule(tasks: Task[]): string[] {
  const pq = new PriorityQueue<string>();
  for (const task of tasks) {
    pq.enqueue(task.name, task.priority);
  }
  const executed: string[] = [];
  while (!pq.isEmpty()) {
    executed.push(pq.dequeue()!);
  }
  return executed;
}

// ============================================================
// 五、自测断言
// ============================================================

// --- MaxHeap 基础 ---
const maxHeap = new MaxHeap<number>();
console.assert(maxHeap.isEmpty() && maxHeap.peek() === undefined, "空堆应为空且 peek 为 undefined");
console.assert(maxHeap.extract() === undefined, "空堆 extract 应返回 undefined");
[5, 1, 9, 3, 7].forEach((v) => maxHeap.insert(v));
console.assert(maxHeap.size() === 5, "插入 5 个元素后 size 应为 5");
console.assert(maxHeap.peek() === 9, "大顶堆堆顶应为最大值 9");
const maxOrder: number[] = [];
while (!maxHeap.isEmpty()) maxOrder.push(maxHeap.extract()!);
console.assert(JSON.stringify(maxOrder) === "[9,7,5,3,1]", "大顶堆依次弹出应严格降序");

// --- MinHeap 基础 ---
const minHeap = new MinHeap<number>();
[5, 1, 9, 3, 7].forEach((v) => minHeap.insert(v));
console.assert(minHeap.peek() === 1, "小顶堆堆顶应为最小值 1");
const minOrder: number[] = [];
while (!minHeap.isEmpty()) minOrder.push(minHeap.extract()!);
console.assert(JSON.stringify(minOrder) === "[1,3,5,7,9]", "小顶堆依次弹出应严格升序");

// --- heapify 建堆 ---
const heapified = MaxHeap.from([3, 1, 6, 5, 2, 4]);
console.assert(heapified.peek() === 6, "heapify 后堆顶应为最大值 6");
const heapifiedOrder: number[] = [];
while (!heapified.isEmpty()) heapifiedOrder.push(heapified.extract()!);
console.assert(JSON.stringify(heapifiedOrder) === "[6,5,4,3,2,1]", "heapify 建堆弹出应降序");
console.assert(MaxHeap.from([42]).peek() === 42, "单元素 heapify 边界");
console.assert(MaxHeap.from<number>([]).isEmpty(), "空数组 heapify 应为空堆");

// --- 重复元素 ---
const dupHeap = new MaxHeap<number>();
[2, 2, 2, 1, 3, 3].forEach((v) => dupHeap.insert(v));
const dupOrder: number[] = [];
while (!dupHeap.isEmpty()) dupOrder.push(dupHeap.extract()!);
console.assert(JSON.stringify(dupOrder) === "[3,3,2,2,2,1]", "重复元素应正常排序弹出");

// --- PriorityQueue ---
const pq = new PriorityQueue<string>();
console.assert(pq.isEmpty() && pq.dequeue() === undefined, "空优先级队列应为空");
pq.enqueue("低优先级任务", 10);
pq.enqueue("紧急 Bug 修复", 1);
pq.enqueue("常规需求", 5);
console.assert(pq.peek() === "紧急 Bug 修复", "堆顶应是 priority 最小的任务");
console.assert(pq.dequeue() === "紧急 Bug 修复", "应先出 priority=1");
console.assert(pq.dequeue() === "常规需求", "再出 priority=5");
console.assert(pq.dequeue() === "低优先级任务", "最后出 priority=10");
console.assert(pq.isEmpty(), "全部出队后应为空");

// --- TopK ---
const top3 = topK([3, 2, 1, 5, 6, 4], 2);
console.assert(JSON.stringify(top3) === "[5,6]", "LeetCode 215 样例 Top2 应为 [5,6]（升序弹出）");
console.assert(JSON.stringify(topK([1, 2, 3, 4, 5], 3)) === "[3,4,5]", "Top3 应为 [3,4,5]");
console.assert(JSON.stringify(topK([5], 1)) === "[5]", "单元素 Top1 边界");
console.assert(JSON.stringify(topK([1, 2, 3], 5)) === "[1,2,3]", "k 大于数组长度时应返回全部");
console.assert(JSON.stringify(topK([1, 2], 0)) === "[]", "k=0 应返回空数组");
console.assert(JSON.stringify(topK([7, 7, 7, 7], 2)) === "[7,7]", "重复值 TopK 应保留重复项");

// --- 任务调度 ---
const tasks: Task[] = [
  { name: "写周报", priority: 4 },
  { name: "线上告警处理", priority: 0 },
  { name: "Code Review", priority: 2 },
  { name: "需求评审", priority: 3 },
];
const executed = schedule(tasks);
console.assert(
  JSON.stringify(executed) === JSON.stringify(["线上告警处理", "Code Review", "需求评审", "写周报"]),
  "任务应按优先级从小到大执行"
);

console.log("✅ 22-07 heap 全部断言通过");

export {};

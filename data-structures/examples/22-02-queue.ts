/**
 * 22-02-queue.ts —— 队列（Queue）与双端队列（Deque）
 * 对应主文档：第二十二部分 22.2 栈与队列
 *
 * 内容清单：
 *   1. IQueue<T> 接口 + ArrayQueue<T>（指出 shift 是 O(n) 的缺陷）
 *   2. RingQueue<T> 环形队列（出入队均 O(1)）
 *   3. Deque<T> 双端队列
 *   4. 应用一：单调双端队列求滑动窗口最大值
 *   5. 应用二：两个栈实现队列
 *   6. 应用三：击鼓传花（队列模拟）
 *
 * 运行方式：npx tsx data-structures/examples/22-02-queue.ts
 */

// ============================================================
// 一、普通队列（数组版，演示用，非最优）
// ============================================================

/** 队列的抽象接口：FIFO（先进先出），队尾进、队头出 */
interface IQueue<T> {
  enqueue(element: T): void;
  dequeue(): T | undefined;
  peek(): T | undefined;
  isEmpty(): boolean;
  size(): number;
}

/**
 * 基于数组的队列。
 * 注意：dequeue 用 Array.prototype.shift 实现，它要把后面所有元素前移一位，
 * 时间复杂度 O(n)。教学可读性好，但大数据量高频出队时应换环形队列或链表。
 */
class ArrayQueue<T> implements IQueue<T> {
  private data: T[] = [];

  enqueue(element: T): void {
    this.data.push(element); // 队尾进，O(1)
  }

  dequeue(): T | undefined {
    // ⚠️ shift 是 O(n)：数组头部删除会让全体元素左移
    return this.data.shift();
  }

  peek(): T | undefined {
    return this.data[0];
  }

  isEmpty(): boolean {
    return this.data.length === 0;
  }

  size(): number {
    return this.data.length;
  }
}

// ============================================================
// 二、环形队列（Ring Queue / Circular Buffer）—— O(1) 出入队
// ============================================================

/**
 * 为什么环形队列能做到 O(1)：
 * 用 head/tail 两个指针在定长数组上「绕圈」（取模回绕），
 * 出队只是 head 指针 +1，不搬移任何元素。
 * 这也是 Node.js 事件循环、音视频缓冲区等场景的底层结构。
 */
class RingQueue<T> implements IQueue<T> {
  private data: (T | undefined)[];
  private head = 0; // 队头下标
  private tail = 0; // 下一个写入位置
  private count = 0; // 当前元素个数（区分「空」与「满」）
  private readonly capacity: number;

  constructor(capacity: number) {
    if (capacity <= 0) throw new Error("容量必须为正数");
    this.capacity = capacity;
    this.data = new Array<T | undefined>(capacity);
  }

  enqueue(element: T): void {
    if (this.count === this.capacity) {
      throw new Error("环形队列已满"); // 定长缓冲：满时拒绝写入（也可设计成覆盖最老元素）
    }
    this.data[this.tail] = element;
    this.tail = (this.tail + 1) % this.capacity; // 取模回绕，环形关键
    this.count++;
  }

  dequeue(): T | undefined {
    if (this.count === 0) return undefined;
    const value = this.data[this.head];
    this.data[this.head] = undefined; // 释放引用，帮助 GC
    this.head = (this.head + 1) % this.capacity;
    this.count--;
    return value;
  }

  peek(): T | undefined {
    if (this.count === 0) return undefined;
    return this.data[this.head];
  }

  isEmpty(): boolean {
    return this.count === 0;
  }

  size(): number {
    return this.count;
  }
}

// ============================================================
// 三、双端队列（Deque）
// ============================================================

/**
 * 两端均可 O(1) 进出。底层用「对象当哈希表 + 双指针」而不是数组：
 * 避免 shift/unshift 的 O(n) 搬移，也避免环形数组取模的额外心智负担。
 * JS 对象数值键的随机访问可视为 O(1)。
 */
class Deque<T> {
  private items: Record<number, T> = {};
  private head = 0; // 队头下标
  private tail = 0; // 队尾下标（下一个尾部写入位置）

  pushBack(value: T): void {
    this.items[this.tail++] = value;
  }

  pushFront(value: T): void {
    this.items[--this.head] = value; // head 向负数方向扩展，无需搬移
  }

  popBack(): T | undefined {
    if (this.isEmpty()) return undefined;
    const value = this.items[--this.tail];
    delete this.items[this.tail];
    return value;
  }

  popFront(): T | undefined {
    if (this.isEmpty()) return undefined;
    const value = this.items[this.head];
    delete this.items[this.head++];
    return value;
  }

  peekFront(): T | undefined {
    return this.isEmpty() ? undefined : this.items[this.head];
  }

  peekBack(): T | undefined {
    return this.isEmpty() ? undefined : this.items[this.tail - 1];
  }

  isEmpty(): boolean {
    return this.tail - this.head === 0;
  }

  size(): number {
    return this.tail - this.head;
  }
}

// ============================================================
// 四、应用一：滑动窗口最大值（LeetCode 239，单调双端队列）
// ============================================================

/**
 * 暴力解法每个窗口扫 k 个数是 O(nk)；单调队列把每个元素的入/出队次数压到各一次，总 O(n)。
 * 核心思想：队列里存下标，且对应值从队头到队尾单调递减——
 *   · 队头永远是当前窗口最大值；
 *   · 新元素入队前，把队尾所有比它小的弹掉（它们再也不可能成为最大值）；
 *   · 队头下标滑出窗口时弹出。
 */
function maxSlidingWindow(nums: number[], k: number): number[] {
  const result: number[] = [];
  const deque = new Deque<number>(); // 存下标而非值，方便判断「是否滑出窗口」

  for (let i = 0; i < nums.length; i++) {
    // 1. 队头下标已不在窗口 [i-k+1, i] 内，弹出
    if (!deque.isEmpty() && deque.peekFront()! < i - k + 1) {
      deque.popFront();
    }
    // 2. 维护单调性：比 nums[i] 小的队尾元素全部出局
    while (!deque.isEmpty() && nums[deque.peekBack()!] < nums[i]) {
      deque.popBack();
    }
    deque.pushBack(i);
    // 3. 窗口形成后（i >= k-1），队头即最大值
    if (i >= k - 1) {
      result.push(nums[deque.peekFront()!]);
    }
  }
  return result;
}

// ============================================================
// 五、应用二：两个栈实现队列（LeetCode 232）
// ============================================================

/**
 * inStack 负责入队，outStack 负责出队。
 * 出队时若 outStack 为空，把 inStack 整体倒入 outStack——
 * 倒一次就把顺序翻转成 FIFO 了。
 * 均摊复杂度：每个元素最多「进 in、出 in、进 out、出 out」各一次，出队均摊 O(1)。
 */
class StackQueue<T> implements IQueue<T> {
  private inStack: T[] = [];
  private outStack: T[] = [];

  enqueue(element: T): void {
    this.inStack.push(element);
  }

  /** 只在 outStack 空了才搬运，保证老元素始终在 outStack 顶部先出 */
  private transfer(): void {
    while (this.inStack.length > 0) {
      this.outStack.push(this.inStack.pop()!);
    }
  }

  dequeue(): T | undefined {
    if (this.outStack.length === 0) this.transfer();
    return this.outStack.pop();
  }

  peek(): T | undefined {
    if (this.outStack.length === 0) this.transfer();
    return this.outStack[this.outStack.length - 1];
  }

  isEmpty(): boolean {
    return this.inStack.length === 0 && this.outStack.length === 0;
  }

  size(): number {
    return this.inStack.length + this.outStack.length;
  }
}

// ============================================================
// 六、应用三：击鼓传花（队列模拟淘汰游戏）
// ============================================================

/**
 * 规则：n 个人围成圈传花，鼓停时花在谁手里谁淘汰，直到只剩一人。
 * 用队列模拟：每次把队头取出再入队 num-1 次（传花），第 num 次取出的直接淘汰。
 * 返回胜利者名字。
 */
function hotPotato(names: string[], num: number): string {
  const queue = new ArrayQueue<string>();
  for (const name of names) queue.enqueue(name);

  while (queue.size() > 1) {
    // 传花 num-1 次：队头出队立刻回队尾，相当于把花传给下一个人
    for (let i = 0; i < num - 1; i++) {
      queue.enqueue(queue.dequeue()!);
    }
    queue.dequeue(); // 鼓停，持花者淘汰
  }
  return queue.dequeue()!;
}

// ============================================================
// 七、自测断言
// ============================================================

// --- ArrayQueue 基础 ---
const q = new ArrayQueue<number>();
console.assert(q.isEmpty() && q.size() === 0, "新队列应为空");
console.assert(q.dequeue() === undefined, "空队列出队应返回 undefined");
q.enqueue(1);
q.enqueue(2);
q.enqueue(3);
console.assert(q.peek() === 1, "队头应是先入队的 1");
console.assert(q.dequeue() === 1 && q.dequeue() === 2, "出队顺序应 FIFO");
console.assert(q.size() === 1 && !q.isEmpty(), "应剩一个元素");

// --- RingQueue 环形队列 ---
const ring = new RingQueue<string>(3);
console.assert(ring.dequeue() === undefined, "空环形队列出队应返回 undefined");
ring.enqueue("a");
ring.enqueue("b");
ring.enqueue("c");
let fullError = false;
try {
  ring.enqueue("d"); // 容量 3，第 4 个应抛错
} catch {
  fullError = true;
}
console.assert(fullError, "环形队列满时应抛错");
console.assert(ring.dequeue() === "a", "环形队列应 FIFO 出 a");
ring.enqueue("d"); // 绕圈复用腾出的槽位——环形特性的核心验证
console.assert(ring.dequeue() === "b", "绕圈后仍应 FIFO 出 b");
console.assert(ring.dequeue() === "c", "应出 c");
console.assert(ring.dequeue() === "d", "应出 d");
console.assert(ring.isEmpty() && ring.size() === 0, "全部出队后应为空");

// --- Deque 双端队列 ---
const dq = new Deque<number>();
console.assert(
  dq.isEmpty() && dq.popFront() === undefined && dq.popBack() === undefined,
  "空双端队列两端弹出均为 undefined",
);
dq.pushBack(2);
dq.pushFront(1);
dq.pushBack(3);
console.assert(
  dq.peekFront() === 1 && dq.peekBack() === 3,
  "两端查看应为 1 和 3",
);
console.assert(dq.popFront() === 1, "前端弹出 1");
console.assert(dq.popBack() === 3, "后端弹出 3");
console.assert(dq.size() === 1 && dq.popBack() === 2, "最后弹出 2 后应为空");
console.assert(dq.isEmpty(), "双端队列应为空");

// --- 滑动窗口最大值 ---
const windowResult = maxSlidingWindow([1, 3, -1, -3, 5, 3, 6, 7], 3);
console.assert(
  JSON.stringify(windowResult) === JSON.stringify([3, 3, 5, 5, 6, 7]),
  "LeetCode 239 官方样例应为 [3,3,5,5,6,7]",
);
console.assert(
  JSON.stringify(maxSlidingWindow([1], 1)) === JSON.stringify([1]),
  "单元素单窗口边界",
);
console.assert(
  JSON.stringify(maxSlidingWindow([1, -1], 1)) === JSON.stringify([1, -1]),
  "k=1 时每个元素自成窗口",
);
console.assert(
  JSON.stringify(maxSlidingWindow([9, 8, 7, 6], 4)) === JSON.stringify([9]),
  "k=n 时只有一个窗口",
);

// --- 两个栈实现队列 ---
const sq = new StackQueue<string>();
console.assert(
  sq.isEmpty() && sq.dequeue() === undefined,
  "空 StackQueue 应为空且出队 undefined",
);
sq.enqueue("x");
sq.enqueue("y");
console.assert(sq.peek() === "x", "队头应为 x");
console.assert(sq.dequeue() === "x", "应先出 x");
sq.enqueue("z"); // 出队后再入队，验证 transfer 逻辑交叉正确
console.assert(
  sq.dequeue() === "y" && sq.dequeue() === "z",
  "交叉入出队顺序应正确",
);
console.assert(sq.isEmpty(), "StackQueue 应为空");

// --- 击鼓传花 ---
console.assert(
  hotPotato(["甲", "乙", "丙", "丁", "戊"], 3) === "丁",
  "5 人传 3 次（约瑟夫 n=5,k=3），胜者应为丁",
);
console.assert(hotPotato(["唯一"], 7) === "唯一", "单人游戏应直接获胜");
console.assert(
  hotPotato(["A", "B"], 1) === "B",
  "num=1 时队头 A 直接淘汰，胜者应为 B",
);
console.assert(
  hotPotato(["A", "B"], 2) === "A",
  "2 人传 2 次（约瑟夫 n=2,k=2），胜者应为 A",
);

console.log("✅ 22-02 queue 全部断言通过");

export {};

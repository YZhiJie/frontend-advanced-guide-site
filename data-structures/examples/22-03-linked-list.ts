/**
 * 22-03-linked-list.ts —— 链表（Linked List）
 * 对应主文档：第二十二部分 22.3 链表
 *
 * 内容清单：
 *   1. Node<T> 节点 + LinkedList<T> 单向链表（append/insert/removeAt/get/update/indexOf/size）
 *   2. 反转链表三种写法：迭代三指针 / 递归 / 借助栈
 *   3. 快慢指针判环（Floyd 判圈）
 *   4. DoublyLinkedList<T> 双向链表简版（append/prepend/removeTail）
 *
 * 运行方式：npx tsx data-structures/examples/22-03-linked-list.ts
 */

// ============================================================
// 一、单向链表
// ============================================================

/** 链表节点：数据 + 后继指针。节点类型独立导出，方便写「反转/判环」等裸指针题目 */
class Node<T> {
  value: T;
  next: Node<T> | null = null;
  constructor(value: T) {
    this.value = value;
  }
}

/**
 * 为什么需要链表：数组按下标随机访问是 O(1)，但头部插入要搬移全部元素 O(n)；
 * 链表插入删除只要拿到前驱就是 O(1)，代价是随机访问退化为 O(n)。
 * 前端场景：React Fiber 树、LRU 缓存、编辑器撤销栈常用链表或其变体。
 */
class LinkedList<T> {
  private head: Node<T> | null = null;
  private length = 0;

  /** 尾插：O(n)，因为单向链表没有尾指针 */
  append(value: T): void {
    const newNode = new Node(value);
    if (this.head === null) {
      this.head = newNode;
    } else {
      let current = this.head;
      while (current.next !== null) {
        current = current.next;
      }
      current.next = newNode;
    }
    this.length++;
  }

  /** 在 position 处插入，合法下标范围 [0, length] */
  insert(value: T, position: number): boolean {
    if (position < 0 || position > this.length) return false;
    const newNode = new Node(value);
    if (position === 0) {
      newNode.next = this.head; // 先接后继，再改头指针，顺序不能反
      this.head = newNode;
    } else {
      const prev = this.nodeAt(position - 1)!; // 已校验边界，必存在
      newNode.next = prev.next;
      prev.next = newNode;
    }
    this.length++;
    return true;
  }

  /** 删除 position 处节点并返回其值，非法下标返回 undefined */
  removeAt(position: number): T | undefined {
    if (position < 0 || position >= this.length) return undefined;
    let removed: Node<T>;
    if (position === 0) {
      removed = this.head!;
      this.head = this.head!.next;
    } else {
      const prev = this.nodeAt(position - 1)!;
      removed = prev.next!;
      prev.next = removed.next; // 跳过被删节点，JS 无手动内存管理，断开引用即可
    }
    this.length--;
    return removed.value;
  }

  get(position: number): T | undefined {
    if (position < 0 || position >= this.length) return undefined;
    return this.nodeAt(position)!.value;
  }

  update(value: T, position: number): boolean {
    if (position < 0 || position >= this.length) return false;
    this.nodeAt(position)!.value = value;
    return true;
  }

  indexOf(value: T): number {
    let current = this.head;
    let index = 0;
    while (current !== null) {
      if (current.value === value) return index;
      current = current.next;
      index++;
    }
    return -1;
  }

  size(): number {
    return this.length;
  }

  isEmpty(): boolean {
    return this.length === 0;
  }

  /** 暴露头节点供「反转 / 判环」等算法题直接操作（面试题通常只给头指针） */
  getHead(): Node<T> | null {
    return this.head;
  }

  /** 私有工具：定位下标对应节点，调用前必须保证 position 在 [0, length) */
  private nodeAt(position: number): Node<T> | null {
    let current = this.head;
    for (let i = 0; i < position; i++) {
      current = current!.next;
    }
    return current;
  }

  toString(): string {
    const parts: T[] = [];
    let current = this.head;
    while (current !== null) {
      parts.push(current.value);
      current = current.next;
    }
    return parts.join(" -> ");
  }
}

// ============================================================
// 二、反转链表三种写法（LeetCode 206）
// ============================================================

/**
 * 写法一：迭代三指针（推荐，O(n) 时间 / O(1) 空间）
 * prev / current / next 三人转：每步只做一件事——把 current.next 掰向 prev。
 * 必须先存 next 再断链，否则链表就丢了。
 */
function reverseListIterative<T>(head: Node<T> | null): Node<T> | null {
  let prev: Node<T> | null = null;
  let current = head;
  while (current !== null) {
    const next = current.next; // 1. 先记住后继
    current.next = prev; // 2. 反转指针
    prev = current; // 3. prev 前进
    current = next; // 4. current 前进
  }
  return prev; // 循环结束时 current 为 null，prev 停在新头节点
}

/**
 * 写法二：递归（O(n) 时间 / O(n) 递归栈空间）
 * 递到尾节点后开始归，归的过程中逐层反转指针。
 * 优雅但有爆栈风险——V8 默认栈深约 1 万层，超长链表禁用。
 */
function reverseListRecursive<T>(head: Node<T> | null): Node<T> | null {
  // 基准情形：空链表或单节点，自身即反转结果
  if (head === null || head.next === null) return head;
  const newHead = reverseListRecursive(head.next); // 先反转后半段
  head.next.next = head; // 让后继节点指回自己
  head.next = null; // 断开原指向，否则成环
  return newHead;
}

/**
 * 写法三：借助栈（O(n) 时间 / O(n) 空间，最直白但最不优）
 * 全部入栈再依次弹出重接，利用栈的 LIFO 天然倒序。
 */
function reverseListWithStack<T>(head: Node<T> | null): Node<T> | null {
  if (head === null) return null;
  const stack: Node<T>[] = [];
  let current: Node<T> | null = head;
  while (current !== null) {
    stack.push(current);
    current = current.next;
  }
  const newHead = stack.pop()!;
  let tail = newHead;
  while (stack.length > 0) {
    tail.next = stack.pop()!;
    tail = tail.next;
  }
  tail.next = null; // 关键：新尾节点的 next 必须置空，否则成环
  return newHead;
}

// ============================================================
// 三、快慢指针判环（LeetCode 141，Floyd 判圈算法）
// ============================================================

/**
 * 快指针每次走 2 步，慢指针每次走 1 步。
 * 若有环：快指针先进环并绕圈，相对慢指针每轮缩短 1 步距离，必然相遇；
 * 若无环：快指针先到 null 终止。
 * 为什么不用 Set 记录访问过的节点：Set 要 O(n) 空间，快慢指针只要 O(1)。
 */
function hasCycle<T>(head: Node<T> | null): boolean {
  let slow = head;
  let fast = head;
  while (fast !== null && fast.next !== null) {
    slow = slow!.next;
    fast = fast.next.next;
    if (slow === fast) return true; // 引用相等即相遇
  }
  return false;
}

// ============================================================
// 四、双向链表简版
// ============================================================

class DoublyNode<T> {
  value: T;
  prev: DoublyNode<T> | null = null;
  next: DoublyNode<T> | null = null;
  constructor(value: T) {
    this.value = value;
  }
}

/**
 * 双向链表：每个节点多一个 prev 指针，换来 O(1) 的尾删和前向遍历能力。
 * LRU 缓存选择双向链表正是因为：删除任意节点（已知引用）只需 O(1)。
 */
class DoublyLinkedList<T> {
  private head: DoublyNode<T> | null = null;
  private tail: DoublyNode<T> | null = null; // 尾指针让 append/removeTail 降到 O(1)
  private length = 0;

  append(value: T): void {
    const node = new DoublyNode(value);
    if (this.tail === null) {
      this.head = this.tail = node; // 空表：头尾同指
    } else {
      node.prev = this.tail;
      this.tail.next = node;
      this.tail = node;
    }
    this.length++;
  }

  prepend(value: T): void {
    const node = new DoublyNode(value);
    if (this.head === null) {
      this.head = this.tail = node;
    } else {
      node.next = this.head;
      this.head.prev = node;
      this.head = node;
    }
    this.length++;
  }

  /** 尾删 O(1)：靠 tail.prev 直接定位前驱，这是单向链表做不到的 */
  removeTail(): T | undefined {
    if (this.tail === null) return undefined;
    const removed = this.tail;
    this.tail = removed.prev;
    if (this.tail !== null) {
      this.tail.next = null;
    } else {
      this.head = null; // 删空了，头指针也要清
    }
    this.length--;
    return removed.value;
  }

  size(): number {
    return this.length;
  }

  toString(): string {
    const parts: T[] = [];
    let current = this.head;
    while (current !== null) {
      parts.push(current.value);
      current = current.next;
    }
    return parts.join(" <-> ");
  }
}

// ============================================================
// 五、工具：数组转链表（自测用）
// ============================================================

function arrayToList<T>(arr: T[]): Node<T> | null {
  const dummy = new Node<T>(undefined as unknown as T); // 哑节点简化头插判断
  let tail = dummy;
  for (const item of arr) {
    tail.next = new Node(item);
    tail = tail.next;
  }
  return dummy.next;
}

function listToArray<T>(head: Node<T> | null): T[] {
  const result: T[] = [];
  let current = head;
  while (current !== null) {
    result.push(current.value);
    current = current.next;
  }
  return result;
}

// ============================================================
// 六、自测断言
// ============================================================

// --- LinkedList CRUD ---
const list = new LinkedList<number>();
console.assert(list.isEmpty() && list.size() === 0, "新链表应为空");
console.assert(list.get(0) === undefined && list.removeAt(0) === undefined, "空链表取值/删除应返回 undefined");
console.assert(list.insert(1, 5) === false, "越界插入应返回 false");
list.append(2);
list.append(4);
list.insert(1, 0); // 头插
list.insert(3, 2); // 中间插
list.insert(5, 4); // 尾插
console.assert(list.toString() === "1 -> 2 -> 3 -> 4 -> 5", "插入后应为 1->2->3->4->5");
console.assert(list.size() === 5, "size 应为 5");
console.assert(list.get(2) === 3, "下标 2 应为 3");
console.assert(list.get(-1) === undefined && list.get(99) === undefined, "越界 get 应为 undefined");
list.update(30, 2);
console.assert(list.get(2) === 30, "update 后下标 2 应为 30");
console.assert(list.update(0, 99) === false, "越界 update 应返回 false");
console.assert(list.indexOf(30) === 2 && list.indexOf(1) === 0, "indexOf 应定位到正确下标");
console.assert(list.indexOf(999) === -1, "不存在的值应返回 -1");
console.assert(list.removeAt(0) === 1, "删头应返回 1");
console.assert(list.removeAt(3) === 5, "删尾应返回 5");
console.assert(list.removeAt(1) === 30, "删中间应返回 30");
console.assert(list.toString() === "2 -> 4", "剩余应为 2->4");
console.assert(list.size() === 2, "删除后 size 应为 2");

// --- 反转三法（同一输入各验证一次） ---
const reversed1 = reverseListIterative(arrayToList([1, 2, 3, 4, 5]));
console.assert(JSON.stringify(listToArray(reversed1)) === "[5,4,3,2,1]", "迭代反转应为 5,4,3,2,1");
const reversed2 = reverseListRecursive(arrayToList([1, 2, 3]));
console.assert(JSON.stringify(listToArray(reversed2)) === "[3,2,1]", "递归反转应为 3,2,1");
const reversed3 = reverseListWithStack(arrayToList(["a", "b", "c"]));
console.assert(JSON.stringify(listToArray(reversed3)) === '["c","b","a"]', "栈反转应为 c,b,a");
// 边界：空链表与单节点，三种写法都必须安全
console.assert(reverseListIterative(null) === null, "迭代反转空链表应返回 null");
console.assert(reverseListRecursive(null) === null, "递归反转空链表应返回 null");
console.assert(reverseListWithStack(null) === null, "栈反转空链表应返回 null");
console.assert(JSON.stringify(listToArray(reverseListIterative(arrayToList([7])))) === "[7]", "单节点反转应不变");

// --- 快慢指针判环 ---
console.assert(hasCycle(arrayToList([1, 2, 3])) === false, "普通链表应无环");
console.assert(hasCycle(null) === false, "空链表应无环");
console.assert(hasCycle(arrayToList([1])) === false, "单节点无环");
// 手工造环：3 -> 2 -> 0 -> 4，尾节点 4 指回节点 2
const n3 = new Node(3);
const n2 = new Node(2);
const n0 = new Node(0);
const n4 = new Node(4);
n3.next = n2;
n2.next = n0;
n0.next = n4;
n4.next = n2; // 成环
console.assert(hasCycle(n3) === true, "尾节点指回中间应判为有环");
const single = new Node(99);
single.next = single; // 自环
console.assert(hasCycle(single) === true, "自环应判为有环");

// --- 双向链表 ---
const dlist = new DoublyLinkedList<string>();
console.assert(dlist.removeTail() === undefined, "空双向链表尾删应返回 undefined");
dlist.append("b");
dlist.prepend("a");
dlist.append("c");
console.assert(dlist.toString() === "a <-> b <-> c", "应为 a<->b<->c");
console.assert(dlist.removeTail() === "c", "尾删应返回 c");
console.assert(dlist.removeTail() === "b", "尾删应返回 b");
console.assert(dlist.size() === 1, "应剩 1 个节点");
console.assert(dlist.removeTail() === "a", "删最后一个应返回 a");
console.assert(dlist.size() === 0 && dlist.removeTail() === undefined, "删空后尾删应返回 undefined");
// 删空后还能继续用（头尾指针状态一致性的关键验证）
dlist.append("新");
console.assert(dlist.toString() === "新" && dlist.size() === 1, "删空后应可正常复用");

console.log("✅ 22-03 linked-list 全部断言通过");

export {};

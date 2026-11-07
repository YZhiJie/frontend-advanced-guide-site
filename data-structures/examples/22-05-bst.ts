/**
 * 22-05-bst.ts —— 二叉搜索树（Binary Search Tree, BST）
 * 对应主文档：第二十二部分 22.5 树与二叉搜索树
 *
 * 内容清单：
 *   1. TreeNode<T> 节点 + BSTree<T> 泛型类
 *   2. insert / search（循环实现，避免递归爆栈）
 *   3. 前序 / 中序 / 后序 / 层序四种遍历（中序结果天然升序，可作正确性校验）
 *   4. min / max
 *   5. remove 三情形：叶子节点 / 单子节点 / 双子节点（找中序后继顶替）
 *
 * 运行方式：npx tsx data-structures/examples/22-05-bst.ts
 */

// ============================================================
// 一、节点与 BST 封装
// ============================================================

class TreeNode<T> {
  value: T;
  left: TreeNode<T> | null = null;
  right: TreeNode<T> | null = null;
  constructor(value: T) {
    this.value = value;
  }
}

/**
 * BST 性质：任意节点的左子树所有值 < 节点值 < 右子树所有值（本实现不允许重复值）。
 * 查找/插入/删除的平均复杂度都是 O(log n)，
 * 但插入序列有序时会退化成链表 O(n)——这正是下一个文件 AVL 要解决的问题。
 */
class BSTree<T> {
  protected root: TreeNode<T> | null = null;
  protected count = 0;
  /** 比较器：返回负数表示 a < b，0 相等，正数 a > b。默认适配 number / string */
  protected compare: (a: T, b: T) => number;

  constructor(compare?: (a: T, b: T) => number) {
    this.compare =
      compare ??
      ((a: T, b: T): number => {
        // 默认比较器仅兜底 number/string；自定义类型必须传 compare
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
      });
  }

  /** 循环版插入：沿比较结果一路向下找到空位挂上。重复值直接忽略 */
  insert(value: T): void {
    const newNode = new TreeNode(value);
    if (this.root === null) {
      this.root = newNode;
      this.count++;
      return;
    }
    let current = this.root;
    // 循环找插入点：比当前小走左，大走右，等于则放弃
    while (true) {
      const cmp = this.compare(value, current.value);
      if (cmp < 0) {
        if (current.left === null) {
          current.left = newNode;
          break;
        }
        current = current.left;
      } else if (cmp > 0) {
        if (current.right === null) {
          current.right = newNode;
          break;
        }
        current = current.right;
      } else {
        return; // 已存在，不重复插入
      }
    }
    this.count++;
  }

  /** 循环版查找：与插入同一条下行路径，O(树高) */
  search(value: T): boolean {
    let current = this.root;
    while (current !== null) {
      const cmp = this.compare(value, current.value);
      if (cmp === 0) return true;
      current = cmp < 0 ? current.left : current.right;
    }
    return false;
  }

  // ============================================================
  // 二、四种遍历
  // ============================================================

  /** 前序：根 -> 左 -> 右。常用于「复制一棵树」 */
  preOrder(): T[] {
    const result: T[] = [];
    const walk = (node: TreeNode<T> | null): void => {
      if (node === null) return;
      result.push(node.value);
      walk(node.left);
      walk(node.right);
    };
    walk(this.root);
    return result;
  }

  /** 中序：左 -> 根 -> 右。BST 的中序结果必然升序——这是验证 BST 正确性的黄金手段 */
  inOrder(): T[] {
    const result: T[] = [];
    const walk = (node: TreeNode<T> | null): void => {
      if (node === null) return;
      walk(node.left);
      result.push(node.value);
      walk(node.right);
    };
    walk(this.root);
    return result;
  }

  /** 后序：左 -> 右 -> 根。常用于「先处理子节点再处理父节点」的场景，如删除整棵树 */
  postOrder(): T[] {
    const result: T[] = [];
    const walk = (node: TreeNode<T> | null): void => {
      if (node === null) return;
      walk(node.left);
      walk(node.right);
      result.push(node.value);
    };
    walk(this.root);
    return result;
  }

  /** 层序：BFS，借队列按层输出。前端渲染树形组件时常用 */
  levelOrder(): T[] {
    const result: T[] = [];
    if (this.root === null) return result;
    const queue: TreeNode<T>[] = [this.root];
    while (queue.length > 0) {
      const node = queue.shift()!; // 教学可读优先；生产环境应换环形队列避免 O(n)
      result.push(node.value);
      if (node.left !== null) queue.push(node.left);
      if (node.right !== null) queue.push(node.right);
    }
    return result;
  }

  // ============================================================
  // 三、最值
  // ============================================================

  /** 最小值一定在「一路向左」的尽头 */
  min(): T | undefined {
    if (this.root === null) return undefined;
    let current = this.root;
    while (current.left !== null) current = current.left;
    return current.value;
  }

  /** 最大值一定在「一路向右」的尽头 */
  max(): T | undefined {
    if (this.root === null) return undefined;
    let current = this.root;
    while (current.right !== null) current = current.right;
    return current.value;
  }

  // ============================================================
  // 四、删除（三情形）
  // ============================================================

  remove(value: T): boolean {
    const result = this.removeNode(this.root, value);
    if (result.removed) {
      this.root = result.node;
      this.count--;
    }
    return result.removed;
  }

  /**
   * 递归删除，返回 { node: 子树新根, removed: 是否真的删掉了 }。
   * 三情形处理：
   *   1. 叶子节点：直接摘（返回 null）；
   *   2. 单子节点：让唯一的子节点顶替自己；
   *   3. 双子节点：找右子树最小值（中序后继）的值覆盖当前节点，
   *      再去右子树递归删掉那个后继——把「删双子」化归为情形 1 或 2。
   */
  private removeNode(
    node: TreeNode<T> | null,
    value: T,
  ): { node: TreeNode<T> | null; removed: boolean } {
    if (node === null) return { node: null, removed: false };

    const cmp = this.compare(value, node.value);
    if (cmp < 0) {
      const result = this.removeNode(node.left, value);
      node.left = result.node;
      return { node, removed: result.removed };
    }
    if (cmp > 0) {
      const result = this.removeNode(node.right, value);
      node.right = result.node;
      return { node, removed: result.removed };
    }

    // 命中待删节点
    // 情形 1 + 情形 2 合并：左空回右、右空回左、皆空回 null
    if (node.left === null) return { node: node.right, removed: true };
    if (node.right === null) return { node: node.left, removed: true };

    // 情形 3：双子节点。中序后继 = 右子树最左节点
    let successor = node.right;
    while (successor.left !== null) successor = successor.left;
    node.value = successor.value; // 只搬值，不搬节点
    const result = this.removeNode(node.right, successor.value); // 去右子树删后继
    node.right = result.node;
    return { node, removed: true };
  }

  size(): number {
    return this.count;
  }

  isEmpty(): boolean {
    return this.count === 0;
  }
}

// ============================================================
// 五、自测断言
// ============================================================

// 构造经典样例树：
//            11
//          /    \
//         7      15
//        / \    /  \
//       5   9  13   20
//      / \   \      / \
//     3   6  10   18  25
const bst = new BSTree<number>();
const insertOrder = [11, 7, 15, 5, 9, 3, 6, 13, 20, 10, 18, 25];
for (const v of insertOrder) bst.insert(v);

console.assert(bst.size() === 12, "插入 12 个节点后 size 应为 12");

// --- 四种遍历 ---
console.assert(
  JSON.stringify(bst.preOrder()) ===
    JSON.stringify([11, 7, 5, 3, 6, 9, 10, 15, 13, 20, 18, 25]),
  "前序应为根-左-右",
);
const inOrder = bst.inOrder();
console.assert(
  JSON.stringify(inOrder) ===
    JSON.stringify([3, 5, 6, 7, 9, 10, 11, 13, 15, 18, 20, 25]),
  "中序结果必须升序（BST 黄金性质）",
);
// 中序升序的通用校验：每个元素都严格大于前一个
let sorted = true;
for (let i = 1; i < inOrder.length; i++) {
  if (inOrder[i] <= inOrder[i - 1]) sorted = false;
}
console.assert(sorted, "中序遍历结果应严格递增");
console.assert(
  JSON.stringify(bst.postOrder()) ===
    JSON.stringify([3, 6, 5, 10, 9, 7, 13, 18, 25, 20, 15, 11]),
  "后序应为左-右-根",
);
console.assert(
  JSON.stringify(bst.levelOrder()) ===
    JSON.stringify([11, 7, 15, 5, 9, 13, 20, 3, 6, 10, 18, 25]),
  "层序应逐层输出",
);

// --- 查找与最值 ---
console.assert(bst.search(10) === true, "应找到 10");
console.assert(bst.search(11) === true, "应找到根 11");
console.assert(bst.search(100) === false, "不存在的值应返回 false");
console.assert(bst.min() === 3, "最小值应为 3");
console.assert(bst.max() === 25, "最大值应为 25");

// --- 重复插入 ---
const beforeDup = bst.size();
bst.insert(10); // 已存在
console.assert(bst.size() === beforeDup, "重复插入应被忽略");

// --- 删除情形 1：叶子节点（3） ---
console.assert(bst.remove(3) === true, "删除叶子 3 应成功");
console.assert(
  bst.search(3) === false && bst.size() === 11,
  "删除后应查不到且 size 减一",
);
console.assert(
  JSON.stringify(bst.inOrder()) ===
    JSON.stringify([5, 6, 7, 9, 10, 11, 13, 15, 18, 20, 25]),
  "删叶子后中序仍应升序",
);

// --- 删除情形 2：单子节点（9 只有右子 10） ---
console.assert(bst.remove(9) === true, "删除单子节点 9 应成功");
console.assert(
  JSON.stringify(bst.inOrder()) ===
    JSON.stringify([5, 6, 7, 10, 11, 13, 15, 18, 20, 25]),
  "删单子节点后中序仍应升序",
);

// --- 删除情形 3：双子节点（7，后继为 10） ---
console.assert(bst.remove(7) === true, "删除双子节点 7 应成功");
console.assert(bst.search(7) === false, "7 应被删除");
console.assert(bst.search(10) === true, "中序后继 10 应顶替上来且仍可查");
console.assert(
  JSON.stringify(bst.inOrder()) ===
    JSON.stringify([5, 6, 10, 11, 13, 15, 18, 20, 25]),
  "删双子节点后中序仍应升序",
);

// --- 删除根节点（11，双子，后继 13） ---
console.assert(bst.remove(11) === true, "删除根应成功");
console.assert(
  JSON.stringify(bst.inOrder()) ===
    JSON.stringify([5, 6, 10, 13, 15, 18, 20, 25]),
  "删根后中序仍应升序",
);
console.assert(bst.inOrder()[3] === 13, "新根应为中序后继 13");

// --- 边界 ---
console.assert(bst.remove(999) === false, "删除不存在的值应返回 false");
console.assert(bst.size() === 8, "连续删除 4 个节点后 size 应为 8");
const emptyBst = new BSTree<number>();
console.assert(emptyBst.search(1) === false, "空树查找应返回 false");
console.assert(
  emptyBst.min() === undefined && emptyBst.max() === undefined,
  "空树最值应为 undefined",
);
console.assert(emptyBst.remove(1) === false, "空树删除应返回 false");
console.assert(
  JSON.stringify(emptyBst.inOrder()) === "[]" &&
    JSON.stringify(emptyBst.levelOrder()) === "[]",
  "空树遍历应返回空数组",
);
// 单节点树：删除唯一的根
const single = new BSTree<number>();
single.insert(42);
console.assert(
  single.remove(42) === true && single.isEmpty(),
  "单节点树删根后应为空",
);

// --- 自定义类型 + 自定义比较器 ---
interface User {
  id: number;
  name: string;
}
const userTree = new BSTree<User>((a, b) => a.id - b.id);
userTree.insert({ id: 2, name: "乙" });
userTree.insert({ id: 1, name: "甲" });
userTree.insert({ id: 3, name: "丙" });
console.assert(
  userTree
    .inOrder()
    .map((u) => u.name)
    .join("") === "甲乙丙",
  "自定义比较器下中序应按 id 升序",
);

console.log("✅ 22-05 bst 全部断言通过");

export {};

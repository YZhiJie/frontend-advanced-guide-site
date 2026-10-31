/**
 * 22-06-avl.ts —— AVL 自平衡二叉搜索树
 * 对应主文档：第二十二部分 22.5 树与二叉搜索树（平衡树小节）
 *
 * 内容清单：
 *   1. AVLNode<T>：节点带高度；平衡因子 = 左子树高 - 右子树高
 *   2. LL / RR / LR / RL 四种旋转（右旋、左旋、先左后右、先右后左）
 *   3. insert 后自底向上回溯更新高度并再平衡
 *   4. 对照实验：顺序插入 1..10，普通 BST 退化成链（高 10），AVL 保持平衡（高 4）
 *
 * 为什么需要 AVL：BST 的各种操作复杂度都是 O(树高)，
 * 顺序插入会让树高退化到 O(n)。AVL 用「任意节点左右子树高度差 ≤ 1」
 * 的强约束把树高压在 O(log n)，插入时最多两次旋转即可恢复平衡。
 *
 * 运行方式：npx tsx data-structures/examples/22-06-avl.ts
 */

// ============================================================
// 一、AVL 节点与树
// ============================================================

class AVLNode<T> {
  value: T;
  left: AVLNode<T> | null = null;
  right: AVLNode<T> | null = null;
  height = 1; // 新节点高度为 1（约定：空节点高度为 0）
  constructor(value: T) {
    this.value = value;
  }
}

class AVLTree<T> {
  private root: AVLNode<T> | null = null;
  private count = 0;
  private compare: (a: T, b: T) => number;

  constructor(compare?: (a: T, b: T) => number) {
    this.compare =
      compare ??
      ((a: T, b: T): number => {
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
      });
  }

  // ---------- 高度与平衡因子 ----------

  private height(node: AVLNode<T> | null): number {
    return node === null ? 0 : node.height; // 空节点高度约定为 0
  }

  private updateHeight(node: AVLNode<T>): void {
    node.height = Math.max(this.height(node.left), this.height(node.right)) + 1;
  }

  /** 平衡因子 = 左高 - 右高。绝对值 > 1 即失衡 */
  private balanceFactor(node: AVLNode<T>): number {
    return this.height(node.left) - this.height(node.right);
  }

  // ---------- 旋转 ----------

  /**
   * 右旋（修复 LL 失衡：左子树的左侧过重）
   *        y                 x
   *       / \               / \
   *      x   C    ===>     A   y
   *     / \                   / \
   *    A   B                 B   C
   * 关键就两步：y.left = B；x.right = y。然后先更新 y 的高度（y 现在更低）。
   */
  private rotateRight(y: AVLNode<T>): AVLNode<T> {
    const x = y.left!;
    const B = x.right;
    x.right = y;
    y.left = B;
    this.updateHeight(y); // 必须先更新被压低的 y，再更新抬升的 x
    this.updateHeight(x);
    return x; // 返回子树新根
  }

  /** 左旋（修复 RR 失衡：右子树的右侧过重），与右旋完全镜像 */
  private rotateLeft(x: AVLNode<T>): AVLNode<T> {
    const y = x.right!;
    const B = y.left;
    y.left = x;
    x.right = B;
    this.updateHeight(x);
    this.updateHeight(y);
    return y;
  }

  /**
   * 插入后的再平衡（在递归回溯路径上逐层调用）。
   * 四种失衡形态判断依据：失衡节点平衡因子的符号 + 较重子树平衡因子的符号。
   */
  private rebalance(node: AVLNode<T>): AVLNode<T> {
    this.updateHeight(node);
    const bf = this.balanceFactor(node);

    // LL：左重（bf > 1）且插入在左子的左侧（左子 bf >= 0）→ 单次右旋
    if (bf > 1 && this.balanceFactor(node.left!) >= 0) {
      return this.rotateRight(node);
    }
    // LR：左重但插入在左子的右侧 → 先对左子左旋化为 LL，再整体右旋
    if (bf > 1 && this.balanceFactor(node.left!) < 0) {
      node.left = this.rotateLeft(node.left!);
      return this.rotateRight(node);
    }
    // RR：右重且插入在右子的右侧 → 单次左旋
    if (bf < -1 && this.balanceFactor(node.right!) <= 0) {
      return this.rotateLeft(node);
    }
    // RL：右重但插入在右子的左侧 → 先对右子右旋化为 RR，再整体左旋
    if (bf < -1 && this.balanceFactor(node.right!) > 0) {
      node.right = this.rotateRight(node.right!);
      return this.rotateLeft(node);
    }
    return node; // 未失衡，原样返回
  }

  // ---------- 插入 ----------

  insert(value: T): void {
    const before = this.count;
    this.root = this.insertNode(this.root, value);
    if (this.count > before) this.count = before + 1;
  }

  /**
   * 递归插入。递归天然携带「自底向上回溯」的路径，
   * 回程时逐层 rebalance，正好把新节点到根的路径上所有祖先检查一遍。
   */
  private insertNode(node: AVLNode<T> | null, value: T): AVLNode<T> {
    if (node === null) {
      this.count++;
      return new AVLNode(value);
    }
    const cmp = this.compare(value, node.value);
    if (cmp < 0) {
      node.left = this.insertNode(node.left, value);
    } else if (cmp > 0) {
      node.right = this.insertNode(node.right, value);
    } else {
      return node; // 重复值忽略
    }
    return this.rebalance(node); // 回溯时再平衡
  }

  // ---------- 观测方法 ----------

  getHeight(): number {
    return this.height(this.root);
  }

  size(): number {
    return this.count;
  }

  inOrder(): T[] {
    const result: T[] = [];
    const walk = (node: AVLNode<T> | null): void => {
      if (node === null) return;
      walk(node.left);
      result.push(node.value);
      walk(node.right);
    };
    walk(this.root);
    return result;
  }

  /** 校验整棵树每个节点都满足 |平衡因子| ≤ 1（自测用） */
  isBalanced(): boolean {
    const check = (node: AVLNode<T> | null): boolean => {
      if (node === null) return true;
      if (Math.abs(this.balanceFactor(node)) > 1) return false;
      return check(node.left) && check(node.right);
    };
    return check(this.root);
  }
}

// ============================================================
// 二、极简 BST（仅用于高度对照，演示「为什么需要 AVL」）
// ============================================================

class SimpleBST<T> {
  private root: AVLNode<T> | null = null;
  private compare: (a: T, b: T) => number;

  constructor(compare: (a: T, b: T) => number) {
    this.compare = compare;
  }

  insert(value: T): void {
    const node = new AVLNode(value);
    if (this.root === null) {
      this.root = node;
      return;
    }
    let current = this.root;
    while (true) {
      if (this.compare(value, current.value) < 0) {
        if (current.left === null) {
          current.left = node;
          return;
        }
        current = current.left;
      } else {
        if (current.right === null) {
          current.right = node;
          return;
        }
        current = current.right;
      }
    }
  }

  getHeight(): number {
    const h = (node: AVLNode<T> | null): number =>
      node === null ? 0 : Math.max(h(node.left), h(node.right)) + 1;
    return h(this.root);
  }
}

// ============================================================
// 三、对照实验 + 自测断言
// ============================================================

// --- 四种旋转逐一验证 ---

// LL：顺序插 1,2,3 → 失衡于根 1，右旋后根变 2
const ll = new AVLTree<number>();
ll.insert(1);
ll.insert(2);
ll.insert(3);
console.assert(JSON.stringify(ll.inOrder()) === "[1,2,3]", "LL 旋转后中序应保持 1,2,3");
console.assert(ll.getHeight() === 2, "LL 旋转后树高应为 2（不平衡时会是 3）");

// RR：倒序插 3,2,1 → 左旋后根变 2
const rr = new AVLTree<number>();
rr.insert(3);
rr.insert(2);
rr.insert(1);
console.assert(rr.getHeight() === 2, "RR 旋转后树高应为 2");
console.assert(JSON.stringify(rr.inOrder()) === "[1,2,3]", "RR 旋转后中序应保持 1,2,3");

// LR：插 3,1,2 → 先左旋左子再右旋
const lr = new AVLTree<number>();
lr.insert(3);
lr.insert(1);
lr.insert(2);
console.assert(lr.getHeight() === 2, "LR 双旋转后树高应为 2");
console.assert(JSON.stringify(lr.inOrder()) === "[1,2,3]", "LR 旋转后中序应保持 1,2,3");

// RL：插 1,3,2 → 先右旋右子再左旋
const rl = new AVLTree<number>();
rl.insert(1);
rl.insert(3);
rl.insert(2);
console.assert(rl.getHeight() === 2, "RL 双旋转后树高应为 2");
console.assert(JSON.stringify(rl.inOrder()) === "[1,2,3]", "RL 旋转后中序应保持 1,2,3");

// --- 对照实验：顺序插入 1..10 ---
const bst = new SimpleBST<number>((a, b) => a - b);
const avl = new AVLTree<number>();
for (let i = 1; i <= 10; i++) {
  bst.insert(i);
  avl.insert(i);
}
console.assert(bst.getHeight() === 10, "BST 顺序插入 1..10 应退化成链，树高 10");
console.assert(avl.getHeight() === 4, "AVL 应把 10 个节点的树高压到 4");
console.assert(avl.isBalanced(), "AVL 全树每个节点平衡因子都应在 [-1, 1]");
console.assert(
  JSON.stringify(avl.inOrder()) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
  "AVL 中序结果应保持升序"
);
console.log(`📊 对照实验：顺序插入 1..10`);
console.log(`   普通 BST 树高 = ${bst.getHeight()}（已退化成链表，查找 O(n)）`);
console.log(`   AVL 树高    = ${avl.getHeight()}（保持平衡，查找 O(log n)）`);

// --- 大规模随机插入的平衡性 ---
const bigAvl = new AVLTree<number>();
const shuffled: number[] = [];
for (let i = 0; i < 1000; i++) shuffled.push(i);
// 固定伪随机打乱（种子固定保证可复现）
let seed = 42;
const rand = (): number => {
  seed = (seed * 9301 + 49297) % 233280;
  return seed / 233280;
};
for (let i = shuffled.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
}
for (const v of shuffled) bigAvl.insert(v);
console.assert(bigAvl.size() === 1000, "插入 1000 个随机数后 size 应为 1000");
console.assert(bigAvl.isBalanced(), "1000 次随机插入后全树应保持平衡");
// 1000 节点的 AVL 树高上界约 1.44 * log2(1000) ≈ 14.4，取 15 校验
console.assert(bigAvl.getHeight() <= 15, "1000 节点的 AVL 树高不应超过 15");

// --- 边界 ---
const empty = new AVLTree<number>();
console.assert(empty.getHeight() === 0 && empty.size() === 0, "空树高度应为 0");
console.assert(empty.isBalanced(), "空树视为平衡");
empty.insert(7);
empty.insert(7); // 重复值
console.assert(empty.size() === 1 && empty.getHeight() === 1, "单节点树高度为 1，重复插入被忽略");

console.log("✅ 22-06 avl 全部断言通过");

export {};

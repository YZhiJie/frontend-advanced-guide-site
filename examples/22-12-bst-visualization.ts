// 文件: examples/22-12-bst-visualization.ts
// ============ 二叉搜索树可视化：插入 / 查找 / 遍历的路径帧 ============
// 树的帧必须交出一棵「可序列化的快照」，而不是节点引用：
//   引用在回放时早已被后续插入修改，历史帧会一起变化（典型的可变状态陷阱）。
// 本示例每次关键动作都深拷贝整棵树，UI 按帧就能看到节点逐个长出来。
// 运行方式：npx tsx examples/22-12-bst-visualization.ts

interface BSTNode {
  value: number;
  left: BSTNode | null;
  right: BSTNode | null;
}

/** 深拷贝：只保留 value/left/right，避免把方法或循环引用带进帧 */
function snapshot(node: BSTNode | null): BSTNode | null {
  if (!node) return null;
  return { value: node.value, left: snapshot(node.left), right: snapshot(node.right) };
}

interface TreeFrame {
  tree: BSTNode | null;
  active: number | null;
  found: number[];
  msg: string;
}

class TracedBST {
  root: BSTNode | null = null;
  readonly frames: TreeFrame[] = [];

  private mark(active: number | null, found: number[], msg: string): void {
    this.frames.push({ tree: snapshot(this.root), active, found, msg });
  }

  insert(value: number): void {
    this.root = this.insertAt(this.root, value);
    this.mark(value, [], `插入 ${value}`);
  }

  private insertAt(node: BSTNode | null, value: number): BSTNode {
    if (!node) return { value, left: null, right: null };
    if (value < node.value) node.left = this.insertAt(node.left, value);
    else if (value > node.value) node.right = this.insertAt(node.right, value);
    // 相等值不重复插入：BST 的「键唯一」约束
    return node;
  }

  search(target: number): boolean {
    let node = this.root;
    const path: number[] = [];
    while (node) {
      path.push(node.value);
      this.mark(node.value, [], `访问 ${node.value}（路径 ${path.join(" → ")}）`);
      if (node.value === target) {
        this.mark(node.value, [target], `命中 ${target}`);
        return true;
      }
      node = target < node.value ? node.left : node.right;
    }
    this.mark(null, [], `未找到 ${target}`);
    return false;
  }

  inorder(): number[] {
    const out: number[] = [];
    const walk = (node: BSTNode | null): void => {
      if (!node) return;
      walk(node.left);
      out.push(node.value);
      this.mark(node.value, out, `中序访问 ${node.value}`);
      walk(node.right);
    };
    walk(this.root);
    return out;
  }

  height(node: BSTNode | null = this.root): number {
    return node ? 1 + Math.max(this.height(node.left), this.height(node.right)) : 0;
  }
}

const values = [8, 3, 10, 1, 6, 14, 4, 7, 13];
const bst = new TracedBST();
for (const v of values) bst.insert(v);

console.log("=== 插入帧（每次插入后整棵树快照）===");
console.log(`共 ${bst.frames.length} 帧，根节点 ${bst.root?.value}`);

const before = bst.frames.length;
console.log("\n=== 查找 7 ===");
console.log("查找结果:", bst.search(7));
console.log("查找 99:", bst.search(99));

console.log("\n=== 中序遍历（即升序）===");
const ordered = bst.inorder();
console.log("中序:", ordered.join(", "));

console.log("\n=== 最近 3 帧 ===");
for (const f of bst.frames.slice(-3)) {
  console.log(`活跃 ${f.active ?? "-"}：${f.msg}`);
}

const expected = [...new Set(values)].sort((a, b) => a - b);
if (JSON.stringify(ordered) !== JSON.stringify(expected))
  throw new Error(`中序遍历不是升序：${ordered.join(",")}`);
if (bst.height() !== 4) throw new Error(`树高应为 4，实际 ${bst.height()}`);
if (bst.search(7) !== true || bst.search(99) !== false) throw new Error("查找结果错误");
if (bst.frames.length <= before) throw new Error("查找过程没有产生帧");

console.log("\n✓ 插入/查找/遍历帧完整，中序升序，树高正确");

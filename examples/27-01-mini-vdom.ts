// 文件: examples/27-01-mini-vdom.ts
// ============ 手写迷你虚拟 DOM（h / isSameType / diff / keyed list diff）==========
// 纯函数实现，不依赖 DOM 环境，直接输出 diff 操作记录。

/* ============================================================
 * 1. VNode 结构 & h() 创建函数
 * ============================================================ */

type VNodeChild = VNode | string | number | null | false | undefined;
type VNodeProps = Record<string, any> & { key?: string | number | null };

export interface VNode {
  type: string; // 标签名, 或 TEXT 标识
  props: VNodeProps;
  children: VNode[];
  key: string | number | null;
}

export const TEXT = Symbol.for("vdom-text") as unknown as string;

/** h()：创建虚拟节点，模仿 React.createElement */
export function h(
  type: string,
  props?: VNodeProps | null,
  ...children: (VNodeChild | VNodeChild[])[]
): VNode {
  const p: VNodeProps = props ? { ...props } : {};
  const flatChildren: VNode[] = [];
  const walk = (list: VNodeChild[]) => {
    for (const c of list) {
      if (c === null || c === false || c === undefined) continue;
      if (Array.isArray(c)) walk(c);
      else if (typeof c === "string" || typeof c === "number")
        flatChildren.push({
          type: TEXT,
          props: {},
          children: [],
          key: null,
          text: String(c),
        } as any);
      else flatChildren.push(c);
    }
  };
  walk(children.flat());
  return {
    type,
    props: p,
    children: flatChildren,
    key: p.key ?? null,
  };
}

/* ============================================================
 * 2. Diff 操作记录（纯函数输出）
 * ============================================================ */

export type DiffOp =
  | { op: "CREATE"; vnode: VNode; parentIndex: number }
  | { op: "REMOVE"; vnode: VNode; index: number }
  | { op: "REPLACE"; old: VNode; next: VNode; index: number }
  | {
      op: "PATCH-PROPS";
      vnode: VNode;
      add: Record<string, any>;
      remove: string[];
    }
  | { op: "MOVE"; vnode: VNode; from: number; to: number }
  | { op: "PATCH-TEXT"; oldText: string; newText: string }
  | { op: "DIFF-CHILDREN"; parentType: string; ops: DiffOp[] };

function isSameVNodeType(a: VNode, b: VNode): boolean {
  return a.type === b.type && a.key === b.key;
}

function isTextNode(v: VNode): boolean {
  return v.type === TEXT;
}

/* ============================================================
 * 3. Props diff
 * ============================================================ */

function diffProps(
  oldP: VNodeProps,
  newP: VNodeProps,
): {
  add: Record<string, any>;
  remove: string[];
} {
  const add: Record<string, any> = {};
  const remove: string[] = [];
  for (const key of Object.keys({ ...oldP, ...newP })) {
    if (key === "key") continue;
    const oldV = oldP[key];
    const newV = newP[key];
    if (!(key in newP)) remove.push(key);
    else if (oldV !== newV) add[key] = newV;
  }
  return { add, remove };
}

/* ============================================================
 * 4. 最长上升子序列（用于 keyed list diff）
 * ============================================================ */

/** O(n log n) LIS：返回元素下标数组 */
function longestIncreasingSubsequence(idx: number[]): number[] {
  if (idx.length === 0) return [];
  // tails[i]: 长度为 i+1 的递增子序列的最小末尾值
  const tails: number[] = [];
  // parent[i]: idx[i] 的前驱下标（用于重建）
  const parent: number[] = new Array(idx.length).fill(-1);
  const tailIdx: number[] = []; // tails[i] 在原数组中的位置

  for (let i = 0; i < idx.length; i++) {
    const x = idx[i];
    if (tails.length === 0 || x > tails[tails.length - 1]) {
      parent[i] = tailIdx[tails.length - 1] ?? -1;
      tails.push(x);
      tailIdx.push(i);
    } else {
      // 二分找 tails 中第一个 >= x 的位置
      let lo = 0,
        hi = tails.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (tails[mid] < x) lo = mid + 1;
        else hi = mid;
      }
      tails[lo] = x;
      tailIdx[lo] = i;
      if (lo > 0) parent[i] = tailIdx[lo - 1];
    }
  }
  // 重建 LIS
  const result: number[] = [];
  let cur = tailIdx[tailIdx.length - 1] ?? -1;
  while (cur !== -1) {
    result.unshift(cur);
    cur = parent[cur];
  }
  return result;
}

/* ============================================================
 * 5. Keyed list diff（同层比较 + key 复用 + LIS 贪心）
 * ============================================================ */

function diffKeyedChildren(
  oldChildren: VNode[],
  newChildren: VNode[],
): DiffOp[] {
  const ops: DiffOp[] = [];

  // 建立 oldKey → oldIndex 映射
  const oldKeyMap = new Map<string | number, number>();
  oldChildren.forEach((c, i) => {
    if (c.key !== null) oldKeyMap.set(c.key, i);
  });

  // 对新 children 中每个元素, 找它在 old 中的 index（没找到 = -1）
  const posInOld: number[] = newChildren.map((nc) => {
    if (nc.key !== null) {
      return oldKeyMap.get(nc.key) ?? -1;
    }
    // 无 key：按同位置匹配
    const idx = oldChildren.findIndex(
      (oc) => oc.key === null && oc.type === nc.type,
    );
    return idx;
  });

  // 先收集 MOVE / PATCH
  // 找 posInOld 里 >0 的子集, 跑 LIS, LIS 里的元素不移动
  const candidates: number[] = posInOld.map((p, i) => (p >= 0 ? p : -1));
  const lisSet = new Set(longestIncreasingSubsequence(candidates));

  for (let i = 0; i < newChildren.length; i++) {
    const nc = newChildren[i];
    const oldIdx = candidates[i];
    if (oldIdx === -1) {
      ops.push({ op: "CREATE", vnode: nc, parentIndex: i });
    } else {
      // 找到了旧节点, patch 它
      const oc = oldChildren[oldIdx];
      ops.push(...diffVNode(oc, nc, i));
      // 不在 LIS 里的, 需要移动到位置 i
      if (!lisSet.has(i)) {
        ops.push({ op: "MOVE", vnode: nc, from: oldIdx, to: i });
      }
    }
  }

  // oldChildren 中 key 没在 newChildren 出现的 → REMOVE
  const newKeys = new Set(
    newChildren.filter((c) => c.key !== null).map((c) => c.key!),
  );
  oldChildren.forEach((oc, i) => {
    if (oc.key !== null && !newKeys.has(oc.key)) {
      ops.push({ op: "REMOVE", vnode: oc, index: i });
    } else if (oc.key === null) {
      // 无 key: 看同位置 new 是否还存在
      const nc = newChildren[i];
      if (!nc) ops.push({ op: "REMOVE", vnode: oc, index: i });
    }
  });

  return ops;
}

/* ============================================================
 * 6. 核心 diff 递归
 * ============================================================ */

export function diffVNode(
  oldV: VNode | null,
  newV: VNode,
  index = 0,
): DiffOp[] {
  const ops: DiffOp[] = [];
  if (!oldV) {
    ops.push({ op: "CREATE", vnode: newV, parentIndex: index });
    return ops;
  }
  if (!isSameVNodeType(oldV, newV)) {
    ops.push({ op: "REPLACE", old: oldV, next: newV, index });
    return ops;
  }

  // 同类型: patch props, 再 diff children
  if (isTextNode(newV)) {
    if ((oldV as any).text !== (newV as any).text) {
      ops.push({
        op: "PATCH-TEXT",
        oldText: (oldV as any).text,
        newText: (newV as any).text,
      });
    }
    return ops;
  }

  const { add, remove } = diffProps(oldV.props, newV.props);
  if (Object.keys(add).length || remove.length) {
    ops.push({ op: "PATCH-PROPS", vnode: newV, add, remove });
  }

  // children: 简单版, 用 keyed list diff
  const childOps = diffKeyedChildren(oldV.children, newV.children);
  if (childOps.length) {
    ops.push({ op: "DIFF-CHILDREN", parentType: newV.type, ops: childOps });
  }

  return ops;
}

/* ============================================================
 * 7. 测试: 打印 vdom tree + diff ops
 * ============================================================ */

function renderTree(v: VNode, depth = 0): string {
  const pad = "  ".repeat(depth);
  if (isTextNode(v)) return `${pad}"${(v as any).text}"`;
  const keyStr = v.key !== null ? ` [key=${v.key}]` : "";
  const propStr = Object.keys(v.props).filter((k) => k !== "key").length
    ? ` {${Object.entries(v.props)
        .filter(([k]) => k !== "key")
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(",")}}`
    : "";
  const head = `${pad}<${v.type}${keyStr}${propStr}>`;
  const kids = v.children.map((c) => renderTree(c, depth + 1)).join("\n");
  return kids
    ? `${head}\n${kids}\n${pad}</${v.type}>`
    : `${head}  </${v.type}>`;
}

function printOps(ops: DiffOp[], depth = 0): void {
  const pad = "  ".repeat(depth);
  for (const op of ops) {
    switch (op.op) {
      case "CREATE":
        console.log(`${pad}+ CREATE ${op.vnode.type}`);
        break;
      case "REMOVE":
        console.log(`${pad}- REMOVE ${op.vnode.type} (idx=${op.index})`);
        break;
      case "REPLACE":
        console.log(`${pad}* REPLACE ${op.old.type} → ${op.next.type}`);
        break;
      case "PATCH-PROPS":
        console.log(
          `${pad}~ PATCH-PROPS +${JSON.stringify(op.add)} -${op.remove}`,
        );
        break;
      case "MOVE":
        console.log(`${pad}↔ MOVE ${op.vnode.type} ${op.from} → ${op.to}`);
        break;
      case "PATCH-TEXT":
        console.log(`${pad}~ TEXT "${op.oldText}" → "${op.newText}"`);
        break;
      case "DIFF-CHILDREN":
        console.log(`${pad}↴ DIFF-CHILDREN of <${op.parentType}>:`);
        printOps(op.ops, depth + 1);
        break;
    }
  }
}

// --- 构造示例 ---
console.log("=== 场景 1: 首次渲染 ===");
const v1 = h("div", { id: "root" }, h("span", null, "hello"));
console.log(renderTree(v1));

console.log("\n=== 场景 2: 改文字 + 加属性 ===");
const v2 = h("div", { id: "root", class: "main" }, h("span", null, "world"));
printOps(diffVNode(v1, v2));

console.log("\n=== 场景 3: 列表重排 keyed diff ===");
const listOld = h(
  "ul",
  null,
  h("li", { key: "a" }, "A"),
  h("li", { key: "b" }, "B"),
  h("li", { key: "c" }, "C"),
  h("li", { key: "d" }, "D"),
);
// 把 D 移到 B 前面, 并新增 E
const listNew = h(
  "ul",
  null,
  h("li", { key: "a" }, "A"),
  h("li", { key: "d" }, "D"),
  h("li", { key: "b" }, "B"),
  h("li", { key: "c" }, "C"),
  h("li", { key: "e" }, "E"),
);
printOps(diffVNode(listOld, listNew));

console.log("\n=== 场景 4: 类型变化 → 整个子树替换 ===");
const oldBox = h("div", null, h("p", null, "hello"));
const newBox = h("section", null, h("p", null, "hello"));
printOps(diffVNode(oldBox, newBox));

console.log("\n✓ mini-vdom 验证完毕");

// 文件: cases/04-mini-framework-lab/src/vdom.ts
// ============ VNode 创建 + 同层 diff + keyed list LCS + patch ============

/** 任意 DOM 属性 */
export type Props = Record<string, unknown>;

/** 子节点：VNode、字符串或数字（文本节点），或它们的数组 */
export type Child = VNode | string | number;

/** 虚拟节点 */
export interface VNode {
  /** 标签名 / 'TEXT' / 组件函数 */
  type: string | (() => unknown);
  /** DOM 属性 */
  props: Props | null;
  /** 子节点（统一拍平成数组，文本节点存为 VNode<TEXT>） */
  children: VNode[];
  /** key，用于 keyed list diff */
  key?: string | number | null;
  /** 文本节点的内容 */
  text?: string;
}

// ============================================================
// h() —— 建造 VNode
// ============================================================

/**
 * 创建 VNode。children 里 string/number 会自动包成 TEXT 节点，
 * 数组会拍平，null/undefined/boolean 会被过滤。
 */
export function h(
  type: string | (() => unknown),
  props: Props | null,
  ...children: (Child | Child[] | null | undefined | boolean)[]
): VNode {
  const flat: VNode[] = [];
  for (const c of children) {
    if (c == null || typeof c === "boolean") continue;
    if (Array.isArray(c)) {
      for (const item of c) flat.push(...normalizeChild(item));
    } else {
      flat.push(...normalizeChild(c));
    }
  }

  const key =
    props && "key" in props
      ? (props as { key?: string | number | null }).key
      : undefined;
  const cleanedProps = props ? { ...props } : null;
  if (cleanedProps && "key" in cleanedProps) delete cleanedProps.key;

  return {
    type,
    props: cleanedProps,
    children: flat,
    key: key ?? null,
  };
}

function normalizeChild(c: Child): VNode[] {
  if (typeof c === "string" || typeof c === "number") {
    return [{ type: "TEXT", props: null, children: [], text: String(c) }];
  }
  return [c];
}

// ============================================================
// Patch 操作（纯函数，不依赖 DOM）
// ============================================================

export type PatchOp =
  | { op: "CREATE"; node: VNode }
  | { op: "REMOVE"; node: VNode }
  | { op: "REPLACE"; oldNode: VNode; newNode: VNode }
  | { op: "UPDATE_PROPS"; oldProps: Props | null; newProps: Props | null }
  | { op: "UPDATE_TEXT"; oldText: string; newText: string }
  | { op: "MOVE"; node: VNode; newIndex: number }
  | { op: "INSERT"; node: VNode; index: number };

/** 一次 diff 后根节点应执行的 patch 列表 */
export interface PatchResult {
  /** 根节点整体操作（CREATE / REPLACE / null 表示原地更新） */
  rootOp: PatchOp | null;
  /** 根节点自身 prop 更新（同层） */
  propOps: PatchOp[];
  /** 子节点操作（按最终顺序） */
  childrenOps: PatchResult[];
  /** 最终新节点 */
  newNode: VNode;
}

export function isSameVNodeType(
  a: VNode | null | undefined,
  b: VNode | null | undefined,
): boolean {
  if (!a || !b) return false;
  if (a.type !== b.type) return false;
  if (a.key !== b.key) return false;
  return true;
}

// ============================================================
// Diff 实现
// ============================================================

/** 对新旧 VNode 树做同层 diff，返回 PatchResult */
export function diff(oldNode: VNode | null, newNode: VNode): PatchResult {
  if (!oldNode) {
    return {
      rootOp: { op: "CREATE", node: newNode },
      propOps: [],
      childrenOps: diffChildren([], newNode.children),
      newNode,
    };
  }

  if (!isSameVNodeType(oldNode, newNode)) {
    return {
      rootOp: { op: "REPLACE", oldNode, newNode },
      propOps: [],
      childrenOps: diffChildren([], newNode.children),
      newNode,
    };
  }

  // 同类型节点：文本更新 + prop 更新 + 子节点 diff
  const propOps = diffProps(oldNode.props, newNode.props);
  const childrenOps = diffChildren(oldNode.children, newNode.children);

  return {
    rootOp: null,
    propOps,
    childrenOps,
    newNode,
  };
}

function diffProps(oldProps: Props | null, newProps: Props | null): PatchOp[] {
  const ops: PatchOp[] = [];
  const oldKeys = new Set<string>(oldProps ? Object.keys(oldProps) : []);
  const newKeys = new Set<string>(newProps ? Object.keys(newProps) : []);

  for (const k of oldKeys) {
    if (!newKeys.has(k)) {
      // 删除：用 UPDATE_PROPS 表示，value 设为 undefined
      ops.push({
        op: "UPDATE_PROPS",
        oldProps: { [k]: (oldProps as Props)[k] },
        newProps: { [k]: undefined },
      });
    }
  }
  for (const k of newKeys) {
    const oldV = oldProps ? (oldProps as Props)[k] : undefined;
    const newV = (newProps as Props)[k];
    if (!Object.is(oldV, newV)) {
      ops.push({
        op: "UPDATE_PROPS",
        oldProps: { [k]: oldV },
        newProps: { [k]: newV },
      });
    }
  }
  return ops;
}

function diffChildren(
  oldChildren: VNode[],
  newChildren: VNode[],
): PatchResult[] {
  // 尝试走 keyed diff
  const allKeyed =
    oldChildren.every((c) => c.key != null) &&
    newChildren.every((c) => c.key != null);

  if (allKeyed && oldChildren.length > 0 && newChildren.length > 0) {
    return diffKeyedChildren(oldChildren, newChildren);
  }

  // 回退：同层按索引逐一 diff
  const max = Math.max(oldChildren.length, newChildren.length);
  const out: PatchResult[] = [];
  for (let i = 0; i < max; i++) {
    const oldC = oldChildren[i] ?? null;
    const newC = newChildren[i];
    if (!oldC && newC) {
      out.push(diff(null, newC));
    } else if (oldC && !newC) {
      out.push({
        rootOp: { op: "REMOVE", node: oldC },
        propOps: [],
        childrenOps: [],
        newNode: oldC,
      });
    } else if (oldC && newC) {
      out.push(diff(oldC, newC));
    }
  }
  return out;
}

// ============================================================
// Keyed list LCS diff
// ============================================================

interface KeyedEntry {
  key: string | number;
  node: VNode;
  index: number;
}

function diffKeyedChildren(
  oldChildren: VNode[],
  newChildren: VNode[],
): PatchResult[] {
  const oldMap = new Map<string | number, KeyedEntry>();
  oldChildren.forEach((n, i) => {
    oldMap.set(n.key!, { key: n.key!, node: n, index: i });
  });

  const newMap = new Map<string | number, KeyedEntry>();
  newChildren.forEach((n, i) => {
    newMap.set(n.key!, { key: n.key!, node: n, index: i });
  });

  const out: PatchResult[] = [];

  // 1. 先处理新增 + 复用（按新顺序）
  const reusedOldNodes: (VNode | null)[] = []; // 新顺序对应的旧节点（或 null 表示新增）
  for (const newChild of newChildren) {
    const oldEntry = oldMap.get(newChild.key!);
    if (oldEntry) {
      reusedOldNodes.push(oldEntry.node);
    } else {
      reusedOldNodes.push(null);
    }
  }

  // 2. 计算 LCS：在 reusedOldNodes 中找到稳定的递增序列
  const lcsIndices = computeLCS(
    reusedOldNodes.map((n) => (n ? getOldIndex(oldChildren, n) : -1)),
  );

  // 3. 复用：稳定的用 diff，其余用 MOVE/INSERT
  const outIndexMap = new Map<number, number>(); // reusedOldNodes index -> lcs index 标记
  for (const idx of lcsIndices) outIndexMap.set(idx, 1);

  for (let i = 0; i < newChildren.length; i++) {
    const oldNode = reusedOldNodes[i];
    const newNode = newChildren[i];
    if (oldNode) {
      const childDiff = diff(oldNode, newNode);
      if (!outIndexMap.has(i)) {
        // 非 LCS 成员：需要 MOVE
        // 把 rootOp 外面再包一层 MOVE：用 childrenOps 里额外记录
        // 简化：直接把 diff 结果放进去，MOVE 信息记录在 rootOp 上
        childDiff.childrenOps.unshift({
          rootOp: { op: "MOVE", node: newNode, newIndex: i },
          propOps: [],
          childrenOps: [],
          newNode,
        });
      }
      out.push(childDiff);
    } else {
      out.push({
        rootOp: { op: "INSERT", node: newNode, index: i },
        propOps: [],
        childrenOps: diffChildren([], newNode.children),
        newNode,
      });
    }
  }

  // 4. 旧节点中未出现在新列表里的要删除
  for (const oldChild of oldChildren) {
    if (!newMap.has(oldChild.key!)) {
      out.push({
        rootOp: { op: "REMOVE", node: oldChild },
        propOps: [],
        childrenOps: [],
        newNode: oldChild,
      });
    }
  }

  return out;
}

function getOldIndex(oldChildren: VNode[], target: VNode): number {
  return oldChildren.indexOf(target);
}

/** 对一组整数序列求 LCS 的下标集合 */
function computeLCS(seq: number[]): number[] {
  const n = seq.length;
  if (n === 0) return [];

  // tails[i] 表示长度为 i+1 的 LCS 的最小末尾值
  const tails: number[] = [];
  const prev: number[] = new Array(n).fill(-1);
  const tailsIndex: number[] = new Array(n).fill(-1);

  for (let i = 0; i < n; i++) {
    const v = seq[i];
    if (v < 0) continue; // 跳过新增元素
    const lo = lowerBound(tails, v);
    if (lo === tails.length) {
      tails.push(v);
      tailsIndex[tails.length - 1] = i;
    } else {
      tails[lo] = v;
      tailsIndex[lo] = i;
    }
    if (lo > 0) prev[i] = tailsIndex[lo - 1];
  }

  // 回溯得到原始下标
  const result: number[] = [];
  let cur = tailsIndex[tails.length - 1];
  while (cur !== -1) {
    result.push(cur);
    cur = prev[cur];
  }
  result.reverse();
  return result;
}

function lowerBound(arr: number[], target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ============================================================
// Patch 执行器（可选 jsdom）
// ============================================================

/**
 * 将 PatchResult 应用到真实 DOM。
 * 若全局没有 document，会把需要 DOM 的操作收集到一个队列里返回。
 * 这里定义为可选的浏览器适配层，纯函数 diff 不依赖它。
 */
export interface PatchContext {
  /** 创建元素 */
  createElement?: (type: string) => unknown;
  /** 创建文本节点 */
  createTextNode?: (text: string) => unknown;
  /** 更新属性 */
  setProperty?: (el: unknown, key: string, value: unknown) => void;
  /** 更新文本 */
  setText?: (el: unknown, text: string) => void;
  /** 插入到 parent 的 index 位置 */
  insert?: (parent: unknown, child: unknown, index: number) => void;
  /** 从 parent 移除 */
  remove?: (parent: unknown, child: unknown) => void;
}

/** 描述一次 patch 中真实 DOM 需要执行的操作（用于测试 mock） */
export interface DOMCommand {
  kind: "create" | "text" | "setProp" | "setText" | "insert" | "remove";
  payload: unknown[];
}

/**
 * 遍历 PatchResult 树，返回应按序执行的 DOMCommand 列表。
 * 这是纯函数，不访问全局 DOM。
 */
export function collectDOMCommands(
  patches: PatchResult[],
  parentRef: string,
): DOMCommand[] {
  const cmds: DOMCommand[] = [];

  function walk(pr: PatchResult, parent: string): string {
    if (pr.rootOp) {
      const op = pr.rootOp;
      switch (op.op) {
        case "CREATE": {
          const ref = `node_${Math.random().toString(36).slice(2, 8)}`;
          if (op.node.type === "TEXT") {
            cmds.push({ kind: "create", payload: [ref, "TEXT", op.node.text] });
          } else {
            cmds.push({ kind: "create", payload: [ref, op.node.type] });
            const props: Props = op.node.props ?? {};
            for (const [k, v] of Object.entries(props)) {
              cmds.push({ kind: "setProp", payload: [ref, k, v] });
            }
          }
          cmds.push({ kind: "insert", payload: [ref, parent] });
          for (const child of pr.childrenOps) {
            walk(child, ref);
          }
          return ref;
        }
        case "INSERT": {
          const ref = `node_${Math.random().toString(36).slice(2, 8)}`;
          cmds.push({ kind: "create", payload: [ref, op.node.type] });
          cmds.push({ kind: "insert", payload: [ref, parent, op.index] });
          for (const child of pr.childrenOps) walk(child, ref);
          return ref;
        }
        case "REMOVE": {
          cmds.push({
            kind: "remove",
            payload: [parent, op.node.key ?? op.node.type],
          });
          return parent;
        }
        case "REPLACE": {
          const ref = `node_${Math.random().toString(36).slice(2, 8)}`;
          cmds.push({ kind: "create", payload: [ref, op.newNode.type] });
          cmds.push({ kind: "insert", payload: [ref, parent] });
          for (const child of pr.childrenOps) walk(child, ref);
          return ref;
        }
        case "MOVE": {
          return parent; // 占位，真实移动由 insert 处理
        }
      }
    }

    // 更新属性
    for (const propOp of pr.propOps) {
      if (propOp.op === "UPDATE_PROPS") {
        const np: Props = propOp.newProps ?? {};
        for (const [k, v] of Object.entries(np)) {
          cmds.push({ kind: "setProp", payload: [parent, k, v] });
        }
      }
    }

    // 子节点
    for (const child of pr.childrenOps) {
      walk(child, parent);
    }
    return parent;
  }

  for (const p of patches) {
    walk(p, parentRef);
  }

  return cmds;
}

// 文件: examples/27-04-mini-fiber.ts
// ============ 手写迷你 Fiber（Fiber tree + beginWork/completeWork + 切片调度）==========
// 纯函数测试：vdom tree → Fiber tree 构建 + 打印双树结构。DOM 操作用 Node 模拟。

/* ============================================================
 * 0. 复用 27-01 的 VNode（简化版, 内联这里避免跨文件依赖）
 * ============================================================ */

const TEXT = Symbol.for("vdom-text") as unknown as string;
type VNodeChild = VNode | string | number | null | false;
interface VNode {
  type: any;
  props: Record<string, any> & {
    key?: any;
    children?: VNodeChild | VNodeChild[];
  };
  children?: VNodeChild[];
}

function h(type: any, props?: any | null, ...children: VNodeChild[]): VNode {
  const p: any = props ? { ...props } : {};
  const flat: VNodeChild[] = [];
  const walk = (list: any[]) => {
    for (const c of list) {
      if (c == null || c === false) continue;
      if (Array.isArray(c)) walk(c);
      else if (typeof c === "string" || typeof c === "number")
        flat.push({ type: TEXT, props: { text: String(c) } });
      else flat.push(c);
    }
  };
  walk([p.children, children].filter((x) => x !== undefined));
  const { children: __, ...rest } = p;
  return { type, props: rest as any, children: flat as VNode[] };
}

/* ============================================================
 * 1. Fiber 节点结构
 * ============================================================ */

export enum Flags {
  NoFlags = 0,
  Placement = 1 << 0, // 需要插入 DOM
  Update = 1 << 1, // props 变化
  Deletion = 1 << 2, // 需要删除
  Text = 1 << 3, // 文本节点
}

export class Fiber {
  type: any; // DOM 标签名 或 TEXT
  props: Record<string, any>;
  child: Fiber | null = null; // 第一个子节点
  sibling: Fiber | null = null; // 下一个兄弟
  return: Fiber | null = null; // 父节点
  flags: Flags = Flags.NoFlags;
  dom: any = null; // 模拟的"真实 DOM"
  alternate: Fiber | null = null; // 双缓存: 上一次渲染的 Fiber
  key: any;
  memoizedProps: Record<string, any> | null = null;
  _rawChildren: VNode[] = []; // 原始 VNode 的 children (不从 props 取)

  constructor(type: any, props: Record<string, any>, key: any = null) {
    this.type = type;
    this.props = props;
    this.key = key;
  }
}

/* ============================================================
 * 2. 从 VNode 创建 Fiber（reconcileChildren: 同层比较 + key 复用）
 * ============================================================ */

function createFiber(vnode: VNode): Fiber {
  const f = new Fiber(vnode.type, vnode.props, vnode.props?.key ?? null);
  f._rawChildren = (vnode.children ?? []) as VNode[];
  // 模拟 DOM 创建: 给每个 Fiber 挂一个假 DOM 对象
  if (vnode.type === TEXT) {
    f.flags |= Flags.Text;
    f.dom = { tag: "#text", text: vnode.props?.text ?? "" };
  } else {
    f.dom = { tag: vnode.type, props: { ...vnode.props }, children: [] };
  }
  f.flags |= Flags.Placement; // 新 Fiber 标记为需要插入
  return f;
}

function isSame(a: VNode, b: VNode): boolean {
  return a.type === b.type && (a.props?.key ?? null) === (b.props?.key ?? null);
}

/** 同层比较 children，构建 Fiber 链表 */
function reconcileChildren(
  parent: Fiber,
  children?: VNodeChild[],
): Fiber | null {
  if (!children || !children.length) return null;

  // 转成 VNode 数组
  const vnodes = children.filter(Boolean) as VNode[];
  // 建立 alternate 的 key 映射
  const altMap = new Map<any, Fiber>();
  let prevFirstChild = parent.alternate?.child ?? null;
  let p = prevFirstChild;
  while (p) {
    if (p.key !== null) altMap.set(p.key, p);
    p = p.sibling;
  }

  let firstChild: Fiber | null = null;
  let prevFiber: Fiber | null = null;

  for (let i = 0; i < vnodes.length; i++) {
    const vnode = vnodes[i];
    let fiber: Fiber;

    // 先尝试 key 复用
    if (vnode.props?.key !== undefined && altMap.has(vnode.props.key)) {
      const alt = altMap.get(vnode.props.key)!;
      if (isSame(alt as any, vnode)) {
        fiber = alt; // 复用
        fiber.flags = Flags.Update;
      } else {
        fiber = createFiber(vnode);
      }
    } else if (prevFirstChild && i < 5 /* 前几个尝试无 key 位置复用 */) {
      // 位置复用
      if (isSame(prevFirstChild as any, vnode)) {
        fiber = prevFirstChild;
        fiber.flags = Flags.Update;
      } else {
        fiber = createFiber(vnode);
      }
      prevFirstChild = prevFirstChild?.sibling ?? null;
    } else {
      fiber = createFiber(vnode);
    }

    fiber.return = parent;
    if (!firstChild) firstChild = fiber;
    else prevFiber!.sibling = fiber;
    prevFiber = fiber;
  }

  return firstChild;
}

/* ============================================================
 * 3. beginWork：自顶向下构建 child + 打 flag
 *    简化版：递归（非循环调度），但保持 Fiber 链表结构
 * ============================================================ */

function beginWork(current: Fiber): Fiber {
  // 如果有 alternate, 先复用它
  if (current.alternate) {
    current = current.alternate;
  }

  // 打 Text flag 的已在 createFiber 里做了, 这里只处理非 text
  if (current.type !== TEXT) {
    // 递归构建 child fiber
    current.child = reconcileChildren(
      current,
      current.props?.children as VNode[],
    );
    // 子节点如果还有子, 递归
    let child = current.child;
    while (child) {
      // 不递归: 只构建一层, 完整递归由 render 循环完成
      child = child.sibling;
    }
  }
  return current;
}

/* ============================================================
 * 4. render 循环（模拟 requestIdleCallback 切片）
 * ============================================================ */

const FRAME_BUDGET_MS = 5;

type WorkLoopStats = {
  frames: number;
  nodesProcessed: number;
  totalMs: number;
  interrupted: number;
};

function collectAllFibers(root: Fiber): Fiber[] {
  // DFS: child → sibling
  const result: Fiber[] = [];
  const stack: Fiber[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    result.push(n);
    // 先 push sibling 再 push child, 保证 child 先处理
    if (n.sibling) stack.push(n.sibling);
    if (n.child) stack.push(n.child);
  }
  return result;
}

/** 简化渲染循环：一次性跑完所有节点，但模拟了 budget 统计 */
export function renderVToFiber(vnode: VNode): {
  root: Fiber;
  stats: WorkLoopStats;
  printTree: () => string;
  printFiber: () => string;
} {
  const root = new Fiber("ROOT", {});
  root.child = createFiber(vnode);

  // 先构建完整的 Fiber 树（简化：一次 DFS 构建完）
  const build = (fiber: Fiber) => {
    if (fiber.type !== TEXT && fiber._rawChildren.length) {
      fiber.child = reconcileChildren(fiber, fiber._rawChildren as VNode[]);
      let c = fiber.child;
      while (c) {
        build(c);
        c = c.sibling;
      }
    }
  };
  build(root.child!);

  // build() 已经完整构建了 Fiber 树并打好 flags，这里只做 budget 切片的模拟遍历
  const all = collectAllFibers(root);

  const start = performance.now();
  let frames = 1;
  let interrupted = 0;
  const budget = FRAME_BUDGET_MS;
  let frameStart = performance.now();

  // 遍历所有节点, 模拟 budget 切片（每处理一个节点检查一次预算）
  for (const f of all) {
    const now = performance.now();
    if (now - frameStart > budget) {
      frames++;
      interrupted++;
      frameStart = now;
    }
    // 简化的 beginWork: 只确保 return 指针正确 (build 已做), 这里不再 reconcile
    if (f.child) f.child.return = f;
    if (f.sibling) f.sibling.return = f.return;
  }

  const totalMs = performance.now() - start;

  // 打印函数
  const printTree = () => {
    const lines: string[] = [];
    const walk = (f: Fiber | null, depth: number) => {
      if (!f) return;
      const pad = "  ".repeat(depth);
      const flagList: string[] = [];
      for (const fl of [
        Flags.Placement,
        Flags.Update,
        Flags.Deletion,
        Flags.Text,
      ]) {
        if (f.flags & fl) flagList.push(Flags[fl]);
      }
      const flagStr = flagList.length ? " [" + flagList.join(",") + "]" : "";
      if (f.type === TEXT) {
        lines.push(`${pad}TEXT "${(f.props as any).text}"${flagStr}`);
      } else {
        lines.push(
          `${pad}<${String(f.type)}${f.key !== null ? ` key=${f.key}` : ""}>${flagStr}`,
        );
      }
      walk(f.child, depth + 1);
      if (f.type !== TEXT) lines.push(`${pad}</${String(f.type)}>`);
      walk(f.sibling, depth); // 继续兄弟
    };
    walk(root.child, 0);
    return lines.join("\n");
  };

  const printFiber = () => {
    const lines: string[] = [];
    const walk = (f: Fiber | null, depth: number) => {
      if (!f) return;
      const pad = "  ".repeat(depth);
      const childInfo = f.child
        ? `child→${String(f.child.type)}`
        : "child→null";
      const sibInfo = f.sibling ? `sib→${String(f.sibling.type)}` : "sib→null";
      const retInfo = f.return ? `ret→${String(f.return.type)}` : "ret→null";
      const flagList: string[] = [];
      for (const fl of [
        Flags.Placement,
        Flags.Update,
        Flags.Deletion,
        Flags.Text,
      ]) {
        if (f.flags & fl) flagList.push(Flags[fl]);
      }
      const flagStr = flagList.length
        ? " flags=[" + flagList.join(",") + "]"
        : "";
      const typeLabel =
        f.type === TEXT ? `TEXT("${(f.props as any).text}")` : String(f.type);
      lines.push(
        `${pad}Fiber(${typeLabel}) ${childInfo} ${sibInfo} ${retInfo}${flagStr}`,
      );
      walk(f.child, depth + 1);
      walk(f.sibling, depth);
    };
    walk(root.child, 0);
    return lines.join("\n");
  };

  return {
    root,
    stats: {
      frames,
      nodesProcessed: all.length,
      totalMs,
      interrupted,
    },
    printTree,
    printFiber,
  };
}

/* ============================================================
 * 5. 测试
 * ============================================================ */

// --- 构造 VNode tree ---
const vnode = h(
  "div",
  { id: "root" },
  h("h1", null, "Hello Mini-Fiber"),
  h(
    "ul",
    { class: "list" },
    h("li", { key: "a" }, "Item A"),
    h("li", { key: "b" }, "Item B"),
    h("li", { key: "c" }, "Item C"),
  ),
  h("footer", null, "Powered by Fiber"),
);

console.log("=== VNode Tree ===");
console.log(`type=div, id=root, children=${vnode.children?.length}`);

console.log("\n=== Fiber Tree (child/sibling/return 链表) ===");
const result = renderVToFiber(vnode);
// DEBUG: 打印 root 的结构
console.log("  [DEBUG] root.type =", result.root.type);
console.log(
  "  [DEBUG] root.child =",
  result.root.child ? `Fiber(${result.root.child.type})` : "null",
);
console.log("  [DEBUG] nodes collected =", result.stats.nodesProcessed);
console.log(result.printFiber());

console.log("\n=== 最终结构（Placement/Update flags） ===");
console.log(result.printTree());

console.log("\n=== WorkLoop 统计 ===");
console.log("  处理节点数:", result.stats.nodesProcessed);
console.log("  总耗时:", result.stats.totalMs.toFixed(3) + "ms");
console.log(
  "  总帧数:",
  result.stats.frames,
  "(budget=" + FRAME_BUDGET_MS + "ms/帧)",
);
console.log("  被中断次数:", result.stats.interrupted);

// --- 测试 2: 构建 alternate 双缓存 ---
console.log("\n=== 测试 2: 双缓存 alternate 构建 ===");
// 构造第二个稍微改动的 vnode
const vnode2 = h(
  "div",
  { id: "root", class: "new" },
  h("h1", null, "Hello Mini-Fiber V2"),
  h(
    "ul",
    { class: "list" },
    h("li", { key: "a" }, "Item A"),
    h("li", { key: "b" }, "Item B"),
    h("li", { key: "c" }, "Item C"),
    h("li", { key: "d" }, "Item D"),
  ),
  h("footer", null, "Updated"),
);

// 第一次 render 完的 root 记为 current
const firstRender = renderVToFiber(vnode);
const secondRender = renderVToFiber(vnode2);

// 给 secondRender 的根挂 alternate → firstRender
secondRender.root.child!.alternate = firstRender.root.child;

// 跑 reconcile: 复用 key=a/b/c, 新增 key=d
const build2 = (fib: Fiber) => {
  // 尝试从 alternate 复用
  const alt = fib.alternate;
  if (alt && alt.type === fib.type) {
    fib.flags = Flags.Update;
    fib.dom = alt.dom; // 复用 DOM
  } else {
    fib.flags |= Flags.Placement;
  }
  fib.alternate = null; // 用毕清空

  if (fib.type !== TEXT && fib._rawChildren.length) {
    fib.child = reconcileChildren(fib, fib._rawChildren);
    // 给新 children 挂上 alternate (从 alt 的 child 开始)
    let oldC = alt?.child ?? null;
    let newC = fib.child;
    while (newC && oldC) {
      if (oldC.type === newC.type && oldC.key === newC.key) {
        newC.alternate = oldC;
        oldC = oldC.sibling;
      }
      newC = newC.sibling;
    }
    // 递归
    let c = fib.child;
    while (c) {
      build2(c);
      c = c.sibling;
    }
  }
};
build2(secondRender.root.child!);

console.log("  Second render fiber 结构:");
console.log(secondRender.printTree());

console.log("\n✓ mini-fiber 验证完毕");

// 文件: cases/04-mini-framework-lab/src/fiber.ts
// ============ Fiber 节点 + beginWork / completeWork + renderLoop 时间片 ============

import type { VNode } from "./vdom.js";

// ============================================================
// Fiber 节点
// ============================================================

export type FiberTag = "HostRoot" | "HostComponent" | "HostText";

export interface Fiber {
  /** 节点类型：HostRoot / HostComponent / HostText */
  tag: FiberTag;
  /** 标签名 / 'TEXT' / 组件函数 */
  type: string | (() => unknown) | null;
  /** 指向父 Fiber */
  parent: Fiber | null;
  /** 第一个子 Fiber */
  child: Fiber | null;
  /** 下一个兄弟 Fiber */
  sibling: Fiber | null;
  /** 上一个兄弟 Fiber */
  return_?: Fiber | null;
  /** 备用 Fiber（上一次渲染的对应节点） */
  alternate: Fiber | null;
  /** props（HostComponent）或 text（HostText） */
  pendingProps: Record<string, unknown> | string | null;
  /** 副作用标记 */
  flags: number;
  /** 子树里的副作用（用于向上冒） */
  subtreeFlags: number;
  /** 索引（keyed list 里用） */
  index: number;
  /** key */
  key?: string | number | null;
}

export const NoFlags = 0b0000000;
export const Placement = 0b0000010;
export const Update = 0b0000100;
export const Deletion = 0b0001000;
export const TextUpdate = 0b0010000;

// ============================================================
// Fiber 工厂
// ============================================================

export function createFiber(
  tag: FiberTag,
  type: string | (() => unknown) | null,
  pendingProps: Record<string, unknown> | string | null,
  key?: string | number | null,
): Fiber {
  return {
    tag,
    type,
    parent: null,
    child: null,
    sibling: null,
    alternate: null,
    pendingProps,
    flags: NoFlags,
    subtreeFlags: NoFlags,
    index: 0,
    key: key ?? null,
  };
}

/** 从 VNode 创建 HostComponent / HostText Fiber */
export function createFiberFromVNode(vnode: VNode): Fiber {
  if (vnode.type === "TEXT") {
    return createFiber("HostText", "TEXT", vnode.text ?? "", vnode.key);
  }
  // 把 vnode.children 合入 pendingProps，让 updateHostComponent 能取到
  const mergedProps: Record<string, unknown> = {
    ...(vnode.props ?? {}),
    children: vnode.children,
  };
  return createFiber(
    "HostComponent",
    vnode.type as string,
    mergedProps,
    vnode.key,
  );
}

/** 创建 HostRoot Fiber */
export function createHostRootFiber(): Fiber {
  return createFiber("HostRoot", null, null);
}

// ============================================================
// beginWork —— 向下构建子 Fiber
// ============================================================

let current: Fiber | null = null;
let workInProgress: Fiber | null = null;
let didMutate = false;

/** 重置内部状态（测试用） */
export function __resetFiber(): void {
  current = null;
  workInProgress = null;
  didMutate = false;
}

/**
 * 对一个 Fiber 做 beginWork：
 *  - 根据 tag 分发处理
 *  - 构建 child Fiber 链表
 *  - 返回「应该开始构建的 child」
 */
function beginWork(fiber: Fiber): Fiber | null {
  switch (fiber.tag) {
    case "HostRoot":
      return updateHostRoot(fiber);
    case "HostComponent":
      return updateHostComponent(fiber);
    case "HostText":
      // Text 节点没有子
      return null;
  }
}

function updateHostRoot(fiber: Fiber): Fiber | null {
  // HostRoot 的 pendingProps 约定是 VNode
  const vnode = fiber.pendingProps as unknown as VNode;
  // HostRoot 不标记 Placement（它是容器）
  const prev = fiber.alternate;
  void prev;
  // 子 VNode 是 root vnode
  if (vnode) {
    fiber.child = reconcileChildFibers(fiber, fiber.child, vnode);
  }
  return fiber.child;
}

function updateHostComponent(fiber: Fiber): Fiber | null {
  // 检查是不是初次挂载
  const prev = fiber.alternate;
  if (prev === null) {
    fiber.flags |= Placement;
  } else if (prev.pendingProps !== fiber.pendingProps) {
    fiber.flags |= Update;
  }

  // 子节点从父 props.children 拿到（约定：HostComponent 的 pendingProps 里 children 是 { children: VNode[] }）
  const props = fiber.pendingProps as Record<string, unknown> | null;
  const childVNodes: VNode[] =
    props && Array.isArray(props.children) ? (props.children as VNode[]) : [];

  fiber.child = reconcileChildrenArray(fiber, fiber.child, childVNodes);
  return fiber.child;
}

function reconcileChildFibers(
  parentFiber: Fiber,
  oldFirstChild: Fiber | null,
  newVNode: VNode | null,
): Fiber | null {
  if (!newVNode) return null;
  // 单节点
  return placeSingleChild(
    reconcileSingleFiber(oldFirstChild, newVNode, parentFiber),
  );
}

function placeSingleChild(newFiber: Fiber | null): Fiber | null {
  if (newFiber && newFiber.alternate === null) {
    newFiber.flags |= Placement;
  }
  return newFiber;
}

function reconcileSingleFiber(
  old: Fiber | null,
  newVNode: VNode,
  parentFiber: Fiber,
): Fiber {
  if (old && isSameFiberType(old, newVNode)) {
    // 复用
    const newFiber = createFiberFromVNode(newVNode);
    newFiber.alternate = old;
    newFiber.parent = parentFiber;
    // 复用 old 的 child 先不处理，由 completeWork / beginWork 继续下去
    return newFiber;
  }
  // 替换：标记 Deletion
  if (old) old.flags |= Deletion;
  didMutate = true;
  const newFiber = createFiberFromVNode(newVNode);
  newFiber.parent = parentFiber;
  return newFiber;
}

function reconcileChildrenArray(
  parentFiber: Fiber,
  oldFirstChild: Fiber | null,
  newChildren: VNode[],
): Fiber | null {
  let prevSibling: Fiber | null = null;
  let firstNew: Fiber | null = null;
  let oldFiber = oldFirstChild;
  let lastPlacedIndex = 0;

  // 先按旧顺序 key 建索引，方便移动检测
  const oldKeyToFiber = new Map<string | number, Fiber>();
  let temp = oldFirstChild;
  while (temp) {
    if (temp.key != null) oldKeyToFiber.set(temp.key, temp);
    temp = temp.sibling;
  }

  let idx = 0;
  for (const newChild of newChildren) {
    let newFiber: Fiber | null = null;

    if (newChild.key != null && oldKeyToFiber.has(newChild.key!)) {
      // keyed 复用
      const oldMatch = oldKeyToFiber.get(newChild.key!)!;
      if (isSameFiberType(oldMatch, newChild)) {
        newFiber = createFiberFromVNode(newChild);
        newFiber.alternate = oldMatch;
        // 移动检测：找到 oldMatch 在 old 序列里的位置
        const oldIndex = findOldIndex(oldFirstChild, oldMatch);
        if (oldIndex < lastPlacedIndex) {
          newFiber.flags |= Placement;
        } else {
          lastPlacedIndex = oldIndex;
        }
      } else {
        // 类型不同：删旧 + 建新
        oldMatch.flags |= Deletion;
        didMutate = true;
      }
    }

    if (!newFiber) {
      // 尝试按顺序复用
      if (oldFiber && isSameFiberType(oldFiber, newChild)) {
        newFiber = createFiberFromVNode(newChild);
        newFiber.alternate = oldFiber;
        oldFiber = oldFiber.sibling;
      } else {
        if (oldFiber) {
          oldFiber.flags |= Deletion;
          didMutate = true;
          oldFiber = oldFiber.sibling;
        }
        newFiber = createFiberFromVNode(newChild);
        newFiber.flags |= Placement;
      }
    }

    newFiber!.parent = parentFiber;
    newFiber!.index = idx++;

    if (prevSibling === null) {
      firstNew = newFiber!;
    } else {
      prevSibling.sibling = newFiber!;
    }
    prevSibling = newFiber!;
  }

  // 剩余 old fiber 全部 Deletion
  let remain = oldFiber;
  while (remain) {
    remain.flags |= Deletion;
    didMutate = true;
    remain = remain.sibling;
  }

  return firstNew;
}

function findOldIndex(first: Fiber | null, target: Fiber): number {
  let idx = 0;
  let cur = first;
  while (cur) {
    if (cur === target) return idx;
    idx++;
    cur = cur.sibling;
  }
  return -1;
}

function isSameFiberType(fiber: Fiber, vnode: VNode): boolean {
  if (fiber.key !== vnode.key) return false;
  if (fiber.type !== vnode.type) return false;
  return true;
}

// ============================================================
// completeWork —— 归并副作用
// ============================================================

/** Fiber 构建日志（测试用） */
export const buildLog: Array<{
  fiberType: string;
  phase: "begin" | "complete";
}> = [];

export function __resetBuildLog(): void {
  buildLog.length = 0;
}

function completeWork(fiber: Fiber): Fiber | null {
  // 归并子树 flags
  let child = fiber.child;
  while (child) {
    fiber.subtreeFlags |= child.flags | child.subtreeFlags;
    child = child.sibling;
  }
  return fiber.sibling;
}

// ============================================================
// renderLoop —— 用时间片推进
// ============================================================

export interface RenderOptions {
  /** 每帧预算毫秒数，默认 5 */
  frameBudgetMs?: number;
  /** 是否同步完成（测试时设为 true 可以避免异步） */
  sync?: boolean;
}

export interface RenderResult {
  root: Fiber;
  /** 构建过程（begin -> complete）的顺序日志 */
  buildLog: Array<{ fiberType: string; phase: "begin" | "complete" }>;
  /** 是否发生了 DOM 级的变化 */
  didMutate: boolean;
}

/**
 * 把 root VNode 渲染成 Fiber 树，返回 HostRoot Fiber。
 * sync=true 时立即跑完整棵树；否则用时间片。
 */
export function render(
  vnode: VNode,
  options: RenderOptions = {},
): RenderResult {
  const { frameBudgetMs = 5, sync = false } = options;

  __resetFiber();
  __resetBuildLog();
  didMutate = false;

  // 准备 HostRoot
  const hostRoot = createHostRootFiber();
  // HostRoot 的 child 指向 vnode：在 beginWork 里用到
  hostRoot.pendingProps = vnode as unknown as Record<string, unknown>;
  // 这就是我们的 workInProgress
  workInProgress = hostRoot;

  if (sync) {
    // 直接跑完整棵树：从 hostRoot 开始
    syncRenderRoot(hostRoot);
    current = hostRoot;
    return { root: hostRoot, buildLog: [...buildLog], didMutate };
  }

  // 异步时间片：返回一个 Promise 版 render
  // 为了保持 sync 风格的返回值，这里也提供同步入口；时间片模式单独暴露 renderAsync
  void frameBudgetMs;
  return { root: hostRoot, buildLog: [...buildLog], didMutate };
}

function syncRenderRoot(hostRoot: Fiber): void {
  // 我们需要 hostRoot 的 alternate 来判断初次 vs 更新
  hostRoot.alternate = current; // 首次时 current 是 null

  // 简单 DFS：beginWork 先下到最左叶子，再 completeWork 回溯
  // 这样比循环版 fiber 简单且能保持正确的构建顺序
  function walkBeginComplete(fiber: Fiber): void {
    buildLog.push({ fiberType: String(fiber.type ?? "Root"), phase: "begin" });
    const child = beginWork(fiber);
    if (child) {
      walkBeginComplete(child);
    }
    completeWork(fiber);
    buildLog.push({
      fiberType: String(fiber.type ?? "Root"),
      phase: "complete",
    });

    let sib = fiber.sibling;
    while (sib) {
      buildLog.push({ fiberType: String(sib.type ?? "Root"), phase: "begin" });
      const sc = beginWork(sib);
      if (sc) walkBeginComplete(sc);
      completeWork(sib);
      buildLog.push({
        fiberType: String(sib.type ?? "Root"),
        phase: "complete",
      });
      sib = sib.sibling;
    }
  }

  walkBeginComplete(hostRoot);
}

/**
 * 真正的时间片模式：每帧预算 ms，超出就停，等待下一个 idle 再续。
 * 返回 Promise<RenderResult>
 */
export function renderAsync(
  vnode: VNode,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const { frameBudgetMs = 5 } = options;

  __resetFiber();
  __resetBuildLog();
  didMutate = false;

  const hostRoot = createHostRootFiber();
  hostRoot.pendingProps = vnode as unknown as Record<string, unknown>;
  hostRoot.alternate = current;

  return new Promise((resolve) => {
    renderLoopImpl(hostRoot, frameBudgetMs, () => {
      current = hostRoot;
      resolve({ root: hostRoot, buildLog: [...buildLog], didMutate });
    });
  });
}

/**
 * 模拟 requestIdleCallback 的 renderLoop：
 * 每次用 setTimeout 16ms 模拟一帧，frameBudgetMs 是可用于 render 的时间预算。
 * 我们用显式的栈来模拟 DFS，支持中途暂停。
 */
function renderLoopImpl(
  hostRoot: Fiber,
  budgetMs: number,
  done: () => void,
): void {
  // 栈元素: { fiber, phase: 'begin' | 'complete' }
  const stack: Array<{ fiber: Fiber; phase: "begin" | "complete" }> = [
    { fiber: hostRoot, phase: "begin" },
  ];

  function step(): boolean {
    const start = performance.now();

    while (stack.length > 0) {
      if (performance.now() - start > budgetMs) {
        // 预算用完：保留栈内容，下一帧续
        return false;
      }

      const frame = stack.pop()!;
      const { fiber, phase } = frame;

      if (phase === "begin") {
        buildLog.push({
          fiberType: String(fiber.type ?? "Root"),
          phase: "begin",
        });
        const child = beginWork(fiber);
        // 先压入 complete，再压入 child 链
        stack.push({ fiber, phase: "complete" });
        if (child) {
          // 压 child → sibling，顺序：从最后一个 sibling 开始压，这样 pop 时先拿第一个
          let c: Fiber | null = child;
          const temp: Fiber[] = [];
          while (c) {
            temp.push(c);
            c = c.sibling;
          }
          // reverse 后压入
          for (let i = temp.length - 1; i >= 0; i--) {
            stack.push({ fiber: temp[i], phase: "begin" });
          }
        }
      } else {
        buildLog.push({
          fiberType: String(fiber.type ?? "Root"),
          phase: "complete",
        });
        completeWork(fiber);
        if (fiber === hostRoot) {
          // 整棵树完成
          return true;
        }
      }
    }

    return true;
  }

  function tick() {
    if (step()) {
      done();
      return;
    }
    // 下一帧再继续
    setTimeout(tick, 16);
  }

  tick();
}

// ============================================================
// 导出一个从 HostRoot 提取 vdom 结构的工具（测试用）
// ============================================================

export function fiberToTreeString(fiber: Fiber, indent = 0): string {
  const pad = "  ".repeat(indent);
  let s = `${pad}<${fiber.type ?? "Root"}`;
  if (fiber.key != null) s += ` key=${String(fiber.key)}`;
  if (fiber.flags) s += ` flags=${fiber.flags.toString(2)}`;
  s += ">";
  if (fiber.tag === "HostText" && typeof fiber.pendingProps === "string") {
    s += ` "${fiber.pendingProps}"`;
  }
  let child = fiber.child;
  while (child) {
    s += "\n" + fiberToTreeString(child, indent + 1);
    child = child.sibling;
  }
  return s;
}

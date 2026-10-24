// 文件: examples/48-02-widget-reconcile.ts
// ============ Widget/Element 协调器:为什么 key 能救回被误删的输入框状态 ============
// 设计要点:
// 1) Flutter 的 Widget 是不可变配置,Element 才是持有 State 的长期对象;
// 2) 更新时先按「同类型 + 同 key」找可复用的旧 Element,找不到才新建;
// 3) 没有 key 时只能按「位置 + 类型」匹配:列表插入/排序会把状态错配到别的行。

type WidgetType = "TextField" | "Text" | "Row";

interface WidgetNode {
  type: WidgetType;
  key?: string;
  label: string;
  children?: WidgetNode[];
}

interface ElementNode {
  widget: WidgetNode;
  /** 模拟 State:输入框里已输入的内容 */
  state: string;
  children: ElementNode[];
}

function describe(w: WidgetNode): string {
  return `${w.type}${w.key ? `#${w.key}` : ""}(${w.label})`;
}

function mount(w: WidgetNode): ElementNode {
  return {
    widget: w,
    state: w.type === "TextField" ? `初始:${w.label}` : "",
    children: (w.children ?? []).map(mount),
  };
}

interface ReconcileStats {
  reused: string[];
  created: string[];
  removed: string[];
}

/** 核心:key 优先,其次同位置同类型;类型不同一律重建 */
function reconcileChildren(
  oldChildren: ElementNode[],
  newChildren: WidgetNode[],
): { elements: ElementNode[]; stats: ReconcileStats } {
  const stats: ReconcileStats = { reused: [], created: [], removed: [] };
  const used = new Set<ElementNode>();
  const next: ElementNode[] = [];

  for (let i = 0; i < newChildren.length; i++) {
    const w = newChildren[i];
    let matched = oldChildren.find(
      (el) =>
        !used.has(el) &&
        el.widget.type === w.type &&
        w.key !== undefined &&
        el.widget.key === w.key,
    );
    if (!matched) {
      matched = oldChildren.find(
        (el) =>
          !used.has(el) &&
          el.widget.type === w.type &&
          w.key === undefined &&
          el.widget.key === undefined &&
          oldChildren.indexOf(el) === i,
      );
    }

    if (matched) {
      used.add(matched);
      stats.reused.push(`${describe(w)} 状态保留=${matched.state || "-"}`);
      // 复用 Element,但用新 Widget 覆盖配置;State 原样保留
      next.push({
        widget: w,
        state: matched.state,
        children: (w.children ?? []).map(mount),
      });
    } else {
      stats.created.push(describe(w));
      next.push(mount(w));
    }
  }

  for (const el of oldChildren) {
    if (!used.has(el)) stats.removed.push(describe(el.widget));
  }
  return { elements: next, stats };
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

// ---------------- 场景 1:无 key 的列表插入 ----------------
const oldList = [mount({ type: "TextField", label: "A" }), mount({ type: "TextField", label: "B" })];
oldList[0].state = "用户输入 A";
oldList[1].state = "用户输入 B";

const noKey = reconcileChildren(oldList, [
  { type: "TextField", label: "新行" },
  { type: "TextField", label: "A" },
  { type: "TextField", label: "B" },
]);
console.log("=== 无 key:首行插入 ===");
console.log("复用:", noKey.stats.reused);
// 位置 0 的旧 A 被当成「新行」的 Element,A 的输入内容串到了新行
assert(noKey.elements[0].state === "用户输入 A", "无 key 时状态会错配到新插入的行");

// ---------------- 场景 2:带 key 的同一操作 ----------------
const keyedOld = [
  mount({ type: "TextField", key: "a", label: "A" }),
  mount({ type: "TextField", key: "b", label: "B" }),
];
keyedOld[0].state = "用户输入 A";
keyedOld[1].state = "用户输入 B";

const keyed = reconcileChildren(keyedOld, [
  { type: "TextField", key: "c", label: "新行" },
  { type: "TextField", key: "a", label: "A" },
  { type: "TextField", key: "b", label: "B" },
]);
console.log("\n=== 有 key:首行插入 ===");
console.log("复用:", keyed.stats.reused);
console.log("新建:", keyed.stats.created);
assert(keyed.elements[1].state === "用户输入 A", "key 命中后 A 的状态应保留");
assert(keyed.elements[0].state === "初始:新行", "新行应是全新 State");

// ---------------- 场景 3:类型变化触发重建 ----------------
const typeChanged = reconcileChildren(keyedOld, [
  { type: "Text", key: "a", label: "A" },
  { type: "TextField", key: "b", label: "B" },
]);
console.log("\n=== 类型变化 ===");
console.log("清除:", typeChanged.stats.removed, "| 新建:", typeChanged.stats.created);
assert(typeChanged.stats.created.includes("Text#a(A)"), "类型变化必须重建 Element");

console.log("\n结论:key 不是性能优化开关,而是「身份声明」——它决定 State 跟着谁走。");

// 标记为模块,避免与其它示例的顶层变量重名
export {};

// 文件: examples/77-03-jank-classifier.ts
// ============ 卡顿分类器：长任务归因 + TBT/掉帧计算 + 修复优先级 ============
// 把 77.3 的卡顿诊断流程代码化：同一段「卡顿」可能来自加载解析、水合、输入响应、
// 滚动渲染或布局抖动。本示例用时间窗与来源标记把长任务归类，算出 TBT 与掉帧数，
// 再按「用户可感知程度 + 修复成本」给出优先级，避免一上来就盲目上骨架屏或懒加载。

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ 断言失败：${msg}`);
    process.exit(1);
  }
}

// ---------------- 1. 输入：一次会话的性能时间线 ----------------

type TaskSource = "script" | "layout" | "style" | "gc";

interface LongTask {
  /** 相对页面开始的毫秒数 */
  start: number;
  duration: number;
  source: TaskSource;
}

interface Markers {
  /** 框架水合开始时间（SSR/CSR 都可能有） */
  hydrationStart?: number;
  /** 用户输入（点击/输入）的时间点 */
  inputs?: number[];
  /** 滚动开始与结束 */
  scroll?: { start: number; end: number };
}

const SESSION: LongTask[] = [
  { start: 180, duration: 120, source: "script" },   // 首屏 JS 解析执行
  { start: 420, duration: 80, source: "script" },    // 第三方 SDK 初始化
  { start: 900, duration: 60, source: "style" },     // 首屏样式计算
  { start: 1400, duration: 180, source: "script" },  // 列表首次渲染
  { start: 2600, duration: 140, source: "layout" },  // 图片插入后同步布局
  { start: 5200, duration: 240, source: "script" },  // 水合后的大组件渲染
  { start: 7100, duration: 70, source: "gc" },
  { start: 7300, duration: 160, source: "script" },  // 点击后的慢处理
  { start: 8600, duration: 90, source: "layout" },
  { start: 9100, duration: 110, source: "layout" },  // 滚动中连续布局
];

const MARKERS: Markers = {
  hydrationStart: 5000,
  inputs: [7200],
  scroll: { start: 8800, end: 9600 },
};

// ---------------- 2. 归因：时间窗优先于「看起来像」 ----------------

type Category =
  | "load-parse"
  | "hydration"
  | "input-response"
  | "scroll-layout"
  | "layout-thrash"
  | "gc";

function classify(task: LongTask, markers: Markers): Category {
  // 输入响应：输入事件后 500ms 内出现的长任务，优先算到交互
  if (markers.inputs?.some((t) => task.start >= t && task.start <= t + 500)) {
    return "input-response";
  }
  // 滚动期：滚动窗口内的一切长任务都会直接表现为掉帧
  if (markers.scroll && task.start >= markers.scroll.start && task.start <= markers.scroll.end) {
    return "scroll-layout";
  }
  // 水合窗：水合开始后 2 秒内，框架组件树同步渲染
  if (markers.hydrationStart !== undefined && task.start >= markers.hydrationStart && task.start <= markers.hydrationStart + 2000) {
    return "hydration";
  }
  if (task.source === "gc") return "gc";
  if (task.source === "layout") return "layout-thrash";
  return "load-parse";
}

// ---------------- 3. 指标：TBT 与掉帧 ----------------

const FRAME_BUDGET_MS = 1000 / 60; // 60Hz ≈ 16.7ms

/** TBT = 所有 >50ms 长任务超出 50ms 的部分之和（Total Blocking Time） */
function totalBlockingTime(tasks: LongTask[]): number {
  return tasks.reduce((sum, t) => (t.duration > 50 ? sum + (t.duration - 50) : sum), 0);
}

/** 掉帧估算：按 16.7ms 帧预算，一个长任务会占满多少帧 */
function droppedFrames(tasks: LongTask[]): number {
  return tasks.reduce((sum, t) => sum + Math.floor(t.duration / FRAME_BUDGET_MS), 0);
}

/** INP 近似：输入后最长一次「处理 + 呈现」延迟 */
function approximateInp(tasks: LongTask[], markers: Markers): number {
  const input = markers.inputs?.[0];
  if (input === undefined) return 0;
  const inWindow = tasks.filter((t) => t.start >= input && t.start <= input + 1000);
  return inWindow.reduce((max, t) => Math.max(max, t.start - input + t.duration), 0);
}

// ---------------- 4. 修复建议：按感知程度 × 成本排序 ----------------

interface Advice {
  category: Category;
  fix: string;
  impact: "high" | "medium" | "low";
  effort: "low" | "medium" | "high";
}

const PLAYBOOK: Record<Category, Advice> = {
  "load-parse": { category: "load-parse", fix: "路由级代码分割 + 重库按需加载 + 第三方脚本延迟挂载", impact: "high", effort: "low" },
  hydration: { category: "hydration", fix: "收紧 'use client' 边界 + 流式 Suspense + 组件级懒水合", impact: "high", effort: "medium" },
  "input-response": { category: "input-response", fix: "事件处理切片（scheduler.yield）+ 乐观更新 + 计算移入 Worker", impact: "high", effort: "medium" },
  "scroll-layout": { category: "scroll-layout", fix: "虚拟列表 + content-visibility + 滚动回调 rAF 合并", impact: "high", effort: "medium" },
  "layout-thrash": { category: "layout-thrash", fix: "读写分离（先批量读 offset，再统一写样式）+ 动画改 transform", impact: "medium", effort: "low" },
  gc: { category: "gc", fix: "减少临时对象与闭包常驻 + 分页释放大数组引用", impact: "low", effort: "medium" },
};

function priority(a: Advice): number {
  const impactScore = { high: 3, medium: 2, low: 1 }[a.impact];
  const effortScore = { low: 3, medium: 2, high: 1 }[a.effort];
  return impactScore * 2 + effortScore; // 先看感知，再看成本
}

// ---------------- 5. 运行 ----------------

const grouped = SESSION.map((task) => ({ task, category: classify(task, MARKERS) }));
console.log("=== 长任务归因 ===");
console.table(
  grouped.map(({ task, category }) => ({
    start: task.start,
    duration: task.duration,
    source: task.source,
    category,
  })),
);

const tbt = totalBlockingTime(SESSION);
const frames = droppedFrames(SESSION);
const inp = approximateInp(SESSION, MARKERS);

const categories = [...new Set(grouped.map((g) => g.category))];
const ranked = categories
  .map((c) => PLAYBOOK[c])
  .sort((a, b) => priority(b) - priority(a));

console.log(`\nTBT=${tbt}ms 掉帧≈${frames} INP≈${inp}ms`);
console.log("\n=== 修复优先级 ===");
console.table(ranked.map((a, i) => ({ rank: i + 1, ...a, score: priority(a) })));

// ---------------- 6. 硬断言 ----------------

assert(tbt === 750, `TBT 应为 750ms，实际 ${tbt}`);
assert(frames === 70, `掉帧数应为 70，实际 ${frames}`);
assert(inp === 260, `INP 近似应为 260ms，实际 ${inp}`);

assert(classify(SESSION[0], MARKERS) === "load-parse", "首屏脚本应归为 load-parse");
assert(classify(SESSION[5], MARKERS) === "hydration", "水合窗内的长任务应归为 hydration");
assert(classify(SESSION[7], MARKERS) === "input-response", "点击后的长任务应归为 input-response");
assert(classify(SESSION[9], MARKERS) === "scroll-layout", "滚动窗内的任务应归为 scroll-layout");
assert(classify(SESSION[6], MARKERS) === "gc", "GC 任务应单独归类");

// 输入响应与水合都是高感知问题，应排在最前
assert(ranked[0].impact === "high", "优先级第一项必须是高感知问题");
assert(ranked.findIndex((a) => a.category === "input-response") < ranked.findIndex((a) => a.category === "gc"), "输入响应应排在 GC 之前");

console.log("\n✅ 卡顿分类示例全部断言通过");

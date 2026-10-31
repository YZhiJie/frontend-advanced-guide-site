// 文件: examples/25-09-perf-measure.ts —— Performance API 度量与 PerformanceObserver
// ============ performance.mark/measure + PerformanceObserver,Node 16+ 原生可跑============
export {}; // 顶层 await 需要 ESM 模块语义

// ── 姿势一:mark + measure —— 给「代码区间」起名字,而不是裸打 performance.now 差值 ──
// 命名后的区间会进入性能时间线:DevTools Performance 面板、上报、getEntries 全都能查
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const obs: PerformanceEntry[] = [];
const po = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) obs.push(e);
});
// buffered: false —— 只收「订阅之后」的条目;要收历史条目用 buffered: true(浏览器专属参数)
po.observe({ entryTypes: ["measure"] });

performance.mark("parse:start");
await sleep(15);
performance.mark("parse:end");
performance.measure("解析阶段", "parse:start", "parse:end");

performance.mark("render:start");
await sleep(25);
performance.mark("render:end");
performance.measure("渲染阶段", "render:start", "render:end");

await sleep(10); // 等 observer 回调送达(异步)

console.log("measure 条目(名称与是否大于 0,duration 随机器浮动):");
for (const e of obs) {
  console.log(`  ${e.name}: ${e.duration > 0 ? "已计时" : "异常"}`);
}

// ── 姿势二:measure 带 detail —— 元数据跟随条目上报,不用平行数组对齐 ──
performance.mark("op:start");
await sleep(5);
performance.measure("关键操作", {
  start: "op:start",
  detail: { route: "/dashboard", attempt: 2 }, // detail 会出现在 entry.detail
});
await sleep(5);
const named = performance.getEntriesByName("关键操作").at(-1);
const detail = (
  named as unknown as { detail?: { route?: string; attempt?: number } }
)?.detail;
console.log("detail 元数据:", detail?.route, "attempt=" + detail?.attempt);

// ── 闭环:上报后必须清理,否则长驻页面里 buffer 无限增长 ──
po.disconnect();
performance.clearMarks();
performance.clearMeasures();
console.log("已 disconnect + clearMarks/clearMeasures(长驻页面的标配收尾)");

// 坑点速记:
//  1) performance.now() 只用于「算差值」;要「看得见」的区间一律 mark/measure
//  2) PerformanceObserver 回调是异步的,别指望 measure 完立刻同步拿到条目
//  3) 长驻应用记得 disconnect/clear——entry 缓冲与监听都是要还的
//  4) 浏览器端算 FP/FCP/LCP 请用 PerformanceObserver 的 paint/LCP 条目或 web-vitals 库,勿手搓
